import express from 'express';
import type { ErrorRequestHandler } from 'express';
import path from 'node:path';
import {
    ideaQuerySchema,
    globalNoteMutationSchema,
    globalNoteQuerySchema,
    journalMutationSchema,
    journalQuerySchema,
    mutationSchema,
    solutionSettingSchema,
    THEME_COOKIE,
    themePreferenceSchema,
} from '../shared/contracts.js';
import { JournalOverflowError, JournalSectionRequiredError } from '../shared/journal.js';
import { taskMutationSchema, taskQuerySchema } from '../shared/tasks.js';
import type { SolutionSource } from './solutions.js';
import type { IdeasStore } from './store.js';
import type { OneDriveConfig } from '../shared/oneDrive.js';

export function createApp(options: {
    store: IdeasStore;
    allowedOrigins: string[];
    solutions?: SolutionSource;
    staticDirectory?: string;
    contentSecurityPolicy?: string;
    oneDrive?: OneDriveConfig | null;
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
    // A journal entry holds up to 200,000 characters, which can reach about 800 KB as UTF-8.
    // This parser runs first, so the 64kb parser below skips the already-parsed body on this route only.
    app.use('/api/journal/mutations', express.json({ limit: '1mb' }));
    app.use('/api/global-notes/mutations', express.json({ limit: '1mb' }));
    app.use('/api/tasks/mutations', express.json({ limit: '1mb' }));
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
    app.get('/api/onedrive', (_req, res) => {
        res.json({ configuration: options.oneDrive ?? null });
    });
    app.get('/api/ideas', async (req, res) => {
        const query = ideaQuerySchema.safeParse(req.query);
        if (!query.success) {
            res.status(400).json({ error: 'Filter by a solution id or "none", and by open, in-progress or done.' });
            return;
        }
        const { solution, status } = query.data;
        const ideas = (await options.store.list()).filter(
            (idea) =>
                (solution === undefined || idea.solution === (solution === 'none' ? null : solution)) &&
                (status === undefined || idea.status === status)
        );
        res.json({ ideas });
    });
    app.get('/api/solutions', async (_req, res) => {
        let listed;
        try {
            listed = options.solutions ? await options.solutions() : [];
        } catch (error) {
            console.error('Solution list failed:', error instanceof Error ? error.message : 'Unknown error');
            res.status(503).json({ error: 'The solution list is unavailable.' });
            return;
        }
        const disabled = new Set(await options.store.listDisabledSolutions());
        res.json({ solutions: listed.map((solution) => ({ ...solution, disabled: disabled.has(solution.id) })) });
    });
    app.post('/api/solution-settings', async (req, res) => {
        const parsed = solutionSettingSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Send a solution id and disabled true or false.' });
            return;
        }
        await options.store.setSolutionDisabled(parsed.data.id, parsed.data.disabled);
        res.json(parsed.data);
    });
    app.post('/api/mutations', async (req, res) => {
        const parsed = mutationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'The change is not a valid idea update.' });
            return;
        }
        res.json(await options.store.apply(parsed.data));
    });
    app.get('/api/journal', async (req, res) => {
        const query = journalQuerySchema.safeParse(req.query);
        if (!query.success) {
            res.status(400).json({ error: 'Filter with from and to as YYYY-MM-DD, a tag, and includeDeleted.' });
            return;
        }
        const { from, to, tag, includeDeleted } = query.data;
        const wanted = tag?.toLocaleLowerCase();
        const entries = (await options.store.listJournal()).filter(
            (entry) =>
                (includeDeleted === 'true' || !entry.deleted) &&
                (from === undefined || entry.entryDate >= from) &&
                (to === undefined || entry.entryDate <= to) &&
                (wanted === undefined || entry.tags.some((value) => value.toLocaleLowerCase() === wanted))
        );
        res.json({ entries });
    });
    app.post('/api/journal/mutations', async (req, res) => {
        const parsed = journalMutationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'The change is not a valid journal update.' });
            return;
        }
        res.json(await options.store.applyJournal(parsed.data));
    });
    app.get('/api/global-notes', async (req, res) => {
        const query = globalNoteQuerySchema.safeParse(req.query);
        if (!query.success) {
            res.status(400).json({ error: 'Use includeDeleted=true to include deleted global notes.' });
            return;
        }
        const notes = (await options.store.listGlobalNotes()).filter(
            (note) => query.data.includeDeleted === 'true' || !note.deleted
        );
        res.json({ notes });
    });
    app.post('/api/global-notes/mutations', async (req, res) => {
        const parsed = globalNoteMutationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'The change is not a valid global note update.' });
            return;
        }
        res.json(await options.store.applyGlobalNote(parsed.data));
    });
    app.get('/api/tasks', async (req, res) => {
        const query = taskQuerySchema.safeParse(req.query);
        if (!query.success) {
            res.status(400).json({
                error: 'Filter with from and to as YYYY-MM-DD, category home or work, and includeDeleted.',
            });
            return;
        }
        const { from, to, category, includeDeleted } = query.data;
        const tasks = (await options.store.listTasks()).filter(
            (task) =>
                (includeDeleted === 'true' || !task.deleted) &&
                (from === undefined || task.taskDate >= from) &&
                (to === undefined || task.taskDate <= to) &&
                (category === undefined || task.category === category)
        );
        res.json({ tasks });
    });
    app.post('/api/tasks/mutations', async (req, res) => {
        const parsed = taskMutationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'The change is not a valid task update.' });
            return;
        }
        res.json(await options.store.applyTask(parsed.data));
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
    if (options.staticDirectory) {
        const staticDirectory = options.staticDirectory;
        app.use(express.static(staticDirectory, { dotfiles: 'deny' }));
        app.get('/notes', (_req, res) => res.sendFile(path.join(staticDirectory, 'index.html')));
        app.get('/tasks', (_req, res) => res.sendFile(path.join(staticDirectory, 'index.html')));
    }
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
        if (error instanceof JournalSectionRequiredError) {
            res.status(409).json({ error: error.message, code: 'journal-section-required' });
            return;
        }
        if (error instanceof JournalOverflowError) {
            res.status(409).json({ error: error.message });
            return;
        }
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
        res.status(503).json({ error: 'The Workbench could not read or save data. Please retry.' });
    };
    app.use(handleError);
    return app;
}
