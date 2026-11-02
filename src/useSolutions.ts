import { useCallback, useEffect, useRef, useState } from 'react';
import type { Solution } from '../shared/contracts';
import { syncFetch } from './syncFetch';

export const SOLUTIONS_STORAGE_KEY = 'the-workbench.solutions';

const isSolutionList = (value: unknown): value is Solution[] =>
    Array.isArray(value) &&
    value.every(
        (item: unknown) =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as Solution).id === 'string' &&
            typeof (item as Solution).name === 'string' &&
            ['boolean', 'undefined'].includes(typeof (item as Solution).disabled)
    );

function readCached(): Solution[] {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(SOLUTIONS_STORAGE_KEY) ?? '[]');
        return isSolutionList(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeCached(solutions: Solution[]) {
    try {
        window.localStorage.setItem(SOLUTIONS_STORAGE_KEY, JSON.stringify(solutions));
    } catch {
        // The cache is a convenience; the live list still works for this visit.
    }
}

export interface SolutionsState {
    solutions: Solution[];
    ready: boolean;
    /** Saves the setting for every device. Returns an error message, or null when saved. */
    setDisabled: (id: string, disabled: boolean) => Promise<string | null>;
    refresh: () => Promise<void>;
}

/** Solution Directory's list, cached in this browser so offline capture can still link a solution. */
export function useSolutions(): SolutionsState {
    const [solutions, setSolutions] = useState(readCached);
    const [ready, setReady] = useState(() => {
        try {
            const cached = window.localStorage.getItem(SOLUTIONS_STORAGE_KEY);
            return cached !== null && isSolutionList(JSON.parse(cached));
        } catch {
            return false;
        }
    });
    const active = useRef(true);
    const refresh = useCallback(
        () =>
            syncFetch('/api/solutions')
                .then(async (response) => {
                    if (!response.ok) return;
                    const body = (await response.json()) as { solutions?: unknown };
                    if (!active.current || !isSolutionList(body.solutions)) return;
                    setSolutions(body.solutions);
                    writeCached(body.solutions);
                })
                .catch(() => undefined)
                .finally(() => {
                    if (active.current) setReady(true);
                }),
        []
    );
    useEffect(() => {
        active.current = true;
        // Solution Directory is the source of truth, so new solutions appear when the tab regains focus.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        void refresh();
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active.current = false;
            window.removeEventListener('online', refresh);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [refresh]);

    const setDisabled = useCallback(async (id: string, disabled: boolean) => {
        const apply = (value: boolean) =>
            setSolutions((current) => {
                const next = current.map((item) => (item.id === id ? { ...item, disabled: value } : item));
                writeCached(next);
                return next;
            });
        apply(disabled);
        try {
            const response = await syncFetch('/api/solution-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, disabled }),
            });
            if (response.ok) return null;
        } catch {
            // Reported below.
        }
        apply(!disabled);
        return 'The solution setting could not be saved. Check the connection and try again.';
    }, []);

    return { solutions, ready, setDisabled, refresh };
}
