import { afterEach, describe, expect, it, vi } from 'vitest';
import { oneDriveConfig } from '../shared/oneDrive';
import { browseOneDrive, isOneDriveResource, pickedImage } from './oneDrivePicker';

const clientId = 'c0a99a60-f88b-4c7a-b373-af219b450399';
const tenantId = '727324e8-f2b6-49bb-b549-2cb3a8b92bf7';

describe('OneDrive authentication resources', () => {
    const config = { clientId, tenantId: 'consumers', baseUrl: 'https://onedrive.live.com/picker' };
    it('accepts resource paths on the configured picker and consumer API origins', () => {
        for (const resource of [
            undefined,
            'https://onedrive.live.com',
            'https://onedrive.live.com/picker',
            'https://api.onedrive.com/',
            'https://api.onedrive.com/v1.0',
        ])
            expect(isOneDriveResource(resource, config)).toBe(true);
    });
    it('rejects spoofed origins, insecure schemes, credentials and unexpected ports', () => {
        for (const resource of [
            'https://api.onedrive.com.evil.example/v1.0',
            'https://unrelated.example',
            'http://api.onedrive.com',
            'https://user:password@api.onedrive.com',
            'https://api.onedrive.com:8443',
            'https://api.onedrive.com/?redirect=elsewhere',
            'not a URL',
        ])
            expect(isOneDriveResource(resource, config)).toBe(false);
        expect(
            isOneDriveResource('https://api.onedrive.com', {
                clientId,
                tenantId,
                baseUrl: 'https://contoso-my.sharepoint.com',
            })
        ).toBe(false);
    });
});

describe('OneDrive picker configuration', () => {
    it('requires an explicitly configured registration and defaults to personal OneDrive', () => {
        expect(oneDriveConfig({})).toBeNull();
        expect(oneDriveConfig({ ONEDRIVE_CLIENT_ID: clientId })).toEqual({
            clientId,
            tenantId: 'consumers',
            baseUrl: 'https://onedrive.live.com/picker',
        });
    });

    it('accepts a work/school tenant and rejects unrelated origins, credentials, ports and paths', () => {
        const environment = { ONEDRIVE_CLIENT_ID: clientId, ONEDRIVE_TENANT_ID: tenantId };
        expect(oneDriveConfig({ ...environment, ONEDRIVE_BASE_URL: 'https://contoso-my.sharepoint.com' })).toEqual({
            clientId,
            tenantId,
            baseUrl: 'https://contoso-my.sharepoint.com',
        });
        for (const baseUrl of [
            'https://contoso-my.sharepoint.com.evil.example',
            'http://contoso-my.sharepoint.com',
            'https://user:password@contoso-my.sharepoint.com',
            'https://contoso-my.sharepoint.com:8443',
            'https://contoso-my.sharepoint.com/path',
            'https://contoso-my.sharepoint.com/',
        ])
            expect(() => oneDriveConfig({ ...environment, ONEDRIVE_BASE_URL: baseUrl })).toThrow();
        expect(() => oneDriveConfig({ ...environment })).toThrow();
        expect(() => oneDriveConfig({ ONEDRIVE_CLIENT_ID: 'not-an-app-id' })).toThrow();
    });
});

describe('picked image validation', () => {
    it('keeps the existing image URL and permissions rather than creating a sharing link', () => {
        expect(
            pickedImage({
                name: 'Reference photo.jpg',
                webUrl: 'https://onedrive.live.com/?id=abc&cid=def',
                file: { mimeType: 'image/jpeg' },
            })
        ).toEqual({ label: 'Reference photo.jpg', url: 'https://onedrive.live.com/?id=abc&cid=def' });
        expect(pickedImage({ name: 'Phone.heic', webUrl: 'https://tenant-my.sharepoint.com/photo.heic' }).label).toBe(
            'Phone.heic'
        );
    });

    function picker() {
        vi.useFakeTimers();
        const form = { action: '', method: '', append: vi.fn(), submit: vi.fn() };
        const input = { type: '', name: '', value: '' };
        const popup = {
            closed: false,
            close: vi.fn(),
            document: {
                createElement: (tag: string) => (tag === 'form' ? form : input),
                body: { append: vi.fn() },
            },
        };
        type Initialization = {
            source: object;
            origin: string;
            data: unknown;
            ports: object[];
        };
        let initialize: ((event: Initialization) => void) | undefined;
        let onCommand: ((event: { data: unknown }) => void) | undefined;
        const port = {
            close: vi.fn(),
            start: vi.fn(),
            postMessage: vi.fn(),
            addEventListener: (_name: string, handler: typeof onCommand) => (onCommand = handler),
        };
        const removeEventListener = vi.fn();
        vi.stubGlobal('location', { origin: 'https://workbench.test' });
        vi.stubGlobal('window', {
            open: vi.fn(() => popup),
            addEventListener: (_name: string, handler: typeof initialize) => (initialize = handler),
            removeEventListener,
            setInterval,
            setTimeout,
        });
        const session = {
            config: { clientId, tenantId: 'consumers', baseUrl: 'https://onedrive.live.com/picker' },
            signIn: vi.fn(),
            token: vi.fn(async () => 'synthetic-test-token'),
        };
        const controller = new AbortController();
        const result = browseOneDrive(session, controller.signal);
        const start = () => {
            const url = new URL(form.action);
            const options = JSON.parse(url.searchParams.get('filePicker') ?? '{}') as {
                messaging: { channelId: string };
            };
            const event = {
                source: popup,
                origin: 'https://onedrive.live.com',
                data: { type: 'initialize', channelId: options.messaging.channelId },
                ports: [port],
            };
            return {
                event,
                initialize: (next: Initialization = event) => initialize?.(next),
                command: (data: object) => onCommand?.({ data: { type: 'command', id: 1, data } }),
            };
        };
        return { form, input, popup, port, session, controller, result, start, removeEventListener };
    }

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('OneDrive picker protocol', () => {
        it('posts the token to Microsoft and accepts only its popup, origin and channel', async () => {
            const app = picker();
            await vi.advanceTimersByTimeAsync(0);
            expect(app.form.action).toMatch(/^https:\/\/onedrive\.live\.com\/picker\?/);
            expect(app.form.method).toBe('POST');
            expect(app.input).toMatchObject({ name: 'access_token', value: 'synthetic-test-token', type: 'hidden' });
            const messages = app.start();
            messages.initialize({ ...messages.event, origin: 'https://unrelated.example' });
            messages.initialize({ ...messages.event, source: {} });
            messages.initialize({ ...messages.event, data: { type: 'initialize', channelId: 'wrong-channel' } });
            expect(app.port.postMessage).not.toHaveBeenCalled();
            messages.initialize();
            expect(app.port.postMessage).toHaveBeenCalledWith({ type: 'activate' });
            messages.command({
                command: 'pick',
                items: [{ name: 'Photo.jpg', webUrl: 'https://1drv.ms/i/private', file: { mimeType: 'image/jpeg' } }],
            });
            await expect(app.result).resolves.toEqual({ label: 'Photo.jpg', url: 'https://1drv.ms/i/private' });
            expect(app.port.postMessage).toHaveBeenCalledWith({ type: 'result', id: 1, data: { result: 'success' } });
            expect(app.popup.close).toHaveBeenCalledOnce();
            expect(app.port.close).toHaveBeenCalledOnce();
            expect(app.removeEventListener).toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('returns a consumer token for a resource URL containing a path', async () => {
            const app = picker();
            await vi.advanceTimersByTimeAsync(0);
            const messages = app.start();
            messages.initialize();
            messages.command({ command: 'authenticate', resource: 'https://api.onedrive.com/v1.0' });
            await vi.advanceTimersByTimeAsync(0);
            expect(app.port.postMessage).toHaveBeenCalledWith({
                type: 'result',
                id: 1,
                data: { result: 'token', token: 'synthetic-test-token' },
            });
            app.controller.abort();
            await expect(app.result).resolves.toBeNull();
        });

        it('refuses to provide tokens for an unexpected resource', async () => {
            const app = picker();
            app.session.config.tenantId = tenantId;
            await vi.advanceTimersByTimeAsync(0);
            const messages = app.start();
            messages.initialize();
            messages.command({ command: 'authenticate', resource: 'https://unrelated.example' });
            await expect(app.result).rejects.toThrow('unexpected authentication resource');
            expect(app.session.token).toHaveBeenCalledTimes(1);
            expect(app.port.postMessage).not.toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ result: 'token' }) })
            );
            expect(vi.getTimerCount()).toBe(0);
        });

        it('ignores consumer resource identifiers and sends the fixed token only over the verified channel', async () => {
            const app = picker();
            const fetch = vi.fn();
            vi.stubGlobal('fetch', fetch);
            await vi.advanceTimersByTimeAsync(0);
            const messages = app.start();
            messages.initialize({ ...messages.event, origin: 'https://unrelated.example' });
            messages.command({ command: 'authenticate', resource: 'consumer-resource-identifier' });
            expect(app.session.token).toHaveBeenCalledTimes(1);
            messages.initialize();
            messages.command({ command: 'authenticate', resource: 'consumer-resource-identifier' });
            await vi.advanceTimersByTimeAsync(0);
            expect(app.port.postMessage).toHaveBeenCalledWith({
                type: 'result',
                id: 1,
                data: { result: 'token', token: 'synthetic-test-token' },
            });
            expect(fetch).not.toHaveBeenCalled();
            app.controller.abort();
            await expect(app.result).resolves.toBeNull();
        });

        it('reads metadata when the picker returns only item identifiers', async () => {
            const app = picker();
            const fetch = vi.fn(async () =>
                Response.json({
                    name: 'Phone.heic',
                    webUrl: 'https://onedrive.live.com/?id=abc',
                    file: { mimeType: 'image/heic' },
                })
            );
            vi.stubGlobal('navigator', { onLine: true });
            vi.stubGlobal('fetch', fetch);
            await vi.advanceTimersByTimeAsync(0);
            const messages = app.start();
            messages.initialize();
            messages.command({ command: 'pick', items: [{ id: 'item/123' }] });
            await expect(app.result).resolves.toEqual({
                label: 'Phone.heic',
                url: 'https://onedrive.live.com/?id=abc',
            });
            expect(fetch).toHaveBeenCalledWith(
                'https://api.onedrive.com/v1.0/drive/items/item%2F123?$select=name,webUrl,file',
                expect.objectContaining({
                    credentials: 'omit',
                    headers: { Authorization: 'Bearer synthetic-test-token' },
                })
            );
        });

        it('cancels without returning an image and removes listeners and timers', async () => {
            const app = picker();
            app.controller.abort();
            await expect(app.result).resolves.toBeNull();
            expect(app.popup.close).toHaveBeenCalledOnce();
            expect(app.form.submit).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('reports startup timeouts rather than waiting indefinitely', async () => {
            const app = picker();
            const failed = expect(app.result).rejects.toThrow('within 60 seconds');
            await vi.advanceTimersByTimeAsync(60_000);
            await failed;
            expect(app.popup.close).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    it('rejects non-images, folders, missing links and unsafe URLs', () => {
        for (const item of [
            { name: 'file.txt', webUrl: 'https://1drv.ms/file', file: { mimeType: 'text/plain' } },
            { name: 'fake.jpg', webUrl: 'https://1drv.ms/file', file: { mimeType: 'text/plain' } },
            { name: 'folder.jpg', webUrl: 'https://1drv.ms/file', folder: {} },
            { name: 'file.jpg' },
            { name: 'file.jpg', webUrl: 'javascript:alert(1)' },
            { name: 'file.jpg', webUrl: 'https://unrelated.example/photo.jpg' },
        ])
            expect(() => pickedImage(item)).toThrow();
    });
});
