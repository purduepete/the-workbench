import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { globalNoteMutationSchema } from '../shared/contracts';
import type { GlobalNoteSave, ServerGlobalNote } from '../shared/contracts';
import { resolveGlobalSave } from '../shared/journal';
import {
    acknowledgeGlobal,
    emptyGlobalNotesState,
    localGlobalNotes,
    markGlobalAttempted,
    queueGlobalDelete,
    queueGlobalSave,
    readGlobalNotesState,
} from './globalNotesSync';

const save = (baseVersion: number, patch: Partial<GlobalNoteSave> = {}): GlobalNoteSave => ({
    kind: 'save',
    mutationId: randomUUID(),
    id: 'a8ab805c-cd81-4da9-b1ad-1213517b13dc',
    baseVersion,
    title: 'Current title',
    body: 'Current body',
    tags: [],
    updatedAt: '2026-10-29T20:05:00.000Z',
    editedLabel: '10/29/2026 13:05',
    ...patch,
});

const current = (patch: Partial<ServerGlobalNote> = {}): ServerGlobalNote => ({
    id: 'a8ab805c-cd81-4da9-b1ad-1213517b13dc',
    title: 'Current title',
    body: 'Current body',
    tags: [],
    deleted: false,
    createdAt: '2026-10-29T18:00:00.000Z',
    updatedAt: '2026-10-29T18:00:00.000Z',
    version: 2,
    ...patch,
});

describe('global note validation and merge', () => {
    it('requires a title and allows an empty body', () => {
        expect(globalNoteMutationSchema.safeParse(save(0, { body: '' })).success).toBe(true);
        expect(globalNoteMutationSchema.safeParse(save(0, { title: ' ' })).success).toBe(false);
    });

    it('keeps stale title-only edits in a deduplicated separator', () => {
        const mutation = save(1, { title: 'New title', body: 'Current body' });
        const result = resolveGlobalSave(current(), mutation);
        expect(result).toMatchObject({
            outcome: 'merged',
            title: 'Current title',
            body: 'Current body\n\n--- Edit from 10/29/2026 13:05, titled "New title" ---',
            bump: true,
        });
        if (result.outcome === 'overflow') throw new Error('Unexpected overflow.');
        expect(resolveGlobalSave(current({ body: result.body, version: 3 }), mutation)).toMatchObject({
            body: result.body,
            bump: false,
        });
    });

    it('accepts and ignores a legacy pin-only change', () => {
        const legacy = save(1, { pinned: true });
        expect(globalNoteMutationSchema.safeParse(legacy).success).toBe(true);
        const result = resolveGlobalSave(current(), legacy);
        expect(result).toMatchObject({
            outcome: 'merged',
            bump: false,
        });
        expect(result).not.toHaveProperty('pinned');
    });
});

describe('global note outbox', () => {
    it('loads cached notes with or without the old pin field and sorts by update time', () => {
        const recent = current({ updatedAt: '2026-10-29T20:00:00.000Z' });
        const older = {
            ...current({ id: 'b8ab805c-cd81-4da9-b1ad-1213517b13dc', updatedAt: '2026-10-29T19:00:00.000Z' }),
            pinned: true,
        };
        const state = { server: [older, recent], outbox: [] };
        vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify(state) } });
        try {
            expect(readGlobalNotesState().error).toBeNull();
            const notes = localGlobalNotes(readGlobalNotesState().state);
            expect(notes.map((note) => note.id)).toEqual([recent.id, older.id]);
            expect(notes[1]).not.toHaveProperty('pinned');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('preserves attempted legacy payloads and clears the old flag on a new save', () => {
        const legacy = { ...save(0, { pinned: true }), attempted: true };
        const state = { server: [], outbox: [legacy] };
        const next = queueGlobalSave(state, {
            id: legacy.id,
            title: legacy.title,
            body: 'New body',
            tags: [],
        });
        expect(next.outbox[0]).toEqual(legacy);
        expect(next.outbox[1]).toMatchObject({ body: 'New body', pinned: false });
    });

    it('rebases only unattempted successors after an acknowledgement', () => {
        const id = 'a8ab805c-cd81-4da9-b1ad-1213517b13dc';
        let state = queueGlobalSave(emptyGlobalNotesState(), {
            id,
            title: 'One',
            body: 'First',
            tags: [],
        });
        const first = state.outbox[0];
        state = markGlobalAttempted(state, first.mutationId);
        state = queueGlobalSave(state, { id, title: 'One', body: 'First', tags: [] });
        state = queueGlobalDelete(state, id);
        expect(state.outbox.map((change) => change.kind)).toEqual(['save', 'delete']);
        const acked = acknowledgeGlobal(state, first.mutationId, {
            outcome: 'created',
            id,
            resultVersion: 1,
            note: current({ id, title: 'One', body: 'First', version: 1 }),
        });
        expect(acked.outbox.map((change) => [change.kind, change.baseVersion, change.attempted])).toEqual([
            ['delete', 1, false],
        ]);
        expect(localGlobalNotes(acked)).toEqual([]);
    });
});
