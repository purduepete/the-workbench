import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JournalMutationResponse, ServerJournalEntry } from '../shared/contracts';
import {
    acknowledge,
    dropEntry,
    JOURNAL_STORAGE_KEY,
    localEntries,
    markAttempted,
    queueDelete,
    queueSave,
    readJournalState,
    releaseAttempt,
    replaceServer,
    writeJournalState,
} from './journalSync';
import type { JournalState } from './journalSync';
import { formatEntryDate } from './journal';
import type { SyncStatus } from './useIdeasSync';

const RETRY_MS = 30_000;

async function readJson<T>(response: Response): Promise<T> {
    if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The server did not return JSON.');
    }
    return (await response.json()) as T;
}

class SyncPaused extends Error {}

export function useJournalSync() {
    const [initial] = useState(readJournalState);
    const [state, setState] = useState(initial.state);
    const [notice, setNotice] = useState<string | null>(initial.error);
    const [phase, setPhase] = useState<'idle' | 'syncing' | 'offline' | 'paused'>('idle');
    // Without a saved copy, an empty list means "not fetched yet", so the page waits for the first sync.
    const [ready, setReady] = useState(() => {
        if (initial.error) return false;
        try {
            return window.localStorage.getItem(JOURNAL_STORAGE_KEY) !== null;
        } catch {
            return false;
        }
    });
    const readyRef = useRef(ready);
    const stateRef = useRef(state);
    const running = useRef(false);
    const again = useRef(false);

    const commit = useCallback((next: JournalState): string | null => {
        stateRef.current = next;
        setState(next);
        const error = writeJournalState(next);
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
                    commit(markAttempted(stateRef.current, change.mutationId));
                    const { attempted: _attempted, ...mutation } = change;
                    const response = await fetch('/api/journal/mutations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(mutation),
                    });
                    if (response.status === 400) {
                        commit(dropEntry(stateRef.current, change.mutationId));
                        setNotice(
                            `The server rejected a change to the entry for ${formatEntryDate(change.entryDate)}, so it was not saved.`
                        );
                        continue;
                    }
                    if (response.status === 409) {
                        // Nothing was written, so the change is unfrozen and stays queued. A shorter save replaces it.
                        commit(releaseAttempt(stateRef.current, change.mutationId));
                        setNotice(
                            `The entry for ${formatEntryDate(change.entryDate)} was also edited on another device, and combining both versions would pass the length limit. Your change is kept on this device. Shorten the entry, then save again.`
                        );
                        throw new SyncPaused();
                    }
                    if (!response.ok) throw new Error(`Sync failed with HTTP ${response.status}.`);
                    const result = await readJson<JournalMutationResponse>(response);
                    commit(acknowledge(stateRef.current, change.mutationId, result));
                    if (result.outcome === 'kept' && change.kind === 'delete') {
                        setNotice(
                            `The entry for ${formatEntryDate(change.entryDate)} changed on another device, so it was kept.`
                        );
                    }
                }
                const response = await fetch('/api/journal?includeDeleted=true');
                if (!response.ok) throw new Error(`Loading notes failed with HTTP ${response.status}.`);
                const { entries } = await readJson<{ entries: ServerJournalEntry[] }>(response);
                commit(replaceServer(stateRef.current, entries));
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
            if (event.key !== JOURNAL_STORAGE_KEY) return;
            const next = readJournalState();
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
        (next: JournalState) => {
            const error = commit(next);
            if (!error) void sync();
            return error;
        },
        [commit, sync]
    );

    const entries = useMemo(() => localEntries(state), [state]);
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
        entries,
        ready,
        status,
        waiting,
        notice,
        refreshing: phase === 'syncing',
        refresh: sync,
        clearNotice: () => setNotice(null),
        save: (entryDate: string, body: string, tags: string[]) =>
            change(queueSave(stateRef.current, entryDate, body, tags)),
        remove: (entryDate: string) => change(queueDelete(stateRef.current, entryDate)),
    };
}
