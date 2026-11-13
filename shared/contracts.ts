import { z } from 'zod';
import { defaultPriority, ideaPriorities, ideaStatuses, statusForSolution } from './status.js';

export { ideaPriorities, ideaStatuses } from './status.js';
export type { IdeaPriority, IdeaStatus } from './status.js';

export const limits = { title: 140, body: 20_000, tag: 40, tags: 12 } as const;

const isoTimestamp = z.iso.datetime({ offset: true });

/** Solution ids match the hyphenated ids in Solution Directory's sites.json. */
export const solutionIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

const baseIdeaFields = {
    title: z.string().trim().min(1).max(limits.title),
    body: z.string().max(limits.body),
    tags: z.array(z.string().trim().min(1).max(limits.tag)).max(limits.tags),
    pinned: z.boolean(),
    archived: z.boolean(),
    // Defaults keep changes queued by an older client valid.
    solution: z.string().regex(solutionIdPattern).nullable().default(null),
    status: z.enum(ideaStatuses).default('open'),
    updatedAt: isoTimestamp,
};

const normalizeStatus = <T extends { solution: string | null; status: (typeof ideaStatuses)[number] }>(fields: T) => ({
    ...fields,
    status: statusForSolution(fields.solution, fields.status),
});

export const ideaFieldsSchema = z
    .object({ ...baseIdeaFields, priority: z.enum(ideaPriorities).default(defaultPriority) })
    .strict()
    .transform(normalizeStatus);

/** An update from a client that predates priority omits it; the server then keeps the stored priority. */
export const ideaUpdateFieldsSchema = z
    .object({ ...baseIdeaFields, priority: z.enum(ideaPriorities).optional() })
    .strict()
    .transform(normalizeStatus);

export type IdeaFields = z.infer<typeof ideaFieldsSchema>;
export type IdeaUpdateFields = z.infer<typeof ideaUpdateFieldsSchema>;

export interface ServerIdea extends IdeaFields {
    id: string;
    createdAt: string;
    version: number;
}

export const mutationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('create'),
            mutationId: z.uuid(),
            id: z.uuid(),
            createdAt: isoTimestamp,
            fields: ideaFieldsSchema,
        })
        .strict(),
    z
        .object({
            kind: z.literal('update'),
            mutationId: z.uuid(),
            id: z.uuid(),
            baseVersion: z.number().int().min(1),
            copyId: z.uuid(),
            fields: ideaUpdateFieldsSchema,
        })
        .strict(),
    z.object({ kind: z.literal('delete'), mutationId: z.uuid(), id: z.uuid() }).strict(),
]);

export type Mutation = z.infer<typeof mutationSchema>;

export type MutationOutcome = 'created' | 'updated' | 'copied' | 'deleted';

/** The recorded outcome of one mutation. A retry of the same mutationId returns the same receipt. */
export interface MutationReceipt {
    outcome: MutationOutcome;
    resultId: string;
    resultVersion: number;
}

export interface MutationResponse extends MutationReceipt {
    /** The current server row for resultId, or null when it no longer exists. */
    idea: ServerIdea | null;
}

export interface Solution {
    id: string;
    name: string;
    /** Hidden from the pickers on every device; linked ideas keep the link. */
    disabled?: boolean;
}

export const solutionSettingSchema = z
    .object({ id: z.string().regex(solutionIdPattern), disabled: z.boolean() })
    .strict();

export const ideaQuerySchema = z.object({
    solution: z.union([z.literal('none'), z.string().regex(solutionIdPattern)]).optional(),
    status: z.enum(ideaStatuses).optional(),
});

/** One cap for the editor, the API and the table, so a merged entry always stays editable. */
export const journalLimits = { title: 140, body: 200_000, tag: 40, tags: 64 } as const;

const isCalendarDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** A local calendar day, `YYYY-MM-DD`. A day can hold any number of daily notes. */
export const entryDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate, 'Not a calendar date.');

const journalTagsSchema = z.array(z.string().trim().min(1).max(journalLimits.tag)).max(journalLimits.tags);
export const noteCategorySchema = z.enum(['home', 'work']).nullable();
export type NoteCategory = z.infer<typeof noteCategorySchema>;

export const journalMutationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('save'),
            mutationId: z.uuid(),
            /** The note's identity. Clients from before multiple daily notes omit it; see resolveLegacyNote. */
            id: z.uuid().optional(),
            entryDate: entryDateSchema,
            /** The version this edit was based on; 0 when the device had not seen the entry. */
            baseVersion: z.number().int().min(0),
            title: z.string().trim().max(journalLimits.title).optional(),
            body: z.string().trim().min(1).max(journalLimits.body),
            tags: journalTagsSchema,
            category: noteCategorySchema.optional(),
            updatedAt: isoTimestamp,
            /** The device's local `mm/dd/yyyy HH:mm`, used in the separator when an edit is merged. */
            editedLabel: z.string().regex(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/),
        })
        .strict(),
    z
        .object({
            kind: z.literal('delete'),
            mutationId: z.uuid(),
            id: z.uuid().optional(),
            entryDate: entryDateSchema,
            baseVersion: z.number().int().min(1),
            category: noteCategorySchema.optional(),
        })
        .strict(),
]);

export type JournalMutation = z.infer<typeof journalMutationSchema>;
export type JournalSave = Extract<JournalMutation, { kind: 'save' }>;

export interface ServerJournalEntry {
    id: string;
    entryDate: string;
    /** Empty when the note has no title; the card then shows its first line. */
    title: string;
    body: string;
    tags: string[];
    category?: NoteCategory;
    /** A deleted entry stays as a tombstone so its version keeps counting up. */
    deleted: boolean;
    createdAt: string;
    updatedAt: string;
    version: number;
}

export type JournalOutcome = 'created' | 'updated' | 'merged' | 'deleted' | 'kept';

export interface JournalReceipt {
    outcome: JournalOutcome;
    /** The note the mutation landed on; for a legacy mutation the server chose it. */
    id: string;
    entryDate: string;
    category?: NoteCategory;
    resultVersion: number;
}

export interface JournalMutationResponse extends JournalReceipt {
    entry: ServerJournalEntry | null;
}

export const globalNoteLimits = {
    title: limits.title,
    body: journalLimits.body,
    tag: journalLimits.tag,
    tags: journalLimits.tags,
} as const;

const globalNoteFieldsSchema = z
    .object({
        title: z.string().trim().min(1).max(globalNoteLimits.title),
        body: z.string().max(globalNoteLimits.body),
        tags: journalTagsSchema,
        updatedAt: isoTimestamp,
    })
    .strict();

export const globalNoteMutationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('save'),
            mutationId: z.uuid(),
            id: z.uuid(),
            baseVersion: z.number().int().min(0),
            ...globalNoteFieldsSchema.shape,
            // Older queued saves may still contain this field; the server ignores it.
            pinned: z.boolean().optional(),
            editedLabel: z.string().regex(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/),
        })
        .strict(),
    z
        .object({
            kind: z.literal('delete'),
            mutationId: z.uuid(),
            id: z.uuid(),
            baseVersion: z.number().int().min(1),
        })
        .strict(),
]);

export type GlobalNoteMutation = z.infer<typeof globalNoteMutationSchema>;
export type GlobalNoteSave = Extract<GlobalNoteMutation, { kind: 'save' }>;

export interface ServerGlobalNote extends z.infer<typeof globalNoteFieldsSchema> {
    id: string;
    deleted: boolean;
    createdAt: string;
    version: number;
}

export interface GlobalNoteReceipt {
    outcome: JournalOutcome;
    id: string;
    resultVersion: number;
}

export interface GlobalNoteMutationResponse extends GlobalNoteReceipt {
    note: ServerGlobalNote | null;
}

export const globalNoteQuerySchema = z.object({ includeDeleted: z.enum(['true', 'false']).optional() }).strict();

export const journalQuerySchema = z
    .object({
        from: entryDateSchema.optional(),
        to: entryDateSchema.optional(),
        tag: z.string().trim().min(1).max(journalLimits.tag).optional(),
        includeDeleted: z.enum(['true', 'false']).optional(),
    })
    .strict();

export type JournalQuery = z.infer<typeof journalQuerySchema>;

export const themePreferenceSchema = z.object({ theme: z.enum(['system', 'light', 'midnight']) }).strict();

export const THEME_COOKIE = 'the-workbench.theme';
