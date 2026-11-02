// Caches only the app shell so The Workbench can reopen offline. API responses are never cached.
const CACHE = 'the-workbench-shell-v6';

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok && response.type === 'basic') {
                        const copy = response.clone();
                        void caches.open(CACHE).then((cache) => cache.put('/', copy));
                    }
                    return response;
                })
                .catch(() => caches.match('/').then((cached) => cached ?? Response.error()))
        );
        return;
    }

    // Built assets have content hashes in their names, so a cached copy never goes stale.
    // Icons and the manifest keep fixed names, so they always come from the network.
    if (!url.pathname.startsWith('/assets/')) return;
    event.respondWith(
        caches.match(request).then(
            (cached) =>
                cached ??
                fetch(request).then((response) => {
                    if (response.ok && response.type === 'basic') {
                        const copy = response.clone();
                        void caches.open(CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
        )
    );
});
