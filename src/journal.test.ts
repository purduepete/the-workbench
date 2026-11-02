process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it } from 'vitest';
import { entryDateSchema, journalLimits } from '../shared/contracts';
import type { JournalSave, ServerJournalEntry } from '../shared/contracts';
import { resolveSave, unionTags } from '../shared/journal';
import { filterEntries, formatEntryDate, groupByWeek, localDateKey, weekStart } from './journal';
import type { JournalEntry } from './journal';
import { acknowledge, localEntries, markAttempted, queueDelete, queueSave, releaseAttempt } from './journalSync';
import type { JournalState } from './journalSync';

const entry = (entryDate: string, body = 'Body', tags: string[] = []): JournalEntry => ({
    entryDate,
    body,
    tags,
    updatedAt: '2026-10-29T18:00:00.000Z',
});

const row = (entryDate: string, version: number, body = 'Server', deleted = false): ServerJournalEntry => ({
    entryDate,
    body,
    tags: [],
    deleted,
    createdAt: '2026-10-29T18:00:00.000Z',
    updatedAt: '2026-10-29T18:00:00.000Z',
    version,
});

const save = (baseVersion: number, body: string, tags: string[] = []): JournalSave => ({
    kind: 'save',
    mutationId: crypto.randomUUID(),
    entryDate: '2026-10-29',
    baseVersion,
    body,
    tags,
    updatedAt: '2026-10-29T20:05:00.000Z',
    editedLabel: '10/29/2026 13:05',
});

describe('journal dates', () => {
    it('uses the local calendar day, not the UTC day', () => {
        expect(localDateKey(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
        // 06:30 UTC on 11/01 is still 10/31 in Pacific time.
        expect(localDateKey(new Date('2026-11-01T06:30:00Z'))).toBe('2026-10-31');
    });

    it('formats dates as mm/dd/yyyy without parsing them', () => {
        expect(formatEntryDate('2026-01-05')).toBe('01/05/2026');
    });

    it('accepts only real calendar dates', () => {
        expect(entryDateSchema.safeParse('2028-02-29').success).toBe(true);
        expect(entryDateSchema.safeParse('2026-02-29').success).toBe(false);
        expect(entryDateSchema.safeParse('2026-13-01').success).toBe(false);
        expect(entryDateSchema.safeParse('2026-1-01').success).toBe(false);
    });

    it('starts weeks on Monday, including across daylight saving changes', () => {
        expect(weekStart('2026-10-26')).toBe('2026-10-26');
        expect(weekStart('2026-11-01')).toBe('2026-10-26');
        expect(weekStart('2026-11-02')).toBe('2026-11-02');
        expect(weekStart('2026-03-08')).toBe('2026-03-02');
        expect(weekStart('2026-03-09')).toBe('2026-03-09');
        expect(weekStart('2027-01-01')).toBe('2026-12-28');
    });

    it('groups newest week first and newest day first', () => {
        const groups = groupByWeek([
            entry('2026-10-26'),
            entry('2026-11-02'),
            entry('2026-11-01'),
            entry('2026-10-28'),
        ]);
        expect(groups.map((group) => [group.weekStart, group.entries.map((value) => value.entryDate)])).toEqual([
            ['2026-11-02', ['2026-11-02']],
            ['2026-10-26', ['2026-11-01', '2026-10-28', '2026-10-26']],
        ]);
    });

    it('searches body and tags and filters by tag without case', () => {
        const entries = [entry('2026-10-26', 'Ran 5 miles', ['Health']), entry('2026-10-27', 'Quiet day', ['home'])];
        expect(filterEntries(entries, 'miles', null).map((value) => value.entryDate)).toEqual(['2026-10-26']);
        expect(filterEntries(entries, 'HOM', null).map((value) => value.entryDate)).toEqual(['2026-10-27']);
        expect(filterEntries(entries, '', 'health').map((value) => value.entryDate)).toEqual(['2026-10-26']);
        expect(filterEntries(entries, 'quiet', 'health')).toEqual([]);
    });
});

describe('journal merge rule', () => {
    it('creates, replaces on a matching version and restores a tombstone', () => {
        expect(resolveSave(null, save(0, 'New'))).toMatchObject({ outcome: 'created', body: 'New' });
        const current = { body: 'Old', tags: ['a'], deleted: false, version: 2 };
        expect(resolveSave(current, save(2, 'New', ['b']))).toMatchObject({
            outcome: 'updated',
            body: 'New',
            tags: ['b'],
        });
        expect(resolveSave({ ...current, deleted: true, body: '' }, save(1, 'Back'))).toMatchObject({
            outcome: 'created',
            body: 'Back',
        });
    });

    it('appends a stale save under a dated separator and unions tags', () => {
        const decision = resolveSave(
            { body: 'From phone', tags: ['Home'], deleted: false, version: 3 },
            save(1, 'From laptop', ['home', 'work'])
        );
        expect(decision).toEqual({
            outcome: 'merged',
            body: 'From phone\n\n--- Edit from 10/29/2026 13:05 ---\nFrom laptop',
            tags: ['Home', 'work'],
            bump: true,
        });
    });

    it('does not duplicate text already in the entry', () => {
        const current = { body: 'Morning\n\n--- Edit from x ---\nEvening', tags: ['a'], deleted: false, version: 4 };
        expect(resolveSave(current, save(2, 'Evening', ['A']))).toMatchObject({
            outcome: 'merged',
            body: current.body,
            bump: false,
        });
    });

    it('refuses a merge past the shared limit', () => {
        const long = 'x'.repeat(journalLimits.body - 10);
        expect(resolveSave({ body: long, tags: [], deleted: false, version: 2 }, save(1, 'More text'))).toEqual({
            outcome: 'overflow',
        });
        const tags = Array.from({ length: journalLimits.tags }, (_, index) => `t${index}`);
        expect(resolveSave({ body: 'a', tags, deleted: false, version: 2 }, save(1, 'a', ['extra']))).toEqual({
            outcome: 'overflow',
        });
    });

    it('keeps the first spelling of each tag', () => {
        expect(unionTags(['Work'], ['work', 'Home', 'HOME'])).toEqual(['Work', 'Home']);
    });
});

describe('journal outbox', () => {
    const empty: JournalState = { server: [], outbox: [] };

    it('collapses unsent saves for a day and shows queued changes on top', () => {
        let state = queueSave(empty, '2026-10-29', 'One', []);
        state = queueSave(state, '2026-10-29', 'Two', ['x']);
        expect(state.outbox).toHaveLength(1);
        expect(state.outbox[0]).toMatchObject({ baseVersion: 0, body: 'Two', tags: ['x'] });
        expect(state.outbox[0].kind === 'save' && state.outbox[0].editedLabel).toMatch(
            /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/
        );
        expect(localEntries(state).map((value) => value.body)).toEqual(['Two']);
    });

    it('hides tombstones and queued deletes', () => {
        const state: JournalState = { server: [row('2026-10-28', 3, '', true), row('2026-10-29', 1)], outbox: [] };
        expect(localEntries(state).map((value) => value.entryDate)).toEqual(['2026-10-29']);
        expect(localEntries(queueDelete(state, '2026-10-29'))).toEqual([]);
    });

    it('drops an unsent day instead of queuing a delete', () => {
        const state = queueDelete(queueSave(empty, '2026-10-29', 'Draft', []), '2026-10-29');
        expect(state.outbox).toEqual([]);
    });

    it('queues a delete behind an in-flight first save', () => {
        let state = queueSave(empty, '2026-10-29', 'Draft', []);
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueDelete(state, '2026-10-29');
        expect(state.outbox.map((change) => [change.kind, change.baseVersion])).toEqual([
            ['save', 0],
            ['delete', 1],
        ]);
    });

    it('rebases later changes after a create or update but not after a merge', () => {
        let state = queueSave(empty, '2026-10-29', 'First', []);
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueSave(state, '2026-10-29', 'Second', []);
        const [first] = state.outbox;
        const created = acknowledge(state, first.mutationId, {
            outcome: 'created',
            entryDate: '2026-10-29',
            resultVersion: 1,
            entry: row('2026-10-29', 1, 'First'),
        });
        expect(created.outbox.map((change) => change.baseVersion)).toEqual([1]);
        expect(created.server.map((value) => value.version)).toEqual([1]);

        const merged = acknowledge(state, first.mutationId, {
            outcome: 'merged',
            entryDate: '2026-10-29',
            resultVersion: 4,
            entry: row('2026-10-29', 4, 'Phone\n\nFirst'),
        });
        expect(merged.outbox.map((change) => change.baseVersion)).toEqual([0]);
    });

    it('does not rebase an already-attempted frozen journal mutation', () => {
        let state = queueSave(empty, '2026-10-29', 'First', []);
        const [first] = state.outbox;
        state = markAttempted(state, first.mutationId);
        state = queueSave(state, '2026-10-29', 'Second', []);
        const [sent, later] = state.outbox;
        state = markAttempted(state, later.mutationId);
        const result = acknowledge(state, sent.mutationId, {
            outcome: 'created',
            entryDate: '2026-10-29',
            resultVersion: 1,
            entry: row('2026-10-29', 1, 'First'),
        });
        expect(result.outbox[0]).toMatchObject({ attempted: true, baseVersion: 0 });
    });

    it('unfreezes a refused change so the next save replaces it', () => {
        let state = queueSave(empty, '2026-10-29', 'Too long', []);
        const [change] = state.outbox;
        state = releaseAttempt(markAttempted(state, change.mutationId), change.mutationId);
        state = queueSave(state, '2026-10-29', 'Shorter', []);
        expect(state.outbox).toHaveLength(1);
        expect(state.outbox[0]).toMatchObject({ mutationId: change.mutationId, body: 'Shorter' });
    });
});
