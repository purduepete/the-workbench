import { expect, test } from '@playwright/test';

for (const theme of ['midnight', 'light']) {
    test(`duplicate opens an independent idea draft in ${theme}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.setViewportSize({ width: theme === 'light' ? 390 : 1280, height: 900 });
        await page.goto('/');
        const title = `Original ${theme}`;
        const body = '**Copy these details**\n\n- First item\n- Second item';
        await page.getByRole('button', { name: 'New idea', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Idea title', { exact: true }).fill(title);
        await dialog.getByRole('textbox', { name: 'Details', exact: true }).fill(body);
        await dialog.locator('input[name="tags"]').fill('copy, example');
        await dialog.getByRole('button', { name: 'Solution: No solution', exact: true }).click();
        await page.getByRole('option', { name: 'Ferry Tracker', exact: true }).click();
        await dialog.getByRole('button', { name: 'In progress', exact: true }).click();
        await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();
        const original = page.getByRole('article', { name: title, exact: true });
        const footerActions = original.locator('.idea-card-bottom .card-action');
        await expect(footerActions).toHaveCount(3);
        await expect(footerActions.nth(1)).toHaveAttribute('aria-label', `Duplicate ${title}`);
        await expect(footerActions.nth(2)).toHaveAttribute('aria-label', 'Edit');
        for (const action of await footerActions.all()) {
            await expect(action).toHaveText('');
            await expect(action.locator('svg')).toHaveCount(1);
            await expect(action).toHaveAttribute('aria-label', /.+/);
        }
        await original.getByRole('button', { name: `Pin ${title}`, exact: true }).click();
        await original.getByRole('button', { name: `Duplicate ${title}`, exact: true }).click();
        await expect(dialog).toHaveAttribute('aria-label', 'New idea');
        await expect(dialog.getByLabel('Idea title', { exact: true })).toHaveValue(title);
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(body);
        await expect(dialog.locator('input[name="tags"]')).toHaveValue('copy, example');
        await expect(dialog.getByRole('button', { name: 'Solution: Ferry Tracker', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'In progress', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(dialog.getByRole('button', { name: 'Delete idea' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('article', { name: title, exact: true })).toHaveCount(1);
        await original.getByRole('button', { name: `Duplicate ${title}`, exact: true }).click();
        await dialog.getByLabel('Idea title', { exact: true }).fill(`Copied ${theme}`);
        await dialog.getByRole('button', { name: 'Save idea', exact: true }).click();
        const copy = page.getByRole('article', { name: `Copied ${theme}`, exact: true });
        await expect(copy).toBeVisible();
        await expect(copy.getByRole('button', { name: `Pin Copied ${theme}`, exact: true })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
        await expect(original.getByRole('button', { name: `Unpin ${title}`, exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await page.reload();
        await expect(copy).toBeVisible();
        await copy.getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(body);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'New idea', exact: true }).click();
        await expect(dialog.getByLabel('Idea title', { exact: true })).toHaveValue('');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
}
