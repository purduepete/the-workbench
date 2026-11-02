import { taskMutationSchema } from '../shared/tasks';
import type { ServerTask, TaskCategory, TaskMutation, TaskMutationResponse } from '../shared/tasks';

export const TASKS_STORAGE_KEY = 'the-workbench.tasks-sync';
export type TaskOutboxEntry = TaskMutation & { attempted: boolean };
export interface TasksState {
    server: ServerTask[];
    outbox: TaskOutboxEntry[];
}
export const emptyTasksState = (): TasksState => ({ server: [], outbox: [] });
export const compareTasks = (a: ServerTask, b: ServerTask) =>
    b.taskDate.localeCompare(a.taskDate) ||
    a.category.localeCompare(b.category) ||
    a.position - b.position ||
    a.id.localeCompare(b.id);

const nextPosition = (tasks: Iterable<ServerTask>, date: string, category: TaskCategory, id: string) =>
    Math.max(
        -1,
        ...[...tasks]
            .filter((task) => !task.deleted && task.taskDate === date && task.category === category && task.id !== id)
            .map((task) => task.position)
    ) + 1;

export function localTasks(state: TasksState): ServerTask[] {
    const tasks = new Map(state.server.map((task) => [task.id, { ...task }]));
    for (const change of state.outbox) {
        if (change.kind === 'reorder') {
            const ordered = change.orderedIds.map((id) => tasks.get(id));
            if (
                ordered.some(
                    (task) =>
                        !task || task.deleted || task.taskDate !== change.taskDate || task.category !== change.category
                )
            )
                continue;
            const remaining = [...tasks.values()]
                .filter(
                    (task) =>
                        !task.deleted &&
                        task.taskDate === change.taskDate &&
                        task.category === change.category &&
                        !change.orderedIds.includes(task.id)
                )
                .sort(compareTasks);
            const ids = [...change.orderedIds, ...remaining.map((task) => task.id)];
            ids.forEach((id, position) => {
                const task = tasks.get(id);
                if (task) tasks.set(id, { ...task, position });
            });
            continue;
        }
        const current = tasks.get(change.id);
        if (current && (current.deleted || current.taskDate !== change.taskDate)) continue;
        if (change.kind === 'save') {
            tasks.set(change.id, {
                id: change.id,
                taskDate: change.taskDate,
                category: change.category,
                title: change.title,
                body: change.body,
                completed: current?.completed ?? false,
                position:
                    current?.category === change.category
                        ? current.position
                        : nextPosition(tasks.values(), change.taskDate, change.category, change.id),
                deleted: false,
                createdAt: current?.createdAt ?? change.updatedAt,
                updatedAt: change.updatedAt,
                version: current?.version ?? 0,
            });
        } else if (current && change.kind === 'complete') {
            tasks.set(change.id, { ...current, completed: change.completed, updatedAt: change.updatedAt });
        } else if (current && change.kind === 'delete') {
            tasks.set(change.id, { ...current, deleted: true });
        }
    }
    return [...tasks.values()].filter((task) => !task.deleted).sort(compareTasks);
}

const sameTarget = (a: TaskMutation, b: TaskMutation) =>
    a.kind === b.kind &&
    a.taskDate === b.taskDate &&
    (a.kind === 'reorder' && b.kind === 'reorder'
        ? a.category === b.category
        : 'id' in a && 'id' in b && a.id === b.id);

export function queueTaskMutation(state: TasksState, mutation: TaskMutation): TasksState {
    const last = state.outbox.at(-1);
    if (last && !last.attempted && sameTarget(last, mutation)) {
        return {
            ...state,
            outbox: [...state.outbox.slice(0, -1), { ...mutation, mutationId: last.mutationId, attempted: false }],
        };
    }
    return { ...state, outbox: [...state.outbox, { ...mutation, attempted: false }] };
}

export function markTaskAttempted(state: TasksState, mutationId: string): TasksState {
    return {
        ...state,
        outbox: state.outbox.map((entry) => (entry.mutationId === mutationId ? { ...entry, attempted: true } : entry)),
    };
}

export function acknowledgeTask(state: TasksState, mutationId: string, response: TaskMutationResponse): TasksState {
    return {
        server: [...state.server.filter((task) => task.taskDate !== response.taskDate), ...response.tasks],
        outbox: state.outbox.filter((entry) => entry.mutationId !== mutationId),
    };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export const isServerTask = (value: unknown): value is ServerTask =>
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.taskDate === 'string' &&
    (value.category === 'home' || value.category === 'work') &&
    typeof value.title === 'string' &&
    typeof value.body === 'string' &&
    typeof value.completed === 'boolean' &&
    typeof value.deleted === 'boolean' &&
    typeof value.position === 'number' &&
    Number.isInteger(value.position) &&
    value.position >= 0 &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version >= 0;

export const isTaskMutationResponse = (value: unknown): value is TaskMutationResponse =>
    isObject(value) &&
    ['created', 'updated', 'completed', 'deleted', 'reordered', 'kept'].includes(String(value.outcome)) &&
    typeof value.taskDate === 'string' &&
    Array.isArray(value.tasks) &&
    value.tasks.every((task: unknown) => isServerTask(task) && task.taskDate === value.taskDate);

export function readTasksState(): { state: TasksState; error: string | null } {
    try {
        const saved = window.localStorage.getItem(TASKS_STORAGE_KEY);
        if (saved === null) return { state: emptyTasksState(), error: null };
        const value: unknown = JSON.parse(saved);
        if (
            !isObject(value) ||
            !Array.isArray(value.server) ||
            !value.server.every(isServerTask) ||
            !Array.isArray(value.outbox)
        )
            return { state: emptyTasksState(), error: 'Saved tasks have an unexpected format.' };
        const outbox: TaskOutboxEntry[] = [];
        for (const entry of value.outbox) {
            if (!isObject(entry) || typeof entry.attempted !== 'boolean')
                return { state: emptyTasksState(), error: 'Saved task changes have an unexpected format.' };
            const { attempted, ...payload } = entry;
            const parsed = taskMutationSchema.safeParse(payload);
            if (!parsed.success)
                return { state: emptyTasksState(), error: 'Saved task changes have an unexpected format.' };
            outbox.push({ ...parsed.data, attempted });
        }
        return { state: { server: value.server, outbox }, error: null };
    } catch {
        return { state: emptyTasksState(), error: 'Saved tasks could not be read from browser storage.' };
    }
}

export function writeTasksState(state: TasksState): string | null {
    try {
        window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(state));
        return null;
    } catch {
        return 'Your task change could not be saved. Check browser storage and try again.';
    }
}

const CATEGORY_KEY = 'the-workbench.task-category';
export function readTaskCategory(): { category: TaskCategory; error: string | null } {
    try {
        const value = window.localStorage.getItem(CATEGORY_KEY);
        if (value === null || value === 'home' || value === 'work') return { category: value ?? 'home', error: null };
        return { category: 'home', error: 'The saved task section is invalid. Home is selected.' };
    } catch {
        return { category: 'home', error: 'The task section could not be read from browser storage.' };
    }
}
export function writeTaskCategory(category: TaskCategory): string | null {
    try {
        window.localStorage.setItem(CATEGORY_KEY, category);
        return null;
    } catch {
        return 'The task section could not be remembered in browser storage.';
    }
}
