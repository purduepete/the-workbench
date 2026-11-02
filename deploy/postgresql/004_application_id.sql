-- Set the persistent SolutionDeploy application identifier to the-workbench without changing schema version 3.
-- Databases created after the rename already carry the-workbench, so both updates change nothing there.
BEGIN;
DO $$
BEGIN
    IF (SELECT count(*) FROM public.solutiondeploy_schema) <> 1
        OR NOT EXISTS (SELECT 1 FROM public.solutiondeploy_schema WHERE version = 3) THEN
        RAISE EXCEPTION 'Exactly one schema ledger row at version 3 is required';
    END IF;
    IF (SELECT count(*) FROM public.solutiondeploy_import) > 1 THEN
        RAISE EXCEPTION 'At most one import receipt is expected';
    END IF;
END $$;
UPDATE public.solutiondeploy_schema
SET app_id = 'the-workbench'
WHERE version = 3 AND app_id <> 'the-workbench';
UPDATE public.solutiondeploy_import
SET app_id = 'the-workbench'
WHERE app_id <> 'the-workbench';
COMMIT;