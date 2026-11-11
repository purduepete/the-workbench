import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';

test('loads under the production CSP without violations in light and midnight', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto('/ideas');
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
    await page.goto('/ideas');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    const saved = page.waitForResponse('**/api/preferences');
    await page.getByRole('radio', { name: 'Light' }).click();
    expect((await saved).status()).toBe(204);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
});

test('OneDrive runtime settings allow only the configured Microsoft endpoints and serve an isolated callback', async () => {
    const port = 4192;
    const origin = `http://127.0.0.1:${port}`;
    const clientId = 'c0a99a60-f88b-4c7a-b373-af219b450399';
    const child = spawn(process.execPath, ['dist-server/server/main.js'], {
        env: {
            ...process.env,
            STORAGE_BACKEND: 'memory',
            PORT: String(port),
            ALLOWED_ORIGINS: origin,
            ONEDRIVE_CLIENT_ID: clientId,
            ONEDRIVE_TENANT_ID: 'consumers',
            ONEDRIVE_BASE_URL: 'https://onedrive.live.com/picker',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    try {
        await expect
            .poll(async () => (await fetch(`${origin}/api/health`).catch(() => null))?.status ?? 0, {
                timeout: 10_000,
            })
            .toBe(200);
        const response = await fetch(`${origin}/api/onedrive`);
        expect(await response.json()).toEqual({
            configuration: { clientId, tenantId: 'consumers', baseUrl: 'https://onedrive.live.com/picker' },
        });
        const csp = response.headers.get('content-security-policy');
        expect(csp).toContain(
            "connect-src 'self' https://login.microsoftonline.com https://onedrive.live.com https://api.onedrive.com"
        );
        expect(csp).toContain("form-action 'self' https://onedrive.live.com");
        expect(csp?.split('; ').find((directive) => directive.startsWith('connect-src'))).not.toContain(
            '*.sharepoint.com'
        );
        expect(csp?.split('; ').find((directive) => directive.startsWith('img-src'))).toContain(
            'https://*.sharepoint.com'
        );
        const callback = await fetch(`${origin}/onedrive-auth.html`);
        expect(callback.status).toBe(200);
        expect(callback.headers.get('cache-control')).toBe('no-store');
        const html = await callback.text();
        expect(html).toContain('Microsoft sign-in | The Workbench');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('id="root"');
    } finally {
        child.kill();
        await exited;
    }
});

test('reopens offline, keeps edits, and syncs them once on reconnect', async ({ page, context }) => {
    await page.goto('/ideas');
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
    const folder = mkdtempSync(join(tmpdir(), 'the-workbench-stop-'));
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
