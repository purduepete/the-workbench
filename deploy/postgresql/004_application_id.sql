-- Rename the persistent SolutionDeploy application identifier without changing schema version 3.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema
        WHERE app_id = 'idea-notes' AND version = 3
    ) THEN
        RAISE EXCEPTION 'Idea Notes schema version 3 is required';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench'
    ) THEN
        RAISE EXCEPTION 'The Workbench application id already exists';
    END IF;
END $$;
UPDATE public.solutiondeploy_schema
SET app_id = 'the-workbench'
WHERE app_id = 'idea-notes' AND version = 3;
UPDATE public.solutiondeploy_import
SET app_id = 'the-workbench'
WHERE app_id = 'idea-notes';
COMMIT;
