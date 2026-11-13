BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 7
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 7 is required';
    END IF;
END $$;

-- Dated comments added under a daily note after it was written. Existing tables are unchanged.
-- note_id has no foreign key: a comment can sync before the offline note it belongs to.
CREATE TABLE public.journal_comments (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL,
    body TEXT NOT NULL CHECK (length(body) <= 20000),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE INDEX journal_comments_note ON public.journal_comments (note_id, created_at);

-- Permanent receipts keep retries once-only.
CREATE TABLE public.journal_comment_mutations (
    mutation_id UUID PRIMARY KEY,
    comment_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'merged', 'deleted', 'kept')),
    result_version INTEGER NOT NULL CHECK (result_version >= 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- New tables get no automatic runtime privileges; match the runtime grant plan.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sd_the_workbench_runtime') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_comments, public.journal_comment_mutations
            TO sd_the_workbench_runtime;
    END IF;
END $$;

UPDATE public.solutiondeploy_schema SET version = 8 WHERE app_id = 'the-workbench' AND version = 7;
COMMIT;
