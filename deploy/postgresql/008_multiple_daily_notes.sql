BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.solutiondeploy_schema WHERE app_id = 'the-workbench' AND version = 6
    ) THEN
        RAISE EXCEPTION 'The Workbench schema version 6 is required';
    END IF;
END $$;

-- A day can now hold any number of daily notes. Each existing day-and-section row becomes one note with its own id
-- and an empty title. Bodies, tags, sections, timestamps, versions and tombstones are unchanged.
ALTER TABLE public.journal_entries
    ADD COLUMN id UUID,
    ADD COLUMN title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 140);
UPDATE public.journal_entries SET id = gen_random_uuid();
ALTER TABLE public.journal_entries
    ALTER COLUMN id SET NOT NULL,
    DROP CONSTRAINT journal_entries_pkey,
    ADD PRIMARY KEY (id);
CREATE INDEX journal_entries_day ON public.journal_entries (entry_date, category);

-- A retried mutation must return the note it first landed on. Old receipts point at their day and section row, which
-- each held exactly one note before this migration.
ALTER TABLE public.journal_mutations ADD COLUMN note_id UUID;
UPDATE public.journal_mutations AS mutation
SET note_id = entry.id
FROM public.journal_entries AS entry
WHERE entry.entry_date = mutation.entry_date AND entry.category = mutation.category;
-- A kept change against a day that never had a row has no note; it gets an id that matches nothing, as before.
UPDATE public.journal_mutations SET note_id = gen_random_uuid() WHERE note_id IS NULL;
ALTER TABLE public.journal_mutations ALTER COLUMN note_id SET NOT NULL;

UPDATE public.solutiondeploy_schema SET version = 7 WHERE app_id = 'the-workbench' AND version = 6;
COMMIT;
