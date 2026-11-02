import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://workbench.test';
const shell = '<html><script src="/assets/app.js"></script><link href="/assets/app.css"></html>';

interface WorkerEvent {
    request?: Request;
    waitUntil: (promise: Promise<unknown>) => void;
    respondWith: (promise: Promise<Response>) => void;
}

function response(body: string, type = 'text/plain', redirected = false) {
    const result = new Response(body, { headers: { 'Content-Type': type } });
    Object.defineProperties(result, { type: { value: 'basic' }, redirected: { value: redirected } });
    return result;
}

function worker() {
    const handlers = new Map<string, (event: WorkerEvent) => void>();
    const stores = new Map<string, Map<string, Response>>();
    const key = (request: string | Request) =>
        new URL(typeof request === 'string' ? request : request.url, origin).href;
    const fetch = vi.fn(async (request: string | Request) =>
        key(request) === `${origin}/` ? response(shell, 'text/html') : response('asset')
    );
    const open = async (name: string) => {
        let store = stores.get(name);
        if (!store) {
            store = new Map();
            stores.set(name, store);
        }
        return {
            put: async (request: string | Request, value: Response) => {
                store.set(key(request), value);
            },
            match: async (request: string | Request) => store.get(key(request))?.clone(),
        };
    };
    runInNewContext(source, {
        self: {
            location: { origin },
            addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
            skipWaiting: vi.fn(),
            clients: { claim: vi.fn() },
        },
        caches: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) },
        fetch,
        URL,
        Response,
        AbortSignal,
        console: { warn: vi.fn() },
    });
    const emit = async (name: string, request?: Request) => {
        const pending: Promise<unknown>[] = [];
        let result: Promise<Response> | undefined;
        handlers.get(name)?.({
            request,
            waitUntil: (promise) => pending.push(promise),
            respondWith: (promise) => {
                result = promise;
            },
        });
        const resolved = await result;
        await Promise.all(pending);
        return resolved;
    };
    return { emit, fetch, open, stores };
}

describe('offline shell', () => {
    it('caches all entry assets and both icons on installation, before an online reload', async () => {
        const app = worker();
        await app.emit('install');
        const cache = await app.open('the-workbench-shell-v7');
        for (const path of ['/', '/assets/app.js', '/assets/app.css', '/favicon.svg', '/favicon-light.svg']) {
            expect(await cache.match(path)).toBeDefined();
        }
        app.fetch.mockRejectedValue(new TypeError('No Internet'));
        const request = new Request(`${origin}/notes`);
        Object.defineProperty(request, 'mode', { value: 'navigate' });
        expect(await (await app.emit('fetch', request))?.text()).toBe(shell);
        expect(await (await app.emit('fetch', new Request(`${origin}/favicon-light.svg`)))?.text()).toBe('asset');
    });

    it('keeps the prior shell if an updated asset cannot be downloaded', async () => {
        const app = worker();
        await app.emit('install');
        app.fetch.mockImplementation(async (request) => {
            if (String(request).includes('/assets/new.js')) throw new Error('Interrupted download');
            return response('<html><script src="/assets/new.js"></script></html>', 'text/html');
        });
        const request = new Request(`${origin}/tasks`);
        Object.defineProperty(request, 'mode', { value: 'navigate' });
        await app.emit('fetch', request);
        expect(await (await (await app.open('the-workbench-shell-v7')).match('/'))?.text()).toBe(shell);
    });

    it('rejects an authentication redirect as an installable shell', async () => {
        const app = worker();
        app.fetch.mockResolvedValue(response(shell, 'text/html', true));
        await expect(app.emit('install')).rejects.toThrow('No valid app shell');
    });

    it('caches the font stylesheet and font files for an offline reopen', async () => {
        const app = worker();
        const href = 'https://fonts.googleapis.com/css2?family=Roboto+Flex';
        const font = 'https://fonts.gstatic.com/font.woff2';
        app.fetch.mockImplementation(async (request) => {
            if (request === '/') return response(`${shell}<link href="${href}">`, 'text/html');
            if (request === href) return response(`@font-face {src: url(${font})}`, 'text/css');
            return response('asset');
        });
        await app.emit('install');
        app.fetch.mockRejectedValue(new Error('No Internet'));
        expect(await (await app.emit('fetch', new Request(href)))?.text()).toContain(font);
        expect(await (await app.emit('fetch', new Request(font)))?.text()).toBe('asset');
    });

    it('does not intercept APIs or delete other applications caches', async () => {
        const app = worker();
        await app.open('another-app');
        await app.open('the-workbench-shell-v6');
        await app.emit('install');
        await app.emit('activate');
        expect(app.stores.has('another-app')).toBe(true);
        expect(app.stores.has('the-workbench-shell-v6')).toBe(false);
        app.fetch.mockClear();
        expect(await app.emit('fetch', new Request(`${origin}/api/ideas`))).toBeUndefined();
        expect(app.fetch).not.toHaveBeenCalled();
    });
});
