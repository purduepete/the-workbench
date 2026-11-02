import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('loads under the production CSP without violations in light and midnight', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'self' https://site-dock.jimlertech.com");
    expect(csp).toMatch(/script-src 'self' 'sha256-/);
    expect(response?.headers()['x-frame-options']).toBeUndefined();
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    expect(violations).toEqual([]);
});

test('restores the theme from the server cookie when localStorage is cleared', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    const saved = page.waitForResponse('**/api/preferences');
    await page.getByRole('radio', { name: 'Light' }).click();
    expect((await saved).status()).toBe(204);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
});

test('reopens offline, keeps edits, and syncs them once on reconnect', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Synced');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'The Workbench' })).toBeVisible();

    await page.getByRole('button', { name: 'New idea' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Idea title').fill('Offline thought');
    await dialog.getByRole('button', { name: 'Save idea' }).click();
    await expect(page.getByRole('status')).toHaveText(/Offline, 1 change waiting/);

    let previous = 'Offline thought';
    for (const title of ['Offline thought v2', 'Offline thought v3']) {
        const current = page.locator('.idea-card').filter({ has: page.getByRole('heading', { name: previous }) });
        await current.getByRole('button', { name: 'Edit' }).click();
        await dialog.getByLabel('Idea title').fill(title);
        await dialog.getByRole('button', { name: 'Save idea' }).click();
        previous = title;
    }
    await expect(page.getByRole('heading', { name: 'Offline thought v3' })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByRole('status')).toHaveText('Synced', { timeout: 15_000 });
    const { ideas } = (await (await page.request.get('/api/ideas')).json()) as { ideas: { title: string }[] };
    expect(ideas.filter((idea) => idea.title.startsWith('Offline thought')).map((idea) => idea.title)).toEqual([
        'Offline thought v3',
    ]);
});

test('stops gracefully when the deployment stop file appears', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'idea-notes-stop-'));
    const stopFile = join(folder, 'stop');
    const port = 4191;
    const child = spawn(process.execPath, ['dist-server/server/main.js'], {
        env: { ...process.env, STORAGE_BACKEND: 'memory', PORT: String(port), SOLUTIONDEPLOY_STOP_FILE: stopFile },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    await expect
        .poll(async () => (await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null))?.status ?? 0, {
            timeout: 15_000,
        })
        .toBe(200)
        .catch((error: unknown) => {
            throw new Error(`Server did not become healthy. Output:\n${output}`, { cause: error });
        });
    expect(existsSync(stopFile)).toBe(false);
    writeFileSync(stopFile, '');
    expect(await exited).toBe(0);
});
