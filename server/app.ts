import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { mutationSchema, THEME_COOKIE, themePreferenceSchema } from '../shared/contracts.js';
import type { IdeasStore } from './store.js';

export function createApp(options: {
    store: IdeasStore;
    allowedOrigins: string[];
    staticDirectory?: string;
    contentSecurityPolicy?: string;
}) {
    const app = express();
    app.disable('x-powered-by');
    const allowedHosts = new Set(options.allowedOrigins.map((origin) => new URL(origin).host));
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Cache-Control', 'no-store');
        if (options.contentSecurityPolicy) res.setHeader('Content-Security-Policy', options.contentSecurityPolicy);
        const loopbackReadiness =
            req.path === '/api/health' &&
            ['GET', 'HEAD'].includes(req.method) &&
            /^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '');
        if (!allowedHosts.has(req.headers.host ?? '') && !loopbackReadiness) {
            res.status(403).json({ error: 'Unrecognized request host.' });
            return;
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            if (
                !req.headers.origin ||
                !options.allowedOrigins.includes(req.headers.origin) ||
                !req.is('application/json') ||
                req.headers['sec-fetch-site'] === 'cross-site'
            ) {
                res.status(403).json({ error: 'Writes require an allowed origin and a JSON request.' });
                return;
            }
        }
        next();
    });
    app.use(express.json({ limit: '64kb' }));
    app.get('/api/health', async (_req, res) => {
        try {
            await options.store.ready();
            res.json({ ok: true });
        } catch (error) {
            console.error('Readiness failed:', error instanceof Error ? error.message : 'Unknown storage failure');
            res.status(503).json({ ok: false, error: 'Database unavailable or schema not initialized.' });
        }
    });
    app.get('/api/ideas', async (_req, res) => {
        res.json({ ideas: await options.store.list() });
    });
    app.post('/api/mutations', async (req, res) => {
        const parsed = mutationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'The change is not a valid idea update.' });
            return;
        }
        res.json(await options.store.apply(parsed.data));
    });
    app.post('/api/preferences', (req, res) => {
        const parsed = themePreferenceSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Choose system, light or midnight.' });
            return;
        }
        res.cookie(THEME_COOKIE, parsed.data.theme, {
            path: '/',
            sameSite: 'lax',
            // TLS ends at Cloudflare or Tailscale; the guarded Origin shows which scheme the browser used.
            secure: req.headers.origin?.startsWith('https://') ?? false,
            maxAge: 365 * 24 * 60 * 60 * 1000,
        });
        res.status(204).end();
    });
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
    if (options.staticDirectory) app.use(express.static(options.staticDirectory, { dotfiles: 'deny' }));
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
        if (error instanceof SyntaxError) {
            res.status(400).json({ error: 'Request body must be valid JSON.' });
            return;
        }
        const tooLarge = (error as { type?: string }).type === 'entity.too.large';
        if (tooLarge) {
            res.status(413).json({ error: 'The change is too large.' });
            return;
        }
        console.error('Request failed:', error instanceof Error ? error.message : 'Unknown request failure');
        res.status(503).json({ error: 'Idea Notes could not read or save data. Please retry.' });
    };
    app.use(handleError);
    return app;
}
