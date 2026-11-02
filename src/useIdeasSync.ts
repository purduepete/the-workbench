import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutationResponse, ServerIdea } from '../shared/contracts';
import {
    acknowledge,
    dropEntry,
    localIdeas,
    markAttempted,
    queueCreate,
    queueDelete,
    queueUpdate,
    readSyncState,
    replaceServer,
    SYNC_STORAGE_KEY,
    writeSyncState,
} from './sync';
import type { SyncState } from './sync';
import type { Idea } from './types';
import { syncFetch } from './syncFetch';

export type SyncStatus = 'synced' | 'syncing' | 'waiting' | 'offline' | 'paused';

const RETRY_MS = 30_000;

async function readJson<T>(response: Response): Promise<T> {
    if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The server did not return JSON.');
    }
    return (await response.json()) as T;
}

export function useIdeasSync() {
    const [initial] = useState(readSyncState);
    const [state, setState] = useState(initial.state);
    const [notice, setNotice] = useState<string | null>(initial.error);
    const [phase, setPhase] = useState<'idle' | 'syncing' | 'offline' | 'paused'>(() =>
        navigator.onLine ? 'idle' : 'offline'
    );
    // Without a saved copy, an empty list means "not fetched yet", so the page waits for the first sync.
    const [ready, setReady] = useState(() => {
        if (initial.error) return false;
        try {
            return window.localStorage.getItem(SYNC_STORAGE_KEY) !== null || initial.state.outbox.length > 0;
        } catch {
            return false;
        }
    });
    const readyRef = useRef(ready);
    const stateRef = useRef(state);
    const running = useRef(false);
    const again = useRef(false);
    const retryNeeded = useRef(false);

    const commit = useCallback((next: SyncState): string | null => {
        stateRef.current = next;
        setState(next);
        const error = writeSyncState(next);
        if (error) setNotice(error);
        return error;
    }, []);

    const sync = useCallback(async () => {
        if (!navigator.onLine) {
            retryNeeded.current = true;
            return;
        }
        if (running.current) {
            again.current = true;
            return;
        }
        running.current = true;
        setPhase('syncing');
        try {
            do {
                again.current = false;
                while (stateRef.current.outbox.length > 0) {
                    const entry = stateRef.current.outbox[0];
                    const storageError = commit(markAttempted(stateRef.current, entry.mutationId));
                    if (storageError) throw new Error(storageError);
                    const { attempted: _attempted, ...mutation } = entry;
                    const response = await syncFetch('/api/mutations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mutation),
                    });
                    if (response.status === 400) {
                        commit(dropEntry(stateRef.current, entry.mutationId));
                        setNotice(
                            `The server rejected a change to "${entry.kind === 'delete' ? 'a note' : entry.fields.title}", so it was not saved.`
                        );
                        continue;
                    }
                    if (!response.ok) throw new Error(`Sync failed with HTTP ${response.status}.`);
                    const result = await readJson<MutationResponse>(response);
                    commit(acknowledge(stateRef.current, entry.mutationId, result));
                }
                const response = await syncFetch('/api/ideas');
                if (!response.ok) throw new Error(`Loading ideas failed with HTTP ${response.status}.`);
                const { ideas } = await readJson<{ ideas: ServerIdea[] }>(response);
                commit(replaceServer(stateRef.current, ideas));
                readyRef.current = true;
                setReady(true);
            } while (again.current || stateRef.current.outbox.length > 0);
            setPhase('idle');
            retryNeeded.current = false;
        } catch (error) {
            retryNeeded.current = true;
            setPhase(navigator.onLine ? 'paused' : 'offline');
            if (navigator.onLine)
                setNotice(error instanceof Error ? error.message : 'Sync paused. Changes stay on this device.');
        } finally {
            running.current = false;
        }
    }, [commit]);

    useEffect(() => {
        void sync();
        const retry = () => void sync();
        const offline = () => setPhase('offline');
        const onVisible = () => {
            if (document.visibilityState === 'visible') retry();
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key !== SYNC_STORAGE_KEY) return;
            const next = readSyncState();
            if (next.error) return;
            stateRef.current = next.state;
            setState(next.state);
            readyRef.current = true;
            setReady(true);
        };
        const timer = window.setInterval(() => {
            if (!readyRef.current || stateRef.current.outbox.length > 0 || retryNeeded.current) retry();
        }, RETRY_MS);
        window.addEventListener('online', retry);
        window.addEventListener('offline', offline);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', retry);
            window.removeEventListener('offline', offline);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [sync]);

    const change = useCallback(
        (next: SyncState) => {
            const error = commit(next);
            if (!error) {
                readyRef.current = true;
                setReady(true);
                void sync();
            }
            return error;
        },
        [commit, sync]
    );

    const ideas = useMemo(() => localIdeas(state), [state]);
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

    return {
        ideas,
        ready,
        status,
        waiting,
        notice,
        refreshing: phase === 'syncing',
        refresh: sync,
        clearNotice: () => setNotice(null),
        create: (idea: Idea) => change(queueCreate(stateRef.current, idea)),
        update: (idea: Idea) => change(queueUpdate(stateRef.current, idea)),
        remove: (id: string) => change(queueDelete(stateRef.current, id)),
    };
}
