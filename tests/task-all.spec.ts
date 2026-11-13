import { chip, expect, test, closeDialog } from './fixtures';

for (const theme of ['midnight', 'light']) {
    test(`Home and Work are the only task sections, and a saved All opens Home, in ${theme}`, async ({ page }) => {
        await page.addInitScript((theme) => {
            localStorage.setItem('the-workbench.theme-preference', theme);
            if (!sessionStorage.getItem('seeded')) {
                localStorage.setItem('the-workbench.task-category', 'all');
                sessionStorage.setItem('seeded', 'true');
            }
        }, theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/tasks');
        const filter = page.getByRole('group', { name: 'Task section', exact: true });
        await expect(filter.getByRole('button')).toHaveText(['Home', 'Work']);
        await expect(filter.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-pressed', 'true');
        for (const category of ['Home', 'Work']) {
            await filter.getByRole('button', { name: category, exact: true }).click();
            await page.getByRole('button', { name: 'New task', exact: true }).click();
            const dialog = page.getByRole('dialog');
            const section = chip(dialog, 'Section');
            await expect(section).toHaveAccessibleName(`Section: ${category}`);
            const sectionBox = await section.boundingBox();
            const titleBox = await dialog.getByLabel('Title', { exact: true }).boundingBox();
            if (!sectionBox || !titleBox) throw new Error('Task editor fields are missing.');
            expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(sectionBox.y);
            await section.click();
            await expect(page.getByRole('option')).toHaveText(['Home', 'Work']);
            await page.keyboard.press('Escape');
            await dialog.getByLabel('Title', { exact: true }).fill(`${category} section example ${theme}`);
            await dialog
                .getByRole('textbox', { name: 'Details', exact: true })
                .fill(
                    Array.from({ length: 8 }, (_, index) => `Paragraph ${index + 1} with **formatted details**.`).join(
                        '\n\n'
                    )
                );
            await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
        }
        await expect(page.getByRole('heading', { name: `Work section example ${theme}`, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: `Home section example ${theme}`, exact: true })).toHaveCount(0);
        await expect(page.locator('.local-badge')).toHaveText('Synced');
        await page.reload();
        await expect(filter.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.getByRole('button', { name: 'New task', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(chip(dialog, 'Section')).toHaveAccessibleName('Section: Work');
        await closeDialog(dialog);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(filter.getByRole('button')).toHaveText(['Home', 'Work']);
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(page.getByRole('heading', { name: `Work section example ${theme}`, exact: true })).toHaveCount(0);
        const list = page.locator('.task-list-transition');
        await expect(list).toHaveCSS('opacity', '1');
        const transitions = await page.evaluate(async () => {
            const list = document.querySelector<HTMLElement>('.task-list-transition');
            const transitions = [];
            for (const target of ['Work', 'Home', 'Work', 'Home', 'Work']) {
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
                .every((sample) => sample.text.includes(`Home section example ${theme}`))
        ).toBe(true);
        await expect(page.getByRole('heading', { name: `Work section example ${theme}`, exact: true })).toBeVisible();
        // Switching again mid-transition still settles on the last section chosen.
        for (const target of ['Home', 'Work', 'Home']) {
            await filter.getByRole('button', { name: target, exact: true }).evaluate((button) => {
                if (!(button instanceof HTMLButtonElement)) throw new Error('Task filter button is missing.');
                button.click();
            });
        }
        await expect(list).toHaveAttribute('data-leaving', 'false');
        await expect(page.getByRole('heading', { name: `Work section example ${theme}`, exact: true })).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await filter.getByRole('button', { name: 'Work', exact: true }).click();
        await expect(list).toHaveAttribute('data-leaving', 'false');
        await expect(page.getByRole('heading', { name: `Work section example ${theme}`, exact: true })).toBeVisible();
        expect(
            await list.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))
        ).toBeLessThanOrEqual(0.00001);
    });
}
