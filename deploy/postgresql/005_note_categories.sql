BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 3
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 3 is required';
    END IF;
END $$;
ALTER TABLE public.journal_entries
    ADD COLUMN category TEXT CHECK (category IN ('home', 'work'));
UPDATE public.solutiondeploy_schema SET version = 4 WHERE app_id = 'the-workbench' AND version = 3;
COMMIT;
