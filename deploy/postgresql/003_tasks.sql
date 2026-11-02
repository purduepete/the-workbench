-- Apply through the reviewed migration identity, then re-run the runtime grant plan.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 2
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 2 is required';
    END IF;
END $$;
CREATE TABLE public.tasks (
    id UUID PRIMARY KEY,
    task_date DATE NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('home', 'work')),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
    body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL CHECK (position >= 0),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE INDEX tasks_day_category_order ON public.tasks (task_date, category, deleted, position, id);
-- Permanent receipts keep retries once-only, including stale actions that kept a row.
CREATE TABLE public.task_mutations (
    mutation_id UUID PRIMARY KEY,
    task_date DATE NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'completed', 'deleted', 'reordered', 'kept')),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
UPDATE public.solutiondeploy_schema SET version = 3 WHERE app_id = 'the-workbench' AND version = 2;
COMMIT;
