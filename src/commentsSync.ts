import type { JournalCommentMutation, JournalCommentMutationResponse, ServerJournalComment } from '../shared/contracts';
import { formatIdeaTimestamp } from './ideas';

export const COMMENTS_STORAGE_KEY = 'the-workbench.comment-sync';

export type CommentOutboxEntry = JournalCommentMutation & { attempted: boolean };

export interface CommentsState {
    server: ServerJournalComment[];
    outbox: CommentOutboxEntry[];
}

export interface NoteComment {
    id: string;
    noteId: string;
    body: string;
    createdAt: string;
    updatedAt: string;
}

export const emptyCommentsState = (): CommentsState => ({ server: [], outbox: [] });
const uuid = () => globalThis.crypto.randomUUID();

/** Confirmed comments with queued changes on top, grouped by note and oldest first. */
export function localComments(state: CommentsState): Map<string, NoteComment[]> {
    const comments = new Map<string, NoteComment>(
        state.server
            .filter((comment) => !comment.deleted)
            .map((comment) => [
                comment.id,
                {
                    id: comment.id,
                    noteId: comment.noteId,
                    body: comment.body,
                    createdAt: comment.createdAt,
                    updatedAt: comment.updatedAt,
                },
            ])
    );
    for (const change of state.outbox) {
        if (change.kind === 'delete') {
            comments.delete(change.id);
            continue;
        }
        const previous = comments.get(change.id);
        comments.set(change.id, {
            id: change.id,
            noteId: previous?.noteId ?? change.noteId,
            body: change.body,
            createdAt: previous?.createdAt ?? change.updatedAt,
            updatedAt: change.updatedAt,
        });
    }
    const byNote = new Map<string, NoteComment[]>();
    const sorted = [...comments.values()].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
    for (const comment of sorted) byNote.set(comment.noteId, [...(byNote.get(comment.noteId) ?? []), comment]);
    return byNote;
}

const serverVersion = (state: CommentsState, id: string) =>
    state.server.find((comment) => comment.id === id)?.version ?? 0;

export function queueCommentSave(
    state: CommentsState,
    value: { id: string; noteId: string; body: string },
    now = new Date()
): CommentsState {
    const updatedAt = now.toISOString();
    const editedLabel = formatIdeaTimestamp(updatedAt);
    const index = state.outbox.findLastIndex((change) => change.id === value.id);
    const pending = state.outbox[index];
    if (pending && !pending.attempted && pending.kind === 'save') {
        const outbox = [...state.outbox];
        // An unsent new comment keeps its first time: the server stores it as the comment's creation time.
        const unsentNew = !state.server.some((comment) => comment.id === value.id);
        outbox[index] = {
            ...pending,
            body: value.body,
            updatedAt: unsentNew ? pending.updatedAt : updatedAt,
            editedLabel,
        };
        return { ...state, outbox };
    }
    return {
        ...state,
        outbox: [
            ...state.outbox,
            {
                kind: 'save',
                mutationId: uuid(),
                id: value.id,
                noteId: value.noteId,
                body: value.body,
                baseVersion: serverVersion(state, value.id),
                updatedAt,
                editedLabel,
                attempted: false,
            },
        ],
    };
}

export function queueCommentDelete(state: CommentsState, id: string): CommentsState {
    const kept = state.outbox.filter((change) => change.id !== id || change.attempted);
    const row = state.server.find((comment) => comment.id === id);
    const inFlight = kept.some((change) => change.id === id);
    // A comment that never reached the server only needs its queued saves removed.
    if ((!row || row.deleted) && !inFlight) return { ...state, outbox: kept };
    return {
        ...state,
        outbox: [
            ...kept,
            { kind: 'delete', mutationId: uuid(), id, baseVersion: Math.max(1, row?.version ?? 1), attempted: false },
        ],
    };
}

const setAttempted = (state: CommentsState, mutationId: string, attempted: boolean): CommentsState => ({
    ...state,
    outbox: state.outbox.map((change) => (change.mutationId === mutationId ? { ...change, attempted } : change)),
});

export const markCommentAttempted = (state: CommentsState, mutationId: string) => setAttempted(state, mutationId, true);
export const releaseCommentAttempt = (state: CommentsState, mutationId: string) =>
    setAttempted(state, mutationId, false);
export const dropCommentEntry = (state: CommentsState, mutationId: string): CommentsState => ({
    ...state,
    outbox: state.outbox.filter((change) => change.mutationId !== mutationId),
});

export function acknowledgeComment(
    state: CommentsState,
    mutationId: string,
    response: JournalCommentMutationResponse
): CommentsState {
    const acked = state.outbox.find((change) => change.mutationId === mutationId);
    if (!acked) return state;
    const server = state.server.filter((comment) => comment.id !== response.id);
    if (response.comment) server.push(response.comment);
    // After a merge or a kept delete, later changes stay stale on purpose and merge again on the server.
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

export const replaceCommentServer = (state: CommentsState, comments: ServerJournalComment[]): CommentsState => ({
    ...state,
    server: comments,
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isCommentsState = (value: unknown): value is CommentsState =>
    isObject(value) &&
    Array.isArray(value.server) &&
    value.server.every(
        (comment) =>
            isObject(comment) &&
            typeof comment.id === 'string' &&
            typeof comment.noteId === 'string' &&
            typeof comment.body === 'string' &&
            typeof comment.deleted === 'boolean' &&
            typeof comment.version === 'number'
    ) &&
    Array.isArray(value.outbox) &&
    value.outbox.every(
        (change) =>
            isObject(change) &&
            typeof change.mutationId === 'string' &&
            typeof change.id === 'string' &&
            typeof change.attempted === 'boolean'
    );

export function readCommentsState(): { state: CommentsState; error: string | null } {
    try {
        const saved = window.localStorage.getItem(COMMENTS_STORAGE_KEY);
        if (saved === null) return { state: emptyCommentsState(), error: null };
        const parsed: unknown = JSON.parse(saved);
        if (isCommentsState(parsed)) return { state: parsed, error: null };
        return { state: emptyCommentsState(), error: 'Saved comments have an unexpected format.' };
    } catch {
        return { state: emptyCommentsState(), error: 'Saved comments could not be read from browser storage.' };
    }
}

export function writeCommentsState(state: CommentsState): string | null {
    try {
        window.localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(state));
        return null;
    } catch {
        return 'Your comment could not be saved. Check browser storage and try again.';
    }
}
