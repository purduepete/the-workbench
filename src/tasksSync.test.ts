import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerTask, TaskMutation } from '../shared/tasks';
import {
    acknowledgeTask,
    emptyTasksState,
    isTaskMutationResponse,
    localTasks,
    markTaskAttempted,
    queueTaskMutation,
    readTaskCategory,
    readTasksState,
    TASKS_STORAGE_KEY,
    writeTaskCategory,
    writeTasksState,
} from './tasksSync';

const date = '2026-10-29';
const timestamp = '2026-10-29T18:00:00.000Z';
const row = (position = 0, extra: Partial<ServerTask> = {}): ServerTask => ({
    id: crypto.randomUUID(),
    taskDate: date,
    category: 'home',
    title: 'Task',
    body: '',
    completed: false,
    position,
    deleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    ...extra,
});
const save = (
    task: ServerTask,
    extra: Partial<Extract<TaskMutation, { kind: 'save' }>> = {}
): Extract<TaskMutation, { kind: 'save' }> => ({
    kind: 'save',
    mutationId: crypto.randomUUID(),
    id: task.id,
    taskDate: task.taskDate,
    category: task.category,
    title: task.title,
    body: task.body,
    updatedAt: timestamp,
    ...extra,
});
const complete = (task: ServerTask, completed: boolean): TaskMutation => ({
    kind: 'complete',
    mutationId: crypto.randomUUID(),
    id: task.id,
    taskDate: date,
    completed,
    updatedAt: timestamp,
});
const reorder = (ids: string[], category: 'home' | 'work' = 'home'): TaskMutation => ({
    kind: 'reorder',
    mutationId: crypto.randomUUID(),
    taskDate: date,
    category,
    orderedIds: ids,
});
afterEach(() => vi.unstubAllGlobals());

describe('task offline projection', () => {
    it('preserves completion while editing text, including pending creates', () => {
        const task = row();
        let state = queueTaskMutation(emptyTasksState(), save(task));
        state = queueTaskMutation(state, complete(task, true));
        state = queueTaskMutation(state, save(task, { title: 'Edited' }));
        expect(localTasks(state)[0]).toMatchObject({ completed: true, title: 'Edited' });
    });

    it('reorders only the specified day and category and appends concurrent additions', () => {
        const first = row(0),
            second = row(1),
            added = row(2);
        const work = row(0, { category: 'work' }),
            yesterday = row(0, { taskDate: '2026-10-28' });
        const state = queueTaskMutation(
            { server: [first, second, added, work, yesterday], outbox: [] },
            reorder([second.id, first.id])
        );
        expect(
            localTasks(state)
                .filter((task) => task.taskDate === date && task.category === 'home')
                .map((task) => task.id)
        ).toEqual([second.id, first.id, added.id]);
        expect(localTasks(state).find((task) => task.id === work.id)?.position).toBe(0);
        expect(localTasks(state).find((task) => task.id === yesterday.id)?.position).toBe(0);
    });

    it('appends category moves and does not undo completion or the other section order', () => {
        const home = row(0, { completed: true }),
            work = row(0, { category: 'work' });
        const state = queueTaskMutation({ server: [home, work], outbox: [] }, save(home, { category: 'work' }));
        expect(localTasks(state).map((task) => task.id)).toEqual([work.id, home.id]);
        expect(localTasks(state)[1]).toMatchObject({ completed: true, category: 'work', position: 1 });
    });

    it('keeps tombstones deleted and ignores a reorder containing moved IDs', () => {
        const deleted = row(0, { deleted: true }),
            home = row(1),
            work = row(0, { category: 'work' });
        let state = queueTaskMutation({ server: [deleted, home, work], outbox: [] }, save(deleted));
        state = queueTaskMutation(state, reorder([work.id, home.id]));
        expect(localTasks(state).map((task) => task.id)).not.toContain(deleted.id);
        expect(localTasks(state).find((task) => task.id === home.id)?.position).toBe(1);
    });

    it('coalesces only adjacent unattempted changes and freezes retried payloads', () => {
        const task = row(),
            original = save(task);
        let state = queueTaskMutation(emptyTasksState(), original);
        state = queueTaskMutation(state, save(task, { title: 'Second' }));
        expect(state.outbox).toHaveLength(1);
        expect(state.outbox[0]).toMatchObject({ mutationId: original.mutationId, title: 'Second' });
        state = markTaskAttempted(state, original.mutationId);
        state = queueTaskMutation(state, save(task, { title: 'Third' }));
        state = queueTaskMutation(state, complete(task, true));
        state = queueTaskMutation(state, save(task, { title: 'Fourth' }));
        expect(state.outbox).toHaveLength(4);
        expect(state.outbox[0]).toMatchObject({ attempted: true, title: 'Second' });
    });

    it('acknowledges the full day and projects pending fields over confirmed results', () => {
        const task = row(),
            work = row(0, { category: 'work' }),
            otherDay = row(0, { taskDate: '2026-10-28' });
        const sent = save(task),
            pending = complete(task, true);
        let state = queueTaskMutation({ server: [otherDay], outbox: [] }, sent);
        state = queueTaskMutation(state, pending);
        state = acknowledgeTask(state, sent.mutationId, { outcome: 'created', taskDate: date, tasks: [task, work] });
        expect(state.outbox).toHaveLength(1);
        expect(localTasks(state)).toHaveLength(3);
        expect(localTasks(state).find((value) => value.id === task.id)?.completed).toBe(true);
    });

    it('validates mutation outcomes and same-day response rows', () => {
        expect(isTaskMutationResponse({ outcome: 'created', taskDate: date, tasks: [row()] })).toBe(true);
        expect(isTaskMutationResponse({ outcome: 'unknown', taskDate: date, tasks: [] })).toBe(false);
        expect(
            isTaskMutationResponse({ outcome: 'created', taskDate: date, tasks: [row(0, { taskDate: '2026-10-28' })] })
        ).toBe(false);
        expect(isTaskMutationResponse(null)).toBe(false);
    });
});

describe('task browser storage', () => {
    it('round-trips pending changes and the chosen section', () => {
        const values = new Map<string, string>();
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
            },
        });
        const mutation = save(row());
        const state = markTaskAttempted(queueTaskMutation(emptyTasksState(), mutation), mutation.mutationId);
        expect(writeTasksState(state)).toBeNull();
        expect(readTasksState()).toEqual({ state, error: null });
        expect(writeTaskCategory('work')).toBeNull();
        expect(readTaskCategory()).toEqual({ category: 'work', error: null });
        values.set(TASKS_STORAGE_KEY, '{"server":[],"outbox":[{"attempted":false,"kind":"bad"}]}');
        expect(readTasksState().error).toBeTruthy();
    });

    it('reports storage failures', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: () => {
                    throw new Error('blocked');
                },
                setItem: () => {
                    throw new Error('full');
                },
            },
        });
        expect(readTasksState().error).toBeTruthy();
        expect(writeTasksState(emptyTasksState())).toContain('could not be saved');
        expect(readTaskCategory().error).toBeTruthy();
        expect(writeTaskCategory('home')).toContain('could not be remembered');
    });
});
