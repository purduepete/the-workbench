import { z } from 'zod';

export const limits = { title: 140, body: 20_000, tag: 40, tags: 12 } as const;

const isoTimestamp = z.iso.datetime({ offset: true });

export const ideaFieldsSchema = z
    .object({
        title: z.string().trim().min(1).max(limits.title),
        body: z.string().max(limits.body),
        tags: z.array(z.string().trim().min(1).max(limits.tag)).max(limits.tags),
        pinned: z.boolean(),
        archived: z.boolean(),
        updatedAt: isoTimestamp,
    })
    .strict();

export type IdeaFields = z.infer<typeof ideaFieldsSchema>;

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
            fields: ideaFieldsSchema,
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

export const themePreferenceSchema = z.object({ theme: z.enum(['system', 'light', 'midnight']) }).strict();

export const THEME_COOKIE = 'idea-notes.theme';
