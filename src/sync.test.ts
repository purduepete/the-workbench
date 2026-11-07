import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryIdeasStore } from '../server/store';
import {
    acknowledge,
    emptySyncState,
    fieldsOf,
    localIdeas,
    markAttempted,
    queueCreate,
    queueDelete,
    queueUpdate,
    readSyncState,
    replaceServer,
    SYNC_STORAGE_KEY,
} from './sync';
import type { SyncState } from './sync';
import type { Idea } from './types';

const idea = (title: string, id: string = crypto.randomUUID()): Idea => ({
    id,
    title,
    body: '',
    tags: [],
    createdAt: '2026-10-29T18:00:00.000Z',
    updatedAt: '2026-10-29T18:00:00.000Z',
    pinned: false,
    archived: false,
    solution: null,
    status: 'open',
    priority: 'high',
});

/** Sends the head of the outbox the way the hook does: mark attempted, apply, acknowledge. */
async function sendNext(state: SyncState, store: MemoryIdeasStore): Promise<SyncState> {
    const entry = state.outbox[0];
    const attempted = markAttempted(state, entry.mutationId);
    const { attempted: _attempted, ...mutation } = attempted.outbox[0];
    return acknowledge(attempted, entry.mutationId, await store.apply(mutation));
}

async function drain(state: SyncState, store: MemoryIdeasStore): Promise<SyncState> {
    let next = state;
    while (next.outbox.length > 0) next = await sendNext(next, store);
    // The hook refetches the full list once the outbox is empty.
    return replaceServer(next, await store.list());
}

describe('outbox', () => {
    it('normalizes status for new writes and displays older unlinked notes as N/A', () => {
        const note = idea('Unlinked');
        expect(fieldsOf({ ...note, status: 'done' }).status).toBe('n/a');
        expect(fieldsOf({ ...note, solution: 'ferry-tracker', status: 'n/a' }).status).toBe('open');
        expect(fieldsOf({ ...note, solution: 'ferry-tracker', status: 'done' }).status).toBe('done');
        const state = {
            ...queueCreate(emptySyncState(), note),
            server: [{ ...idea('Previously saved'), version: 1 }],
        };
        expect(localIdeas(state).map(({ status }) => status)).toEqual(['n/a', 'n/a']);
    });

    it('collapses two offline edits to one note into a single update with no copy', async () => {
        const store = new MemoryIdeasStore();
        const note = idea('Draft');
        let state = await drain(queueCreate(emptySyncState(), note), store);
        state = queueUpdate(state, { ...note, title: 'Draft 2' });
        state = queueUpdate(state, { ...note, title: 'Draft 3' });
        expect(state.outbox).toHaveLength(1);
        state = await drain(state, store);
        expect((await store.list()).map(({ title, version }) => ({ title, version }))).toEqual([
            { title: 'Draft 3', version: 2 },
        ]);
        expect(localIdeas(state).map((item) => item.title)).toEqual(['Draft 3']);
    });

    it('never folds a new edit into a change that was already sent', () => {
        const note = idea('Sent');
        let state = queueCreate(emptySyncState(), note);
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueUpdate(state, { ...note, title: 'After send' });
        expect(state.outbox.map((entry) => entry.kind)).toEqual(['create', 'update']);
        expect(state.outbox[0].kind === 'create' && state.outbox[0].fields.title).toBe('Sent');
    });

    it('rebases an edit queued behind an in-flight edit onto the acknowledged version', async () => {
        const store = new MemoryIdeasStore();
        const note = idea('Base');
        let state = await drain(queueCreate(emptySyncState(), note), store);
        state = queueUpdate(state, { ...note, title: 'First' });
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueUpdate(state, { ...note, title: 'Second' });
        await drain(state, store);
        expect((await store.list()).map(({ title, version }) => ({ title, version }))).toEqual([
            { title: 'Second', version: 3 },
        ]);
    });

    it('sends an edit queued behind an in-flight conflicting edit to the copy', async () => {
        const store = new MemoryIdeasStore();
        const note = idea('Shared');
        let state = await drain(queueCreate(emptySyncState(), note), store);
        // Another device edits the note while this one is offline.
        await store.apply({
            kind: 'update',
            mutationId: crypto.randomUUID(),
            id: note.id,
            baseVersion: 1,
            copyId: crypto.randomUUID(),
            fields: { ...state.server[0], title: 'Other device' },
        });
        state = queueUpdate(state, { ...note, title: 'Mine' });
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueUpdate(state, { ...note, title: 'Mine again' });
        state = await drain(state, store);
        const titles = (await store.list()).map((item) => item.title).sort();
        expect(titles).toEqual(['Mine again', 'Other device']);
        expect(
            localIdeas(state)
                .map((item) => item.title)
                .sort()
        ).toEqual(['Mine again', 'Other device']);
    });

    it('keeps an edit of a note deleted elsewhere as a copy', async () => {
        const store = new MemoryIdeasStore();
        const note = idea('Doomed');
        let state = await drain(queueCreate(emptySyncState(), note), store);
        await store.apply({ kind: 'delete', mutationId: crypto.randomUUID(), id: note.id });
        state = await drain(queueUpdate(state, { ...note, title: 'Still wanted' }), store);
        expect((await store.list()).map((item) => item.title)).toEqual(['Still wanted (copy)']);
        expect(localIdeas(state).map((item) => item.title)).toEqual(['Still wanted (copy)']);
    });

    it('drops an unsent note entirely when it is deleted before syncing', () => {
        const note = idea('Never sent');
        const state = queueDelete(queueUpdate(queueCreate(emptySyncState(), note), note), note.id);
        expect(state.outbox).toEqual([]);
        expect(localIdeas(state)).toEqual([]);
    });

    it('saves priority on create, edit, pin and archive and keeps it on a conflict copy', async () => {
        const store = new MemoryIdeasStore();
        const note = { ...idea('Ranked'), priority: 'low' as const };
        let state = await drain(queueCreate(emptySyncState(), note), store);
        expect(localIdeas(state)[0].priority).toBe('low');
        state = await drain(queueUpdate(state, { ...localIdeas(state)[0], priority: 'medium' }), store);
        state = await drain(queueUpdate(state, { ...localIdeas(state)[0], pinned: true, archived: true }), store);
        expect(await store.list()).toMatchObject([{ priority: 'medium', pinned: true, archived: true }]);
        await store.apply({
            kind: 'update',
            mutationId: crypto.randomUUID(),
            id: note.id,
            baseVersion: 3,
            copyId: crypto.randomUUID(),
            fields: { ...fieldsOf(localIdeas(state)[0]), title: 'Other device' },
        });
        await drain(queueUpdate(state, { ...localIdeas(state)[0], title: 'Stale edit' }), store);
        expect(
            (await store.list()).map((item) => [item.title, item.priority]).sort((a, b) => a[0].localeCompare(b[0]))
        ).toEqual([
            ['Other device', 'medium'],
            ['Stale edit (copy)', 'medium'],
        ]);
    });
});

describe('readSyncState', () => {
    afterEach(() => vi.unstubAllGlobals());

    const withStorage = (values: Record<string, string>) =>
        vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values[key] ?? null } });

    it('gives data saved before solutions existed the server defaults', () => {
        const { solution: _solution, status: _status, priority: _p, ...old } = idea('Saved last month', 'old-1');
        const { solution: _s, status: _st, priority: _pr, ...oldFields } = fieldsOf(idea('Queued offline', 'old-2'));
        withStorage({
            [SYNC_STORAGE_KEY]: JSON.stringify({
                server: [{ ...old, version: 3 }],
                outbox: [
                    {
                        kind: 'create',
                        mutationId: 'm-1',
                        id: 'old-2',
                        createdAt: old.createdAt,
                        fields: oldFields,
                        attempted: false,
                    },
                ],
            }),
        });
        const { state, error } = readSyncState();
        expect(error).toBeNull();
        expect(state.server[0]).toMatchObject({
            id: 'old-1',
            solution: null,
            status: 'open',
            priority: 'high',
            version: 3,
        });
        const entry = state.outbox[0];
        expect(entry.kind !== 'delete' && entry.fields).toMatchObject({ solution: null, status: 'open' });
        // The queued payload is not rewritten; the server applies the priority default.
        expect(entry.kind !== 'delete' && 'priority' in entry.fields).toBe(false);
        expect(localIdeas(state).map((item) => [item.id, item.status, item.priority])).toEqual(
            expect.arrayContaining([
                ['old-1', 'n/a', 'high'],
                ['old-2', 'n/a', 'high'],
            ])
        );
    });

    it('keeps the priority of a queued pre-priority edit unchanged, including after it was attempted', async () => {
        const store = new MemoryIdeasStore();
        const note = { ...idea('Medium one'), priority: 'medium' as const };
        const state = await drain(queueCreate(emptySyncState(), note), store);
        const { priority: _priority, ...oldFields } = fieldsOf({ ...note, title: 'Edited by old client' });
        const payload = {
            kind: 'update' as const,
            mutationId: crypto.randomUUID(),
            id: note.id,
            baseVersion: 1,
            copyId: crypto.randomUUID(),
            fields: oldFields,
            attempted: true,
        };
        withStorage({ [SYNC_STORAGE_KEY]: JSON.stringify({ server: state.server, outbox: [payload] }) });
        const restored = readSyncState().state;
        expect(restored.outbox[0]).toEqual(payload);
        expect(localIdeas(restored)[0]).toMatchObject({ title: 'Edited by old client', priority: 'medium' });
        await drain(restored, store);
        expect(await store.list()).toMatchObject([{ title: 'Edited by old client', priority: 'medium' }]);
    });
});
