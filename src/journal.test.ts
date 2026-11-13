process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it } from 'vitest';
import { entryDateSchema, journalLimits } from '../shared/contracts';
import type { JournalSave, NoteCategory, ServerJournalEntry } from '../shared/contracts';
import { resolveSave, unionTags } from '../shared/journal';
import { filterEntries, formatEntryDate, groupByWeek, localDateKey, noteHeading, weekStart } from './journal';
import type { JournalEntry } from './journal';
import { acknowledge, localEntries, markAttempted, queueDelete, queueSave, releaseAttempt } from './journalSync';
import type { JournalOutboxEntry, JournalState } from './journalSync';

const DATE = '2026-10-29';
const NOTE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const entry = (
    entryDate: string,
    body = 'Body',
    tags: string[] = [],
    extra: Partial<JournalEntry> = {}
): JournalEntry => ({
    id: `${entryDate}-${body}`,
    entryDate,
    title: '',
    body,
    tags,
    createdAt: '2026-10-29T18:00:00.000Z',
    updatedAt: '2026-10-29T18:00:00.000Z',
    ...extra,
});

const row = (
    entryDate: string,
    version: number,
    body = 'Server',
    deleted = false,
    id = NOTE,
    category: NoteCategory = null
): ServerJournalEntry => ({
    id,
    entryDate,
    title: '',
    body,
    tags: [],
    category,
    deleted,
    createdAt: '2026-10-29T18:00:00.000Z',
    updatedAt: '2026-10-29T18:00:00.000Z',
    version,
});

const current = (body: string, tags: string[], version: number, deleted = false) => ({
    title: '',
    body,
    tags,
    deleted,
    version,
});

const save = (baseVersion: number, body: string, tags: string[] = []): JournalSave => ({
    kind: 'save',
    mutationId: crypto.randomUUID(),
    entryDate: DATE,
    baseVersion,
    body,
    tags,
    updatedAt: '2026-10-29T20:05:00.000Z',
    editedLabel: '10/29/2026 13:05',
});

const note = (body: string, extra: Partial<Parameters<typeof queueSave>[1]> = {}) => ({
    id: NOTE,
    entryDate: DATE,
    title: '',
    body,
    tags: [] as string[],
    category: null as NoteCategory,
    ...extra,
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

    it('groups several notes for one day in the order they were created', () => {
        const [week] = groupByWeek([
            entry(DATE, 'Later', [], { createdAt: '2026-10-29T20:00:00.000Z' }),
            entry(DATE, 'Earlier', [], { createdAt: '2026-10-29T08:00:00.000Z' }),
            entry('2026-10-28', 'Yesterday'),
        ]);
        expect(week.days.map((day) => [day.entryDate, day.entries.map((value) => value.body)])).toEqual([
            [DATE, ['Earlier', 'Later']],
            ['2026-10-28', ['Yesterday']],
        ]);
    });

    it('names a note by its title, then its first line', () => {
        expect(noteHeading(entry(DATE, 'Body', [], { title: 'Standup' }))).toBe('Standup');
        expect(noteHeading(entry(DATE, '## Plan for **today**\nmore'))).toBe('Plan for today');
        expect(noteHeading(entry(DATE, '[Photo.jpg](https://1drv.ms/i/x) at the park'))).toBe('Photo.jpg at the park');
        expect(noteHeading(entry(DATE, '   '))).toBe('Untitled note');
    });

    it('searches body and tags and filters by tag without case', () => {
        const entries = [entry('2026-10-26', 'Ran 5 miles', ['Health']), entry('2026-10-27', 'Quiet day', ['home'])];
        expect(filterEntries(entries, 'miles', null).map((value) => value.entryDate)).toEqual(['2026-10-26']);
        expect(filterEntries(entries, 'HOM', null).map((value) => value.entryDate)).toEqual(['2026-10-27']);
        expect(filterEntries(entries, '', 'health').map((value) => value.entryDate)).toEqual(['2026-10-26']);
        expect(filterEntries(entries, 'quiet', 'health')).toEqual([]);
        const titled = [entry(DATE, 'Body', [], { title: 'Budget review' })];
        expect(filterEntries(titled, 'budget', null)).toHaveLength(1);
    });
});

describe('journal merge rule', () => {
    it('creates, replaces on a matching version and restores a tombstone', () => {
        expect(resolveSave(null, save(0, 'New'))).toMatchObject({ outcome: 'created', body: 'New' });
        const existing = current('Old', ['a'], 2);
        expect(resolveSave(existing, save(2, 'New', ['b']))).toMatchObject({
            outcome: 'updated',
            body: 'New',
            tags: ['b'],
        });
        expect(resolveSave({ ...existing, deleted: true, body: '' }, save(1, 'Back'))).toMatchObject({
            outcome: 'created',
            body: 'Back',
        });
    });

    it('appends a stale save under a dated separator and unions tags', () => {
        const decision = resolveSave(current('From phone', ['Home'], 3), save(1, 'From laptop', ['home', 'work']));
        expect(decision).toMatchObject({
            outcome: 'merged',
            body: 'From phone\n\n--- Edit from 10/29/2026 13:05 ---\nFrom laptop',
            tags: ['Home', 'work'],
            bump: true,
        });
    });

    it('does not duplicate text already in the entry', () => {
        const existing = current('Morning\n\n--- Edit from x ---\nEvening', ['a'], 4);
        expect(resolveSave(existing, save(2, 'Evening', ['A']))).toMatchObject({
            outcome: 'merged',
            body: existing.body,
            bump: false,
        });
    });

    it('refuses a merge past the shared limit', () => {
        const long = 'x'.repeat(journalLimits.body - 10);
        expect(resolveSave(current(long, [], 2), save(1, 'More text'))).toEqual({
            outcome: 'overflow',
        });
        const tags = Array.from({ length: journalLimits.tags }, (_, index) => `t${index}`);
        expect(resolveSave(current('a', tags, 2), save(1, 'a', ['extra']))).toEqual({
            outcome: 'overflow',
        });
    });

    it('keeps a title unless the save brings a new one', () => {
        const titled = { ...current('Old', [], 2), title: 'Kept' };
        expect(resolveSave(titled, save(2, 'New'))).toMatchObject({ outcome: 'updated', title: 'Kept' });
        expect(resolveSave(titled, { ...save(2, 'New'), title: 'Renamed' })).toMatchObject({ title: 'Renamed' });
        expect(resolveSave(null, { ...save(0, 'New'), title: 'Fresh' })).toMatchObject({ title: 'Fresh' });
    });

    it('keeps the first spelling of each tag', () => {
        expect(unionTags(['Work'], ['work', 'Home', 'HOME'])).toEqual(['Work', 'Home']);
    });
});

describe('journal outbox', () => {
    const empty: JournalState = { server: [], outbox: [] };
    const created = (version: number, body: string, id = NOTE) => ({
        outcome: 'created' as const,
        id,
        entryDate: DATE,
        resultVersion: version,
        entry: row(DATE, version, body, false, id),
    });

    it('collapses unsent saves for a note and shows queued changes on top', () => {
        let state = queueSave(empty, note('One'));
        state = queueSave(state, note('Two', { title: 'Plan', tags: ['x'] }));
        expect(state.outbox).toHaveLength(1);
        expect(state.outbox[0]).toMatchObject({ id: NOTE, baseVersion: 0, title: 'Plan', body: 'Two', tags: ['x'] });
        expect(state.outbox[0].kind === 'save' && state.outbox[0].editedLabel).toMatch(
            /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/
        );
        expect(localEntries(state).map((value) => [value.title, value.body])).toEqual([['Plan', 'Two']]);
    });

    it('keeps several notes for the same day and section apart', () => {
        let state = queueSave(empty, note('Morning'));
        state = queueSave(state, note('Evening', { id: OTHER }));
        expect(state.outbox.map((change) => change.id)).toEqual([NOTE, OTHER]);
        expect(localEntries(state).map((value) => value.body)).toEqual(['Morning', 'Evening']);
        state = queueDelete(state, NOTE, DATE);
        expect(localEntries(state).map((value) => value.body)).toEqual(['Evening']);
    });

    it('hides tombstones and queued deletes', () => {
        const state: JournalState = {
            server: [row('2026-10-28', 3, '', true, OTHER), row(DATE, 1)],
            outbox: [],
        };
        expect(localEntries(state).map((value) => value.entryDate)).toEqual([DATE]);
        expect(localEntries(queueDelete(state, NOTE, DATE))).toEqual([]);
    });

    it('drops an unsent note instead of queuing a delete', () => {
        const state = queueDelete(queueSave(empty, note('Draft')), NOTE, DATE);
        expect(state.outbox).toEqual([]);
    });

    it('queues a delete behind an in-flight first save', () => {
        let state = queueSave(empty, note('Draft'));
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueDelete(state, NOTE, DATE);
        expect(state.outbox.map((change) => [change.kind, change.baseVersion])).toEqual([
            ['save', 0],
            ['delete', 1],
        ]);
    });

    it('rebases later changes after a create or update but not after a merge', () => {
        let state = queueSave(empty, note('First'));
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueSave(state, note('Second'));
        const [first] = state.outbox;
        const after = acknowledge(state, first.mutationId, created(1, 'First'));
        expect(after.outbox.map((change) => change.baseVersion)).toEqual([1]);
        expect(after.server.map((value) => value.version)).toEqual([1]);

        const merged = acknowledge(state, first.mutationId, {
            ...created(4, 'Phone\n\nFirst'),
            outcome: 'merged',
        });
        expect(merged.outbox.map((change) => change.baseVersion)).toEqual([0]);
    });

    it('rebases only changes for the acknowledged note', () => {
        let state: JournalState = { server: [row(DATE, 2, 'Other note', false, OTHER)], outbox: [] };
        state = queueSave(state, note('First'));
        state = markAttempted(state, state.outbox[0].mutationId);
        state = queueSave(state, note('Second'));
        state = queueSave(state, note('Other edit', { id: OTHER }));
        state = acknowledge(state, state.outbox[0].mutationId, created(1, 'First'));
        expect(state.outbox.map((change) => [change.id, change.baseVersion])).toEqual([
            [NOTE, 1],
            [OTHER, 2],
        ]);
    });

    it('does not rebase an already-attempted frozen journal mutation', () => {
        let state = queueSave(empty, note('First'));
        const [first] = state.outbox;
        state = markAttempted(state, first.mutationId);
        state = queueSave(state, note('Second'));
        const [sent, later] = state.outbox;
        state = markAttempted(state, later.mutationId);
        const result = acknowledge(state, sent.mutationId, created(1, 'First'));
        expect(result.outbox[0]).toMatchObject({ attempted: true, baseVersion: 0 });
    });

    it('unfreezes a refused change so the next save replaces it', () => {
        let state = queueSave(empty, note('Too long'));
        const [change] = state.outbox;
        state = releaseAttempt(markAttempted(state, change.mutationId), change.mutationId);
        state = queueSave(state, note('Shorter'));
        expect(state.outbox).toHaveLength(1);
        expect(state.outbox[0]).toMatchObject({ mutationId: change.mutationId, body: 'Shorter' });
    });

    it('maps a change queued before note ids to the one live note in its section', () => {
        const legacy: JournalOutboxEntry = {
            kind: 'save',
            mutationId: crypto.randomUUID(),
            entryDate: DATE,
            baseVersion: 3,
            body: 'Queued offline',
            tags: [],
            category: 'work',
            updatedAt: '2026-10-29T20:05:00.000Z',
            editedLabel: '10/29/2026 13:05',
            attempted: false,
        };
        const state: JournalState = {
            server: [row(DATE, 3, 'Work', false, NOTE, 'work'), row(DATE, 1, 'Home', false, OTHER, 'home')],
            outbox: [legacy],
        };
        expect(localEntries(state).map((value) => [value.id, value.body])).toEqual([
            [NOTE, 'Queued offline'],
            [OTHER, 'Home'],
        ]);
        const next = queueSave(state, note('Newer', { category: 'work' }));
        expect(next.outbox).toHaveLength(1);
        expect(next.outbox[0]).toMatchObject({ id: NOTE, body: 'Newer' });
    });
});
