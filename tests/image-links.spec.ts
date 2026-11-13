import { expect, test } from '@playwright/test';
import { openEditor } from './fixtures';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const origin = 'http://127.0.0.1:4194';
let child: ChildProcess;
let exited: Promise<unknown>;
test.use({ serviceWorkers: 'block', baseURL: origin });
test.beforeAll(async () => {
    child = spawn(process.execPath, ['dist-server/server/main.js'], {
        env: {
            ...process.env,
            STORAGE_BACKEND: 'memory',
            PORT: '4194',
            ALLOWED_ORIGINS: origin,
            ONEDRIVE_CLIENT_ID: 'c0a99a60-f88b-4c7a-b373-af219b450399',
            ONEDRIVE_TENANT_ID: 'consumers',
            ONEDRIVE_BASE_URL: 'https://onedrive.live.com/picker',
        },
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

test('unconfigured OneDrive explains setup without manual sharing controls', async ({ page }) => {
    await page.route('**/api/onedrive', (route) => route.fulfill({ json: { configuration: null } }));
    await page.goto('/notes');
    await openEditor(page, 'Global note');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Add image link', exact: true }).click();
    const fields = dialog.getByRole('group', { name: 'OneDrive image link' });
    await expect(fields.getByRole('alert')).toHaveText('Browse OneDrive needs a Microsoft app registration.');
    await expect(fields.getByRole('textbox', { name: 'OneDrive sharing link' })).toHaveCount(0);
    await expect(fields.getByRole('button', { name: 'Insert link' })).toHaveCount(0);
    await expect(fields.getByText('In OneDrive, choose Share', { exact: false })).toHaveCount(0);
    await fields.getByRole('textbox', { name: 'Image label' }).fill('Reference photo');
    await fields.getByRole('textbox', { name: 'Image label' }).press('Enter');
    await expect(dialog.locator('textarea[name="body"]')).toHaveValue('');
    await fields.getByRole('textbox', { name: 'Image label' }).press('Escape');
    await expect(fields).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Add image link', exact: true })).toBeFocused();
});

for (const theme of ['midnight', 'light']) {
    for (const editor of [
        { path: '/ideas', open: 'New idea', save: 'Save idea', title: true },
        { path: '/notes', open: 'New note', save: 'Save note', title: false },
        { path: '/notes', open: 'Global note', save: 'Save note', title: true },
        { path: '/tasks', open: 'New task', save: 'Save task', title: true },
    ]) {
        test(`selecting an image inserts directly in ${editor.open} in ${theme}`, async ({ page }) => {
            await page.addInitScript((theme) => localStorage.setItem('the-workbench.theme-preference', theme), theme);
            await page.setViewportSize({ width: theme === 'light' ? 390 : 1280, height: 900 });
            await page.route('**/api/onedrive', (route) =>
                route.fulfill({
                    json: {
                        configuration: {
                            clientId: 'c0a99a60-f88b-4c7a-b373-af219b450399',
                            tenantId: 'consumers',
                            baseUrl: 'https://onedrive.live.com/picker',
                        },
                    },
                })
            );
            await page.route('**/assets/dist-*.js', (route) =>
                route.fulfill({
                    contentType: 'text/javascript',
                    body: `export const EventType={POPUP_OPENED:'popup'}; export class PublicClientApplication {
                    async initialize(){} addEventCallback(){return 'callback'} removeEventCallback(){}
                    async acquireTokenPopup(){window.oneDriveSignIns=(window.oneDriveSignIns??0)+1;return {account:{}}} setActiveAccount(){}
                    async acquireTokenSilent(){return {accessToken:'synthetic-test-token'}}
                }`,
                })
            );
            await page.context().route('https://onedrive.live.com/picker?**', (route) =>
                route.fulfill({
                    contentType: 'text/html',
                    body: `<script>
                    const config=JSON.parse(new URL(location.href).searchParams.get('filePicker'));
                    const channel=new MessageChannel();
                    channel.port1.onmessage=(event)=>{
                        if(event.data.type==='activate') channel.port1.postMessage({type:'command',id:1,
                            data:{command:'pick',items:[{name:'Photo.jpg',webUrl:'https://1drv.ms/i/example',file:{mimeType:'image/jpeg'}}]}});
                    };
                    opener.postMessage({type:'initialize',channelId:config.messaging.channelId},config.messaging.origin,[channel.port2]);
                </script>`,
                })
            );
            await page.goto(editor.path);
            await openEditor(page, editor.open);
            const dialog = page.getByRole('dialog');
            if (editor.title) await dialog.locator('input[name="title"]').fill(`Image ${editor.open} ${theme}`);
            const body = dialog.locator('textarea[name="body"]');
            await body.fill('Existing details.');
            await dialog.getByRole('button', { name: 'Add image link', exact: true }).click();
            const fields = dialog.getByRole('group', { name: 'OneDrive image link' });
            await fields.getByRole('textbox', { name: 'Image label' }).fill('Reference photo');
            await fields.getByRole('button', { name: 'Sign in to OneDrive', exact: true }).click();
            await fields.getByRole('button', { name: 'Browse OneDrive', exact: true }).click();
            await expect(fields).toBeHidden();
            await expect(body).toHaveValue('Existing details.\n[Reference photo](https://1drv.ms/i/example)');
            await dialog.getByRole('button', { name: editor.save, exact: true }).click();
            await expect(dialog).toBeHidden();
            if (editor.open === 'Global note')
                await page
                    .getByRole('group', { name: 'Filter notes', exact: true })
                    .getByRole('button', { name: 'Global', exact: true })
                    .click();
            const reopen =
                editor.open === 'New note'
                    ? page.getByRole('button', { name: 'Edit Existing details.', exact: true }).last()
                    : editor.open === 'Global note'
                      ? page.getByRole('button', { name: `Edit Image ${editor.open} ${theme}`, exact: true })
                      : page.getByRole('button', { name: editor.open, exact: true });
            await reopen.click();
            await dialog.getByRole('button', { name: 'Add image link', exact: true }).click();
            await expect(fields.getByRole('button', { name: 'Sign in to OneDrive', exact: true })).toHaveCount(0);
            await fields.getByRole('button', { name: 'Browse OneDrive', exact: true }).click();
            await expect(fields).toBeHidden();
            await expect(body).toHaveValue(/\[Photo\.jpg\]\(https:\/\/1drv\.ms\/i\/example\)/);
            expect(await page.evaluate(() => Reflect.get(window, 'oneDriveSignIns'))).toBe(1);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        });
    }
}
