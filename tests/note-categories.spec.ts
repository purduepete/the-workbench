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
    await expect.poll(async () => (await fetch(`${origin}/api/health`).catch(() => null))?.status ?? 0).toBe(200);
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

test('deleting one section retains unsaved changes in another section', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-06T12:00:00-08:00'));
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const category = dialog.getByRole('group', { name: 'Note category', exact: true });
    const body = dialog.locator('textarea[name="body"]');
    await body.fill('Home to delete');
    await category.getByRole('button', { name: 'Work', exact: true }).click();
    await body.fill('Work to keep');
    await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
    const work = page.locator('.journal-card').filter({ hasText: 'Work to keep' });
    await work.getByRole('button', { name: /^Edit entry / }).click();
    await body.fill('Unsaved work to keep');
    await category.getByRole('button', { name: 'Home', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete entry', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(body).toHaveValue('');
    await category.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(body).toHaveValue('Unsaved work to keep');
    await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(work).toContainText('Unsaved work to keep');
    await expect(page.locator('.journal-card').filter({ hasText: 'Home to delete' })).toHaveCount(0);
});

for (const theme of ['midnight', 'light']) {
    test(`daily sections retain separate content and tags online and offline in ${theme}`, async ({
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
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toBeVisible();
        const section = dialog.locator('.field-label').filter({ hasText: /^Section$/ });
        await expect(section).toBeVisible();
        const sectionBox = await section.boundingBox();
        const categoryBox = await category.boundingBox();
        if (!sectionBox || !categoryBox) throw new Error('Daily note section controls are missing.');
        expect(sectionBox.y + sectionBox.height).toBeLessThanOrEqual(categoryBox.y);
        await expect(category.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const body = dialog.locator('textarea[name="body"]');
        const tags = dialog.locator('input[name="tags"]');
        const select = async (name: string) => category.getByRole('button', { name, exact: true }).click();
        await body.fill(`Daily work ${theme}`);
        await tags.fill('work-tag');
        await select('Home');
        await expect(body).toHaveValue('');
        await expect(tags).toHaveValue('');
        await tags.fill('home-tag');
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        await expect(dialog.getByRole('alert')).toHaveText('Write details for Home before saving its tags.');
        await body.fill(`Daily home ${theme}`);
        await select('Unclassified');
        await expect(body).toHaveValue('');
        await expect(tags).toHaveValue('');
        await body.fill(`Daily other ${theme}`);
        await tags.fill('other-tag');
        await select('Work');
        await expect(body).toHaveValue(`Daily work ${theme}`);
        await expect(tags).toHaveValue('work-tag');
        await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(dialog.locator('.markdown-editor-preview')).toHaveText(`Daily work ${theme}`);
        await select('Home');
        await expect(body).toHaveValue(`Daily home ${theme}`);
        await expect(tags).toHaveValue('home-tag');
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        const daily = page.locator('.journal-card').filter({ hasText: `Daily work ${theme}` });
        const home = page.locator('.journal-card').filter({ hasText: `Daily home ${theme}` });
        await expect(daily).toBeVisible();
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(daily).toHaveCount(0);
        await expect(home).toBeVisible();
        await filter.getByRole('button', { name: 'All', exact: true }).click();
        const cards = page.locator('.journal-card');
        await expect(cards.filter({ hasText: new RegExp(`Daily (work|home|other) ${theme}`) })).toHaveCount(3);
        const ids = await cards.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
        expect(new Set(ids).size).toBe(ids.length);
        await expect(page.getByRole('status')).toHaveText('Synced');

        await context.setOffline(true);
        await filter.getByRole('button', { name: 'Work', exact: true }).click();
        await expect(daily).toBeVisible();
        await daily.getByRole('button', { name: /^Edit entry / }).click();
        await expect(body).toHaveValue(`Daily work ${theme}`);
        await body.fill(`Daily work ${theme} offline`);
        await select('Home');
        await expect(body).toHaveValue(`Daily home ${theme}`);
        await body.fill(`Daily home ${theme} offline`);
        await select('Work');
        await expect(body).toHaveValue(`Daily work ${theme} offline`);
        await select('Unclassified');
        await expect(body).toHaveValue(`Daily other ${theme}`);
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        await expect(daily).toContainText(`Daily work ${theme} offline`);
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(daily).toHaveCount(0);
        await expect(home).toContainText(`Daily home ${theme} offline`);
        await context.setOffline(false);
        await expect(page.getByRole('status')).toHaveText('Synced');
        await page.reload();
        await expect(filter.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await home.getByRole('button', { name: /^Edit entry / }).click();
        await expect(body).toHaveValue(`Daily home ${theme} offline`);
        await expect(tags).toHaveValue('home-tag');
        await select('Work');
        await expect(body).toHaveValue(`Daily work ${theme} offline`);
        await expect(tags).toHaveValue('work-tag');
        await select('Home');
        await dialog.getByRole('button', { name: 'Delete entry', exact: true }).click();
        await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
        await expect(home).toHaveCount(0);
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await expect(body).toHaveValue('');
        await expect(tags).toHaveValue('');
        await select('Work');
        await expect(body).toHaveValue(`Daily work ${theme} offline`);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('Synced');
        const journal = await (await page.request.get('/api/journal')).json();
        expect(
            journal.entries.find((entry: { body: string }) => entry.body === `Daily work ${theme} offline`)
        ).toMatchObject({ category: 'work', tags: ['work-tag'], version: 2 });
        expect(journal.entries.find((entry: { body: string }) => entry.body === `Daily other ${theme}`)).toMatchObject({
            category: null,
            tags: ['other-tag'],
            version: 1,
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
}
