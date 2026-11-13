import type { JournalMutation, JournalMutationResponse, NoteCategory, ServerJournalEntry } from '../shared/contracts';
import { noteCategorySchema } from '../shared/contracts';
import { resolveJournalCategory } from '../shared/journal';
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

export interface JournalNoteInput {
    id: string;
    entryDate: string;
    title: string;
    body: string;
    tags: string[];
    category: NoteCategory;
}

export const emptyJournalState = (): JournalState => ({ server: [], outbox: [] });

const uuid = () => globalThis.crypto.randomUUID();

/**
 * The note a queued change belongs to. Changes queued before multiple daily notes have no id; they belong to the one
 * live note in their day and section, the same rule the server applies.
 */
function changeId(state: JournalState, change: JournalOutboxEntry): string {
    if (change.id) return change.id;
    const sameDay = state.server.filter((row) => row.entryDate === change.entryDate);
    let category: NoteCategory;
    try {
        category = resolveJournalCategory(change.category, sameDay);
    } catch {
        return `legacy:${change.entryDate}`;
    }
    const live = sameDay.filter((row) => !row.deleted && (row.category ?? null) === category);
    return live.length === 1 ? live[0].id : `legacy:${change.entryDate}:${category ?? 'unclassified'}`;
}

const serverRow = (state: JournalState, id: string) => state.server.find((row) => row.id === id);

/** The notes to show: the confirmed rows with every queued change applied on top. */
export function localEntries(state: JournalState): JournalEntry[] {
    const entries = new Map(state.server.filter((row) => !row.deleted).map((row) => [row.id, toJournalEntry(row)]));
    for (const change of state.outbox) {
        const id = changeId(state, change);
        if (change.kind === 'delete') {
            entries.delete(id);
            continue;
        }
        const previous = entries.get(id) ?? (serverRow(state, id) ? toJournalEntry(serverRow(state, id)!) : null);
        entries.set(id, {
            id,
            entryDate: previous?.entryDate ?? change.entryDate,
            title: change.title ?? previous?.title ?? '',
            body: change.body,
            tags: [...change.tags],
            category: change.category === undefined ? previous?.category : change.category,
            createdAt: previous && !serverRow(state, id)?.deleted ? previous.createdAt : change.updatedAt,
            updatedAt: change.updatedAt,
        });
    }
    return [...entries.values()];
}

export function queueSave(state: JournalState, note: JournalNoteInput, now = new Date()): JournalState {
    const updatedAt = now.toISOString();
    const editedLabel = formatIdeaTimestamp(updatedAt);
    const pendingIndex = state.outbox.findLastIndex((change) => changeId(state, change) === note.id);
    const pending = state.outbox[pendingIndex];
    // Unsent saves for the same note collapse into one request.
    if (pending && !pending.attempted && pending.kind === 'save') {
        const outbox = [...state.outbox];
        outbox[pendingIndex] = {
            ...pending,
            id: note.id,
            title: note.title,
            body: note.body,
            tags: [...note.tags],
            category: note.category,
            updatedAt,
            editedLabel,
        };
        return { ...state, outbox };
    }
    const change: JournalOutboxEntry = {
        kind: 'save',
        mutationId: uuid(),
        id: note.id,
        entryDate: serverRow(state, note.id)?.entryDate ?? note.entryDate,
        baseVersion: serverRow(state, note.id)?.version ?? 0,
        title: note.title,
        body: note.body,
        tags: [...note.tags],
        category: note.category,
        updatedAt,
        editedLabel,
        attempted: false,
    };
    return { ...state, outbox: [...state.outbox, change] };
}

export function queueDelete(state: JournalState, id: string, entryDate: string): JournalState {
    const matches = (change: JournalOutboxEntry) => changeId(state, change) === id;
    const kept = state.outbox.filter((change) => !matches(change) || change.attempted);
    const row = serverRow(state, id);
    const inFlight = kept.some(matches);
    // A note that never reached the server only needs its queued saves removed.
    if ((!row || row.deleted) && !inFlight) return { ...state, outbox: kept };
    const change: JournalOutboxEntry = {
        kind: 'delete',
        mutationId: uuid(),
        id,
        entryDate: row?.entryDate ?? entryDate,
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
    const ackedKey = changeId(state, acked);
    const server = state.server.filter((row) => row.id !== response.id);
    if (response.entry) server.push(response.entry);
    // After a merge or a kept entry, later changes stay stale on purpose and merge again on the server.
    const rebase = response.outcome === 'created' || response.outcome === 'updated' || response.outcome === 'deleted';
    const outbox = state.outbox
        .filter((change) => change.mutationId !== mutationId)
        .map((change) => {
            const key = changeId(state, change);
            if (key !== response.id && key !== ackedKey) return change;
            // A queued change from before note ids takes the id the server chose, so it keeps following the note.
            const adopted = change.attempted || change.id ? change : { ...change, id: response.id };
            return rebase && !adopted.attempted
                ? {
                      ...adopted,
                      baseVersion: Math.max(adopted.kind === 'delete' ? 1 : 0, response.resultVersion),
                  }
                : adopted;
        });
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

export function readJournalState(): { state: JournalState; error: string | null; refetch?: boolean } {
    try {
        const saved = window.localStorage.getItem(JOURNAL_STORAGE_KEY);
        if (saved === null) return { state: emptyJournalState(), error: null };
        const parsed: unknown = JSON.parse(saved);
        if (isJournalState(parsed)) {
            // Rows saved before notes had ids are dropped and fetched again; queued changes stay.
            const current = parsed.server.every((row) => typeof row.id === 'string' && typeof row.title === 'string');
            if (current) return { state: parsed, error: null };
            return { state: { server: [], outbox: parsed.outbox }, error: null, refetch: true };
        }
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
