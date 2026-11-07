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
const legacyReceiptId = randomUUID();
const existingIdeaId = randomUUID();

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
        await pool.query(
            `INSERT INTO public.journal_entries
                 (entry_date, body, tags, category, deleted, created_at, updated_at, version)
             VALUES ('2026-01-01', 'Retained work', '{}', 'work', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2)`
        );
        await pool.query(
            `INSERT INTO public.journal_mutations (mutation_id, entry_date, outcome, result_version)
             VALUES ($1, '2026-01-01', 'created', 1)`,
            [legacyReceiptId]
        );
        await pool.query(
            await readFile(new URL('../deploy/postgresql/006_daily_note_sections.sql', import.meta.url), 'utf8')
        );
        await pool.query(
            `INSERT INTO public.ideas (id, title, body, tags, pinned, archived, solution, status, created_at, updated_at, version)
             VALUES ($1, 'Existing idea', 'Body', '{home}', TRUE, FALSE, 'ferry-tracker', 'done',
                     '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 4)`,
            [existingIdeaId]
        );
        await pool.query(
            await readFile(new URL('../deploy/postgresql/007_idea_priority.sql', import.meta.url), 'utf8')
        );
        store = new PostgresIdeasStore(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    it('sets existing ideas to High and keeps their other fields', async () => {
        expect(await store.list()).toMatchObject([
            {
                id: existingIdeaId,
                title: 'Existing idea',
                pinned: true,
                solution: 'ferry-tracker',
                status: 'done',
                priority: 'high',
                version: 4,
            },
        ]);
        await expect(
            pool.query(`UPDATE public.ideas SET priority = 'urgent' WHERE id = $1`, [existingIdeaId])
        ).rejects.toThrow(/check constraint/);
    });

    it('keeps the stored priority when an older client updates an idea', async () => {
        await store.apply({
            kind: 'update',
            mutationId: randomUUID(),
            id: existingIdeaId,
            baseVersion: 4,
            copyId: randomUUID(),
            fields: {
                title: 'Medium now',
                body: 'Body',
                tags: ['home'],
                pinned: true,
                archived: false,
                solution: 'ferry-tracker',
                status: 'done',
                priority: 'medium',
                updatedAt: '2026-01-03T00:00:00.000Z',
            },
        });
        const response = await store.apply({
            kind: 'update',
            mutationId: randomUUID(),
            id: existingIdeaId,
            baseVersion: 5,
            copyId: randomUUID(),
            fields: {
                title: 'Old client edit',
                body: 'Body',
                tags: ['home'],
                pinned: true,
                archived: false,
                solution: 'ferry-tracker',
                status: 'done',
                updatedAt: '2026-01-04T00:00:00.000Z',
            },
        });
        expect(response).toMatchObject({ outcome: 'updated', idea: { title: 'Old client edit', priority: 'medium' } });
    });

    it('is ready after all migrations', async () => {
        await expect(store.ready()).resolves.toBeUndefined();
    });

    it('keeps legacy retry receipts attached to the retained row after adding a new section', async () => {
        const oldSave = {
            ...save(0, 'Original home'),
            entryDate: '2026-01-01',
            category: 'home' as const,
            mutationId: legacyReceiptId,
        };
        expect(await store.applyJournal(oldSave)).toMatchObject({
            outcome: 'created',
            resultVersion: 1,
            category: 'work',
            entry: { category: 'work', body: 'Retained work', version: 2 },
        });
        await store.applyJournal({ ...oldSave, mutationId: randomUUID(), body: 'Separate home' });
        expect((await store.applyJournal(oldSave)).entry).toMatchObject({
            category: 'work',
            body: 'Retained work',
            version: 2,
        });
    });

    it('persists Home/Work for daily notes and preserves categories on old-client saves', async () => {
        const daily = { ...save(0, 'Category daily'), entryDate: '2026-01-05', category: 'work' as const };
        expect((await store.applyJournal(daily)).entry?.category).toBe('work');
        expect((await store.listJournal()).find((entry) => entry.entryDate === daily.entryDate)?.category).toBe('work');
        const oldDaily = { ...save(1, 'Old client daily'), entryDate: daily.entryDate };
        expect((await store.applyJournal(oldDaily)).entry?.category).toBe('work');
        const other = await store.applyJournal({
            ...oldDaily,
            mutationId: randomUUID(),
            baseVersion: 0,
            category: null,
        });
        expect(other.entry).toMatchObject({ category: null, version: 1 });
        expect((await store.listJournal()).filter((entry) => entry.entryDate === daily.entryDate)).toHaveLength(2);
        const deleted = await store.applyJournal({
            kind: 'delete',
            mutationId: randomUUID(),
            entryDate: daily.entryDate,
            category: null,
            baseVersion: 1,
        });
        expect(deleted.entry).toMatchObject({ deleted: true });
        expect(
            (await store.listJournal()).find(
                (entry) => entry.entryDate === daily.entryDate && entry.category === 'work'
            )
        ).toMatchObject({ body: 'Old client daily', deleted: false, version: 2 });
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
