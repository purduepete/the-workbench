import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const origin = 'http://127.0.0.1:4195';
let child: ChildProcess;
let exited: Promise<unknown>;
test.use({ baseURL: origin, serviceWorkers: 'block' });
test.beforeAll(async () => {
    child = spawn(process.execPath, ['dist-server/server/main.js'], {
        env: { ...process.env, STORAGE_BACKEND: 'memory', PORT: '4195', ALLOWED_ORIGINS: origin },
        stdio: 'ignore',
    });
    exited = new Promise((resolve) => child.on('exit', resolve));
    await expect
        .poll(async () => (await fetch(`${origin}/api/health`).catch(() => null))?.status ?? 0, { timeout: 20_000 })
        .toBe(200);
});
test.afterAll(async () => {
    child.kill();
    await exited;
});

test('global notes appear only under All', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/notes');
    const filter = page.getByRole('group', { name: 'Filter notes', exact: true });

    await page.getByRole('button', { name: 'Global note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="title"]').fill('Uncategorized reference');
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    const global = page.locator('.global-note-card').filter({ hasText: 'Uncategorized reference' });
    await page.getByRole('button', { name: 'Global notes', exact: true }).click();
    await expect(global).toBeVisible();

    for (const name of ['Home', 'Work', 'Unclassified']) {
        await filter.getByRole('button', { name, exact: true }).click();
        await expect(global).toHaveCount(0);
    }
    await filter.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Global notes', exact: true }).click();
    await expect(global).toBeVisible();
});

test('a day holds several titled notes that move between sections and delete one at a time', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-11-06T12:00:00-08:00') });
    await page.goto('/notes');
    const filter = page.getByRole('group', { name: 'Filter notes', exact: true });
    const dialog = page.getByRole('dialog');
    const category = dialog.getByRole('group', { name: 'Note category', exact: true });
    const title = dialog.locator('input[name="title"]');
    const body = dialog.locator('textarea[name="body"]');
    const create = async (section: string, heading: string, details: string) => {
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: 'New note for 11/06/2026' })).toBeVisible();
        await category.getByRole('button', { name: section, exact: true }).click();
        await title.fill(heading);
        await body.fill(details);
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        await expect(dialog).toHaveCount(0);
    };
    await create('Work', 'Standup', 'Standup details');
    await create('Work', 'Retro', 'Retro details');
    await create('Home', '', 'Groceries to buy');

    const day = page.getByRole('region', { name: 'Notes for 11/06/2026' });
    await expect(day.locator('.journal-card')).toHaveCount(3);
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Standup', 'Retro', 'Groceries to buy']);
    await filter.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Standup', 'Retro']);

    await day.getByRole('button', { name: 'Edit Retro', exact: true }).click();
    await expect(title).toHaveValue('Retro');
    await expect(body).toHaveValue('Retro details');
    await category.getByRole('button', { name: 'Home', exact: true }).click();
    await title.fill('Retro at home');
    await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Standup']);
    await filter.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Retro at home', 'Groceries to buy']);

    await filter.getByRole('button', { name: 'All', exact: true }).click();
    await day.getByRole('button', { name: 'Edit Standup', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete note', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Retro at home', 'Groceries to buy']);

    // The day's own add button opens a new note for that day in the filtered section.
    await filter.getByRole('button', { name: 'Home', exact: true }).click();
    await day.getByRole('button', { name: 'Add a note for 11/06/2026', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'New note for 11/06/2026' })).toBeVisible();
    await expect(category.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(body).toHaveValue('');
    await body.fill('Evening walk');
    await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(day.locator('.journal-day-toggle')).toHaveText(['Retro at home', 'Groceries to buy', 'Evening walk']);
    await expect(page.getByRole('status')).toHaveText('Synced');
    const journal = await (await page.request.get('/api/journal')).json();
    const live = journal.entries.filter(
        (entry: { entryDate: string; deleted: boolean }) => entry.entryDate === '2026-11-06' && !entry.deleted
    );
    expect(live.map((entry: { title: string; category: string | null }) => [entry.title, entry.category])).toEqual([
        ['Retro at home', 'home'],
        ['', 'home'],
        ['', 'home'],
    ]);
});

for (const theme of ['midnight', 'light']) {
    test(`daily notes keep their sections, titles and tags online and offline in ${theme}`, async ({
        page,
        context,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.clock.setFixedTime(
            new Date(theme === 'midnight' ? '2026-11-04T12:00:00-08:00' : '2026-11-05T12:00:00-08:00')
        );
        await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
        await page.setViewportSize({ width: theme === 'light' ? 390 : 1280, height: 900 });
        await page.goto('/notes');
        const filter = page.getByRole('group', { name: 'Filter notes', exact: true });
        await expect(filter).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const actions = page.locator('.notes-actions');
        expect(await filter.evaluate((node) => node.nextElementSibling?.classList.contains('notes-actions'))).toBe(
            true
        );
        const filterBox = await filter.boundingBox();
        const actionsBox = await actions.boundingBox();
        if (!filterBox || !actionsBox) throw new Error('Notes toolbar controls are missing.');
        if (theme === 'midnight') {
            expect(actionsBox.x).toBeGreaterThanOrEqual(filterBox.x + filterBox.width);
            expect(actionsBox.x - filterBox.x - filterBox.width).toBeCloseTo(12, 0);
            expect(Math.abs(actionsBox.y - filterBox.y)).toBeLessThanOrEqual(2);
        } else {
            expect(actionsBox.y).toBeGreaterThanOrEqual(filterBox.y + filterBox.height);
        }
        await expect(actions.getByRole('button')).toHaveText(['Global note', 'Calendar']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

        await filter.getByRole('button', { name: 'Work', exact: true }).click();
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        const dialog = page.getByRole('dialog');
        const category = dialog.getByRole('group', { name: 'Note category', exact: true });
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toBeFocused();
        const section = dialog.locator('.field-label').filter({ hasText: /^Section$/ });
        const sectionBox = await section.boundingBox();
        const categoryBox = await category.boundingBox();
        if (!sectionBox || !categoryBox) throw new Error('Daily note section controls are missing.');
        expect(sectionBox.y + sectionBox.height).toBeLessThanOrEqual(categoryBox.y);
        await expect(category.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const title = dialog.locator('input[name="title"]');
        const body = dialog.locator('textarea[name="body"]');
        const tags = dialog.locator('input[name="tags"]');
        const save = () => dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        const select = async (name: string) => category.getByRole('button', { name, exact: true }).click();

        await title.fill(`Work plan ${theme}`);
        await tags.fill('work-tag');
        await save();
        await expect(dialog.getByRole('alert')).toHaveText('Write details before saving this note.');
        await body.fill(`Daily work ${theme}`);
        await save();
        await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await select('Home');
        await body.fill(`Daily home ${theme}`);
        await tags.fill('home-tag');
        await save();
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await select('Unclassified');
        await body.fill(`Daily other ${theme}`);
        await tags.fill('other-tag');
        await save();

        const daily = page.locator('.journal-card').filter({ hasText: `Work plan ${theme}` });
        const home = page.locator('.journal-card').filter({ hasText: `Daily home ${theme}` });
        await expect(daily).toBeVisible();
        await expect(home).toHaveCount(0);
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(daily).toHaveCount(0);
        await expect(home).toBeVisible();
        await filter.getByRole('button', { name: 'All', exact: true }).click();
        const cards = page.locator('.journal-card');
        await expect(cards.filter({ hasText: new RegExp(`Daily (work|home|other) ${theme}`) })).toHaveCount(3);
        const ids = await page.locator('.journal-week [id]').evaluateAll((nodes) => nodes.map((node) => node.id));
        expect(new Set(ids).size).toBe(ids.length);
        await expect(page.getByRole('status')).toHaveText('Synced');

        await context.setOffline(true);
        await daily.getByRole('button', { name: `Edit Work plan ${theme}`, exact: true }).click();
        await expect(title).toHaveValue(`Work plan ${theme}`);
        await expect(tags).toHaveValue('work-tag');
        await body.fill(`Daily work ${theme} offline`);
        await save();
        await expect(daily).toContainText(`Daily work ${theme} offline`);
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await select('Work');
        await title.fill(`Offline extra ${theme}`);
        await body.fill(`Second work note ${theme}`);
        await save();
        await expect(page.locator('.journal-card').filter({ hasText: `Offline extra ${theme}` })).toBeVisible();
        await context.setOffline(false);
        await expect(page.getByRole('status')).toHaveText('Synced');
        await page.reload();

        // Emptying the details of a saved note deletes it after a confirmation.
        await home.getByRole('button', { name: `Edit Daily home ${theme}`, exact: true }).click();
        await body.fill('');
        await save();
        await expect(dialog.getByRole('alert')).toHaveText('This note has no details. Save again to delete it.');
        await save();
        await expect(home).toHaveCount(0);
        await expect(page.getByRole('status')).toHaveText('Synced');

        const journal = await (await page.request.get('/api/journal')).json();
        const find = (body: string) => journal.entries.find((entry: { body: string }) => entry.body === body);
        expect(find(`Daily work ${theme} offline`)).toMatchObject({
            title: `Work plan ${theme}`,
            category: 'work',
            tags: ['work-tag'],
            version: 2,
        });
        expect(find(`Second work note ${theme}`)).toMatchObject({ title: `Offline extra ${theme}`, category: 'work' });
        expect(find(`Daily other ${theme}`)).toMatchObject({ category: null, tags: ['other-tag'], version: 1 });
        expect(
            journal.entries.some(
                (entry: { body: string; deleted: boolean }) =>
                    entry.body.includes(`Daily home ${theme}`) && !entry.deleted
            )
        ).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
}
