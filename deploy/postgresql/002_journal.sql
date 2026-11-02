-- Apply through the reviewed migration identity with the application owner role.
-- Re-run the Manage-Postgres.ps1 grant plan afterwards so the runtime role can read and write the new tables.
BEGIN;
-- One personal journal entry per local calendar day. A deleted entry stays as a tombstone so its version keeps counting.
CREATE TABLE public.journal_entries (
    entry_date DATE PRIMARY KEY,
    body TEXT NOT NULL CHECK (length(body) <= 200000),
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 64),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    CHECK (deleted OR length(body) >= 1)
);
-- One receipt per client journal mutation, kept permanently so any later retry returns the original result.
CREATE TABLE public.journal_mutations (
    mutation_id UUID PRIMARY KEY,
    entry_date DATE NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'merged', 'deleted', 'kept')),
    result_version INTEGER NOT NULL CHECK (result_version >= 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Date-agnostic personal notes have their own identities and mutation receipts.
CREATE TABLE public.global_notes (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) <= 140),
    body TEXT NOT NULL CHECK (length(body) <= 200000),
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 64),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    CHECK (deleted OR length(title) >= 1)
);
CREATE TABLE public.global_note_mutations (
    mutation_id UUID PRIMARY KEY,
    note_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'merged', 'deleted', 'kept')),
    result_version INTEGER NOT NULL CHECK (result_version >= 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
UPDATE public.solutiondeploy_schema SET version = 2 WHERE app_id = 'the-workbench' AND version = 1;
COMMIT;
