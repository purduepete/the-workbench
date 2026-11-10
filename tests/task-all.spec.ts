import { expect, test, closeDialog } from './fixtures';

for (const theme of ['midnight', 'light']) {
    test(`All shows Home and Work tasks and persists in ${theme}`, async ({ page }) => {
        await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/tasks');
        const filter = page.getByRole('group', { name: 'Task section', exact: true });
        await expect(filter.getByRole('button')).toHaveText(['All', 'Home', 'Work']);
        for (const category of ['Home', 'Work']) {
            await filter.getByRole('button', { name: category, exact: true }).click();
            await page.getByRole('button', { name: 'New task', exact: true }).click();
            const dialog = page.getByRole('dialog');
            const categoryBox = await dialog.getByRole('group', { name: 'Task category' }).boundingBox();
            const titleBox = await dialog.getByLabel('Task title', { exact: true }).locator('..').boundingBox();
            if (!categoryBox || !titleBox) throw new Error('Task editor fields are missing.');
            expect(categoryBox.y + categoryBox.height).toBeLessThanOrEqual(titleBox.y);
            await expect(dialog.getByRole('group', { name: 'Task category' }).getByRole('button')).toHaveText([
                'Home',
                'Work',
            ]);
            await dialog.getByLabel('Task title', { exact: true }).fill(`${category} All example ${theme}`);
            await dialog
                .getByRole('textbox', { name: 'Details', exact: true })
                .fill(
                    Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1} with **formatted details**.`).join(
                        '\n\n'
                    )
                );
            await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
        }
        await filter.getByRole('button', { name: 'All', exact: true }).click();
        await expect(page.getByText('Select Home or Work to reorder tasks.', { exact: true })).toHaveCount(0);
        for (const category of ['Home', 'Work']) {
            await expect(
                page.getByRole('heading', { name: `${category} All example ${theme}`, exact: true })
            ).toBeVisible();
        }
        await expect(page.locator('.task-drag-handle').first()).toBeDisabled();
        await expect(page.getByRole('button', { name: /^Add task for / })).toHaveCount(0);
        await expect(page.getByRole('status').first()).toHaveText('Synced');
        await page.reload();
        await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
        for (const category of ['Home', 'Work']) {
            await expect(
                page.getByRole('heading', { name: `${category} All example ${theme}`, exact: true })
            ).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.getByRole('button', { name: 'Calendar', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'New task', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await closeDialog(dialog);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(filter.getByRole('button')).toHaveText(['All', 'Home', 'Work']);
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(page.getByRole('heading', { name: `Work All example ${theme}`, exact: true })).toHaveCount(0);
        const list = page.locator('.task-list-transition');
        await expect(list).toHaveCSS('opacity', '1');
        const transitions = await page.evaluate(async () => {
            const list = document.querySelector<HTMLElement>('.task-list-transition');
            const transitions = [];
            for (const target of ['Work', 'All', 'Home', 'All', 'Work']) {
                const work = [
                    ...document.querySelectorAll<HTMLButtonElement>('[aria-label="Task section"] button'),
                ].find((button) => button.textContent === target);
                if (!list || !work) throw new Error('Task filter or list is missing.');
                work.click();
                const samples: { opacity: number; leaving: boolean; text: string; height: number }[] = [];
                const start = performance.now();
                await new Promise<void>((resolve) => {
                    const sample = () => {
                        samples.push({
                            opacity: Number(getComputedStyle(list).opacity),
                            leaving: list.dataset.leaving === 'true',
                            text: list.textContent ?? '',
                            height: list.querySelector('.task-details')?.getBoundingClientRect().height ?? 0,
                        });
                        if (performance.now() - start < 650) requestAnimationFrame(sample);
                        else resolve();
                    };
                    requestAnimationFrame(sample);
                });
                transitions.push(samples);
            }
            return transitions;
        });
        const samples = transitions[0];
        expect(samples.some((sample) => sample.leaving && sample.opacity > 0 && sample.opacity < 1)).toBe(true);
        expect(samples.some((sample) => !sample.leaving && sample.opacity > 0 && sample.opacity < 1)).toBe(true);
        for (const transition of transitions) {
            const heights = transition.map((sample) => sample.height);
            expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
        }
        expect(
            samples
                .filter((sample) => sample.leaving)
                .every((sample) => sample.text.includes(`Home All example ${theme}`))
        ).toBe(true);
        await expect(page.getByRole('heading', { name: `Work All example ${theme}`, exact: true })).toBeVisible();
        await filter.getByRole('button', { name: 'All', exact: true }).evaluate((button) => {
            if (!(button instanceof HTMLButtonElement)) throw new Error('Task filter button is missing.');
            button.click();
        });
        await filter.getByRole('button', { name: 'Home', exact: true }).evaluate((button) => {
            if (!(button instanceof HTMLButtonElement)) throw new Error('Task filter button is missing.');
            button.click();
        });
        await expect(list).toHaveAttribute('data-leaving', 'false');
        await expect(page.getByRole('heading', { name: `Work All example ${theme}`, exact: true })).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await filter.getByRole('button', { name: 'Work', exact: true }).click();
        await expect(list).toHaveAttribute('data-leaving', 'false');
        await expect(page.getByRole('heading', { name: `Work All example ${theme}`, exact: true })).toBeVisible();
        expect(
            await list.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))
        ).toBeLessThanOrEqual(0.00001);
    });
}
