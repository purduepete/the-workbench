import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4193';
test.use({ serviceWorkers: 'block' });
let child: ChildProcess;
let exited: Promise<unknown>;
test.beforeAll(async () => {
    child = spawn(process.execPath, ['dist-server/server/main.js'], {
        env: {
            ...process.env,
            STORAGE_BACKEND: 'memory',
            PORT: '4193',
            ALLOWED_ORIGINS: origin,
            ONEDRIVE_CLIENT_ID: 'c0a99a60-f88b-4c7a-b373-af219b450399',
            ONEDRIVE_TENANT_ID: 'consumers',
            ONEDRIVE_BASE_URL: 'https://onedrive.live.com/picker',
        },
        stdio: 'ignore',
    });
    exited = new Promise((resolve) => child.on('exit', resolve));
    await expect.poll(async () => (await fetch(`${origin}/api/health`).catch(() => null))?.status ?? 0).toBe(200);
});
test.afterAll(async () => {
    child.kill();
    await exited;
});

for (const editor of [
    { path: '/', open: 'New idea', save: 'Save idea', title: true },
    { path: '/notes', open: 'New note', save: 'Save entry', title: false },
    { path: '/notes', open: 'Global note', save: 'Save note', title: true },
    { path: '/tasks', open: 'New task', save: 'Save task', title: true },
]) {
    test(`shows clickable authenticated thumbnails in ${editor.open} without saving temporary URLs`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.route('**/assets/dist-*.js', (route) =>
            route.fulfill({
                contentType: 'text/javascript',
                body: `export const EventType={POPUP_OPENED:'popup'};
                export class PublicClientApplication {
                    async initialize(){} addEventCallback(){return 'callback'} removeEventCallback(){}
                    async acquireTokenPopup(){return {account:{}}} setActiveAccount(){}
                    async acquireTokenSilent(){return {accessToken:'synthetic-test-token'}}
                }`,
            })
        );
        await page.route('https://api.onedrive.com/**', (route) => {
            expect(route.request().headers().authorization).toBe('Bearer synthetic-test-token');
            return route.fulfill({
                json: { value: [{ medium: { url: 'https://southcentralus1-medias.svc.ms/thumbnail' } }] },
            });
        });
        const image = await page.request.get(`${origin}/apple-touch-icon.png`);
        const imageBody = await image.body();
        await page.route('https://southcentralus1-medias.svc.ms/thumbnail', (route) =>
            route.fulfill({ body: imageBody, contentType: 'image/png' })
        );
        await page.goto(`${origin}${editor.path}`);
        await page.getByRole('button', { name: editor.open, exact: true }).click();
        const dialog = page.getByRole('dialog');
        if (editor.title) await dialog.locator('input[name="title"]').fill(`Thumbnail ${editor.open}`);
        const body = '[Reference photo](https://onedrive.live.com/?id=abc!123)';
        await dialog.locator('textarea[name="body"]').fill(body);
        await dialog.getByRole('button', { name: 'Add image link', exact: true }).click();
        await dialog.getByRole('button', { name: 'Sign in to OneDrive', exact: true }).click();
        await expect(dialog.getByText('Signed in. Browse OneDrive to select an image.')).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel image link', exact: true }).click();
        if (editor.path === '/notes') {
            await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
            await expect(dialog.getByRole('img', { name: 'Reference photo' })).toBeVisible();
        }
        await dialog.getByRole('button', { name: editor.save, exact: true }).click();
        if (editor.open === 'Global note')
            await page.getByRole('button', { name: 'Global notes', exact: true }).click();
        const thumbnail = page.getByRole('img', { name: 'Reference photo' }).last();
        await expect(thumbnail).toBeVisible();
        await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
        const link = page.getByRole('link', { name: 'Reference photo', exact: true }).last();
        await expect(link).toHaveAttribute('href', 'https://onedrive.live.com/?id=abc!123');
        await expect(link).toHaveAttribute('target', '_blank');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        await thumbnail.evaluate((image) => image.dispatchEvent(new Event('error')));
        await expect(page.getByText('Thumbnail could not load. Open the image in OneDrive.').last()).toBeVisible();
        await expect(link).toBeVisible();
        const api =
            editor.path === '/notes'
                ? editor.title
                    ? 'global-notes'
                    : 'journal'
                : editor.path === '/'
                  ? 'ideas'
                  : 'tasks';
        const stored = JSON.stringify(await (await page.request.get(`${origin}/api/${api}`)).json());
        expect(stored).toContain(body);
        expect(stored).not.toContain('test.files.1drv.com');
        expect(stored).not.toContain('synthetic-test-token');
    });
}
