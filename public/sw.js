// API data stays in the browser outboxes, never in the service worker cache.
const CACHE_PREFIX = 'the-workbench-shell-';
const CACHE = `${CACHE_PREFIX}v7`;
const ICONS = ['/favicon.svg', '/favicon-light.svg', '/apple-touch-icon.png', '/manifest.webmanifest'];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

function network(request) {
    return fetch(request, { signal: AbortSignal.timeout(10_000) });
}

function assetUrls(html) {
    return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => new URL(match[1], self.location.origin))
        .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
        .map((url) => url.href);
}

async function cacheFonts(cache, html) {
    try {
        const links = [...html.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g)];
        for (const [, href] of links) {
            const stylesheet = await network(href);
            if (!stylesheet.ok) throw new Error(`Font stylesheet returned HTTP ${stylesheet.status}.`);
            const css = await stylesheet.clone().text();
            await cache.put(href, stylesheet);
            const fonts = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)];
            await Promise.all(
                [...new Set(fonts.map((match) => match[1]))].map(async (url) => {
                    const response = await network(url);
                    if (!response.ok) throw new Error(`Font returned HTTP ${response.status}.`);
                    await cache.put(url, response);
                })
            );
        }
    } catch (error) {
        console.warn('[offline] Fonts could not be cached; the system font remains available.', error);
    }
}

async function cacheShell(response) {
    if (!response.ok || response.redirected || response.type !== 'basic') return false;
    if (!response.headers.get('content-type')?.includes('text/html')) return false;
    const html = await response.clone().text();
    const assets = assetUrls(html);
    if (!assets.length) return false;
    const cache = await caches.open(CACHE);
    // Store HTML only after its dependencies, so an interrupted update keeps a usable shell.
    await Promise.all(
        [...new Set([...assets, ...ICONS])].map(async (url) => {
            const asset = await network(url);
            if (!asset.ok || asset.redirected || asset.type !== 'basic')
                throw new Error(`Shell asset could not be cached: ${url}`);
            await cache.put(url, asset);
        })
    );
    await cache.put('/', response);
    await cacheFonts(cache, html);
    return true;
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        network('/').then(async (response) => {
            if (!(await cacheShell(response))) throw new Error('No valid app shell was returned.');
            await self.skipWaiting();
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET') return;
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

    if (url.origin === self.location.origin && request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE);
                try {
                    const response = await network(request);
                    if (response.ok) {
                        event.waitUntil(
                            cacheShell(response.clone()).catch((error) =>
                                console.warn('[offline] The shell update could not be cached.', error)
                            )
                        );
                        return response;
                    }
                    if (response.status < 500) return response;
                    return (await cache.match('/')) ?? response;
                } catch {
                    return (await cache.match('/')) ?? Response.error();
                }
            })()
        );
        return;
    }

    const localAsset =
        url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || ICONS.includes(url.pathname));
    if (!localAsset && !FONT_HOSTS.has(url.hostname)) return;
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(request);
            if (cached) return cached;
            const response = await network(request);
            if (response.ok && !response.redirected) await cache.put(request, response.clone());
            return response;
        })()
    );
});
