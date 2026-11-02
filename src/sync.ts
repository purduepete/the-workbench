import type { IdeaFields, Mutation, MutationResponse, ServerIdea } from '../shared/contracts';
import type { Idea } from './types';
import { statusForSolution } from '../shared/status';

export const SYNC_STORAGE_KEY = 'the-workbench.sync';
export const LEGACY_IDEAS_KEY = 'the-workbench.ideas';

/** A queued change. Once attempted, its payload is frozen so a retry repeats the exact same request. */
export type OutboxEntry = Mutation & { attempted: boolean };

export interface SyncState {
    /** The last rows the server confirmed, with their versions. */
    server: ServerIdea[];
    outbox: OutboxEntry[];
}

export const emptySyncState = (): SyncState => ({ server: [], outbox: [] });

const uuid = () => globalThis.crypto.randomUUID();

export const fieldsOf = (idea: Idea): IdeaFields => ({
    title: idea.title,
    body: idea.body,
    tags: [...idea.tags],
    pinned: idea.pinned,
    archived: idea.archived,
    solution: idea.solution,
    status: statusForSolution(idea.solution, idea.status),
    updatedAt: idea.updatedAt,
});

/** Data saved before solutions and status existed gets the same defaults the server applies. */
const withDefaults = <T extends object>(value: T) => ({ solution: null, status: 'open' as const, ...value });

const stripVersion = ({ version: _version, ...idea }: ServerIdea): Idea => ({
    ...idea,
    status: statusForSolution(idea.solution, idea.status),
});

/** The ideas to show: the confirmed server rows with every queued change applied on top. */
export function localIdeas(state: SyncState): Idea[] {
    const ideas = new Map(state.server.map((idea) => [idea.id, stripVersion(idea)]));
    for (const entry of state.outbox) {
        if (entry.kind === 'delete') {
            ideas.delete(entry.id);
            continue;
        }
        const current = ideas.get(entry.id);
        const createdAt = current?.createdAt ?? (entry.kind === 'create' ? entry.createdAt : entry.fields.updatedAt);
        ideas.set(entry.id, {
            id: entry.id,
            createdAt,
            ...entry.fields,
            status: statusForSolution(entry.fields.solution, entry.fields.status),
            tags: [...entry.fields.tags],
        });
    }
    return [...ideas.values()];
}

export function queueCreate(state: SyncState, idea: Idea): SyncState {
    const entry: OutboxEntry = {
        kind: 'create',
        mutationId: uuid(),
        id: idea.id,
        createdAt: idea.createdAt,
        fields: fieldsOf(idea),
        attempted: false,
    };
    return { ...state, outbox: [...state.outbox, entry] };
}

export function queueUpdate(state: SyncState, idea: Idea): SyncState {
    const fields = fieldsOf(idea);
    const pendingIndex = state.outbox.findLastIndex((entry) => entry.id === idea.id);
    const pending = state.outbox[pendingIndex];
    // Unsent changes to the same note collapse into one request.
    if (pending && !pending.attempted && pending.kind !== 'delete') {
        const outbox = [...state.outbox];
        outbox[pendingIndex] = { ...pending, fields };
        return { ...state, outbox };
    }
    // Queued behind an in-flight change, this base version is corrected when that change is acknowledged.
    const baseVersion = state.server.find((row) => row.id === idea.id)?.version ?? 1;
    const entry: OutboxEntry = {
        kind: 'update',
        mutationId: uuid(),
        id: idea.id,
        baseVersion,
        copyId: uuid(),
        fields,
        attempted: false,
    };
    return { ...state, outbox: [...state.outbox, entry] };
}

export function queueDelete(state: SyncState, id: string): SyncState {
    const kept = state.outbox.filter((entry) => entry.id !== id || entry.attempted);
    const neverSent =
        !state.server.some((row) => row.id === id) && !kept.some((entry) => entry.id === id && entry.attempted);
    if (neverSent) return { ...state, outbox: kept };
    return { ...state, outbox: [...kept, { kind: 'delete', mutationId: uuid(), id, attempted: false }] };
}

export function markAttempted(state: SyncState, mutationId: string): SyncState {
    return {
        ...state,
        outbox: state.outbox.map((entry) => (entry.mutationId === mutationId ? { ...entry, attempted: true } : entry)),
    };
}

/** Drops a change the server rejected as invalid; retrying it can never succeed. */
export function dropEntry(state: SyncState, mutationId: string): SyncState {
    return { ...state, outbox: state.outbox.filter((entry) => entry.mutationId !== mutationId) };
}

export function acknowledge(state: SyncState, mutationId: string, response: MutationResponse): SyncState {
    const acked = state.outbox.find((entry) => entry.mutationId === mutationId);
    if (!acked) return state;
    let server = state.server.filter((row) => row.id !== response.resultId);
    if (response.outcome === 'deleted') server = server.filter((row) => row.id !== acked.id);
    else if (response.idea) server = [...server, response.idea];
    const outbox = state.outbox
        .filter((entry) => entry.mutationId !== mutationId)
        .map((entry): OutboxEntry => {
            if (entry.id !== acked.id || response.outcome === 'deleted') return entry;
            // Later changes build on the acknowledged result only, never on unrelated server edits.
            const id = response.outcome === 'copied' ? response.resultId : entry.id;
            return entry.kind === 'update' ? { ...entry, id, baseVersion: response.resultVersion } : { ...entry, id };
        });
    return { server, outbox };
}

/** Replaces the confirmed rows after a full fetch. Queued changes stay on top. */
export function replaceServer(state: SyncState, ideas: ServerIdea[]): SyncState {
    return { ...state, server: ideas };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

const isLegacyIdea = (value: unknown): value is Idea =>
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.body === 'string' &&
    isStringArray(value.tags) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.pinned === 'boolean' &&
    typeof value.archived === 'boolean';

const isSyncState = (value: unknown): value is SyncState =>
    isObject(value) &&
    Array.isArray(value.server) &&
    value.server.every((row) => isLegacyIdea(row) && typeof (row as ServerIdea).version === 'number') &&
    Array.isArray(value.outbox) &&
    value.outbox.every(
        (entry) =>
            isObject(entry) &&
            typeof entry.mutationId === 'string' &&
            typeof entry.id === 'string' &&
            typeof entry.attempted === 'boolean'
    );

export function readSyncState(): { state: SyncState; error: string | null } {
    try {
        const saved = window.localStorage.getItem(SYNC_STORAGE_KEY);
        if (saved !== null) {
            const parsed: unknown = JSON.parse(saved);
            if (isSyncState(parsed)) {
                const state: SyncState = {
                    server: parsed.server.map(withDefaults),
                    outbox: parsed.outbox.map((entry) =>
                        entry.kind === 'delete' ? entry : { ...entry, fields: withDefaults(entry.fields) }
                    ),
                };
                return { state, error: null };
            }
            return {
                state: emptySyncState(),
                error: 'Saved ideas could not be read because the stored data has an unexpected format.',
            };
        }
        // Ideas saved before server sync are queued as new notes so they upload once.
        const legacy = window.localStorage.getItem(LEGACY_IDEAS_KEY);
        const legacyIdeas: unknown = legacy === null ? [] : JSON.parse(legacy);
        const state = Array.isArray(legacyIdeas)
            ? legacyIdeas.filter(isLegacyIdea).map(withDefaults).reduce(queueCreate, emptySyncState())
            : emptySyncState();
        return { state, error: null };
    } catch {
        return {
            state: emptySyncState(),
            error: 'Saved ideas could not be read. Browser storage may be unavailable or the saved data may be damaged.',
        };
    }
}

export function writeSyncState(state: SyncState): string | null {
    try {
        window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
        window.localStorage.removeItem(LEGACY_IDEAS_KEY);
        return null;
    } catch {
        return 'Your change could not be saved. Check browser storage and try again.';
    }
}
