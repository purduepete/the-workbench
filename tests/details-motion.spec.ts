import { expect, test } from '@playwright/test';

for (const kind of ['idea', 'task'] as const) {
    test(`${kind} details animate through intermediate heights in both directions`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(kind === 'idea' ? '/' : '/tasks');
        await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
        const dialog = page.getByRole('dialog');
        const title = `Smooth ${kind} example`;
        await dialog.getByLabel(kind === 'idea' ? 'Idea title' : 'Task title', { exact: true }).fill(title);
        await dialog
            .getByRole('textbox', { name: 'Details', exact: true })
            .fill(
                Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1} with **formatted details**.`).join(
                    '\n\n'
                )
            );
        await dialog.getByRole('button', { name: `Save ${kind}`, exact: true }).click();
        const container = page.getByRole(kind === 'idea' ? 'article' : 'listitem', { name: title, exact: true });
        const details = container.locator(`.${kind}-details`);
        await page.mouse.move(0, 0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await expect(details).toHaveCSS('transition-duration', '0.35s');
        const collapsed = await details.evaluate((node) => node.clientHeight);

        for (const expanding of [true, false]) {
            const samples = await container.evaluate(async (node) => {
                const details = node.querySelector<HTMLElement>('.idea-details, .task-details');
                const button = node.querySelector<HTMLButtonElement>('.idea-details-toggle, .task-details-toggle');
                if (!details || !button) throw new Error('Expandable details are missing.');
                const heights = [details.getBoundingClientRect().height];
                button.click();
                const start = performance.now();
                await new Promise<void>((resolve) => {
                    const sample = () => {
                        heights.push(details.getBoundingClientRect().height);
                        if (performance.now() - start < 450) requestAnimationFrame(sample);
                        else resolve();
                    };
                    requestAnimationFrame(sample);
                });
                return heights;
            });
            const first = samples[0];
            const last = samples[samples.length - 1];
            expect(expanding ? last - first : first - last).toBeGreaterThan(100);
            expect(
                samples.some((height) => height > Math.min(first, last) + 2 && height < Math.max(first, last) - 2)
            ).toBe(true);
            for (let index = 1; index < samples.length; index += 1) {
                expect(
                    expanding ? samples[index] - samples[index - 1] : samples[index - 1] - samples[index]
                ).toBeGreaterThanOrEqual(-1);
            }
        }
        expect(await details.evaluate((node) => node.clientHeight)).toBe(collapsed);
        const now = new Date();
        await page.clock.install({ time: now });
        await page.clock.pauseAt(now);
        const content = container.locator(kind === 'idea' ? '.idea-card-body' : '.task-text');
        await content.hover();
        await page.clock.runFor(249);
        await expect(content).toHaveAttribute('data-hovered', 'false');
        expect(await details.evaluate((node) => node.clientHeight)).toBe(collapsed);
        await page.mouse.move(0, 0);
        await page.clock.runFor(600);
        await expect(content).toHaveAttribute('data-hovered', 'false');
        await content.hover();
        await page.clock.runFor(249);
        await expect(content).toHaveAttribute('data-hovered', 'false');
        await page.clock.runFor(1);
        await expect(content).toHaveAttribute('data-hovered', 'true');
        await page.mouse.move(0, 0);
        await expect(content).toHaveAttribute('data-hovered', 'false');
        await page.clock.resume();
        await expect.poll(() => details.evaluate((node) => node.clientHeight)).toBe(collapsed);
        const clippedLines = await details.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let clipped = 0;
            while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.trim()) continue;
                range.selectNodeContents(walker.currentNode);
                for (const rect of range.getClientRects()) {
                    if (rect.top < bounds.bottom - 1 && rect.bottom > bounds.bottom + 1) clipped += 1;
                }
            }
            return clipped;
        });
        expect(clippedLines).toBe(0);
        const toggle = container.locator(`.${kind}-details-toggle`);
        await expect(toggle).toBeHidden();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
            await details.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))
        ).toBeLessThanOrEqual(0.00001);
        await toggle.evaluate((node) => {
            if (!(node instanceof HTMLButtonElement)) throw new Error('Details toggle is missing.');
            node.click();
        });
        await expect.poll(() => details.evaluate((node) => node.clientHeight >= node.scrollHeight - 1)).toBe(true);
    });
}
