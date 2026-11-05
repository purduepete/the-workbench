import { expect, test } from '@playwright/test';

test('only search fields show placeholders', async ({ page }) => {
    for (const [path, buttons] of [
        ['/', ['New idea']],
        ['/tasks', ['New task']],
        ['/notes', ['New note', 'Global note']],
    ] as const) {
        await page.goto(path);
        await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', /Search/);
        for (const name of buttons) {
            await page.getByRole('button', { name, exact: true }).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            await expect(dialog.locator('input[placeholder], textarea[placeholder]')).toHaveCount(0);
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        }
    }
});
