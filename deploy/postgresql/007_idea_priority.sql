BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 5
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 5 is required';
    END IF;
END $$;

-- Existing ideas become High. Contents, status, pins, versions and receipts are unchanged.
ALTER TABLE public.ideas
    ADD COLUMN priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('high', 'medium', 'low'));

UPDATE public.solutiondeploy_schema SET version = 6 WHERE app_id = 'the-workbench' AND version = 5;
COMMIT;
