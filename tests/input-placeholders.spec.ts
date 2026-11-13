import { expect, test, closeDialog, openEditor } from './fixtures';

test('only search fields and the editor title show placeholders', async ({ page }) => {
    for (const [path, buttons] of [
        ['/ideas', ['New idea']],
        ['/tasks', ['New task']],
        ['/notes', ['New note', 'Global note']],
    ] as const) {
        await page.goto(path);
        await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', /Search/);
        for (const name of buttons) {
            await openEditor(page, name);
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            // The borderless title input is the one editor field that names itself with a placeholder.
            await expect(dialog.locator('input[placeholder], textarea[placeholder]')).toHaveCount(1);
            await expect(dialog.getByLabel('Title', { exact: true })).toHaveAttribute('placeholder', 'Title');
            await closeDialog(dialog);
        }
    }
});
