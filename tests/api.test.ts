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
    it('reports unconfigured OneDrive without exposing environment values', async () => {
        const response = await fetch(`${origin}/api/onedrive`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ configuration: null });
    });

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
        expect(cookie).toMatch(/^the-workbench\.theme=light;/);
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

describe('journal', () => {
    const journalSave = (entryDate: string, baseVersion: number, body: string, tags: string[] = []) => ({
        kind: 'save' as const,
        mutationId: randomUUID(),
        entryDate,
        baseVersion,
        body,
        tags,
        updatedAt: '2026-10-29T20:05:00.000Z',
        editedLabel: '10/29/2026 13:05',
    });
    const journalDelete = (entryDate: string, baseVersion: number) => ({
        kind: 'delete' as const,
        mutationId: randomUUID(),
        entryDate,
        baseVersion,
    });
    const send = async (mutation: unknown) => {
        const response = await post('/api/journal/mutations', mutation);
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const list = async (query = '') =>
        ((await (await fetch(`${origin}/api/journal${query}`)).json()) as { entries: Record<string, unknown>[] })
            .entries;

    it('creates, replaces and lists entries newest first', async () => {
        expect((await send(journalSave('2026-10-28', 0, 'Tuesday'))).body).toMatchObject({
            outcome: 'created',
            resultVersion: 1,
            entry: { entryDate: '2026-10-28', body: 'Tuesday', version: 1, deleted: false },
        });
        await send(journalSave('2026-10-29', 0, 'Wednesday', ['work']));
        expect((await send(journalSave('2026-10-29', 1, 'Wednesday, edited', ['work']))).body).toMatchObject({
            outcome: 'updated',
            resultVersion: 2,
        });
        const entries = await list();
        expect(entries.map((entry) => [entry.entryDate, entry.body])).toEqual([
            ['2026-10-29', 'Wednesday, edited'],
            ['2026-10-28', 'Tuesday'],
        ]);
    });

    it('merges a stale save from another device without losing text', async () => {
        await send(journalSave('2026-10-29', 0, 'From phone', ['Home']));
        const merged = await send(journalSave('2026-10-29', 0, 'From laptop', ['home', 'work']));
        expect(merged.body).toMatchObject({
            outcome: 'merged',
            resultVersion: 2,
            entry: {
                body: 'From phone\n\n--- Edit from 10/29/2026 13:05 ---\nFrom laptop',
                tags: ['Home', 'work'],
            },
        });
        expect((await send(journalSave('2026-10-29', 0, 'From laptop'))).body).toMatchObject({
            outcome: 'merged',
            resultVersion: 2,
        });
    });

    it('keeps an entry on a stale delete and restores a tombstone with a higher version', async () => {
        await send(journalSave('2026-10-29', 0, 'First'));
        await send(journalSave('2026-10-29', 1, 'Second'));
        expect((await send(journalDelete('2026-10-29', 1))).body).toMatchObject({ outcome: 'kept', resultVersion: 2 });
        expect((await send(journalDelete('2026-10-29', 2))).body).toMatchObject({
            outcome: 'deleted',
            resultVersion: 3,
        });
        expect(await list()).toEqual([]);
        expect(await list('?includeDeleted=true')).toMatchObject([
            { entryDate: '2026-10-29', deleted: true, body: '' },
        ]);
        expect((await send(journalDelete('2026-10-29', 3))).body).toMatchObject({ outcome: 'kept' });
        expect((await send(journalSave('2026-10-29', 0, 'Back'))).body).toMatchObject({
            outcome: 'created',
            resultVersion: 4,
            entry: { body: 'Back', deleted: false },
        });
    });

    it('returns the original receipt when a mutation is retried', async () => {
        const first = journalSave('2026-10-29', 0, 'Once');
        const original = await send(first);
        await send(journalSave('2026-10-29', 1, 'Later'));
        expect((await send(first)).body).toMatchObject({ outcome: original.body.outcome, resultVersion: 1 });
        expect((await list())[0]).toMatchObject({ body: 'Later', version: 2 });
    });

    it('filters by date range and tag and rejects bad queries', async () => {
        await send(journalSave('2026-09-30', 0, 'September', ['health']));
        await send(journalSave('2026-10-05', 0, 'October', ['Health']));
        await send(journalSave('2026-10-06', 0, 'Other', ['work']));
        const october = await list('?from=2026-10-01&to=2026-10-31&tag=health');
        expect(october.map((entry) => entry.entryDate)).toEqual(['2026-10-05']);
        for (const query of ['?from=2026-02-30', '?to=10/05/2026', '?includeDeleted=yes', '?other=1']) {
            expect((await fetch(`${origin}/api/journal${query}`)).status).toBe(400);
        }
    });

    it('validates journal changes', async () => {
        expect((await send({ ...journalSave('2026-10-29', 0, 'x'), extra: 1 })).status).toBe(400);
        expect((await send(journalSave('2026-02-30', 0, 'x'))).status).toBe(400);
        expect((await send(journalSave('2026-10-29', 0, '   '))).status).toBe(400);
        expect((await send({ ...journalSave('2026-10-29', 0, 'x'), editedLabel: '2026-10-29' })).status).toBe(400);
        expect((await send(journalDelete('2026-10-29', 0))).status).toBe(400);
        const tags = Array.from({ length: 65 }, (_, index) => `t${index}`);
        expect((await send(journalSave('2026-10-29', 0, 'x', tags))).status).toBe(400);
        expect(
            (
                await post('/api/journal/mutations', journalSave('2026-10-29', 0, 'x'), {
                    Origin: 'https://evil.example',
                })
            ).status
        ).toBe(403);
    });

    it('accepts a full-length multibyte entry while other routes keep the 64kb cap', async () => {
        const body = '漢'.repeat(200_000);
        const saved = await send(journalSave('2026-10-29', 0, body));
        expect(saved.status).toBe(200);
        expect((saved.body.entry as { body: string }).body).toHaveLength(200_000);
        expect((await send(journalSave('2026-10-30', 0, 'x'.repeat(200_001)))).status).toBe(400);
        const huge = create('Big');
        if (huge.kind === 'create') huge.fields.body = 'x'.repeat(66_000);
        expect((await post('/api/mutations', huge)).status).toBe(413);
        expect((await post('/api/preferences', { theme: 'light', pad: 'x'.repeat(66_000) })).status).toBe(413);
    });

    it('answers 409 and writes nothing when a merge would pass the limit', async () => {
        await send(journalSave('2026-10-29', 0, 'a'.repeat(150_000)));
        const refused = journalSave('2026-10-29', 0, 'b'.repeat(60_000));
        expect((await send(refused)).status).toBe(409);
        expect((await list())[0]).toMatchObject({ version: 1 });
        // No receipt was kept, so the same mutation can succeed once it fits.
        expect((await send({ ...refused, body: 'short' })).body).toMatchObject({ outcome: 'merged' });
    });
});

describe('global notes', () => {
    const globalSave = (
        id: string,
        baseVersion: number,
        patch: Partial<{
            title: string;
            body: string;
            tags: string[];
            pinned: boolean;
            mutationId: string;
            updatedAt: string;
        }> = {}
    ) => ({
        kind: 'save' as const,
        mutationId: patch.mutationId ?? randomUUID(),
        id,
        baseVersion,
        title: patch.title ?? 'Reference',
        body: patch.body ?? '',
        tags: patch.tags ?? [],
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        updatedAt: patch.updatedAt ?? '2026-10-29T20:05:00.000Z',
        editedLabel: '10/29/2026 13:05',
    });

    const globalDelete = (id: string, baseVersion: number) => ({
        kind: 'delete' as const,
        mutationId: randomUUID(),
        id,
        baseVersion,
    });

    const send = async (mutation: unknown) => {
        const response = await post('/api/global-notes/mutations', mutation);
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };

    const list = async (query = '') =>
        ((await (await fetch(`${origin}/api/global-notes${query}`)).json()) as { notes: Record<string, unknown>[] })
            .notes;

    it('saves a date-agnostic note and ignores a legacy pin field', async () => {
        const id = randomUUID();
        const created = await send(globalSave(id, 0, { pinned: true }));
        expect(created.body).toMatchObject({
            outcome: 'created',
            note: { id, title: 'Reference', body: '', version: 1 },
        });
        expect(created.body.note).not.toHaveProperty('pinned');
        expect((await send(globalSave(id, 0, { pinned: false }))).body).toMatchObject({
            outcome: 'merged',
            resultVersion: 1,
        });
        const notes = await list();
        expect(notes).toMatchObject([{ id }]);
        expect(notes[0]).not.toHaveProperty('pinned');
    });

    it('preserves stale title-only changes and deduplicates retries', async () => {
        const id = randomUUID();
        await send(globalSave(id, 0, { body: 'Shared body' }));
        const titleChange = globalSave(id, 0, { title: 'Phone title', body: 'Shared body' });
        expect((await send(titleChange)).body).toMatchObject({
            outcome: 'merged',
            resultVersion: 2,
            note: {
                title: 'Reference',
                body: 'Shared body\n\n--- Edit from 10/29/2026 13:05, titled "Phone title" ---',
            },
        });
        expect((await send(titleChange)).body).toMatchObject({ resultVersion: 2 });
        expect((await send(globalSave(id, 0, { body: 'Shared body', pinned: true }))).body).toMatchObject({
            outcome: 'merged',
            resultVersion: 2,
        });
    });

    it('orders global notes by update time even when an older save included a pin flag', async () => {
        const older = randomUUID();
        const newer = randomUUID();
        await send(globalSave(older, 0, { pinned: true, updatedAt: '2026-10-28T20:05:00.000Z' }));
        await send(globalSave(newer, 0, { updatedAt: '2026-10-29T20:05:00.000Z' }));
        expect((await list()).map((note) => note.id)).toEqual([newer, older]);
    });

    it('keeps stale deletes, tombstones matching deletes and restores with a higher version', async () => {
        const id = randomUUID();
        await send(globalSave(id, 0, { body: 'Original' }));
        await send(globalSave(id, 1, { body: 'Updated' }));
        expect((await send(globalDelete(id, 1))).body).toMatchObject({ outcome: 'kept' });
        expect((await send(globalDelete(id, 2))).body).toMatchObject({
            outcome: 'deleted',
            note: { deleted: true, body: '' },
        });
        expect(await list()).toEqual([]);
        expect(await list('?includeDeleted=true')).toMatchObject([{ id, deleted: true }]);
        expect((await send(globalSave(id, 0, { body: 'Restored' }))).body).toMatchObject({
            outcome: 'created',
            resultVersion: 4,
            note: { deleted: false, version: 4 },
        });
    });

    it('validates writes and permits the journal-sized payload cap', async () => {
        const id = randomUUID();
        expect((await send(globalSave(id, 0, { title: ' ' }))).status).toBe(400);
        expect((await send({ ...globalSave(id, 0), extra: 1 })).status).toBe(400);
        expect(
            (await post('/api/global-notes/mutations', globalSave(id, 0), { Origin: 'https://evil.example' })).status
        ).toBe(403);
        const long = globalSave(id, 0, { body: '漢'.repeat(200_000) });
        expect((await send(long)).status).toBe(200);
        expect((await send(globalSave(randomUUID(), 0, { body: 'x'.repeat(200_001) }))).status).toBe(400);
    });
});

describe('page routes', () => {
    it('serves the app shell at /notes and 404s other unknown paths', async () => {
        const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const directory = await mkdtemp(join(tmpdir(), 'the-workbench-'));
        await writeFile(join(directory, 'index.html'), '<!doctype html><title>shell</title>');
        const shell = createServer();
        await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve));
        const address = shell.address();
        if (!address || typeof address === 'string') throw new Error('Shell server did not bind.');
        const base = `http://127.0.0.1:${address.port}`;
        shell.on('request', createApp({ store, allowedOrigins: [base], staticDirectory: directory }));
        try {
            const notes = await fetch(`${base}/notes`);
            expect(notes.status).toBe(200);
            expect(await notes.text()).toContain('shell');
            expect((await fetch(`${base}/nope`)).status).toBe(404);
            expect((await fetch(`${base}/notes/extra`)).status).toBe(404);
            expect((await fetch(`${base}/api/notes`)).status).toBe(404);
        } finally {
            await new Promise<void>((resolve) => shell.close(() => resolve()));
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe('PostgresIdeasStore', () => {
    const fakePool = (handler: (sql: string, values?: unknown[]) => { rows: unknown[] }) =>
        ({ query: async (sql: string, values?: unknown[]) => handler(sql, values) }) as unknown as Pool;

    it('is ready only at schema version 4 with journal, global-note and task tables', async () => {
        const at = (version: number) =>
            new PostgresIdeasStore(
                fakePool((sql) => ({ rows: sql.includes('solutiondeploy_schema') ? [{ version }] : [] }))
            );
        await expect(at(4).ready()).resolves.toBeUndefined();
        await expect(at(3).ready()).rejects.toThrow(/schema version/);
        await expect(at(2).ready()).rejects.toThrow(/schema version/);
        await expect(at(1).ready()).rejects.toThrow(/schema version/);
        const missingJournal = new PostgresIdeasStore(
            fakePool((sql) => {
                if (sql.includes('journal_entries')) throw new Error('relation does not exist');
                return { rows: sql.includes('solutiondeploy_schema') ? [{ version: 4 }] : [] };
            })
        );
        await expect(missingJournal.ready()).rejects.toThrow(/does not exist/);
        const missingGlobalNotes = new PostgresIdeasStore(
            fakePool((sql) => {
                if (sql.includes('global_notes')) throw new Error('relation does not exist');
                return { rows: sql.includes('solutiondeploy_schema') ? [{ version: 4 }] : [] };
            })
        );
        await expect(missingGlobalNotes.ready()).rejects.toThrow(/does not exist/);
        for (const table of ['public.tasks', 'public.task_mutations']) {
            const missingTasks = new PostgresIdeasStore(
                fakePool((sql) => {
                    if (sql.includes(table)) throw new Error('relation does not exist');
                    return { rows: sql.includes('solutiondeploy_schema') ? [{ version: 4 }] : [] };
                })
            );
            await expect(missingTasks.ready()).rejects.toThrow(/does not exist/);
        }
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
