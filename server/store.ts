import type { Pool, PoolClient } from 'pg';
import type { IdeaFields, Mutation, MutationReceipt, MutationResponse, ServerIdea } from '../shared/contracts.js';
import { limits } from '../shared/contracts.js';

export const SCHEMA_VERSION = 1;

export interface IdeasStore {
    list(): Promise<ServerIdea[]>;
    /** Applies a mutation once. Repeating a mutationId returns the first receipt without writing again. */
    apply(mutation: Mutation): Promise<MutationResponse>;
    ready(): Promise<void>;
}

export const copyTitle = (title: string) => `${title.slice(0, limits.title - 7)} (copy)`;

export class MemoryIdeasStore implements IdeasStore {
    private readonly ideas = new Map<string, ServerIdea>();
    private readonly receipts = new Map<string, MutationReceipt>();
    failing = false;

    async list(): Promise<ServerIdea[]> {
        this.check();
        return [...this.ideas.values()].map((idea) => ({ ...idea, tags: [...idea.tags] }));
    }

    async apply(mutation: Mutation): Promise<MutationResponse> {
        this.check();
        const receipt = this.receipts.get(mutation.mutationId) ?? this.write(mutation);
        this.receipts.set(mutation.mutationId, receipt);
        const idea = this.ideas.get(receipt.resultId);
        return { ...receipt, idea: idea ? { ...idea, tags: [...idea.tags] } : null };
    }

    async ready(): Promise<void> {
        this.check();
    }

    private check() {
        if (this.failing) throw new Error('Memory store is set to fail.');
    }

    private insert(id: string, createdAt: string, fields: IdeaFields): number {
        const existing = this.ideas.get(id);
        if (existing) return existing.version;
        this.ideas.set(id, { id, createdAt, version: 1, ...fields, tags: [...fields.tags] });
        return 1;
    }

    private write(mutation: Mutation): MutationReceipt {
        if (mutation.kind === 'create') {
            const version = this.insert(mutation.id, mutation.createdAt, mutation.fields);
            return { outcome: 'created', resultId: mutation.id, resultVersion: version };
        }
        if (mutation.kind === 'delete') {
            this.ideas.delete(mutation.id);
            return { outcome: 'deleted', resultId: mutation.id, resultVersion: 0 };
        }
        const current = this.ideas.get(mutation.id);
        if (current && current.version === mutation.baseVersion) {
            const version = current.version + 1;
            this.ideas.set(mutation.id, { ...current, ...mutation.fields, tags: [...mutation.fields.tags], version });
            return { outcome: 'updated', resultId: mutation.id, resultVersion: version };
        }
        const fields = { ...mutation.fields, title: copyTitle(mutation.fields.title) };
        const version = this.insert(mutation.copyId, new Date().toISOString(), fields);
        return { outcome: 'copied', resultId: mutation.copyId, resultVersion: version };
    }
}

interface IdeaRow {
    id: string;
    title: string;
    body: string;
    tags: string[];
    pinned: boolean;
    archived: boolean;
    solution: string | null;
    status: IdeaFields['status'];
    created_at: Date;
    updated_at: Date;
    version: number;
}

const ideaColumns = 'id, title, body, tags, pinned, archived, solution, status, created_at, updated_at, version';

const toIdea = (row: IdeaRow): ServerIdea => ({
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    pinned: row.pinned,
    archived: row.archived,
    solution: row.solution,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
});

interface ReceiptRow {
    outcome: MutationReceipt['outcome'];
    result_id: string;
    result_version: number;
}

const isDuplicateReceipt = (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === 'applied_mutations_pkey';

export class PostgresIdeasStore implements IdeasStore {
    constructor(private readonly pool: Pool) {}

    async list(): Promise<ServerIdea[]> {
        const result = await this.pool.query<IdeaRow>(
            `SELECT ${ideaColumns} FROM public.ideas ORDER BY updated_at DESC, id`
        );
        return result.rows.map(toIdea);
    }

    async apply(mutation: Mutation): Promise<MutationResponse> {
        let receipt: MutationReceipt;
        try {
            receipt = await this.transaction(mutation);
        } catch (error) {
            // A concurrent retry of the same mutation committed first; this attempt rolled back.
            if (!isDuplicateReceipt(error)) throw error;
            const prior = await this.receipt(this.pool, mutation.mutationId);
            if (!prior) throw error;
            receipt = prior;
        }
        const row = await this.pool.query<IdeaRow>(`SELECT ${ideaColumns} FROM public.ideas WHERE id = $1`, [
            receipt.resultId,
        ]);
        return { ...receipt, idea: row.rows[0] ? toIdea(row.rows[0]) : null };
    }

    async ready(): Promise<void> {
        const result = await this.pool.query<{ version: number }>(
            "SELECT version FROM public.solutiondeploy_schema WHERE app_id = 'idea-notes'"
        );
        if (result.rows[0]?.version !== SCHEMA_VERSION)
            throw new Error(`Idea Notes schema version is not ${SCHEMA_VERSION}.`);
        await this.pool.query('SELECT id FROM public.ideas LIMIT 1');
        await this.pool.query('SELECT mutation_id FROM public.applied_mutations LIMIT 1');
    }

    private async receipt(db: Pool | PoolClient, mutationId: string): Promise<MutationReceipt | null> {
        const result = await db.query<ReceiptRow>(
            'SELECT outcome, result_id, result_version FROM public.applied_mutations WHERE mutation_id = $1',
            [mutationId]
        );
        const row = result.rows[0];
        return row ? { outcome: row.outcome, resultId: row.result_id, resultVersion: row.result_version } : null;
    }

    private async insert(client: PoolClient, id: string, createdAt: string | null, fields: IdeaFields) {
        const inserted = await client.query<{ version: number }>(
            `INSERT INTO public.ideas
                 (id, title, body, tags, pinned, archived, solution, status, created_at, updated_at, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, CURRENT_TIMESTAMP), $10, 1)
             ON CONFLICT (id) DO NOTHING RETURNING version`,
            [
                id,
                fields.title,
                fields.body,
                fields.tags,
                fields.pinned,
                fields.archived,
                fields.solution,
                fields.status,
                createdAt,
                fields.updatedAt,
            ]
        );
        if (inserted.rows[0]) return inserted.rows[0].version;
        const existing = await client.query<{ version: number }>('SELECT version FROM public.ideas WHERE id = $1', [
            id,
        ]);
        return existing.rows[0]?.version ?? 1;
    }

    private async write(client: PoolClient, mutation: Mutation): Promise<MutationReceipt> {
        if (mutation.kind === 'create') {
            const version = await this.insert(client, mutation.id, mutation.createdAt, mutation.fields);
            return { outcome: 'created', resultId: mutation.id, resultVersion: version };
        }
        if (mutation.kind === 'delete') {
            await client.query('DELETE FROM public.ideas WHERE id = $1', [mutation.id]);
            return { outcome: 'deleted', resultId: mutation.id, resultVersion: 0 };
        }
        const { fields } = mutation;
        const updated = await client.query<{ version: number }>(
            `UPDATE public.ideas
             SET title = $3, body = $4, tags = $5, pinned = $6, archived = $7, solution = $8, status = $9,
                 updated_at = $10, version = version + 1
             WHERE id = $1 AND version = $2 RETURNING version`,
            [
                mutation.id,
                mutation.baseVersion,
                fields.title,
                fields.body,
                fields.tags,
                fields.pinned,
                fields.archived,
                fields.solution,
                fields.status,
                fields.updatedAt,
            ]
        );
        if (updated.rows[0])
            return { outcome: 'updated', resultId: mutation.id, resultVersion: updated.rows[0].version };
        const version = await this.insert(client, mutation.copyId, null, { ...fields, title: copyTitle(fields.title) });
        return { outcome: 'copied', resultId: mutation.copyId, resultVersion: version };
    }

    private async transaction(mutation: Mutation): Promise<MutationReceipt> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const prior = await this.receipt(client, mutation.mutationId);
            const receipt = prior ?? (await this.write(client, mutation));
            if (!prior) {
                await client.query(
                    `INSERT INTO public.applied_mutations (mutation_id, idea_id, outcome, result_id, result_version)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [mutation.mutationId, mutation.id, receipt.outcome, receipt.resultId, receipt.resultVersion]
                );
            }
            await client.query('COMMIT');
            return receipt;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }
}
