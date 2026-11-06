import { expect, test } from '@playwright/test';

test('I, N and T switch pages, but not while typing or in a dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Ideas' })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/notes$/);
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/tasks$/);
    await page.keyboard.press('i');
    await expect(page).toHaveURL(/\/$/);

    const search = page.getByRole('searchbox', { name: 'Search ideas' });
    await search.fill('');
    await search.press('t');
    await expect(search).toHaveValue('t');
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('button', { name: 'New idea', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').focus();
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/$/);
});

test('page filters are remembered after a reload', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('group', { name: 'Filter notes' }).getByRole('button', { name: 'Work', exact: true }).click();
    await page.goto('/tasks');
    await page.getByRole('group', { name: 'Task section', exact: true }).getByRole('button', { name: 'All' }).click();
    await page.goto('/');
    await page
        .getByRole('group', { name: 'Idea view' })
        .getByRole('button', { name: /Archived/ })
        .click();
    await page.getByRole('button', { name: /Filter by solution/ }).click();
    await page.getByRole('option', { name: 'Ferry Tracker' }).click();

    await page.reload();
    await expect(
        page.getByRole('group', { name: 'Idea view' }).getByRole('button', { name: /Archived/ })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Filter by solution/ })).toContainText('Ferry Tracker');
    await page.goto('/notes');
    await expect(
        page.getByRole('group', { name: 'Filter notes' }).getByRole('button', { name: 'Work', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/tasks');
    await expect(
        page.getByRole('group', { name: 'Task section', exact: true }).getByRole('button', { name: 'All' })
    ).toHaveAttribute('aria-pressed', 'true');
});
