import { expect, test } from './fixtures';

const editors = [
    { path: '/', open: 'New idea' },
    { path: '/tasks', open: 'New task' },
    { path: '/notes', open: 'New note' },
    { path: '/notes', open: 'Global note' },
];

test('desktop editors maximize to the viewport, remember the choice and restore', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const editor of editors) {
        await page.goto(editor.path);
        await page.evaluate(() => localStorage.removeItem('the-workbench.editor-maximized'));
        await page.getByRole('button', { name: editor.open, exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        const normal = await dialog.boundingBox();
        if (!normal) throw new Error(`${editor.open} editor is missing.`);
        expect(normal.width).toBeCloseTo(1100, 0);
        if (editor.open === 'New idea' || editor.open === 'Global note') {
            // Measure both in one frame so a settling dialog cannot shift one between reads.
            const { title, toggle } = await dialog.evaluate((node) => {
                const box = (selector: string) => {
                    const element = node.querySelector(selector);
                    if (!element) throw new Error(`${selector} is missing.`);
                    return element.getBoundingClientRect().toJSON() as DOMRect;
                };
                return { title: box('input[name="title"]'), toggle: box('.editor-size-toggle') };
            });
            expect(toggle.y).toBeCloseTo(title.y, 0);
            expect(toggle.x - (title.x + title.width)).toBeCloseTo(6, 0);
        }

        await dialog.getByRole('button', { name: 'Maximize editor', exact: true }).click();
        const restore = dialog.getByRole('button', { name: 'Restore editor size', exact: true });
        await expect(restore).toHaveAttribute('aria-pressed', 'true');
        const viewport = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            height: window.innerHeight,
        }));
        const maximized = await dialog.boundingBox();
        if (!maximized) throw new Error(`${editor.open} editor is missing.`);
        expect(maximized.x).toBeCloseTo(16, 0);
        expect(maximized.y).toBeCloseTo(16, 0);
        // The page keeps a stable scrollbar gutter (up to 16px) on the right; the editor fills the rest.
        expect(maximized.width).toBeGreaterThanOrEqual(viewport.width - 32 - 16);
        expect(maximized.width).toBeLessThanOrEqual(viewport.width - 32);
        expect(maximized.height).toBeCloseTo(viewport.height - 32, 0);
        expect(await dialog.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);

        // The choice is remembered for the next editor.
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: editor.open, exact: true }).first().click();
        await expect(dialog.getByRole('button', { name: 'Restore editor size', exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Restore editor size', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Maximize editor', exact: true })).toBeVisible();
        expect((await dialog.boundingBox())?.width).toBeCloseTo(normal.width, 0);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
});

test.describe('phone editors', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('do not offer the maximize control', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'New idea', exact: true }).tap();
        await expect(page.getByRole('dialog').locator('.editor-size-toggle')).toBeHidden();
    });
});
