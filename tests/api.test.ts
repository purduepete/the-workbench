import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { createSolutionSource } from '../server/solutions.js';
import type { SolutionSource } from '../server/solutions.js';
import { MemoryIdeasStore, PostgresIdeasStore } from '../server/store.js';
import { mutationSchema } from '../shared/contracts.js';
import type { IdeaFields, Mutation } from '../shared/contracts.js';

let server: Server;
let origin: string;
let store: MemoryIdeasStore;
let solutions: SolutionSource | undefined;

const fields = (title: string): IdeaFields => ({
    title,
    body: 'Details',
    tags: ['home'],
    pinned: false,
    archived: false,
    solution: null,
    status: 'open',
    updatedAt: '2026-10-29T18:00:00.000Z',
});

const create = (title: string, id = randomUUID()): Mutation => ({
    kind: 'create',
    mutationId: randomUUID(),
    id,
    createdAt: '2026-10-29T18:00:00.000Z',
    fields: fields(title),
});

const update = (id: string, baseVersion: number, title: string): Mutation => ({
    kind: 'update',
    mutationId: randomUUID(),
    id,
    baseVersion,
    copyId: randomUUID(),
    fields: fields(title),
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
    origin = `http://127.0.0.1:${address.port}`;
    server.on('request', (req, res) => createApp({ store, allowedOrigins: [origin], solutions })(req, res));
});

beforeEach(() => {
    store = new MemoryIdeasStore();
    solutions = undefined;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('request guards', () => {
    it('rejects writes without an allowed origin, JSON body or same-site request', async () => {
        const mutation = create('Guarded');
        expect((await post('/api/mutations', mutation, { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await post('/api/mutations', mutation, { 'Content-Type': 'text/plain' })).status).toBe(403);
        expect((await post('/api/mutations', mutation, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
        expect((await post('/api/preferences', { theme: 'light' }, { Origin: 'https://evil.example' })).status).toBe(
            403
        );
        expect(await store.list()).toEqual([]);
    });

    it('rejects unknown hosts except for loopback readiness', async () => {
        const { request } = await import('node:http');
        const status = (path: string) =>
            new Promise<number>((resolve, reject) => {
                const req = request(`${origin}${path}`, { headers: { Host: 'evil.example' } }, (res) => {
                    res.resume();
                    resolve(res.statusCode ?? 0);
                });
                req.on('error', reject);
                req.end();
            });
        expect(await status('/api/ideas')).toBe(403);
        expect((await fetch(`${origin}/api/health`)).status).toBe(200);
    });

    it('validates payloads and caps the body size', async () => {
        expect((await post('/api/mutations', { ...create('x'), extra: true })).status).toBe(400);
        expect((await post('/api/mutations', create(''))).status).toBe(400);
        expect((await post('/api/mutations', '{not json')).status).toBe(400);
        const huge = create('Big');
        if (huge.kind === 'create') huge.fields.body = 'x'.repeat(70_000);
        expect((await post('/api/mutations', huge)).status).toBe(413);
    });

    it('reports readiness failures as 503', async () => {
        store.failing = true;
        const response = await fetch(`${origin}/api/health`);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ ok: false });
    });
});

describe('preferences', () => {
    it('stores a valid theme in a cookie and rejects other values', async () => {
        const response = await post('/api/preferences', { theme: 'light' });
        expect(response.status).toBe(204);
        const cookie = response.headers.get('set-cookie') ?? '';
        expect(cookie).toMatch(/^idea-notes\.theme=light;/);
        expect(cookie).toMatch(/SameSite=Lax/);
        expect(cookie).not.toMatch(/Secure/);
        expect((await post('/api/preferences', { theme: 'dark' })).status).toBe(400);
    });
});

describe('mutations', () => {
    it('creates, updates and lists ideas with versions', async () => {
        const created = create('First');
        expect(await (await post('/api/mutations', created)).json()).toMatchObject({
            outcome: 'created',
            resultVersion: 1,
        });
        const updated = await (await post('/api/mutations', update(created.id, 1, 'First, edited'))).json();
        expect(updated).toMatchObject({ outcome: 'updated', resultVersion: 2, idea: { title: 'First, edited' } });
        const { ideas } = await (await fetch(`${origin}/api/ideas`)).json();
        expect(ideas).toHaveLength(1);
    });

    it('keeps both versions when the base version is stale', async () => {
        const created = create('Shared');
        await store.apply(created);
        await store.apply(update(created.id, 1, 'Edited elsewhere'));
        const stale = update(created.id, 1, 'Edited offline');
        const result = await store.apply(stale);
        expect(result).toMatchObject({ outcome: 'copied', resultVersion: 1, idea: { title: 'Edited offline (copy)' } });
        if (stale.kind === 'update') expect(result.resultId).toBe(stale.copyId);
        expect((await store.list()).map((idea) => idea.title).sort()).toEqual([
            'Edited elsewhere',
            'Edited offline (copy)',
        ]);
    });

    it('returns the original result when a lost response is retried', async () => {
        const created = create('Retry');
        await store.apply(created);
        const edit = update(created.id, 1, 'Retry, edited');
        const first = await store.apply(edit);
        const retry = await store.apply(edit);
        expect(retry).toMatchObject({ outcome: 'updated', resultVersion: 2 });
        expect(retry.outcome).toBe(first.outcome);

        // Another client edits before the retry arrives; the retry still reports the first outcome.
        await store.apply(update(created.id, 2, 'Edited elsewhere'));
        expect(await store.apply(edit)).toMatchObject({ outcome: 'updated', resultVersion: 2 });
        expect(await store.list()).toHaveLength(1);
    });

    it('answers concurrent duplicate retries with one result and one copy', async () => {
        const created = create('Race');
        await store.apply(created);
        await store.apply(update(created.id, 1, 'Moved on'));
        const stale = update(created.id, 1, 'Stale edit');
        const results = await Promise.all([1, 2, 3].map(() => post('/api/mutations', stale).then((r) => r.json())));
        expect(new Set(results.map((result) => result.resultId)).size).toBe(1);
        expect(await store.list()).toHaveLength(2);
    });

    it('turns an edit of a deleted note into a copy', async () => {
        const created = create('Gone');
        await store.apply(created);
        await store.apply({ kind: 'delete', mutationId: randomUUID(), id: created.id });
        const result = await store.apply(update(created.id, 1, 'Edited after delete'));
        expect(result.outcome).toBe('copied');
        expect((await store.list()).map((idea) => idea.title)).toEqual(['Edited after delete (copy)']);
    });

    it('makes creates and deletes safe to repeat', async () => {
        const created = create('Twice');
        await store.apply(created);
        await store.apply(created);
        const removal: Mutation = { kind: 'delete', mutationId: randomUUID(), id: created.id };
        await store.apply(removal);
        expect(await store.apply(removal)).toMatchObject({ outcome: 'deleted', idea: null });
        expect(await store.list()).toEqual([]);
    });
});

describe('solutions and status', () => {
    const linked = (title: string, solution: string | null, status: IdeaFields['status']): Mutation => ({
        kind: 'create',
        mutationId: randomUUID(),
        id: randomUUID(),
        createdAt: '2026-10-29T18:00:00.000Z',
        fields: { ...fields(title), solution, status },
    });

    it('defaults solution and status for changes queued by an older client', () => {
        const { solution: _solution, status: _status, ...oldFields } = fields('Old client');
        const parsed = mutationSchema.parse({ ...create('Old client'), fields: oldFields });
        expect(parsed.kind === 'create' && parsed.fields).toMatchObject({ solution: null, status: 'n/a' });
    });

    it('sets N/A on unlinked writes and Open when linking an N/A idea', async () => {
        const mutation = linked('Loose thought', null, 'done');
        expect(await (await post('/api/mutations', mutation)).json()).toMatchObject({
            idea: { solution: null, status: 'n/a' },
        });
        const edit = update(mutation.id, 1, 'Now linked');
        if (edit.kind !== 'update') throw new Error('Expected update.');
        edit.fields = { ...edit.fields, solution: 'ferry-tracker', status: 'n/a' };
        expect(await (await post('/api/mutations', edit)).json()).toMatchObject({
            idea: { solution: 'ferry-tracker', status: 'open' },
        });
        const unlink = update(mutation.id, 2, 'Unlinked again');
        if (unlink.kind !== 'update') throw new Error('Expected update.');
        unlink.fields.status = 'in-progress';
        expect(await (await post('/api/mutations', unlink)).json()).toMatchObject({
            idea: { solution: null, status: 'n/a' },
        });
        const response = await fetch(`${origin}/api/ideas?solution=none&status=n%2Fa`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ideas: [{ id: mutation.id, status: 'n/a' }] });
    });

    it('filters ideas by solution and status and rejects bad filters', async () => {
        await store.apply(linked('Tide alerts', 'ferry-tracker', 'open'));
        await store.apply(linked('Shipped already', 'ferry-tracker', 'done'));
        await store.apply(linked('Loose thought', null, 'open'));
        const titles = async (query: string) =>
            ((await (await fetch(`${origin}/api/ideas${query}`)).json()) as { ideas: { title: string }[] }).ideas
                .map((idea) => idea.title)
                .sort();
        expect(await titles('?solution=ferry-tracker&status=open')).toEqual(['Tide alerts']);
        expect(await titles('?solution=ferry-tracker')).toEqual(['Shipped already', 'Tide alerts']);
        expect(await titles('?solution=none')).toEqual(['Loose thought']);
        expect(await titles('?status=done')).toEqual(['Shipped already']);
        expect((await fetch(`${origin}/api/ideas?solution=Bad%20Id`)).status).toBe(400);
        expect((await fetch(`${origin}/api/ideas?status=later`)).status).toBe(400);
    });

    it('rejects a solution id outside the directory id format', async () => {
        const response = await post('/api/mutations', linked('Bad link', '../etc', 'open'));
        expect(response.status).toBe(400);
    });

    it('serves the directory list and keeps the last good copy when it fails', async () => {
        let fail = false;
        const directory = createServer((_req, res) => {
            if (fail) {
                res.writeHead(500).end();
                return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({
                    host: 'test',
                    sites: [
                        { id: 'work-log', name: 'Work Log', url: 'x' },
                        { id: 'ferry-tracker', name: 'Ferry Tracker' },
                    ],
                })
            );
        });
        await new Promise<void>((resolve) => directory.listen(0, '127.0.0.1', resolve));
        const address = directory.address();
        if (!address || typeof address === 'string') throw new Error('Directory server did not bind.');
        try {
            solutions = createSolutionSource(`http://127.0.0.1:${address.port}/sites.json`);
            const expected = {
                solutions: [
                    { id: 'ferry-tracker', name: 'Ferry Tracker', disabled: false },
                    { id: 'work-log', name: 'Work Log', disabled: false },
                ],
            };
            expect(await (await fetch(`${origin}/api/solutions`)).json()).toEqual(expected);
            fail = true;
            expect(await (await fetch(`${origin}/api/solutions`)).json()).toEqual(expected);
        } finally {
            await new Promise((resolve) => directory.close(resolve));
        }
    });

    it('reports 503 when the directory has never answered and [] when none is configured', async () => {
        expect(await (await fetch(`${origin}/api/solutions`)).json()).toEqual({ solutions: [] });
        solutions = createSolutionSource('C:\\missing\\sites.json');
        expect((await fetch(`${origin}/api/solutions`)).status).toBe(503);
    });

    it('disables and re-enables a solution for every client and keeps linked ideas', async () => {
        solutions = async () => [
            { id: 'ferry-tracker', name: 'Ferry Tracker' },
            { id: 'work-log', name: 'Work Log' },
        ];
        const linked = create('Linked');
        if (linked.kind === 'create') linked.fields = { ...linked.fields, solution: 'work-log', status: 'open' };
        await post('/api/mutations', linked);

        const disabled = await post('/api/solution-settings', { id: 'work-log', disabled: true });
        expect(await disabled.json()).toEqual({ id: 'work-log', disabled: true });
        expect((await post('/api/solution-settings', { id: 'work-log', disabled: true })).status).toBe(200);
        expect(await (await fetch(`${origin}/api/solutions`)).json()).toEqual({
            solutions: [
                { id: 'ferry-tracker', name: 'Ferry Tracker', disabled: false },
                { id: 'work-log', name: 'Work Log', disabled: true },
            ],
        });
        const { ideas } = (await (await fetch(`${origin}/api/ideas?solution=work-log`)).json()) as {
            ideas: { title: string }[];
        };
        expect(ideas.map((idea) => idea.title)).toEqual(['Linked']);

        await post('/api/solution-settings', { id: 'work-log', disabled: false });
        expect(await store.listDisabledSolutions()).toEqual([]);
    });

    it('guards and validates solution settings', async () => {
        const body = { id: 'work-log', disabled: true };
        expect((await post('/api/solution-settings', body, { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await post('/api/solution-settings', body, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
        expect((await post('/api/solution-settings', { id: 'Work Log', disabled: true })).status).toBe(400);
        expect((await post('/api/solution-settings', { id: 'work-log', disabled: 'yes' })).status).toBe(400);
        expect((await post('/api/solution-settings', { ...body, extra: 1 })).status).toBe(400);
        expect(await store.listDisabledSolutions()).toEqual([]);
        store.failing = true;
        expect((await post('/api/solution-settings', body)).status).toBe(503);
    });
});

describe('PostgresIdeasStore', () => {
    const fakePool = (handler: (sql: string, values?: unknown[]) => { rows: unknown[] }) =>
        ({ query: async (sql: string, values?: unknown[]) => handler(sql, values) }) as unknown as Pool;

    it('is ready only at schema version 1', async () => {
        const at = (version: number) =>
            new PostgresIdeasStore(
                fakePool((sql) => ({ rows: sql.includes('solutiondeploy_schema') ? [{ version }] : [] }))
            );
        await expect(at(1).ready()).resolves.toBeUndefined();
        await expect(at(2).ready()).rejects.toThrow(/schema version/);
    });

    it('returns the recorded receipt when a concurrent retry wins the race', async () => {
        const mutation = create('Raced');
        const duplicate = Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'applied_mutations_pkey',
        });
        const pool = {
            connect: async () => ({
                query: async (sql: string) => {
                    if (sql.startsWith('INSERT INTO public.applied_mutations')) throw duplicate;
                    if (sql.includes('FROM public.applied_mutations')) return { rows: [] };
                    if (sql.startsWith('INSERT INTO public.ideas')) return { rows: [{ version: 1 }] };
                    return { rows: [] };
                },
                release: () => undefined,
            }),
            query: async (sql: string) => {
                if (sql.includes('FROM public.applied_mutations'))
                    return { rows: [{ outcome: 'created', result_id: mutation.id, result_version: 1 }] };
                return { rows: [] };
            },
        } as unknown as Pool;
        await expect(new PostgresIdeasStore(pool).apply(mutation)).resolves.toMatchObject({
            outcome: 'created',
            resultId: mutation.id,
            idea: null,
        });
    });
});
