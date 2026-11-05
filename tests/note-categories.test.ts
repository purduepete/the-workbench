import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryIdeasStore } from '../server/store';
import { globalNoteMutationSchema, journalMutationSchema } from '../shared/contracts';
import type { GlobalNoteSave, JournalSave } from '../shared/contracts';
import { localEntries, queueSave } from '../src/journalSync';

const journalSave = (patch: Partial<JournalSave> = {}): JournalSave => ({
    kind: 'save',
    mutationId: randomUUID(),
    entryDate: '2026-11-04',
    body: 'Daily details',
    tags: [],
    baseVersion: 0,
    updatedAt: '2026-11-04T20:00:00.000Z',
    editedLabel: '11/04/2026 12:00',
    ...patch,
});
const globalSave = (patch: Partial<GlobalNoteSave> = {}): GlobalNoteSave => {
    const { entryDate: _date, ...fields } = journalSave();
    return { ...fields, id: randomUUID(), title: 'Reference', ...patch };
};

describe('note categories', () => {
    it('validates categories and accepts legacy queued saves without a category', () => {
        for (const [schema, save] of [[journalMutationSchema, journalSave()]] as const) {
            for (const category of ['home', 'work', null])
                expect(schema.safeParse({ ...save, category }).success).toBe(true);
            expect(schema.safeParse(save).success).toBe(true);
            expect(schema.safeParse({ ...save, category: 'office' }).success).toBe(false);
        }
        expect(globalNoteMutationSchema.safeParse(globalSave()).success).toBe(true);
        for (const category of ['home', 'work', null])
            expect(globalNoteMutationSchema.safeParse({ ...globalSave(), category }).success).toBe(false);
    });

    it('daily saves preserve category on legacy and stale edits, and allow explicit changes', async () => {
        const store = new MemoryIdeasStore();
        const apply = async (patch: Partial<JournalSave>) => (await store.applyJournal(journalSave(patch))).entry;
        const home = await apply({ category: 'home' });
        expect(home).toMatchObject({ category: 'home', version: 1 });
        const work = await apply({ category: 'work', baseVersion: 1 });
        expect(work).toMatchObject({ category: 'work', version: 2 });
        const stale = await apply({ category: 'home', baseVersion: 1, body: 'Offline addition' });
        expect(stale).toMatchObject({ category: 'work' });
        const legacy = await apply({ baseVersion: stale!.version, body: 'Legacy edit' });
        expect(legacy).toMatchObject({ category: 'work' });
        const unclassified = await apply({ baseVersion: legacy!.version, category: null });
        expect(unclassified).toMatchObject({ category: null });
    });

    it('queues Home/Work offline and retains categories under old queued edits', async () => {
        const store = new MemoryIdeasStore();
        const daily = (await store.applyJournal(journalSave({ category: 'work' }))).entry!;
        let journal = queueSave({ server: [daily], outbox: [] }, daily.entryDate, 'Old queued edit', []);
        expect(localEntries(journal)[0].category).toBe('work');
        journal = queueSave(journal, daily.entryDate, 'New edit', [], new Date(), 'home');
        expect(localEntries(journal)[0].category).toBe('home');
        expect(journal.outbox).toHaveLength(1);
        expect(journal.outbox[0]).toMatchObject({ category: 'home' });
    });
});
