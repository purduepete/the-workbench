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

for (const theme of ['midnight', 'light']) {
    test(`daily notes retain Home/Work while global notes remain category-free in ${theme}`, async ({
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
        await dialog.locator('textarea[name="body"]').fill(`Daily work ${theme}`);
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        const daily = page.locator('.journal-card').filter({ hasText: `Daily work ${theme}` });
        await expect(daily).toBeVisible();
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(daily).toHaveCount(0);

        await page.getByRole('button', { name: 'Global note', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Details', exact: true })).toBeVisible();
        await expect(category).toHaveCount(0);
        await dialog.locator('input[name="title"]').fill(`Global reference ${theme}`);
        await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
        await page.getByRole('button', { name: 'Global notes', exact: true }).click();
        const global = page.locator('.global-note-card').filter({ hasText: `Global reference ${theme}` });
        await expect(global).toBeVisible();
        await expect(global.locator('.card-label')).toHaveCount(0);
        for (const name of ['Work', 'Unclassified', 'All', 'Home']) {
            await filter.getByRole('button', { name, exact: true }).click();
            await expect(global).toBeVisible();
        }
        await expect(page.getByRole('status')).toHaveText('Synced');

        await context.setOffline(true);
        await filter.getByRole('button', { name: 'Work', exact: true }).click();
        await expect(global).toBeVisible();
        await expect(daily).toBeVisible();
        await daily.getByRole('button', { name: /^Edit entry / }).click();
        await category.getByRole('button', { name: 'Home', exact: true }).click();
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        await expect(daily).toHaveCount(0);
        await filter.getByRole('button', { name: 'Home', exact: true }).click();
        await expect(daily).toBeVisible();
        await expect(global).toBeVisible();
        await context.setOffline(false);
        await expect(page.getByRole('status')).toHaveText('Synced');
        await page.reload();
        await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: 'Global notes', exact: true }).click();
        await expect(global.locator('.card-label')).toHaveCount(0);
        await global.getByRole('button', { name: /^Edit / }).click();
        await expect(category).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await daily.getByRole('button', { name: /^Edit entry / }).click();
        await expect(category.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await category.getByRole('button', { name: 'Home', exact: true }).click();
        await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
        await expect(daily.locator('.card-label').first()).toHaveText('Home');
        const journal = await (await page.request.get('/api/journal')).json();
        expect(journal.entries.find((entry: { body: string }) => entry.body === `Daily work ${theme}`).category).toBe(
            'home'
        );
        const notes = await (await page.request.get('/api/global-notes')).json();
        expect(
            notes.notes.find((note: { title: string }) => note.title === `Global reference ${theme}`)
        ).not.toHaveProperty('category');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
}
