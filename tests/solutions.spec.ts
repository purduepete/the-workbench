import { expect, test } from '@playwright/test';

test('links an idea to a solution with the keyboard, filters by it, and reads it from the API', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText('Synced');
    expect(await page.locator('select, datalist').count()).toBe(0);

    await page.getByRole('button', { name: 'New idea' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title').fill('Tide-aware arrival alerts');

    // Keyboard: open, move to the second solution in name order (Ferry Tracker, Solution Directory, Work Log), choose.
    const trigger = dialog.getByRole('button', { name: 'Solution: No solution' });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const listbox = page.getByRole('listbox', { name: 'Solution' });
    await expect(listbox).toBeVisible();
    const placed = { panel: await listbox.boundingBox(), trigger: await trigger.boundingBox() };
    const { panel: p, trigger: t } = placed;
    // Opens above or below the trigger, never on top of it.
    expect(p && t && (p.y >= t.y + t.height || p.y + p.height <= t.y)).toBe(true);
    await expect(listbox.getByRole('option')).toHaveText([
        'No solution',
        'Ferry Tracker',
        'Solution Directory',
        'Work Log',
    ]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Solution: Ferry Tracker' })).toBeFocused();

    // Escape closes only the listbox and leaves the dialog open.
    await page.keyboard.press('Enter');
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'In progress' }).click();
    await expect(dialog.getByRole('button', { name: 'In progress' })).toHaveAttribute('aria-pressed', 'true');
    const saved = page.waitForResponse('**/api/mutations');
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await saved;

    const card = page.locator('.idea-card', { hasText: 'Tide-aware arrival alerts' });
    await expect(card.getByRole('button', { name: 'Filter by solution Ferry Tracker' })).toBeVisible();
    await expect(card.locator('.status-chip')).toHaveText('In progress');

    const fromApi = await page.request.get('/api/ideas?solution=ferry-tracker&status=in-progress');
    const { ideas } = (await fromApi.json()) as { ideas: { title: string }[] };
    expect(ideas.map((idea) => idea.title)).toContain('Tide-aware arrival alerts');

    // Mouse: an unlinked idea, then filter from the toolbar and from the card chip.
    await page.getByRole('button', { name: 'New idea' }).click();
    await page.getByRole('dialog').getByLabel('Idea title').fill('Unlinked shower thought');
    await page.getByRole('dialog').getByRole('button', { name: 'Save idea' }).click();

    const filter = page.getByRole('button', { name: /^Filter by solution:/ });
    await filter.click();
    await page
        .getByRole('listbox', { name: 'Filter by solution' })
        .getByRole('option', { name: 'No solution' })
        .click();
    await expect(page.locator('.idea-card', { hasText: 'Unlinked shower thought' })).toBeVisible();
    await expect(card).toBeHidden();

    await filter.click();
    await page.getByRole('option', { name: 'All solutions' }).click();
    await card.getByRole('button', { name: 'Filter by solution Ferry Tracker' }).click();
    await expect(page.getByRole('button', { name: 'Filter by solution: Ferry Tracker' })).toBeVisible();
    await expect(page.locator('.idea-card', { hasText: 'Unlinked shower thought' })).toBeHidden();

    // A new idea started while filtered defaults to that solution.
    await page.getByRole('button', { name: 'New idea' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Solution: Ferry Tracker' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

test('fits a phone screen with the solution filter and dialog fields', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New idea' }).click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Solution:/ })
        .click();
    const panel = page.getByRole('listbox', { name: 'Solution' });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    const trigger = await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Solution:/ })
        .boundingBox();
    // The panel opens beside the trigger, never on top of it.
    expect(box && trigger && (box.y >= trigger.y + trigger.height || box.y + box.height <= trigger.y)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
});
