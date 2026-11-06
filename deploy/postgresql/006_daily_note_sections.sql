BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 4
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 4 is required';
    END IF;
END $$;

ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_category_check;
UPDATE public.journal_entries SET category = 'unclassified' WHERE category IS NULL;
ALTER TABLE public.journal_entries
    ALTER COLUMN category SET NOT NULL,
    ADD CONSTRAINT journal_entries_category_check CHECK (category IN ('home', 'work', 'unclassified')),
    DROP CONSTRAINT journal_entries_pkey,
    ADD PRIMARY KEY (entry_date, category);

ALTER TABLE public.journal_mutations ADD COLUMN category TEXT;
-- Old retries returned the current day row. Keep them attached to that retained section.
UPDATE public.journal_mutations AS mutation
SET category = COALESCE(entry.category, 'unclassified')
FROM public.journal_entries AS entry
WHERE entry.entry_date = mutation.entry_date;
UPDATE public.journal_mutations SET category = 'unclassified' WHERE category IS NULL;
ALTER TABLE public.journal_mutations
    ALTER COLUMN category SET NOT NULL,
    ADD CONSTRAINT journal_mutations_category_check CHECK (category IN ('home', 'work', 'unclassified'));

UPDATE public.solutiondeploy_schema SET version = 5 WHERE app_id = 'the-workbench' AND version = 4;
COMMIT;
