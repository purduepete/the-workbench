import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { MemoryIdeasStore } from '../server/store.js';
import { taskMutationSchema, taskLimits } from '../shared/tasks.js';
import type { TaskMutation, TaskMutationResponse, ServerTask } from '../shared/tasks.js';

const day = '2026-11-02';
const timestamp = '2026-11-02T17:00:00.000Z';
const save = (
    id: string = randomUUID(),
    fields: Partial<Extract<TaskMutation, { kind: 'save' }>> = {}
): Extract<TaskMutation, { kind: 'save' }> => ({
    kind: 'save',
    mutationId: randomUUID(),
    id,
    taskDate: day,
    category: 'home',
    title: 'Task',
    body: '',
    updatedAt: timestamp,
    ...fields,
});
const action = (id: string, completed: boolean): Extract<TaskMutation, { kind: 'complete' }> => ({
    kind: 'complete',
    mutationId: randomUUID(),
    id,
    taskDate: day,
    completed,
    updatedAt: timestamp,
});
const remove = (id: string): Extract<TaskMutation, { kind: 'delete' }> => ({
    kind: 'delete',
    mutationId: randomUUID(),
    id,
    taskDate: day,
});
const reorder = (orderedIds: string[]): Extract<TaskMutation, { kind: 'reorder' }> => ({
    kind: 'reorder',
    mutationId: randomUUID(),
    taskDate: day,
    category: 'home',
    orderedIds,
});

let server: Server;
let origin: string;
let store: MemoryIdeasStore;
const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}/api/tasks/mutations`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
const send = async (body: TaskMutation): Promise<TaskMutationResponse> => {
    const response = await post(body);
    expect(response.status).toBe(200);
    return response.json();
};
const list = async (query = ''): Promise<ServerTask[]> =>
    (await (await fetch(`${origin}/api/tasks${query}`)).json()).tasks;
const homeIds = (result: TaskMutationResponse) =>
    result.tasks.filter((task) => task.category === 'home' && !task.deleted).map((task) => task.id);

beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
    origin = `http://127.0.0.1:${address.port}`;
    server.on('request', (req, res) => createApp({ store, allowedOrigins: [origin] })(req, res));
});
beforeEach(() => {
    store = new MemoryIdeasStore();
});
afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Tasks API', () => {
    it('validates strict mutations, real dates, UUIDs, text caps and explicit booleans', async () => {
        for (const invalid of [
            { ...save(), extra: true },
            { ...save(), title: '  ' },
            { ...save(), title: 'x'.repeat(taskLimits.title + 1) },
            { ...save(), body: 'x'.repeat(taskLimits.body + 1) },
            { ...save(), category: 'other' },
            { ...save(), taskDate: '2026-02-30' },
            { ...save(), id: 'nope' },
            { ...save(), updatedAt: 'yesterday' },
            { ...action(randomUUID(), true), completed: 'true' },
        ])
            expect((await post(invalid)).status).toBe(400);
        const parsed = taskMutationSchema.parse({ ...save(), title: '  Trim me  ', body: undefined });
        expect(parsed).toMatchObject({ title: 'Trim me', body: '' });
        expect((await post({ ...save(), taskDate: '2028-02-29' })).status).toBe(200);
        expect(await list()).toHaveLength(1);
    });

    it('rejects duplicate and oversized reorder lists, including case-variant UUID duplicates', () => {
        const id = randomUUID();
        expect(taskMutationSchema.safeParse(reorder([id, id])).success).toBe(false);
        expect(taskMutationSchema.safeParse(reorder([id, id.toUpperCase()])).success).toBe(false);
        expect(taskMutationSchema.safeParse(reorder(Array.from({ length: 10_001 }, () => randomUUID()))).success).toBe(
            false
        );
    });

    it('uses Origin protections and the larger task-only JSON parser', async () => {
        expect((await post(save(), { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await post(save(), { Origin: '' })).status).toBe(403);
        expect((await post(save(), { 'Content-Type': 'text/plain' })).status).toBe(403);
        expect((await post(save(), { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
        expect((await send(save(undefined, { body: '📝'.repeat(100_000) }))).tasks[0].body).toHaveLength(200_000);
        expect((await post(save(undefined, { body: 'x'.repeat(1_100_000) }))).status).toBe(413);
    });

    it('appends tasks independently per category and day, trims titles and returns both categories', async () => {
        const first = save(undefined, { title: '  First  ' });
        const second = save();
        await send(first);
        await send(second);
        const work = save(undefined, { category: 'work' });
        const result = await send(work);
        expect(result.tasks).toHaveLength(3);
        expect(result.tasks.find((task) => task.id === first.id)).toMatchObject({
            title: 'First',
            position: 0,
            completed: false,
            deleted: false,
            version: 1,
        });
        expect(result.tasks.find((task) => task.id === second.id)?.position).toBe(1);
        expect(result.tasks.find((task) => task.id === work.id)?.position).toBe(0);
        expect((await send(save(undefined, { taskDate: '2026-11-03' }))).tasks[0].position).toBe(0);
    });

    it('keeps completion independent from text saves, including older timestamps and unchecking', async () => {
        const original = save();
        await send(original);
        await send(action(original.id, true));
        const edited = await send(
            save(original.id, { title: 'Edited', body: 'Details', updatedAt: '2020-01-01T00:00:00Z' })
        );
        expect(edited.tasks[0]).toMatchObject({ completed: true, title: 'Edited', body: 'Details', position: 0 });
        expect((await send(action(original.id, false))).tasks[0]).toMatchObject({
            completed: false,
            title: 'Edited',
            body: 'Details',
            position: 0,
            version: 4,
        });
        expect((await send(action(original.id, false))).outcome).toBe('kept');
    });

    it('transfers category to the destination tail while preserving completion and immutable date', async () => {
        const a = save(),
            b = save(undefined, { category: 'work' });
        await send(a);
        await send(b);
        await send(action(a.id, true));
        const moved = await send(save(a.id, { category: 'work' }));
        expect(moved.tasks.find((task) => task.id === a.id)).toMatchObject({
            category: 'work',
            position: 1,
            completed: true,
        });
        expect((await send(save(a.id, { taskDate: '2026-11-03' }))).outcome).toBe('kept');
        expect((await send({ ...action(a.id, false), taskDate: '2026-11-03' })).outcome).toBe('kept');
        expect((await send({ ...remove(a.id), taskDate: '2026-11-03' })).outcome).toBe('kept');
        expect((await list()).find((task) => task.id === a.id)).toMatchObject({ taskDate: day, completed: true });
    });

    it('orders provided tasks first and retains concurrent additions and omitted tasks', async () => {
        const tasks = Array.from({ length: 4 }, () => save());
        await send(tasks[0]);
        await send(tasks[1]);
        const queued = reorder([tasks[1].id]);
        await Promise.all(tasks.slice(2).map(send));
        const result = await send(queued);
        expect(homeIds(result)).toEqual([tasks[1].id, tasks[0].id, tasks[2].id, tasks[3].id]);
        expect(result.tasks.map((task) => task.position)).toEqual([0, 1, 2, 3]);
        const versions = result.tasks.map((task) => task.version);
        await send(action(tasks[0].id, true));
        expect(homeIds(await send(reorder([])))).toEqual(homeIds(result));
        expect(versions).toEqual([2, 2, 1, 1]);
    });

    it('keeps the whole order unchanged for missing, moved, wrong-day or deleted reorder ids', async () => {
        const a = save(),
            b = save(),
            other = save(undefined, { taskDate: '2026-11-03' });
        await send(a);
        await send(b);
        await send(other);
        for (const invalid of [randomUUID(), other.id]) {
            expect((await send(reorder([b.id, invalid]))).outcome).toBe('kept');
            expect((await list()).filter((task) => task.taskDate === day).map((task) => task.id)).toEqual([a.id, b.id]);
        }
        await send(save(b.id, { category: 'work' }));
        expect((await send(reorder([b.id, a.id]))).outcome).toBe('kept');
        await send(remove(a.id));
        expect((await send(reorder([a.id]))).outcome).toBe('kept');
    });

    it('retains tombstones, never resurrects them and keeps missing actions', async () => {
        const original = save();
        await send(original);
        const deleted = await send(remove(original.id));
        expect(deleted).toMatchObject({ outcome: 'deleted', tasks: [{ deleted: true, version: 2 }] });
        expect((await send(save(original.id, { title: 'Old offline save' }))).outcome).toBe('kept');
        expect((await send(action(original.id, true))).outcome).toBe('kept');
        expect((await send(remove(original.id))).outcome).toBe('kept');
        expect((await send(action(randomUUID(), true))).outcome).toBe('kept');
        expect((await send(remove(randomUUID()))).outcome).toBe('kept');
        expect(await list()).toEqual([]);
        expect(await list('?includeDeleted=true')).toMatchObject([{ title: 'Task', deleted: true, version: 2 }]);
        const appended = await send(save());
        expect(appended.tasks.find((task) => !task.deleted)?.position).toBe(1);
    });

    it('replays permanent receipts with the original day and outcome and current rows', async () => {
        const original = save();
        await Promise.all([send(original), send(original)]);
        const completion = action(original.id, true);
        await send(completion);
        await send(action(original.id, false));
        expect((await send(completion)).tasks[0]).toMatchObject({ completed: false, version: 3 });
        const retried = await send({ ...original, taskDate: '2026-11-03' });
        expect(retried).toMatchObject({ outcome: 'created', taskDate: day, tasks: [{ version: 3 }] });
        const ordered = reorder([original.id]);
        await send(ordered);
        await send(save());
        expect((await send(ordered)).tasks).toHaveLength(2);
        const deleted = remove(original.id);
        await send(deleted);
        expect(await send(deleted)).toMatchObject({ outcome: 'deleted' });
    });

    it('records kept receipts even when the missing task is later created', async () => {
        const id = randomUUID(),
            completion = action(id, true);
        expect((await send(completion)).outcome).toBe('kept');
        await send(save(id));
        expect(await send(completion)).toMatchObject({ outcome: 'kept', tasks: [{ completed: false }] });
    });

    it('filters inclusive dates and category, defaults to active rows and rejects unknown query keys', async () => {
        await send(save());
        await send(save(undefined, { category: 'work' }));
        await send(save(undefined, { taskDate: '2026-11-03' }));
        expect(await list(`?from=${day}&to=${day}&category=home`)).toHaveLength(1);
        expect(await list('?category=work')).toHaveLength(1);
        for (const query of [
            '?from=2026-02-30',
            '?category=Home',
            '?includeDeleted=1',
            '?extra=true',
            '?category=home&category=work',
        ]) {
            expect((await fetch(`${origin}/api/tasks${query}`)).status).toBe(400);
        }
        const rows = await store.listTasks();
        rows[0].title = 'Changed outside store';
        expect((await store.listTasks())[0].title).toBe('Task');
    });
});
