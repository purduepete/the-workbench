import type { JournalMutation, JournalMutationResponse, NoteCategory, ServerJournalEntry } from '../shared/contracts';
import { noteCategorySchema } from '../shared/contracts';
import { formatIdeaTimestamp } from './ideas';
import { toJournalEntry } from './journal';
import type { JournalEntry } from './journal';

export const JOURNAL_STORAGE_KEY = 'the-workbench.journal-sync';

/** A queued change. Once attempted, its payload is frozen so a retry repeats the exact same request. */
export type JournalOutboxEntry = JournalMutation & { attempted: boolean };

export interface JournalState {
    /** The last rows the server confirmed, tombstones included, with their versions. */
    server: ServerJournalEntry[];
    outbox: JournalOutboxEntry[];
}

export const emptyJournalState = (): JournalState => ({ server: [], outbox: [] });

const uuid = () => globalThis.crypto.randomUUID();

const serverVersion = (state: JournalState, entryDate: string) =>
    state.server.find((row) => row.entryDate === entryDate)?.version ?? 0;

/** The entries to show: the confirmed rows with every queued change applied on top. */
export function localEntries(state: JournalState): JournalEntry[] {
    const entries = new Map(
        state.server.filter((row) => !row.deleted).map((row) => [row.entryDate, toJournalEntry(row)])
    );
    for (const change of state.outbox) {
        if (change.kind === 'delete') entries.delete(change.entryDate);
        else
            entries.set(change.entryDate, {
                entryDate: change.entryDate,
                body: change.body,
                tags: [...change.tags],
                category: change.category === undefined ? entries.get(change.entryDate)?.category : change.category,
                updatedAt: change.updatedAt,
            });
    }
    return [...entries.values()];
}

export function queueSave(
    state: JournalState,
    entryDate: string,
    body: string,
    tags: string[],
    now = new Date(),
    category?: NoteCategory
) {
    const updatedAt = now.toISOString();
    const editedLabel = formatIdeaTimestamp(updatedAt);
    const pendingIndex = state.outbox.findLastIndex((change) => change.entryDate === entryDate);
    const pending = state.outbox[pendingIndex];
    // Unsent saves for the same day collapse into one request.
    if (pending && !pending.attempted && pending.kind === 'save') {
        const outbox = [...state.outbox];
        outbox[pendingIndex] = {
            ...pending,
            body,
            tags: [...tags],
            updatedAt,
            editedLabel,
            ...(category !== undefined ? { category } : {}),
        };
        return { ...state, outbox };
    }
    const change: JournalOutboxEntry = {
        kind: 'save',
        mutationId: uuid(),
        entryDate,
        baseVersion: serverVersion(state, entryDate),
        body,
        tags: [...tags],
        ...(category !== undefined ? { category } : {}),
        updatedAt,
        editedLabel,
        attempted: false,
    };
    return { ...state, outbox: [...state.outbox, change] };
}

export function queueDelete(state: JournalState, entryDate: string): JournalState {
    const kept = state.outbox.filter((change) => change.entryDate !== entryDate || change.attempted);
    const row = state.server.find((value) => value.entryDate === entryDate);
    const inFlight = kept.some((change) => change.entryDate === entryDate);
    // A day that never reached the server only needs its queued saves removed.
    if ((!row || row.deleted) && !inFlight) return { ...state, outbox: kept };
    const change: JournalOutboxEntry = {
        kind: 'delete',
        mutationId: uuid(),
        entryDate,
        baseVersion: Math.max(1, row?.version ?? 1),
        attempted: false,
    };
    return { ...state, outbox: [...kept, change] };
}

export function markAttempted(state: JournalState, mutationId: string): JournalState {
    return {
        ...state,
        outbox: state.outbox.map((change) =>
            change.mutationId === mutationId ? { ...change, attempted: true } : change
        ),
    };
}

/** Drops a change the server rejected as invalid; retrying it can never succeed. */
export function dropEntry(state: JournalState, mutationId: string): JournalState {
    return { ...state, outbox: state.outbox.filter((change) => change.mutationId !== mutationId) };
}

/** Unfreezes a change the server refused without writing a receipt (409), so the next save can replace it. */
export function releaseAttempt(state: JournalState, mutationId: string): JournalState {
    return {
        ...state,
        outbox: state.outbox.map((change) =>
            change.mutationId === mutationId ? { ...change, attempted: false } : change
        ),
    };
}

export function acknowledge(state: JournalState, mutationId: string, response: JournalMutationResponse): JournalState {
    const acked = state.outbox.find((change) => change.mutationId === mutationId);
    if (!acked) return state;
    const server = state.server.filter((row) => row.entryDate !== response.entryDate);
    if (response.entry) server.push(response.entry);
    // After a merge or a kept entry, later changes stay stale on purpose and merge again on the server.
    const rebase = response.outcome === 'created' || response.outcome === 'updated' || response.outcome === 'deleted';
    const outbox = state.outbox
        .filter((change) => change.mutationId !== mutationId)
        .map((change) =>
            rebase && !change.attempted && change.entryDate === acked.entryDate
                ? { ...change, baseVersion: Math.max(change.kind === 'delete' ? 1 : 0, response.resultVersion) }
                : change
        );
    return { server, outbox };
}

/** Replaces the confirmed rows after a full fetch. Queued changes stay on top. */
export function replaceServer(state: JournalState, entries: ServerJournalEntry[]): JournalState {
    return { ...state, server: entries };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

const isJournalState = (value: unknown): value is JournalState =>
    isObject(value) &&
    Array.isArray(value.server) &&
    value.server.every(
        (row) =>
            isObject(row) &&
            typeof row.entryDate === 'string' &&
            typeof row.body === 'string' &&
            isStringArray(row.tags) &&
            (row.category === undefined || noteCategorySchema.safeParse(row.category).success) &&
            typeof row.deleted === 'boolean' &&
            typeof row.version === 'number'
    ) &&
    Array.isArray(value.outbox) &&
    value.outbox.every(
        (change) =>
            isObject(change) &&
            typeof change.mutationId === 'string' &&
            typeof change.entryDate === 'string' &&
            (change.category === undefined || noteCategorySchema.safeParse(change.category).success) &&
            typeof change.attempted === 'boolean'
    );

export function readJournalState(): { state: JournalState; error: string | null } {
    try {
        const saved = window.localStorage.getItem(JOURNAL_STORAGE_KEY);
        if (saved === null) return { state: emptyJournalState(), error: null };
        const parsed: unknown = JSON.parse(saved);
        if (isJournalState(parsed)) return { state: parsed, error: null };
        return {
            state: emptyJournalState(),
            error: 'Saved notes could not be read because the stored data has an unexpected format.',
        };
    } catch {
        return {
            state: emptyJournalState(),
            error: 'Saved notes could not be read. Browser storage may be unavailable or the saved data may be damaged.',
        };
    }
}

export function writeJournalState(state: JournalState): string | null {
    try {
        window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(state));
        return null;
    } catch {
        return 'Your note could not be saved. Check browser storage and try again.';
    }
}
