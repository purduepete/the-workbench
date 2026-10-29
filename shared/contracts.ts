import { z } from 'zod';
import { ideaStatuses, statusForSolution } from './status.js';

export { ideaStatuses } from './status.js';
export type { IdeaStatus } from './status.js';

export const limits = { title: 140, body: 20_000, tag: 40, tags: 12 } as const;

const isoTimestamp = z.iso.datetime({ offset: true });

/** Solution ids match the hyphenated ids in Solution Directory's sites.json. */
export const solutionIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const ideaFieldsSchema = z
    .object({
        title: z.string().trim().min(1).max(limits.title),
        body: z.string().max(limits.body),
        tags: z.array(z.string().trim().min(1).max(limits.tag)).max(limits.tags),
        pinned: z.boolean(),
        archived: z.boolean(),
        // Defaults keep changes queued by an older client valid.
        solution: z.string().regex(solutionIdPattern).nullable().default(null),
        status: z.enum(ideaStatuses).default('open'),
        updatedAt: isoTimestamp,
    })
    .strict()
    .transform((fields) => ({ ...fields, status: statusForSolution(fields.solution, fields.status) }));

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

export const themePreferenceSchema = z.object({ theme: z.enum(['system', 'light', 'midnight']) }).strict();

export const THEME_COOKIE = 'idea-notes.theme';
