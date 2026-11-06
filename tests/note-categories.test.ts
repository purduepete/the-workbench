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

    it('keeps independent daily sections, receipts and section-specific deletes', async () => {
        const store = new MemoryIdeasStore();
        const apply = async (patch: Partial<JournalSave>) => (await store.applyJournal(journalSave(patch))).entry;
        const home = await apply({ category: 'home' });
        expect(home).toMatchObject({ category: 'home', version: 1 });
        const workSave = journalSave({ category: 'work', body: 'Work details' });
        const work = (await store.applyJournal(workSave)).entry;
        expect(work).toMatchObject({ category: 'work', version: 1 });
        const stale = await apply({ category: 'home', baseVersion: 0, body: 'Offline addition' });
        expect(stale).toMatchObject({ category: 'home' });
        expect(stale!.body).toContain('Offline addition');
        const unclassified = await apply({ category: null, body: 'Other details' });
        expect(unclassified).toMatchObject({ category: null });
        expect(await store.listJournal()).toHaveLength(3);
        expect((await store.applyJournal(workSave)).entry).toMatchObject({
            category: 'work',
            body: 'Work details',
            version: 1,
        });
        const deleted = await store.applyJournal({
            kind: 'delete',
            mutationId: randomUUID(),
            entryDate: work!.entryDate,
            category: 'work',
            baseVersion: 1,
        });
        expect(deleted.entry).toMatchObject({ category: 'work', deleted: true });
        expect((await store.listJournal()).filter((entry) => !entry.deleted)).toHaveLength(2);
        await expect(apply({ body: 'Legacy ambiguous edit' })).rejects.toThrow(/multiple note sections/);
    });

    it('preserves the section for a legacy save when the day still has only one entry', async () => {
        const store = new MemoryIdeasStore();
        await store.applyJournal(journalSave({ category: 'work' }));
        const legacy = await store.applyJournal(journalSave({ baseVersion: 1, body: 'Legacy work edit' }));
        expect(legacy.entry).toMatchObject({ category: 'work', body: 'Legacy work edit' });
    });

    it('queues Home/Work offline and retains categories under old queued edits', async () => {
        const store = new MemoryIdeasStore();
        const daily = (await store.applyJournal(journalSave({ category: 'work' }))).entry!;
        let journal = queueSave({ server: [daily], outbox: [] }, daily.entryDate, 'Old queued edit', []);
        expect(localEntries(journal)[0].category).toBe('work');
        journal = queueSave(journal, daily.entryDate, 'New edit', [], new Date(), 'home');
        expect(localEntries(journal).map((entry) => [entry.category, entry.body])).toEqual([
            ['work', 'Old queued edit'],
            ['home', 'New edit'],
        ]);
        expect(journal.outbox).toHaveLength(2);
        expect(journal.outbox[1]).toMatchObject({ category: 'home', baseVersion: 0 });
    });
});
