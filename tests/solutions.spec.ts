import { expect, test } from '@playwright/test';

for (const theme of ['midnight', 'light']) {
    test(`automatically selects N/A without a solution in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.goto('/');
        await expect(page.getByRole('status')).toHaveText('Synced');
        await page.getByRole('button', { name: 'New idea' }).click();
        const dialog = page.getByRole('dialog');
        const status = dialog.getByRole('group', { name: 'Status', exact: true });
        await expect(status.getByRole('button', { name: 'N/A', exact: true })).toBeDisabled();
        await expect(status.getByRole('button', { name: 'N/A', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(status.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);

        await dialog.getByRole('button', { name: 'Solution: No solution' }).click();
        await page.getByRole('option', { name: 'Ferry Tracker' }).click();
        await expect(status.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await status.getByRole('button', { name: 'Done', exact: true }).click();
        await dialog.getByRole('button', { name: 'Solution: Ferry Tracker' }).click();
        await page.getByRole('option', { name: 'No solution', exact: true }).click();
        await expect(status.getByRole('button', { name: 'N/A', exact: true })).toBeDisabled();
        await expect(status.getByRole('button', { name: 'N/A', exact: true })).toHaveAttribute('aria-pressed', 'true');

        const title = `Unlinked N/A ${theme}`;
        await dialog.getByLabel('Idea title').fill(title);
        const saved = page.waitForResponse('**/api/mutations');
        await dialog.getByRole('button', { name: 'Save idea' }).click();
        expect((await (await saved).json()).idea).toMatchObject({ title, solution: null, status: 'n/a' });
        const card = page.locator('.idea-card', { hasText: title });
        await expect(card.locator('.status-chip')).toHaveText('N/A');
        await page.reload();
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'N/A', exact: true })).toBeDisabled();
        await dialog.getByRole('button', { name: 'Solution: No solution' }).click();
        await page.getByRole('option', { name: 'Ferry Tracker' }).click();
        await expect(status.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
}

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

for (const theme of ['midnight', 'light']) {
    test(`disables a solution for every device in ${theme}`, async ({ page, baseURL }) => {
        await page.addInitScript((value) => localStorage.setItem('the-workbench.theme-preference', value), theme);
        await page.goto('/');
        await expect(page.getByRole('status')).toHaveText('Synced');

        // An idea linked before the solution is disabled keeps its link.
        const title = `Linked before disable ${theme}`;
        await page.getByRole('button', { name: 'New idea' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Idea title').fill(title);
        await dialog.getByRole('button', { name: 'Solution: No solution' }).click();
        await page.getByRole('option', { name: 'Work Log' }).click();
        await dialog.getByRole('button', { name: 'Save idea' }).click();

        try {
            await page.getByRole('button', { name: 'Manage solutions' }).click();
            const manage = page.getByRole('dialog', { name: 'Manage solutions' });
            const workLog = manage.getByRole('checkbox', { name: 'Work Log' });
            await expect(workLog).toBeChecked();
            // Checkboxes use the theme accent rather than the browser default.
            expect(await workLog.evaluate((node) => getComputedStyle(node).accentColor)).not.toBe('auto');
            const saved = page.waitForResponse('**/api/solution-settings');
            await workLog.uncheck();
            expect((await saved).ok()).toBe(true);
            await expect(manage.getByText('2 of 3 enabled')).toBeVisible();
            await manage.getByRole('button', { name: 'OK', exact: true }).click();
            await expect(manage).toBeHidden();

            const filter = page.getByRole('button', { name: /^Filter by solution:/ });
            await filter.click();
            await expect(page.getByRole('listbox', { name: 'Filter by solution' }).getByRole('option')).toHaveText([
                'All solutions',
                'No solution',
                'Ferry Tracker',
                'Solution Directory',
            ]);
            await page.keyboard.press('Escape');

            await page.getByRole('button', { name: 'New idea' }).click();
            await dialog.getByRole('button', { name: 'Solution: No solution' }).click();
            await expect(page.getByRole('listbox', { name: 'Solution' }).getByRole('option')).toHaveText([
                'No solution',
                'Ferry Tracker',
                'Solution Directory',
            ]);
            await page.keyboard.press('Escape');
            await dialog.getByRole('button', { name: 'Cancel' }).click();

            // The existing link shows by name, in the card and as the edit dialog's current value.
            const card = page.locator('.idea-card', { hasText: title });
            await expect(card.getByRole('button', { name: 'Filter by solution Work Log' })).toBeVisible();
            await card.getByRole('button', { name: 'Edit', exact: true }).click();
            await expect(dialog.getByRole('button', { name: 'Solution: Work Log' })).toBeVisible();
            await dialog.getByRole('button', { name: 'Cancel' }).click();

            // The setting comes from the server, so a fresh browser sees it too.
            const other = await page.context().browser()!.newPage();
            await other.goto(`${baseURL}/`);
            await other.getByRole('button', { name: 'Manage solutions' }).click();
            await expect(other.getByRole('checkbox', { name: 'Work Log' })).not.toBeChecked();
            await other.close();
        } finally {
            await page.request.post('/api/solution-settings', {
                data: { id: 'work-log', disabled: false },
                headers: { Origin: baseURL! },
            });
        }
    });
}

test('fits a phone screen with the solution filter and dialog fields', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Manage solutions' }).click();
    await expect(page.getByRole('checkbox', { name: 'Ferry Tracker' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
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
