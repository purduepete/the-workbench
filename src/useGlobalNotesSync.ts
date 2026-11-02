import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalNoteMutationResponse, ServerGlobalNote } from '../shared/contracts';
import {
    acknowledgeGlobal,
    dropGlobalEntry,
    GLOBAL_NOTES_STORAGE_KEY,
    localGlobalNotes,
    markGlobalAttempted,
    queueGlobalDelete,
    queueGlobalSave,
    readGlobalNotesState,
    releaseGlobalAttempt,
    replaceGlobalServer,
    writeGlobalNotesState,
} from './globalNotesSync';
import type { GlobalNotesState } from './globalNotesSync';
import type { SyncStatus } from './useIdeasSync';

const RETRY_MS = 30_000;

async function readJson<T>(response: Response): Promise<T> {
    if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The server did not return JSON.');
    }
    return (await response.json()) as T;
}

class SyncPaused extends Error {}

export function useGlobalNotesSync() {
    const [initial] = useState(readGlobalNotesState);
    const [state, setState] = useState(initial.state);
    const [notice, setNotice] = useState<string | null>(initial.error);
    const [phase, setPhase] = useState<'idle' | 'syncing' | 'offline' | 'paused'>('idle');
    const [ready, setReady] = useState(() => {
        if (initial.error) return false;
        try {
            return window.localStorage.getItem(GLOBAL_NOTES_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    });
    const readyRef = useRef(ready);
    const stateRef = useRef(state);
    const running = useRef(false);
    const again = useRef(false);

    const commit = useCallback((next: GlobalNotesState): string | null => {
        stateRef.current = next;
        setState(next);
        const error = writeGlobalNotesState(next);
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
                while (stateRef.current.outbox.length > 0) {
                    const change = stateRef.current.outbox[0];
                    commit(markGlobalAttempted(stateRef.current, change.mutationId));
                    const { attempted: _attempted, ...mutation } = change;
                    const response = await fetch('/api/global-notes/mutations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mutation),
                    });
                    if (response.status === 400) {
                        commit(dropGlobalEntry(stateRef.current, change.mutationId));
                        setNotice('The server rejected a global-note change, so it was not saved.');
                        continue;
                    }
                    if (response.status === 409) {
                        commit(releaseGlobalAttempt(stateRef.current, change.mutationId));
                        setNotice(
                            'Combining this global-note edit would exceed its size limit. Shorten it and save again.'
                        );
                        throw new SyncPaused();
                    }
                    if (!response.ok) throw new Error(`Sync failed with HTTP ${response.status}.`);
                    const result = await readJson<GlobalNoteMutationResponse>(response);
                    commit(acknowledgeGlobal(stateRef.current, change.mutationId, result));
                    if (result.outcome === 'kept' && change.kind === 'delete')
                        setNotice('This global note changed on another device, so it was kept.');
                }
                const response = await fetch('/api/global-notes?includeDeleted=true');
                if (!response.ok) throw new Error(`Loading global notes failed with HTTP ${response.status}.`);
                const { notes } = await readJson<{ notes: ServerGlobalNote[] }>(response);
                commit(replaceGlobalServer(stateRef.current, notes));
                readyRef.current = true;
                setReady(true);
            } while (again.current || stateRef.current.outbox.length > 0);
            setPhase('idle');
        } catch (error) {
            setPhase(error instanceof SyncPaused ? 'paused' : navigator.onLine ? 'paused' : 'offline');
        } finally {
            running.current = false;
        }
    }, [commit]);

    useEffect(() => {
        void sync();
        const retry = () => void sync();
        const onVisible = () => {
            if (document.visibilityState === 'visible') retry();
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key !== GLOBAL_NOTES_STORAGE_KEY) return;
            const next = readGlobalNotesState();
            if (next.error) return;
            stateRef.current = next.state;
            setState(next.state);
            readyRef.current = true;
            setReady(true);
        };
        const timer = window.setInterval(() => {
            if (!readyRef.current || stateRef.current.outbox.length > 0) retry();
        }, RETRY_MS);
        window.addEventListener('online', retry);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', retry);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [sync]);

    const change = useCallback(
        (next: GlobalNotesState) => {
            const error = commit(next);
            if (!error) void sync();
            return error;
        },
        [commit, sync]
    );

    const notes = useMemo(() => localGlobalNotes(state), [state]);
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
        notes,
        ready,
        status,
        waiting,
        notice,
        refreshing: phase === 'syncing',
        refresh: sync,
        clearNotice: () => setNotice(null),
        save: (value: { id: string; title: string; body: string; tags: string[] }) =>
            change(queueGlobalSave(stateRef.current, value)),
        remove: (id: string) => change(queueGlobalDelete(stateRef.current, id)),
    };
}
