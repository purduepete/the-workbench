import { expect, test, closeDialog, openEditor } from './fixtures';

const editors = [
    { path: '/ideas', open: 'New idea' },
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
        await openEditor(page, editor.open);
        const dialog = page.getByRole('dialog');
        const normal = await dialog.boundingBox();
        if (!normal) throw new Error(`${editor.open} editor is missing.`);
        expect(normal.width).toBeCloseTo(1100, 0);
        // Measure in one frame so a settling dialog cannot shift one box between reads.
        const boxes = await dialog.evaluate((node) => {
            const box = (selector: string) => {
                const element = node.querySelector(selector);
                if (!element) throw new Error(`${selector} is missing.`);
                return element.getBoundingClientRect().toJSON() as DOMRect;
            };
            return {
                title: box('.editor-title-input'),
                heading: box('.dialog-heading'),
                toggle: box('.dialog-corner-actions .editor-size-toggle'),
                close: box('.dialog-corner-actions .dialog-close'),
            };
        });
        // Close sits immediately right of the maximize button, on the same row in the upper right corner.
        expect(boxes.close.y).toBeCloseTo(boxes.toggle.y, 0);
        expect(boxes.close.x - (boxes.toggle.x + boxes.toggle.width)).toBeCloseTo(6, 0);
        // 16px inset inside the dialog's 1px border.
        expect(normal.x + normal.width - (boxes.close.x + boxes.close.width)).toBeCloseTo(17, 0);
        // The corner buttons share the heading row, and the title starts below the heading.
        expect(boxes.toggle.y + boxes.toggle.height).toBeGreaterThan(boxes.heading.y);
        expect(boxes.toggle.y).toBeLessThan(boxes.heading.y + boxes.heading.height);
        expect(boxes.title.y).toBeGreaterThanOrEqual(boxes.heading.y + boxes.heading.height - 1);

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

        // On a very wide screen the maximized editor stops at 1750px and stays centered.
        await page.setViewportSize({ width: 2400, height: 900 });
        const wide = await dialog.boundingBox();
        const wideWidth = await page.evaluate(() => document.documentElement.clientWidth);
        if (!wide) throw new Error(`${editor.open} editor is missing.`);
        expect(wide.width).toBeCloseTo(1750, 0);
        expect(Math.abs(wide.x + wide.width / 2 - wideWidth / 2)).toBeLessThanOrEqual(9);
        await page.setViewportSize({ width: 1440, height: 900 });

        // The choice is remembered for the next editor.
        await closeDialog(dialog);
        await openEditor(page, editor.open);
        await expect(dialog.getByRole('button', { name: 'Restore editor size', exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Restore editor size', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Maximize editor', exact: true })).toBeVisible();
        expect((await dialog.boundingBox())?.width).toBeCloseTo(normal.width, 0);
        await closeDialog(dialog);
    }
});

test.describe('phone editors', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('do not offer the maximize control but keep the close button', async ({ page }) => {
        await page.goto('/ideas');
        await page.getByRole('button', { name: 'New idea', exact: true }).tap();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('.editor-size-toggle')).toBeHidden();
        await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
        await expect(dialog).toHaveCount(0);
    });
});
