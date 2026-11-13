import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commentaryId, sectionKey, sectionKeys, WHOLE_NOTE } from './commentary';
import type { JournalCommentSave, ServerJournalComment } from '../shared/contracts';
import { resolveCommentSave } from '../shared/journal';
import {
    acknowledgeComment,
    localComments,
    markCommentAttempted,
    queueCommentDelete,
    queueCommentSave,
} from './commentsSync';
import type { CommentsState } from './commentsSync';

const NOTE = '11111111-1111-4111-8111-111111111111';
const COMMENT = '22222222-2222-4222-8222-222222222222';
const empty: CommentsState = { server: [], outbox: [] };

const row = (version: number, body = 'Server', deleted = false): ServerJournalComment => ({
    id: COMMENT,
    noteId: NOTE,
    body,
    deleted,
    createdAt: '2026-11-12T18:00:00.000Z',
    updatedAt: '2026-11-12T18:00:00.000Z',
    version,
});

const save = (baseVersion: number, body: string): JournalCommentSave => ({
    kind: 'save',
    mutationId: crypto.randomUUID(),
    id: COMMENT,
    noteId: NOTE,
    baseVersion,
    body,
    updatedAt: '2026-11-12T20:00:00.000Z',
    editedLabel: '11/12/2026 12:00',
});

describe('comment merge rule', () => {
    it('creates, replaces a current edit and appends a stale one once', () => {
        expect(resolveCommentSave(null, save(0, 'First'))).toEqual({ outcome: 'created', body: 'First', bump: true });
        expect(resolveCommentSave(row(2, 'Old'), save(2, 'New'))).toMatchObject({ outcome: 'updated', body: 'New' });
        const merged = resolveCommentSave(row(3, 'Phone'), save(1, 'Laptop'));
        expect(merged).toEqual({
            outcome: 'merged',
            body: 'Phone\n\n--- Edit from 11/12/2026 12:00 ---\nLaptop',
            bump: true,
        });
        expect(resolveCommentSave(row(4, 'Phone\nLaptop'), save(1, 'Laptop'))).toMatchObject({ bump: false });
    });
});

describe('comment outbox', () => {
    it('groups comments by note, oldest first, and collapses unsent edits', () => {
        let state = queueCommentSave(
            empty,
            { id: COMMENT, noteId: NOTE, body: 'Draft' },
            new Date('2026-11-12T10:00Z')
        );
        state = queueCommentSave(state, { id: COMMENT, noteId: NOTE, body: 'Edited' });
        state = queueCommentSave(
            state,
            { id: crypto.randomUUID(), noteId: NOTE, body: 'Later' },
            new Date('2026-11-12T11:00Z')
        );
        expect(state.outbox).toHaveLength(2);
        expect(
            localComments(state)
                .get(NOTE)
                ?.map((comment) => comment.body)
        ).toEqual(['Edited', 'Later']);
    });

    it('drops an unsent comment and queues a delete for a saved one', () => {
        expect(
            queueCommentDelete(queueCommentSave(empty, { id: COMMENT, noteId: NOTE, body: 'x' }), COMMENT).outbox
        ).toEqual([]);
        const saved = queueCommentDelete({ server: [row(2)], outbox: [] }, COMMENT);
        expect(saved.outbox[0]).toMatchObject({ kind: 'delete', baseVersion: 2 });
        expect(localComments(saved).get(NOTE)).toBeUndefined();
    });

    it('rebases a later edit after the first save is acknowledged', () => {
        let state = queueCommentSave(empty, { id: COMMENT, noteId: NOTE, body: 'First' });
        state = markCommentAttempted(state, state.outbox[0].mutationId);
        state = queueCommentSave(state, { id: COMMENT, noteId: NOTE, body: 'Second' });
        state = acknowledgeComment(state, state.outbox[0].mutationId, {
            outcome: 'created',
            id: COMMENT,
            resultVersion: 1,
            comment: row(1, 'First'),
        });
        expect(state.outbox.map((change) => change.baseVersion)).toEqual([1]);
        expect(state.server).toHaveLength(1);
    });
});

describe('section commentary keys', () => {
    it('gives every device the same valid id for a note section', () => {
        const id = commentaryId(NOTE, 'questions');
        expect(id).toBe(commentaryId(NOTE, 'questions'));
        expect(id).not.toBe(commentaryId(NOTE, 'my qualifications'));
        expect(id).not.toBe(commentaryId(COMMENT, 'questions'));
        expect(commentaryId(NOTE, WHOLE_NOTE)).not.toBe(id);
        expect(z.uuid().safeParse(id).success).toBe(true);
    });

    it('names sections the way they read and skips fenced code', () => {
        expect(sectionKey('  **Praveen**  1:1 ')).toBe('praveen 1:1');
        expect(sectionKey('[Plan](https://example.com) `v2`')).toBe('plan v2');
        expect(sectionKeys('Intro\n## My qualifications\ntext\n```\n## not a section\n```\n## Questions')).toEqual([
            'my qualifications',
            'questions',
        ]);
        expect(sectionKeys('No sections here')).toEqual([]);
    });
});
