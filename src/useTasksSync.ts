import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServerTask, TaskCategory, TaskMutation } from '../shared/tasks';
import {
    acknowledgeTask,
    isServerTask,
    isTaskMutationResponse,
    localTasks,
    markTaskAttempted,
    queueTaskMutation,
    readTasksState,
    TASKS_STORAGE_KEY,
    writeTasksState,
} from './tasksSync';
import type { TasksState } from './tasksSync';
import type { SyncStatus } from './useIdeasSync';

export function useTasksSync() {
    const [initial] = useState(readTasksState);
    const [state, setState] = useState(initial.state);
    const [notice, setNotice] = useState(initial.error);
    const [phase, setPhase] = useState<'idle' | 'syncing' | 'offline' | 'paused'>('idle');
    const [ready, setReady] = useState(() => {
        try {
            return !initial.error && window.localStorage.getItem(TASKS_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    });
    const readyRef = useRef(ready);
    const stateRef = useRef(state);
    const running = useRef(false);
    const again = useRef(false);
    const commit = useCallback((next: TasksState) => {
        stateRef.current = next;
        setState(next);
        const error = writeTasksState(next);
        if (error) setNotice(error);
        return error;
    }, []);

    const sync = useCallback(async () => {
        if (running.current) {
            again.current = true;
            return;
        }
        running.current = true;
        setPhase('syncing');
        try {
            do {
                again.current = false;
                while (stateRef.current.outbox.length) {
                    const change = stateRef.current.outbox[0];
                    commit(markTaskAttempted(stateRef.current, change.mutationId));
                    const { attempted: _attempted, ...mutation } = change;
                    const response = await fetch('/api/tasks/mutations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mutation),
                    });
                    if (!response.ok)
                        throw new Error(
                            `Task change could not be synced (HTTP ${response.status}). Your change remains on this device.`
                        );
                    if (!response.headers.get('content-type')?.includes('application/json'))
                        throw new Error('Task sync did not return JSON.');
                    const result: unknown = await response.json();
                    if (!isTaskMutationResponse(result)) throw new Error('Task sync returned an invalid task list.');
                    commit(acknowledgeTask(stateRef.current, change.mutationId, result));
                    if (result.outcome === 'kept')
                        setNotice(
                            'This task was moved or removed on another device. The list was refreshed and your action was not applied.'
                        );
                }
                const response = await fetch('/api/tasks?includeDeleted=true');
                if (!response.ok) throw new Error(`Tasks could not be loaded (HTTP ${response.status}).`);
                if (!response.headers.get('content-type')?.includes('application/json'))
                    throw new Error('The server did not return tasks as JSON.');
                const result: unknown = await response.json();
                if (
                    typeof result !== 'object' ||
                    result === null ||
                    !('tasks' in result) ||
                    !Array.isArray(result.tasks) ||
                    !result.tasks.every(isServerTask)
                )
                    throw new Error('The server returned an invalid task list.');
                commit({ ...stateRef.current, server: result.tasks });
                readyRef.current = true;
                setReady(true);
            } while (again.current || stateRef.current.outbox.length);
            setPhase('idle');
        } catch (error) {
            setPhase(navigator.onLine ? 'paused' : 'offline');
            setNotice(error instanceof Error ? error.message : 'Task sync failed. Your changes remain on this device.');
        } finally {
            running.current = false;
        }
    }, [commit]);

    useEffect(() => {
        void sync();
        const retry = () => void sync();
        const visible = () => {
            if (document.visibilityState === 'visible') retry();
        };
        const storage = (event: StorageEvent) => {
            if (event.key !== TASKS_STORAGE_KEY) return;
            const next = readTasksState();
            if (next.error) {
                setNotice(next.error);
                return;
            }
            stateRef.current = next.state;
            setState(next.state);
            readyRef.current = true;
            setReady(true);
            retry();
        };
        const timer = window.setInterval(() => {
            if (!readyRef.current || stateRef.current.outbox.length) retry();
        }, 30_000);
        window.addEventListener('online', retry);
        window.addEventListener('storage', storage);
        document.addEventListener('visibilitychange', visible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', retry);
            window.removeEventListener('storage', storage);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [sync]);

    const change = useCallback(
        (mutation: TaskMutation) => {
            const error = commit(queueTaskMutation(stateRef.current, mutation));
            if (!error) void sync();
            return error;
        },
        [commit, sync]
    );
    const waiting = state.outbox.length;
    const status: SyncStatus =
        phase === 'offline'
            ? 'offline'
            : phase === 'paused'
              ? 'paused'
              : phase === 'syncing' && waiting > 0
                ? 'syncing'
                : waiting > 0
                  ? 'waiting'
                  : 'synced';
    const tasks = useMemo(() => localTasks(state), [state]);
    return {
        tasks,
        ready,
        waiting,
        status,
        notice,
        refreshing: phase === 'syncing',
        refresh: sync,
        clearNotice: () => setNotice(null),
        save: (value: { id: string; taskDate: string; category: TaskCategory; title: string; body: string }) =>
            change({ kind: 'save', mutationId: crypto.randomUUID(), ...value, updatedAt: new Date().toISOString() }),
        complete: (task: ServerTask, completed: boolean) =>
            change({
                kind: 'complete',
                mutationId: crypto.randomUUID(),
                id: task.id,
                taskDate: task.taskDate,
                completed,
                updatedAt: new Date().toISOString(),
            }),
        remove: (task: ServerTask) =>
            change({ kind: 'delete', mutationId: crypto.randomUUID(), id: task.id, taskDate: task.taskDate }),
        reorder: (taskDate: string, category: TaskCategory, orderedIds: string[]) =>
            change({ kind: 'reorder', mutationId: crypto.randomUUID(), taskDate, category, orderedIds }),
    };
}
