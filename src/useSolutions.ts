import { useEffect, useState } from 'react';
import type { Solution } from '../shared/contracts';

export const SOLUTIONS_STORAGE_KEY = 'idea-notes.solutions';

const isSolutionList = (value: unknown): value is Solution[] =>
    Array.isArray(value) &&
    value.every(
        (item: unknown) =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as Solution).id === 'string' &&
            typeof (item as Solution).name === 'string'
    );

function readCached(): Solution[] {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(SOLUTIONS_STORAGE_KEY) ?? '[]');
        return isSolutionList(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Solution Directory's list, cached in this browser so offline capture can still link a solution. */
export function useSolutions(): Solution[] {
    const [solutions, setSolutions] = useState(readCached);
    useEffect(() => {
        let active = true;
        const refresh = () =>
            fetch('/api/solutions')
                .then(async (response) => {
                    if (!response.ok) return;
                    const body = (await response.json()) as { solutions?: unknown };
                    if (!active || !isSolutionList(body.solutions)) return;
                    setSolutions(body.solutions);
                    try {
                        window.localStorage.setItem(SOLUTIONS_STORAGE_KEY, JSON.stringify(body.solutions));
                    } catch {
                        // The cache is a convenience; the live list still works for this visit.
                    }
                })
                .catch(() => undefined);
        // Solution Directory is the source of truth, so new solutions appear when the tab regains focus.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        void refresh();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return solutions;
}
