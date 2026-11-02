import { expect, test } from '@playwright/test';

for (const theme of ['midnight', 'light']) {
    test(`notes page saves today's entry and keeps it after reload in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('idea-notes.theme-preference', value), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        const nav = page.getByRole('navigation', { name: 'Pages' });
        await nav.getByRole('link', { name: 'Notes' }).click();
        await expect(page).toHaveURL(/\/notes$/);
        await expect(nav.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');

        const body = `Walked the dog in ${theme}`;
        const newNote = page.getByRole('button', { name: 'New note', exact: true });
        await expect(newNote).toHaveText('New note');
        await newNote.click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('textarea[name="body"]').fill(body);
        await dialog.locator('input[name="tags"]').fill('health, Family');
        await dialog.getByRole('button', { name: 'Save entry' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText(body)).toBeVisible();
        await expect(page.getByText(/^Week of \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
        await expect(page.getByRole('status').first()).toHaveText('Synced');

        await page.reload();
        await expect(page).toHaveURL(/\/notes$/);
        await expect(page.getByText(body)).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        await page.goBack().catch(() => undefined);
        await page.goto('/');
        await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Notes' }).click();
        await page.goBack();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('button', { name: 'New idea' })).toBeVisible();
    });
}

test('calendar opens an existing entry and a blank entry for another day', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    const now = new Date();
    const todayLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLabel = `${String(yesterday.getMonth() + 1).padStart(2, '0')}/${String(yesterday.getDate()).padStart(2, '0')}/${yesterday.getFullYear()}`;

    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const todayEntry = page.getByRole('dialog');
    await todayEntry.locator('textarea[name="body"]').fill('Calendar existing-day entry');
    await todayEntry.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByText('Calendar existing-day entry')).toBeVisible();

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a day' });
    await expect(calendar.locator('.dialog-close')).toHaveCount(0);
    await expect(calendar.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    const todayButton = calendar.getByRole('button', { name: todayLabel, exact: true });
    await expect(todayButton).toHaveAttribute('data-has-entry', 'true');
    await todayButton.press('ArrowLeft');
    await expect(calendar.getByRole('button', { name: yesterdayLabel, exact: true })).toBeFocused();
    await calendar.getByRole('button', { name: todayLabel, exact: true }).click();
    await calendar.getByRole('button', { name: `Open ${todayLabel}` }).click();
    await expect(page.getByRole('dialog').locator('textarea[name="body"]')).toHaveValue('Calendar existing-day entry');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const secondCalendar = page.getByRole('dialog', { name: 'Choose a day' });
    const emptyDay = secondCalendar.getByRole('button', { name: yesterdayLabel, exact: true });
    await expect(emptyDay).toHaveAttribute('data-has-entry', 'false');
    await emptyDay.click();
    await secondCalendar.getByRole('button', { name: `Open ${yesterdayLabel}` }).click();
    await expect(page.getByRole('dialog', { name: `Entry for ${yesterdayLabel}` })).toBeVisible();
    await expect(page.getByRole('dialog').locator('textarea[name="body"]')).toHaveValue('');
});

test('editors keep text open through Escape, backdrop and browser Back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Notes' }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.dialog-close')).toHaveCount(0);
    const initialBox = await dialog.boundingBox();
    expect(initialBox?.width).toBeCloseTo(960, 0);
    const body = dialog.locator('textarea[name="body"]');
    await body.fill('Draft text must stay open');

    for (let index = 0; index < 3; index += 1) await body.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(body).toHaveValue('Draft text must stay open');
    await page.mouse.click(5, 400);
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Ideas' }).click();
    await page.getByRole('button', { name: 'New idea' }).click();
    const ideaDialog = page.getByRole('dialog', { name: 'New idea' });
    await expect(ideaDialog).toHaveJSProperty('open', true);
    const ideaBox = await ideaDialog.boundingBox();
    expect(ideaBox?.width).toBeCloseTo(960, 0);
    await ideaDialog.locator('input[name="title"]').fill('Protected idea');
    for (let index = 0; index < 3; index += 1) await ideaDialog.locator('input[name="title"]').press('Escape');
    await expect(ideaDialog).toBeVisible();
    await ideaDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(ideaDialog).toBeHidden();
});

test('global notes can be searched and reopened without pin controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes');
    const title = `Global ${Date.now()}`;
    await page.getByRole('button', { name: 'Global note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New global note' });
    await expect(dialog.locator('.dialog-close')).toHaveCount(0);
    await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="body"]').fill('Reference for later');
    await dialog.locator('input[name="tags"]').fill('reference');
    await dialog.getByRole('button', { name: 'Save note' }).click();
    await page.getByRole('button', { name: 'Global notes', exact: true }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('button', { name: `Pin ${title}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Unpin ${title}` })).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search notes' }).fill(title);
    await expect(page.getByText('Reference for later')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Global notes', exact: true }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${title}` }).click();
    await expect(page.getByRole('dialog').locator('textarea[name="body"]')).toHaveValue('Reference for later');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: `Pin ${title}` })).toHaveCount(0);
});

test('modal opening fades without moving the page and calendar swaps keep the backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
    const frames = await page.evaluate(async () => {
        document.body.style.minHeight = '2000px';
        window.scrollTo(0, 600);
        const scrollBefore = window.scrollY;
        const opener = document.querySelector<HTMLButtonElement>('button[aria-label="New note"]');
        if (!opener) throw new Error('Entry opener is missing.');
        opener.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
        if (!dialog) throw new Error('Entry dialog did not open.');
        const samples: { opacity: number; top: number }[] = [];
        const started = performance.now();
        do {
            samples.push({
                opacity: Number(getComputedStyle(dialog).opacity),
                top: dialog.getBoundingClientRect().top,
            });
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        } while (performance.now() - started < 350);
        return { samples, scrollBefore, scrollAfter: window.scrollY };
    });
    expect(frames.samples[0].opacity).toBeLessThan(0.8);
    expect(frames.samples.at(-1)?.opacity).toBe(1);
    expect(frames.samples.some((sample) => sample.opacity > 0 && sample.opacity < 1)).toBe(true);
    expect(
        Math.max(...frames.samples.map((sample) => sample.top)) -
            Math.min(...frames.samples.map((sample) => sample.top))
    ).toBeLessThanOrEqual(1);
    expect(frames.scrollAfter).toBe(frames.scrollBefore);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Open / })
        .click();
    const entry = page.getByRole('dialog');
    await expect(entry).toHaveAttribute('data-replacing', 'true');
    expect(await entry.evaluate((element) => getComputedStyle(element, '::backdrop').animationName)).toBe('none');
    await entry.getByRole('button', { name: 'Cancel' }).click();
});

for (const { theme, width } of [
    { theme: 'midnight', width: 1280 },
    { theme: 'light', width: 390 },
]) {
    test(`global and weekly note groups collapse independently in ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('idea-notes.theme-preference', value), theme);
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/notes');

        const now = new Date();
        const previous = new Date(now);
        previous.setDate(previous.getDate() - 7);
        const dateKey = (date: Date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const editedLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const recentBody = `Recent group ${theme} ${Date.now()}`;
        const olderBody = `Older group ${theme} ${Date.now()}`;
        const globalTitle = `Legacy global ${theme} ${Date.now()}`;
        await page.evaluate(
            async ({ today, oldDay, recentBody, olderBody, globalTitle, updatedAt, editedLabel }) => {
                const changes = [
                    {
                        path: '/api/journal/mutations',
                        value: { entryDate: today, body: recentBody },
                    },
                    {
                        path: '/api/journal/mutations',
                        value: { entryDate: oldDay, body: olderBody },
                    },
                    {
                        path: '/api/global-notes/mutations',
                        value: {
                            id: crypto.randomUUID(),
                            title: globalTitle,
                            body: 'Legacy global body',
                            pinned: true,
                        },
                    },
                ];
                for (const change of changes) {
                    const response = await fetch(change.path, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            kind: 'save',
                            mutationId: crypto.randomUUID(),
                            baseVersion: 0,
                            tags: [],
                            updatedAt,
                            editedLabel,
                            ...change.value,
                        }),
                    });
                    if (!response.ok) throw new Error(`Fixture save failed with HTTP ${response.status}.`);
                }
            },
            {
                today: dateKey(now),
                oldDay: dateKey(previous),
                recentBody,
                olderBody,
                globalTitle,
                updatedAt: now.toISOString(),
                editedLabel,
            }
        );
        await page.reload();

        const globalGroup = page.getByRole('region', { name: 'Global notes', exact: true });
        const globalCard = globalGroup.locator('article').filter({ hasText: globalTitle });
        const recentCard = page.locator('article.journal-card').filter({ hasText: recentBody });
        const olderCard = page.locator('article.journal-card').filter({ hasText: olderBody });
        const recentGroup = page.locator('section.journal-week').filter({ has: recentCard });
        const olderGroup = page.locator('section.journal-week').filter({ has: olderCard });
        const globalToggle = globalGroup.getByRole('button', { name: 'Global notes', exact: true });
        const recentToggle = recentGroup.getByRole('button', { name: /^Week of / });
        const olderToggle = olderGroup.getByRole('button', { name: /^Week of / });

        await expect(globalCard).toBeHidden();
        await expect(recentCard).toBeVisible();
        await expect(olderCard).toBeHidden();
        await expect(globalToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(recentToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(olderToggle).toHaveAttribute('aria-expanded', 'false');
        await globalToggle.click();
        await olderToggle.click();
        await expect(globalCard).toBeVisible();
        await expect(olderCard).toBeVisible();
        await globalToggle.click();
        await expect(globalToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(globalCard).toBeHidden();
        await expect(recentCard).toBeVisible();

        await recentToggle.press('Space');
        await olderToggle.click();
        await expect(recentToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(olderToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(recentCard).toBeHidden();
        await expect(olderCard).toBeHidden();
        await globalToggle.press('Enter');
        await expect(globalCard).toBeVisible();
        await expect(recentCard).toBeHidden();
        await recentToggle.press('Enter');
        await olderToggle.press('Space');
        await expect(recentCard).toBeVisible();
        await expect(olderCard).toBeVisible();
        await expect(globalGroup.getByRole('button', { name: /^(Pin|Unpin) / })).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
}
