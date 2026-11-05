import type { Pool, PoolClient } from 'pg';
import type {
    IdeaFields,
    GlobalNoteMutation,
    GlobalNoteMutationResponse,
    GlobalNoteReceipt,
    JournalMutation,
    JournalMutationResponse,
    JournalReceipt,
    Mutation,
    MutationReceipt,
    MutationResponse,
    ServerIdea,
    ServerGlobalNote,
    ServerJournalEntry,
    NoteCategory,
} from '../shared/contracts.js';
import { limits } from '../shared/contracts.js';
import { JournalOverflowError, resolveGlobalSave, resolveSave } from '../shared/journal.js';
import type { CurrentEntry } from '../shared/journal.js';
import type { ServerTask, TaskMutation, TaskMutationResponse, TaskOutcome } from '../shared/tasks.js';

export const SCHEMA_VERSION = 4;

export interface IdeasStore {
    list(): Promise<ServerIdea[]>;
    /** Applies a mutation once. Repeating a mutationId returns the first receipt without writing again. */
    apply(mutation: Mutation): Promise<MutationResponse>;
    ready(): Promise<void>;
    listDisabledSolutions(): Promise<string[]>;
    setSolutionDisabled(id: string, disabled: boolean): Promise<void>;
    /** Every journal entry, tombstones included, newest day first. */
    listJournal(): Promise<ServerJournalEntry[]>;
    /** Applies a journal change once, like `apply`. Throws JournalOverflowError when a merge would exceed the limit. */
    applyJournal(mutation: JournalMutation): Promise<JournalMutationResponse>;
    listGlobalNotes(): Promise<ServerGlobalNote[]>;
    applyGlobalNote(mutation: GlobalNoteMutation): Promise<GlobalNoteMutationResponse>;
    listTasks(): Promise<ServerTask[]>;
    applyTask(mutation: TaskMutation): Promise<TaskMutationResponse>;
}

export const copyTitle = (title: string) => `${title.slice(0, limits.title - 7)} (copy)`;

const copyEntry = (entry: ServerJournalEntry): ServerJournalEntry => ({ ...entry, tags: [...entry.tags] });
const copyGlobalNote = (note: ServerGlobalNote): ServerGlobalNote => ({ ...note, tags: [...note.tags] });

type TaskReceipt = Pick<TaskMutationResponse, 'outcome' | 'taskDate'>;
const sortTasks = (tasks: ServerTask[]) =>
    tasks.sort(
        (a, b) =>
            b.taskDate.localeCompare(a.taskDate) ||
            a.category.localeCompare(b.category) ||
            a.position - b.position ||
            a.id.localeCompare(b.id)
    );

/** Both stores apply the same field-specific changes to a locked day's rows. */
function changeTasks(tasks: ServerTask[], mutation: TaskMutation, existing: ServerTask | undefined): TaskOutcome {
    const appendPosition = (category: ServerTask['category']) =>
        tasks.reduce((maximum, task) => (task.category === category ? Math.max(maximum, task.position) : maximum), -1) +
        1;
    if (mutation.kind === 'reorder') {
        const active = sortTasks(tasks.filter((task) => !task.deleted && task.category === mutation.category));
        const byId = new Map(active.map((task) => [task.id, task]));
        if (mutation.orderedIds.some((id) => !byId.has(id))) return 'kept';
        const provided = new Set(mutation.orderedIds);
        const ordered = [
            ...mutation.orderedIds.map((id) => byId.get(id)!),
            ...active.filter((task) => !provided.has(task.id)),
        ];
        const now = new Date().toISOString();
        ordered.forEach((task, position) => {
            if (task.position === position) return;
            task.position = position;
            task.updatedAt = now;
            task.version += 1;
        });
        return 'reordered';
    }
    if (existing && (existing.deleted || existing.taskDate !== mutation.taskDate)) return 'kept';
    const current = tasks.find((task) => task.id === mutation.id);
    if (mutation.kind === 'save') {
        if (!current) {
            tasks.push({
                id: mutation.id,
                taskDate: mutation.taskDate,
                category: mutation.category,
                title: mutation.title,
                body: mutation.body,
                completed: false,
                deleted: false,
                position: appendPosition(mutation.category),
                createdAt: mutation.updatedAt,
                updatedAt: mutation.updatedAt,
                version: 1,
            });
            return 'created';
        }
        if (current.category !== mutation.category) current.position = appendPosition(mutation.category);
        current.category = mutation.category;
        current.title = mutation.title;
        current.body = mutation.body;
        current.updatedAt = mutation.updatedAt;
        current.version += 1;
        return 'updated';
    }
    if (!current) return 'kept';
    if (mutation.kind === 'complete') {
        if (current.completed === mutation.completed) return 'kept';
        current.completed = mutation.completed;
        current.updatedAt = mutation.updatedAt;
        current.version += 1;
        return 'completed';
    }
    current.deleted = true;
    current.updatedAt = new Date().toISOString();
    current.version += 1;
    return 'deleted';
}

export class MemoryIdeasStore implements IdeasStore {
    private readonly ideas = new Map<string, ServerIdea>();
    private readonly receipts = new Map<string, MutationReceipt>();
    private readonly disabledSolutions = new Set<string>();
    private readonly journal = new Map<string, ServerJournalEntry>();
    private readonly journalReceipts = new Map<string, JournalReceipt>();
    private readonly globalNotes = new Map<string, ServerGlobalNote>();
    private readonly globalNoteReceipts = new Map<string, GlobalNoteReceipt>();
    private readonly tasks = new Map<string, ServerTask>();
    private readonly taskReceipts = new Map<string, TaskReceipt>();
    failing = false;

    async listTasks(): Promise<ServerTask[]> {
        this.check();
        return sortTasks([...this.tasks.values()].map((task) => ({ ...task })));
    }

    async applyTask(mutation: TaskMutation): Promise<TaskMutationResponse> {
        this.check();
        let receipt = this.taskReceipts.get(mutation.mutationId);
        if (!receipt) {
            const tasks = [...this.tasks.values()].filter((task) => task.taskDate === mutation.taskDate);
            const existing = mutation.kind === 'reorder' ? undefined : this.tasks.get(mutation.id);
            const outcome = changeTasks(tasks, mutation, existing);
            for (const task of tasks) this.tasks.set(task.id, task);
            receipt = { outcome, taskDate: mutation.taskDate };
            this.taskReceipts.set(mutation.mutationId, receipt);
        }
        return { ...receipt, tasks: (await this.listTasks()).filter((task) => task.taskDate === receipt.taskDate) };
    }

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

    async listDisabledSolutions(): Promise<string[]> {
        this.check();
        return [...this.disabledSolutions].sort();
    }

    async setSolutionDisabled(id: string, disabled: boolean): Promise<void> {
        this.check();
        if (disabled) this.disabledSolutions.add(id);
        else this.disabledSolutions.delete(id);
    }

    private check() {
        if (this.failing) throw new Error('Memory store is set to fail.');
    }

    async listJournal(): Promise<ServerJournalEntry[]> {
        this.check();
        return [...this.journal.values()].map(copyEntry).sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    }

    async applyJournal(mutation: JournalMutation): Promise<JournalMutationResponse> {
        this.check();
        const receipt = this.journalReceipts.get(mutation.mutationId) ?? this.writeJournal(mutation);
        this.journalReceipts.set(mutation.mutationId, receipt);
        const entry = this.journal.get(receipt.entryDate);
        return { ...receipt, entry: entry ? copyEntry(entry) : null };
    }

    private writeJournal(mutation: JournalMutation): JournalReceipt {
        const { entryDate } = mutation;
        const current = this.journal.get(entryDate);
        if (mutation.kind === 'delete') {
            if (!current || current.deleted || current.version !== mutation.baseVersion)
                return { outcome: 'kept', entryDate, resultVersion: current?.version ?? 0 };
            const version = current.version + 1;
            this.journal.set(entryDate, {
                ...current,
                body: '',
                tags: [],
                deleted: true,
                updatedAt: new Date().toISOString(),
                version,
            });
            return { outcome: 'deleted', entryDate, resultVersion: version };
        }

        const decision = resolveSave(current ?? null, mutation);
        if (decision.outcome === 'overflow') throw new JournalOverflowError();
        if (!current) {
            this.journal.set(entryDate, {
                entryDate,
                body: decision.body,
                tags: [...decision.tags],
                category: decision.category,
                deleted: false,
                createdAt: mutation.updatedAt,
                updatedAt: mutation.updatedAt,
                version: 1,
            });
            return { outcome: 'created', entryDate, resultVersion: 1 };
        }
        if (!decision.bump) return { outcome: decision.outcome, entryDate, resultVersion: current.version };
        const version = current.version + 1;
        this.journal.set(entryDate, {
            ...current,
            body: decision.body,
            tags: [...decision.tags],
            category: decision.category,
            deleted: false,
            updatedAt: mutation.updatedAt,
            version,
        });
        return { outcome: decision.outcome, entryDate, resultVersion: version };
    }

    async listGlobalNotes(): Promise<ServerGlobalNote[]> {
        this.check();
        return [...this.globalNotes.values()]
            .map(copyGlobalNote)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    }

    async applyGlobalNote(mutation: GlobalNoteMutation): Promise<GlobalNoteMutationResponse> {
        this.check();
        const receipt = this.globalNoteReceipts.get(mutation.mutationId) ?? this.writeGlobalNote(mutation);
        this.globalNoteReceipts.set(mutation.mutationId, receipt);
        const note = this.globalNotes.get(receipt.id);
        return { ...receipt, note: note ? copyGlobalNote(note) : null };
    }

    private writeGlobalNote(mutation: GlobalNoteMutation): GlobalNoteReceipt {
        const current = this.globalNotes.get(mutation.id);
        if (mutation.kind === 'delete') {
            if (!current || current.deleted || current.version !== mutation.baseVersion)
                return { outcome: 'kept', id: mutation.id, resultVersion: current?.version ?? 0 };
            const version = current.version + 1;
            this.globalNotes.set(mutation.id, {
                ...current,
                body: '',
                tags: [],
                deleted: true,
                updatedAt: new Date().toISOString(),
                version,
            });
            return { outcome: 'deleted', id: mutation.id, resultVersion: version };
        }
        const decision = resolveGlobalSave(current ?? null, mutation);
        if (decision.outcome === 'overflow') throw new JournalOverflowError();
        if (!current || current.deleted) {
            const version = (current?.version ?? 0) + 1;
            this.globalNotes.set(mutation.id, {
                id: mutation.id,
                title: decision.title,
                body: decision.body,
                tags: [...decision.tags],
                updatedAt: mutation.updatedAt,
                createdAt: current?.createdAt ?? mutation.updatedAt,
                deleted: false,
                version,
            });
            return { outcome: 'created', id: mutation.id, resultVersion: version };
        }
        if (!decision.bump) return { outcome: decision.outcome, id: mutation.id, resultVersion: current.version };
        const version = current.version + 1;
        this.globalNotes.set(mutation.id, {
            ...current,
            title: decision.title,
            body: decision.body,
            tags: [...decision.tags],
            deleted: false,
            updatedAt: mutation.updatedAt,
            version,
        });
        return { outcome: decision.outcome, id: mutation.id, resultVersion: version };
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

const isDuplicateReceipt = (error: unknown, constraint = 'applied_mutations_pkey') =>
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === constraint;

interface JournalRow {
    entry_date: string;
    body: string;
    tags: string[];
    category: NoteCategory;
    deleted: boolean;
    created_at: Date;
    updated_at: Date;
    version: number;
}

interface GlobalNoteRow {
    id: string;
    title: string;
    body: string;
    tags: string[];
    deleted: boolean;
    created_at: Date;
    updated_at: Date;
    version: number;
}

const globalNoteColumns = 'id, title, body, tags, deleted, created_at, updated_at, version';

const toGlobalNote = (row: GlobalNoteRow): ServerGlobalNote => ({
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    deleted: row.deleted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
});

// entry_date::text keeps the calendar day as-is; pg would otherwise build a Date at local midnight.
const journalColumns = 'entry_date::text AS entry_date, body, tags, category, deleted, created_at, updated_at, version';

const toJournalEntry = (row: JournalRow): ServerJournalEntry => ({
    entryDate: row.entry_date,
    category: row.category,
    body: row.body,
    tags: row.tags,
    deleted: row.deleted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
});

type TaskRow = Omit<ServerTask, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const taskColumns = `id, task_date::text AS "taskDate", category, title, body, completed, position, deleted,
    created_at AS "createdAt", updated_at AS "updatedAt", version`;
const toTask = (row: TaskRow): ServerTask => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

export class PostgresIdeasStore implements IdeasStore {
    constructor(private readonly pool: Pool) {}

    async listTasks(): Promise<ServerTask[]> {
        const result = await this.pool.query<TaskRow>(
            `SELECT ${taskColumns} FROM public.tasks ORDER BY task_date DESC, category, position, id`
        );
        return result.rows.map(toTask);
    }

    private async taskReceipt(db: Pool | PoolClient, mutationId: string): Promise<TaskReceipt | null> {
        const result = await db.query<TaskReceipt>(
            `SELECT outcome, task_date::text AS "taskDate" FROM public.task_mutations WHERE mutation_id = $1`,
            [mutationId]
        );
        return result.rows[0] ?? null;
    }

    async applyTask(mutation: TaskMutation): Promise<TaskMutationResponse> {
        let receipt: TaskReceipt;
        try {
            receipt = await this.taskTransaction(mutation);
        } catch (error) {
            if (!isDuplicateReceipt(error, 'task_mutations_pkey')) throw error;
            const prior = await this.taskReceipt(this.pool, mutation.mutationId);
            if (!prior) throw error;
            receipt = prior;
        }
        const result = await this.pool.query<TaskRow>(
            `SELECT ${taskColumns} FROM public.tasks WHERE task_date = $1 ORDER BY category, position, id`,
            [receipt.taskDate]
        );
        return { ...receipt, tasks: result.rows.map(toTask) };
    }

    private async taskTransaction(mutation: TaskMutation): Promise<TaskReceipt> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // Category transfers and reorders share the entire day's lock, including first inserts.
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtextextended('the-workbench:tasks:' || $1::text, 0))",
                [mutation.taskDate]
            );
            const prior = await this.taskReceipt(client, mutation.mutationId);
            if (prior) {
                await client.query('COMMIT');
                return prior;
            }
            const result = await client.query<TaskRow>(
                `SELECT ${taskColumns} FROM public.tasks WHERE task_date = $1 FOR UPDATE`,
                [mutation.taskDate]
            );
            const tasks = result.rows.map(toTask);
            const versions = new Map(tasks.map((task) => [task.id, task.version]));
            let existing = mutation.kind === 'reorder' ? undefined : tasks.find((task) => task.id === mutation.id);
            if (mutation.kind !== 'reorder' && !existing) {
                const elsewhere = await client.query<TaskRow>(`SELECT ${taskColumns} FROM public.tasks WHERE id = $1`, [
                    mutation.id,
                ]);
                existing = elsewhere.rows[0] ? toTask(elsewhere.rows[0]) : undefined;
            }
            let outcome = changeTasks(tasks, mutation, existing);
            const added = tasks.find((task) => !versions.has(task.id));
            if (added) {
                const inserted = await client.query(
                    `INSERT INTO public.tasks
                        (id, task_date, category, title, body, completed, position, deleted, created_at, updated_at, version)
                     VALUES ($1, $2, $3, $4, $5, FALSE, $6, FALSE, $7, $7, 1)
                     ON CONFLICT (id) DO NOTHING RETURNING id`,
                    [added.id, added.taskDate, added.category, added.title, added.body, added.position, added.createdAt]
                );
                if (!inserted.rowCount) outcome = 'kept';
            }
            const changed = tasks.filter((task) => versions.has(task.id) && versions.get(task.id) !== task.version);
            if (changed.length) {
                await client.query(
                    `UPDATE public.tasks AS t
                     SET category = c.category, title = c.title, body = c.body, completed = c.completed,
                         position = c.position, deleted = c.deleted, updated_at = c."updatedAt", version = c.version
                     FROM jsonb_to_recordset($1::jsonb) AS c(
                         id uuid, category text, title text, body text, completed boolean, position integer,
                         deleted boolean, "updatedAt" timestamptz, version integer)
                     WHERE t.id = c.id AND t.task_date = $2`,
                    [JSON.stringify(changed), mutation.taskDate]
                );
            }
            const receipt = { outcome, taskDate: mutation.taskDate };
            await client.query(
                'INSERT INTO public.task_mutations (mutation_id, task_date, outcome) VALUES ($1, $2, $3)',
                [mutation.mutationId, receipt.taskDate, receipt.outcome]
            );
            await client.query('COMMIT');
            return receipt;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }

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
            "SELECT version FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench'"
        );
        if (result.rows[0]?.version !== SCHEMA_VERSION)
            throw new Error(`The Workbench schema version is not ${SCHEMA_VERSION}.`);
        await this.pool.query('SELECT id FROM public.ideas LIMIT 1');
        await this.pool.query('SELECT mutation_id FROM public.applied_mutations LIMIT 1');
        await this.pool.query('SELECT solution_id FROM public.disabled_solutions LIMIT 1');
        await this.pool.query('SELECT entry_date, category FROM public.journal_entries LIMIT 1');
        await this.pool.query('SELECT mutation_id FROM public.journal_mutations LIMIT 1');
        await this.pool.query('SELECT id FROM public.global_notes LIMIT 1');
        await this.pool.query('SELECT mutation_id FROM public.global_note_mutations LIMIT 1');
        await this.pool.query('SELECT id FROM public.tasks LIMIT 1');
        await this.pool.query('SELECT mutation_id FROM public.task_mutations LIMIT 1');
    }

    async listJournal(): Promise<ServerJournalEntry[]> {
        const result = await this.pool.query<JournalRow>(
            `SELECT ${journalColumns} FROM public.journal_entries ORDER BY entry_date DESC`
        );
        return result.rows.map(toJournalEntry);
    }

    async applyJournal(mutation: JournalMutation): Promise<JournalMutationResponse> {
        let receipt: JournalReceipt;
        try {
            receipt = await this.journalTransaction(mutation);
        } catch (error) {
            if (!isDuplicateReceipt(error, 'journal_mutations_pkey')) throw error;
            const prior = await this.journalReceipt(this.pool, mutation.mutationId);
            if (!prior) throw error;
            receipt = prior;
        }
        const row = await this.pool.query<JournalRow>(
            `SELECT ${journalColumns} FROM public.journal_entries WHERE entry_date = $1`,
            [receipt.entryDate]
        );
        return { ...receipt, entry: row.rows[0] ? toJournalEntry(row.rows[0]) : null };
    }

    async listGlobalNotes(): Promise<ServerGlobalNote[]> {
        const result = await this.pool.query<GlobalNoteRow>(
            `SELECT ${globalNoteColumns} FROM public.global_notes ORDER BY updated_at DESC, id`
        );
        return result.rows.map(toGlobalNote);
    }

    async applyGlobalNote(mutation: GlobalNoteMutation): Promise<GlobalNoteMutationResponse> {
        let receipt: GlobalNoteReceipt;
        try {
            receipt = await this.globalNoteTransaction(mutation);
        } catch (error) {
            if (!isDuplicateReceipt(error, 'global_note_mutations_pkey')) throw error;
            const prior = await this.globalNoteReceipt(this.pool, mutation.mutationId);
            if (!prior) throw error;
            receipt = prior;
        }
        const row = await this.pool.query<GlobalNoteRow>(
            `SELECT ${globalNoteColumns} FROM public.global_notes WHERE id = $1`,
            [receipt.id]
        );
        return { ...receipt, note: row.rows[0] ? toGlobalNote(row.rows[0]) : null };
    }

    private async globalNoteReceipt(db: Pool | PoolClient, mutationId: string): Promise<GlobalNoteReceipt | null> {
        const result = await db.query<{
            outcome: GlobalNoteReceipt['outcome'];
            note_id: string;
            result_version: number;
        }>(
            `SELECT outcome, note_id, result_version
             FROM public.global_note_mutations WHERE mutation_id = $1`,
            [mutationId]
        );
        const row = result.rows[0];
        return row ? { outcome: row.outcome, id: row.note_id, resultVersion: row.result_version } : null;
    }

    private async lockGlobalNote(client: PoolClient, id: string): Promise<GlobalNoteRow | null> {
        const result = await client.query<GlobalNoteRow>(
            `SELECT ${globalNoteColumns} FROM public.global_notes WHERE id = $1 FOR UPDATE`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    private async writeGlobalNote(client: PoolClient, mutation: GlobalNoteMutation): Promise<GlobalNoteReceipt> {
        let current = await this.lockGlobalNote(client, mutation.id);
        if (mutation.kind === 'delete') {
            if (!current || current.deleted || current.version !== mutation.baseVersion)
                return { outcome: 'kept', id: mutation.id, resultVersion: current?.version ?? 0 };
            const deleted = await client.query<{ version: number }>(
                `UPDATE public.global_notes
                 SET body = '', tags = '{}', deleted = TRUE, updated_at = CURRENT_TIMESTAMP, version = version + 1
                 WHERE id = $1 RETURNING version`,
                [mutation.id]
            );
            return { outcome: 'deleted', id: mutation.id, resultVersion: deleted.rows[0].version };
        }
        const decision = resolveGlobalSave(current, mutation);
        if (decision.outcome === 'overflow') throw new JournalOverflowError();
        if (!current || current.deleted) {
            const inserted = await client.query<{ version: number }>(
                `INSERT INTO public.global_notes
                     (id, title, body, tags, deleted, created_at, updated_at, version)
                 VALUES ($1, $2, $3, $4, FALSE, COALESCE($5::timestamptz, $6), $6, 1)
                 ON CONFLICT (id) DO NOTHING RETURNING version`,
                [
                    mutation.id,
                    decision.title,
                    decision.body,
                    decision.tags,
                    current?.created_at.toISOString() ?? null,
                    mutation.updatedAt,
                ]
            );
            if (inserted.rows[0]) return { outcome: 'created', id: mutation.id, resultVersion: 1 };
            current = await this.lockGlobalNote(client, mutation.id);
        }
        if (!current) throw new Error('Global note disappeared during save.');
        const resolved = resolveGlobalSave(current, mutation);
        if (resolved.outcome === 'overflow') throw new JournalOverflowError();
        if (!resolved.bump) return { outcome: resolved.outcome, id: mutation.id, resultVersion: current.version };
        const updated = await client.query<{ version: number }>(
            `UPDATE public.global_notes
             SET title = $2, body = $3, tags = $4, deleted = FALSE,
                 updated_at = $5, version = version + 1
             WHERE id = $1 RETURNING version`,
            [mutation.id, resolved.title, resolved.body, resolved.tags, mutation.updatedAt]
        );
        return { outcome: resolved.outcome, id: mutation.id, resultVersion: updated.rows[0].version };
    }

    private async globalNoteTransaction(mutation: GlobalNoteMutation): Promise<GlobalNoteReceipt> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const prior = await this.globalNoteReceipt(client, mutation.mutationId);
            const receipt = prior ?? (await this.writeGlobalNote(client, mutation));
            if (!prior) {
                await client.query(
                    `INSERT INTO public.global_note_mutations (mutation_id, note_id, outcome, result_version)
                     VALUES ($1, $2, $3, $4)`,
                    [mutation.mutationId, receipt.id, receipt.outcome, receipt.resultVersion]
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

    private async journalReceipt(db: Pool | PoolClient, mutationId: string): Promise<JournalReceipt | null> {
        const result = await db.query<{
            outcome: JournalReceipt['outcome'];
            entry_date: string;
            result_version: number;
        }>(
            `SELECT outcome, entry_date::text AS entry_date, result_version
             FROM public.journal_mutations WHERE mutation_id = $1`,
            [mutationId]
        );
        const row = result.rows[0];
        return row ? { outcome: row.outcome, entryDate: row.entry_date, resultVersion: row.result_version } : null;
    }

    private async lockEntry(client: PoolClient, entryDate: string): Promise<CurrentEntry | null> {
        const result = await client.query<CurrentEntry>(
            'SELECT body, tags, category, deleted, version FROM public.journal_entries WHERE entry_date = $1 FOR UPDATE',
            [entryDate]
        );
        return result.rows[0] ?? null;
    }

    private async writeJournal(client: PoolClient, mutation: JournalMutation): Promise<JournalReceipt> {
        const { entryDate } = mutation;
        let current = await this.lockEntry(client, entryDate);
        if (mutation.kind === 'delete') {
            if (!current || current.deleted || current.version !== mutation.baseVersion)
                return { outcome: 'kept', entryDate, resultVersion: current?.version ?? 0 };
            const deleted = await client.query<{ version: number }>(
                `UPDATE public.journal_entries
                 SET body = '', tags = '{}', deleted = TRUE, updated_at = CURRENT_TIMESTAMP, version = version + 1
                 WHERE entry_date = $1 RETURNING version`,
                [entryDate]
            );
            return { outcome: 'deleted', entryDate, resultVersion: deleted.rows[0].version };
        }
        if (!current) {
            const decision = resolveSave(null, mutation);
            if (decision.outcome === 'overflow') throw new JournalOverflowError();
            const inserted = await client.query<{ version: number }>(
                `INSERT INTO public.journal_entries
                     (entry_date, body, tags, deleted, created_at, updated_at, version, category)
                 VALUES ($1, $2, $3, FALSE, $4, $4, 1, $5)
                 ON CONFLICT (entry_date) DO NOTHING RETURNING version`,
                [entryDate, decision.body, decision.tags, mutation.updatedAt, decision.category ?? null]
            );
            if (inserted.rows[0]) return { outcome: 'created', entryDate, resultVersion: 1 };
            // Another device's first save for this day committed while this one waited; merge onto it.
            current = await this.lockEntry(client, entryDate);
        }
        const decision = resolveSave(current, mutation);
        if (decision.outcome === 'overflow') throw new JournalOverflowError();
        if (!decision.bump || !current)
            return { outcome: decision.outcome, entryDate, resultVersion: current?.version ?? 0 };
        const updated = await client.query<{ version: number }>(
            `UPDATE public.journal_entries
             SET body = $2, tags = $3, deleted = FALSE, updated_at = $4, version = version + 1, category = $5
             WHERE entry_date = $1 RETURNING version`,
            [entryDate, decision.body, decision.tags, mutation.updatedAt, decision.category ?? null]
        );
        return { outcome: decision.outcome, entryDate, resultVersion: updated.rows[0].version };
    }

    private async journalTransaction(mutation: JournalMutation): Promise<JournalReceipt> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const prior = await this.journalReceipt(client, mutation.mutationId);
            const receipt = prior ?? (await this.writeJournal(client, mutation));
            if (!prior) {
                await client.query(
                    `INSERT INTO public.journal_mutations (mutation_id, entry_date, outcome, result_version)
                     VALUES ($1, $2, $3, $4)`,
                    [mutation.mutationId, receipt.entryDate, receipt.outcome, receipt.resultVersion]
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

    async listDisabledSolutions(): Promise<string[]> {
        const result = await this.pool.query<{ solution_id: string }>(
            'SELECT solution_id FROM public.disabled_solutions ORDER BY solution_id'
        );
        return result.rows.map((row) => row.solution_id);
    }

    async setSolutionDisabled(id: string, disabled: boolean): Promise<void> {
        await this.pool.query(
            disabled
                ? 'INSERT INTO public.disabled_solutions (solution_id) VALUES ($1) ON CONFLICT DO NOTHING'
                : 'DELETE FROM public.disabled_solutions WHERE solution_id = $1',
            [id]
        );
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
