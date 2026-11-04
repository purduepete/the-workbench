import { z } from 'zod';
import { oneDriveConfigSchema } from '../shared/oneDrive';
import type { OneDriveConfig } from '../shared/oneDrive';
import { oneDriveImageUrl } from './oneDriveLinks';
import { syncFetch } from './syncFetch';

const itemSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    webUrl: z.string().optional(),
    file: z.object({ mimeType: z.string().optional() }).optional(),
    folder: z.unknown().optional(),
    parentReference: z.object({ driveId: z.string() }).optional(),
});
const commandSchema = z.object({
    type: z.literal('command'),
    id: z.union([z.string(), z.number()]),
    data: z.object({
        command: z.string(),
        resource: z.string().optional(),
        items: z.array(itemSchema).optional(),
    }),
});
export interface PickedImage {
    label: string;
    url: string;
}
export interface OneDriveSession {
    config: OneDriveConfig;
    signIn: (signal: AbortSignal) => Promise<void>;
    token: () => Promise<string>;
}

let signedInSession: OneDriveSession | null = null;
const sessionListeners = new Set<() => void>();
export const getOneDriveSession = () => signedInSession;
export function subscribeOneDriveSession(listener: () => void) {
    sessionListeners.add(listener);
    return () => {
        sessionListeners.delete(listener);
    };
}

export function isOneDriveResource(resource: string | undefined, config: OneDriveConfig): boolean {
    if (!resource) return true;
    let url: URL;
    try {
        url = new URL(resource);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
    return (
        url.origin === new URL(config.baseUrl).origin ||
        (config.tenantId === 'consumers' && url.origin === 'https://api.onedrive.com')
    );
}

export async function prepareOneDrive(): Promise<OneDriveSession> {
    if (signedInSession) return signedInSession;
    const response = await syncFetch('/api/onedrive');
    if (!response.ok) throw new Error('OneDrive setup could not be loaded. Try again.');
    const { configuration } = z.object({ configuration: oneDriveConfigSchema.nullable() }).parse(await response.json());
    if (!configuration) throw new Error('Browse OneDrive needs a Microsoft app registration.');
    const { PublicClientApplication, EventType } = await import('@azure/msal-browser');
    const app = new PublicClientApplication({
        auth: {
            clientId: configuration.clientId,
            authority: `https://login.microsoftonline.com/${configuration.tenantId}`,
            redirectUri: `${location.origin}/onedrive-auth.html`,
        },
        cache: { cacheLocation: 'memoryStorage', temporaryCacheLocation: 'memoryStorage' },
    });
    await app.initialize();
    const scopes =
        configuration.tenantId === 'consumers'
            ? ['OneDrive.ReadOnly']
            : [`${new URL(configuration.baseUrl).origin}/MyFiles.Read`];
    const session: OneDriveSession = {
        config: configuration,
        signIn: async (signal) => {
            let popup: Window | undefined;
            const cancel = () => popup?.close();
            const callback = app.addEventCallback((event) => {
                if (event.eventType === EventType.POPUP_OPENED && event.payload && 'popupWindow' in event.payload) {
                    popup = event.payload.popupWindow;
                    if (signal.aborted) cancel();
                }
            });
            signal.addEventListener('abort', cancel, { once: true });
            try {
                const result = await app.acquireTokenPopup({ scopes, prompt: 'select_account' });
                app.setActiveAccount(result.account);
                signedInSession = session;
                sessionListeners.forEach((listener) => listener());
            } finally {
                signal.removeEventListener('abort', cancel);
                if (callback) app.removeEventCallback(callback);
            }
        },
        token: async () => {
            const result = await app.acquireTokenSilent({ scopes });
            return result.accessToken;
        },
    };
    return session;
}

export function pickedImage(value: unknown): PickedImage {
    const item = itemSchema.parse(value);
    const url = item.webUrl && oneDriveImageUrl(item.webUrl);
    const image =
        item.file?.mimeType?.startsWith('image/') ||
        (!item.file?.mimeType && /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(item.name ?? ''));
    if (!url || !image || item.folder !== undefined) throw new Error('Select one image with a OneDrive file link.');
    return { label: item.name ?? 'Image', url };
}

async function imageDetails(value: unknown, session: OneDriveSession): Promise<PickedImage> {
    const item = itemSchema.parse(value);
    if (item.webUrl && item.name) return pickedImage(item);
    if (!item.id) throw new Error('OneDrive did not return the selected image identifier.');
    const personal = session.config.tenantId === 'consumers';
    const base = personal
        ? 'https://api.onedrive.com/v1.0/drive'
        : `${new URL(session.config.baseUrl).origin}/_api/v2.0/drives/${encodeURIComponent(item.parentReference?.driveId ?? '')}`;
    if (!personal && !item.parentReference?.driveId) throw new Error('OneDrive did not return the image drive.');
    const response = await syncFetch(`${base}/items/${encodeURIComponent(item.id)}?$select=name,webUrl,file`, {
        headers: { Authorization: `Bearer ${await session.token()}` },
        credentials: 'omit',
        redirect: 'error',
    });
    if (!response.ok) throw new Error(`OneDrive could not read the selected image (HTTP ${response.status}).`);
    return pickedImage(await response.json());
}

export function browseOneDrive(session: OneDriveSession, signal: AbortSignal): Promise<PickedImage | null> {
    const popup = window.open('', `workbench-onedrive-${crypto.randomUUID()}`, 'width=1080,height=680');
    if (!popup) return Promise.reject(new Error('Allow pop-ups for The Workbench, then choose Browse OneDrive again.'));
    const origin = new URL(session.config.baseUrl).origin;
    const channelId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        let port: MessagePort | undefined;
        let settled = false;
        let ready = false;
        const finish = (image: PickedImage | null, error?: Error) => {
            if (settled) return;
            settled = true;
            window.removeEventListener('message', initialize);
            signal.removeEventListener('abort', cancel);
            clearInterval(closed);
            clearTimeout(startup);
            port?.close();
            popup.close();
            if (error) reject(error);
            else resolve(image);
        };
        const cancel = () => finish(null);
        const closed = window.setInterval(() => {
            if (popup.closed) finish(null);
        }, 500);
        const startup = window.setTimeout(() => {
            if (!ready) finish(null, new Error('OneDrive did not open within 60 seconds. Try again.'));
        }, 60_000);
        const initialize = (event: MessageEvent<unknown>) => {
            if (event.source !== popup || event.origin !== origin || settled) return;
            const message = z.object({ type: z.literal('initialize'), channelId: z.string() }).safeParse(event.data);
            if (!message.success || message.data.channelId !== channelId || !event.ports[0]) return;
            port?.close();
            const activePort = event.ports[0];
            port = activePort;
            ready = true;
            activePort.addEventListener('message', (event: MessageEvent<unknown>) => {
                void handle(event, activePort);
            });
            activePort.start();
            activePort.postMessage({ type: 'activate' });
        };
        const handle = async (event: MessageEvent<unknown>, activePort: MessagePort) => {
            if (settled || activePort !== port) return;
            const parsed = commandSchema.safeParse(event.data);
            if (!parsed.success) return;
            const { id, data } = parsed.data;
            const result = (data: object) => activePort.postMessage({ type: 'result', id, data });
            activePort.postMessage({ type: 'acknowledge', id });
            try {
                switch (data.command) {
                    case 'authenticate': {
                        // The consumer picker uses a fixed OneDrive.ReadOnly token, as in Microsoft's sample.
                        // Its resource value never selects a scope or a network destination.
                        if (
                            session.config.tenantId !== 'consumers' &&
                            !isOneDriveResource(data.resource, session.config)
                        )
                            throw new Error('OneDrive requested an unexpected authentication resource.');
                        const token = await session.token();
                        if (!settled) result({ result: 'token', token });
                        break;
                    }
                    case 'pick': {
                        if (data.items?.length !== 1) throw new Error('Select one image.');
                        const image = await imageDetails(data.items[0], session);
                        if (!settled) {
                            result({ result: 'success' });
                            finish(image);
                        }
                        break;
                    }
                    case 'close':
                        result({ result: 'success' });
                        finish(null);
                        break;
                    default:
                        result({
                            result: 'error',
                            error: { code: 'unsupportedCommand', message: 'Unsupported command.' },
                        });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'OneDrive could not return the image.';
                if (!settled) {
                    result({ result: 'error', error: { code: 'unusableItem', message } });
                    finish(null, new Error(message));
                }
            }
        };
        window.addEventListener('message', initialize);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) {
            cancel();
            return;
        }
        void session
            .token()
            .then((token) => {
                if (settled) return;
                const options = {
                    sdk: '8.0',
                    entry: { oneDrive: { files: {} } },
                    authentication: {},
                    messaging: { origin: location.origin, channelId },
                    typesAndSources: { mode: 'files', filters: ['photo'], access: { mode: 'read' } },
                    selection: { mode: 'single' },
                    commands: { pick: { action: 'select', label: 'Use image' } },
                };
                const endpoint =
                    session.config.tenantId === 'consumers'
                        ? session.config.baseUrl
                        : `${session.config.baseUrl}/_layouts/15/FilePicker.aspx`;
                const form = popup.document.createElement('form');
                form.action = `${endpoint}?${new URLSearchParams({ filePicker: JSON.stringify(options), locale: 'en-us' })}`;
                form.method = 'POST';
                const input = popup.document.createElement('input');
                input.type = 'hidden';
                input.name = 'access_token';
                input.value = token;
                form.append(input);
                popup.document.body.append(form);
                form.submit();
            })
            .catch((error: unknown) =>
                finish(null, new Error(error instanceof Error ? error.message : 'Sign in to OneDrive again.'))
            );
    });
}
