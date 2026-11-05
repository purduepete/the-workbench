import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresIdeasStore } from '../server/store.js';
import type { GlobalNoteSave, JournalSave } from '../shared/contracts.js';
import type { TaskMutation } from '../shared/tasks.js';

// Opt-in: runs only against a disposable database whose name ends in _test, for example a local container.
const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && new URL(url).pathname.endsWith('_test'));

const save = (baseVersion: number, body: string): JournalSave => ({
    kind: 'save',
    mutationId: randomUUID(),
    entryDate: '2026-10-29',
    baseVersion,
    body,
    tags: [],
    updatedAt: '2026-10-29T20:05:00.000Z',
    editedLabel: '10/29/2026 13:05',
});

const globalSave = (id: string, baseVersion: number, body: string, legacyPinned?: boolean): GlobalNoteSave => ({
    kind: 'save',
    mutationId: randomUUID(),
    id,
    baseVersion,
    title: 'Postgres global note',
    body,
    tags: [],
    ...(legacyPinned === undefined ? {} : { pinned: legacyPinned }),
    updatedAt: '2026-10-29T20:05:00.000Z',
    editedLabel: '10/29/2026 13:05',
});

describe.skipIf(!enabled)('PostgresIdeasStore journal against a real database', () => {
    let pool: pg.Pool;
    let store: PostgresIdeasStore;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: url, max: 6 });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        for (const file of [
            '001_initial.sql',
            '002_journal.sql',
            '003_tasks.sql',
            '004_application_id.sql',
            '005_note_categories.sql',
        ]) {
            await pool.query(await readFile(new URL(`../deploy/postgresql/${file}`, import.meta.url), 'utf8'));
        }
        store = new PostgresIdeasStore(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    it('is ready after all migrations', async () => {
        await expect(store.ready()).resolves.toBeUndefined();
    });

    it('persists Home/Work for daily notes and preserves categories on old-client saves', async () => {
        const daily = { ...save(0, 'Category daily'), entryDate: '2026-01-05', category: 'work' as const };
        expect((await store.applyJournal(daily)).entry?.category).toBe('work');
        expect((await store.listJournal()).find((entry) => entry.entryDate === daily.entryDate)?.category).toBe('work');
        const oldDaily = { ...save(1, 'Old client daily'), entryDate: daily.entryDate };
        expect((await store.applyJournal(oldDaily)).entry?.category).toBe('work');
        expect(
            (await store.applyJournal({ ...oldDaily, mutationId: randomUUID(), baseVersion: 2, category: null })).entry
                ?.category
        ).toBeNull();
    });

    it('serializes concurrent first saves for one day into one entry', async () => {
        const results = await Promise.all(
            ['Phone', 'Laptop', 'Tablet'].map((body) => store.applyJournal(save(0, body)))
        );
        expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
        const [entry] = await store.listJournal();
        expect(entry.entryDate).toBe('2026-10-29');
        for (const body of ['Phone', 'Laptop', 'Tablet']) expect(entry.body).toContain(body);
    });

    it('keeps a retried receipt and tombstones on delete', async () => {
        const [current] = await store.listJournal();
        const replace = save(current.version, 'Replaced');
        const first = await store.applyJournal(replace);
        expect(await store.applyJournal(replace)).toMatchObject({
            outcome: 'updated',
            resultVersion: first.resultVersion,
        });
        const deleted = await store.applyJournal({
            kind: 'delete',
            mutationId: randomUUID(),
            entryDate: '2026-10-29',
            baseVersion: first.resultVersion,
        });
        expect(deleted).toMatchObject({ outcome: 'deleted', entry: { deleted: true, body: '' } });
        expect(await store.applyJournal(save(0, 'Restored'))).toMatchObject({
            outcome: 'created',
            resultVersion: deleted.resultVersion + 1,
        });
    });

    it('merges stale global saves, ignores old pin flags and keeps receipts', async () => {
        const id = randomUUID();
        const first = globalSave(id, 0, 'Phone');
        expect(await store.applyGlobalNote(first)).toMatchObject({
            outcome: 'created',
            note: { id, body: 'Phone', version: 1 },
        });
        const stale = globalSave(id, 0, 'Laptop', true);
        const merged = await store.applyGlobalNote(stale);
        expect(merged).toMatchObject({
            outcome: 'merged',
            note: { body: 'Phone\n\n--- Edit from 10/29/2026 13:05 ---\nLaptop', version: 2 },
        });
        expect(merged.note).not.toHaveProperty('pinned');
        expect(await store.applyGlobalNote(stale)).toMatchObject({ resultVersion: 2 });
        const deleted = await store.applyGlobalNote({
            kind: 'delete',
            mutationId: randomUUID(),
            id,
            baseVersion: 2,
        });
        expect(deleted).toMatchObject({ outcome: 'deleted', note: { deleted: true, body: '' } });
    });

    it('serializes task ordering, transfers categories, preserves completion and permanent tombstone receipts', async () => {
        const taskDate = '2026-11-02';
        const taskSave = (id: string, category: 'home' | 'work' = 'home'): TaskMutation => ({
            kind: 'save',
            mutationId: randomUUID(),
            id,
            taskDate,
            category,
            title: 'Postgres task',
            body: '',
            updatedAt: '2026-11-02T17:00:00.000Z',
        });
        const ids = [randomUUID(), randomUUID(), randomUUID()];
        const first = taskSave(ids[0]);
        await Promise.all([store.applyTask(first), store.applyTask(first), store.applyTask(taskSave(ids[1]))]);
        let tasks = (await store.listTasks()).filter((task) => task.taskDate === taskDate);
        expect(tasks).toHaveLength(2);
        expect(tasks.map((task) => task.position)).toEqual([0, 1]);
        await store.applyTask({
            kind: 'complete',
            mutationId: randomUUID(),
            id: ids[0],
            taskDate,
            completed: true,
            updatedAt: '2026-11-02T17:01:00.000Z',
        });
        await store.applyTask(taskSave(ids[0], 'work'));
        expect((await store.listTasks()).find((task) => task.id === ids[0])).toMatchObject({
            completed: true,
            category: 'work',
            position: 0,
        });
        const order: TaskMutation = {
            kind: 'reorder',
            mutationId: randomUUID(),
            taskDate,
            category: 'home',
            orderedIds: [ids[1]],
        };
        await store.applyTask(taskSave(ids[2]));
        expect((await store.applyTask(order)).outcome).toBe('reordered');
        expect(
            (await store.applyTask({ ...order, mutationId: randomUUID(), orderedIds: [ids[0], ids[1]] })).outcome
        ).toBe('kept');
        const deleted: TaskMutation = { kind: 'delete', mutationId: randomUUID(), id: ids[1], taskDate };
        expect((await store.applyTask(deleted)).outcome).toBe('deleted');
        expect((await store.applyTask(taskSave(ids[1]))).outcome).toBe('kept');
        expect((await store.applyTask(deleted)).outcome).toBe('deleted');
        expect(await store.applyTask({ ...first, taskDate: '2026-11-03' })).toMatchObject({
            outcome: 'created',
            taskDate,
            tasks: expect.any(Array),
        });
        tasks = (await store.applyTask(order)).tasks;
        expect(tasks).toHaveLength(3);
        expect(tasks.find((task) => task.id === ids[1])).toMatchObject({ deleted: true });
        expect(tasks.filter((task) => task.category === 'home' && !task.deleted).map((task) => task.id)).toEqual([
            ids[2],
        ]);
    });
});
