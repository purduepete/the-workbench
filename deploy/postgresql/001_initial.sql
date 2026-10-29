-- Apply through the reviewed migration identity with the application owner role.
BEGIN;
CREATE TABLE public.solutiondeploy_schema (
    app_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE public.solutiondeploy_import (
    app_id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    validation JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.ideas (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
    body TEXT NOT NULL CHECK (length(body) <= 20000),
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12),
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0)
);
-- One receipt per client mutation, kept permanently so any later retry returns the original result.
CREATE TABLE public.applied_mutations (
    mutation_id UUID PRIMARY KEY,
    idea_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'updated', 'copied', 'deleted')),
    result_id UUID NOT NULL,
    result_version INTEGER NOT NULL CHECK (result_version >= 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.solutiondeploy_schema(app_id, version) VALUES ('idea-notes', 1);
COMMIT;
