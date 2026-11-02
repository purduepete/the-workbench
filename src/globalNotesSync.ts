import type {
    GlobalNoteMutation,
    GlobalNoteMutationResponse,
    GlobalNoteSave,
    ServerGlobalNote,
} from '../shared/contracts';
import { formatIdeaTimestamp } from './ideas';

export const GLOBAL_NOTES_STORAGE_KEY = 'idea-notes.global-sync';

export type GlobalNoteOutboxEntry = GlobalNoteMutation & { attempted: boolean };

export interface GlobalNotesState {
    server: ServerGlobalNote[];
    outbox: GlobalNoteOutboxEntry[];
}

export interface GlobalNote {
    id: string;
    title: string;
    body: string;
    tags: string[];
    updatedAt: string;
}

export const emptyGlobalNotesState = (): GlobalNotesState => ({ server: [], outbox: [] });
const uuid = () => globalThis.crypto.randomUUID();

export function localGlobalNotes(state: GlobalNotesState): GlobalNote[] {
    const notes = new Map<string, GlobalNote>(
        state.server
            .filter((note) => !note.deleted)
            .map((note) => [
                note.id,
                {
                    id: note.id,
                    title: note.title,
                    body: note.body,
                    tags: [...note.tags],
                    updatedAt: note.updatedAt,
                },
            ])
    );
    for (const change of state.outbox) {
        if (change.kind === 'delete') notes.delete(change.id);
        else
            notes.set(change.id, {
                id: change.id,
                title: change.title,
                body: change.body,
                tags: [...change.tags],
                updatedAt: change.updatedAt,
            });
    }
    return [...notes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

const serverVersion = (state: GlobalNotesState, id: string) =>
    state.server.find((note) => note.id === id)?.version ?? 0;

export function queueGlobalSave(
    state: GlobalNotesState,
    value: Pick<GlobalNoteSave, 'id' | 'title' | 'body' | 'tags'>,
    now = new Date()
): GlobalNotesState {
    const updatedAt = now.toISOString();
    const editedLabel = formatIdeaTimestamp(updatedAt);
    const index = state.outbox.findLastIndex((change) => change.id === value.id);
    const pending = state.outbox[index];
    // Older servers require this field; current servers ignore it.
    const fields = { ...value, tags: [...value.tags], pinned: false };
    if (pending && !pending.attempted && pending.kind === 'save') {
        const outbox = [...state.outbox];
        outbox[index] = { ...pending, ...fields, updatedAt, editedLabel };
        return { ...state, outbox };
    }
    return {
        ...state,
        outbox: [
            ...state.outbox,
            {
                kind: 'save',
                mutationId: uuid(),
                ...fields,
                baseVersion: serverVersion(state, value.id),
                updatedAt,
                editedLabel,
                attempted: false,
            },
        ],
    };
}

export function queueGlobalDelete(state: GlobalNotesState, id: string): GlobalNotesState {
    const kept = state.outbox.filter((change) => change.id !== id || change.attempted);
    const row = state.server.find((note) => note.id === id);
    const inFlight = kept.some((change) => change.id === id);
    if ((!row || row.deleted) && !inFlight) return { ...state, outbox: kept };
    return {
        ...state,
        outbox: [
            ...kept,
            {
                kind: 'delete',
                mutationId: uuid(),
                id,
                baseVersion: Math.max(1, row?.version ?? 1),
                attempted: false,
            },
        ],
    };
}

export function markGlobalAttempted(state: GlobalNotesState, mutationId: string): GlobalNotesState {
    return {
        ...state,
        outbox: state.outbox.map((change) =>
            change.mutationId === mutationId ? { ...change, attempted: true } : change
        ),
    };
}

export function dropGlobalEntry(state: GlobalNotesState, mutationId: string): GlobalNotesState {
    return { ...state, outbox: state.outbox.filter((change) => change.mutationId !== mutationId) };
}

export function releaseGlobalAttempt(state: GlobalNotesState, mutationId: string): GlobalNotesState {
    return {
        ...state,
        outbox: state.outbox.map((change) =>
            change.mutationId === mutationId ? { ...change, attempted: false } : change
        ),
    };
}

export function acknowledgeGlobal(
    state: GlobalNotesState,
    mutationId: string,
    response: GlobalNoteMutationResponse
): GlobalNotesState {
    const acked = state.outbox.find((change) => change.mutationId === mutationId);
    if (!acked) return state;
    const server = state.server.filter((note) => note.id !== response.id);
    if (response.note) server.push(response.note);
    const rebase = response.outcome === 'created' || response.outcome === 'updated' || response.outcome === 'deleted';
    const outbox = state.outbox
        .filter((change) => change.mutationId !== mutationId)
        .map((change) =>
            rebase && !change.attempted && change.id === acked.id
                ? { ...change, baseVersion: Math.max(change.kind === 'delete' ? 1 : 0, response.resultVersion) }
                : change
        );
    return { server, outbox };
}

export function replaceGlobalServer(state: GlobalNotesState, notes: ServerGlobalNote[]): GlobalNotesState {
    return { ...state, server: notes };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

const isGlobalNotesState = (value: unknown): value is GlobalNotesState =>
    isObject(value) &&
    Array.isArray(value.server) &&
    value.server.every(
        (note) =>
            isObject(note) &&
            typeof note.id === 'string' &&
            typeof note.title === 'string' &&
            typeof note.body === 'string' &&
            isStringArray(note.tags) &&
            typeof note.deleted === 'boolean' &&
            typeof note.version === 'number'
    ) &&
    Array.isArray(value.outbox) &&
    value.outbox.every(
        (change) =>
            isObject(change) &&
            typeof change.mutationId === 'string' &&
            typeof change.id === 'string' &&
            typeof change.attempted === 'boolean'
    );

export function readGlobalNotesState(): { state: GlobalNotesState; error: string | null } {
    try {
        const saved = window.localStorage.getItem(GLOBAL_NOTES_STORAGE_KEY);
        if (saved === null) return { state: emptyGlobalNotesState(), error: null };
        const parsed: unknown = JSON.parse(saved);
        if (isGlobalNotesState(parsed)) return { state: parsed, error: null };
        return { state: emptyGlobalNotesState(), error: 'Saved global notes have an unexpected format.' };
    } catch {
        return { state: emptyGlobalNotesState(), error: 'Saved global notes could not be read from browser storage.' };
    }
}

export function writeGlobalNotesState(state: GlobalNotesState): string | null {
    try {
        window.localStorage.setItem(GLOBAL_NOTES_STORAGE_KEY, JSON.stringify(state));
        return null;
    } catch {
        return 'Your global note could not be saved. Check browser storage and try again.';
    }
}
