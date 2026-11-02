import { z } from 'zod';
import { entryDateSchema } from './contracts.js';

export const taskCategories = ['home', 'work'] as const;
export type TaskCategory = (typeof taskCategories)[number];
export const taskLimits = { title: 140, body: 200_000 } as const;

export interface ServerTask {
    id: string;
    taskDate: string;
    category: TaskCategory;
    title: string;
    body: string;
    completed: boolean;
    position: number;
    deleted: boolean;
    createdAt: string;
    updatedAt: string;
    version: number;
}

const uuid = z.uuid().transform((value) => value.toLowerCase());
const identity = { mutationId: uuid, id: uuid, taskDate: entryDateSchema };
const updatedAt = z.iso.datetime({ offset: true });

export const taskMutationSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('save'),
            ...identity,
            category: z.enum(taskCategories),
            title: z.string().trim().min(1).max(taskLimits.title),
            body: z.string().max(taskLimits.body).default(''),
            updatedAt,
        })
        .strict(),
    z
        .object({
            kind: z.literal('complete'),
            ...identity,
            completed: z.boolean(),
            updatedAt,
        })
        .strict(),
    z.object({ kind: z.literal('delete'), ...identity }).strict(),
    z
        .object({
            kind: z.literal('reorder'),
            mutationId: uuid,
            taskDate: entryDateSchema,
            category: z.enum(taskCategories),
            orderedIds: z
                .array(uuid)
                .max(10_000)
                .refine((ids) => new Set(ids).size === ids.length, 'Task ids must be unique.'),
        })
        .strict(),
]);

export type TaskMutation = z.infer<typeof taskMutationSchema>;
export type TaskOutcome = 'created' | 'updated' | 'completed' | 'deleted' | 'reordered' | 'kept';
export interface TaskMutationResponse {
    outcome: TaskOutcome;
    taskDate: string;
    tasks: ServerTask[];
}

export const taskQuerySchema = z
    .object({
        from: entryDateSchema.optional(),
        to: entryDateSchema.optional(),
        category: z.enum(taskCategories).optional(),
        includeDeleted: z.enum(['true', 'false']).optional(),
    })
    .strict();
