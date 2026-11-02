# Idea Notes

## First entry

The header and page stay laid out but hidden until the first ideas sync and solution list
settle, then enter together over 600ms. A valid saved ideas cache enters immediately.
Sync errors reveal the header and prompt immediately. Refreshes keep the shell visible.
Reduced motion removes the entrance animation.

Idea Notes captures thoughts with tags, pins, search and archive. Notes sync to a PostgreSQL database through a small
Express server. The browser keeps an outbox, so capture works offline and changes upload when the connection returns.

New and edit dialogs focus the dialog on iPhone and iPad, including iPads using a desktop user agent.
The keyboard stays closed until you tap a field. Desktop dialogs focus the title; closing a dialog restores focus
to its opener. Empty idea dialogs close from Cancel, Escape or the backdrop. Editors containing title or body text require Cancel or Save.
On desktop, idea and Manage solutions dialogs open near the top of the page; touch layouts stay centered.

Manage solutions saves checkbox changes immediately and closes with Cancel.
The borderless header Refresh and Theme buttons change fill and text color only while active.
Refresh stays active until ideas, notes, tasks and solutions finish refreshing, including after a failed request.

## Local development

Run `npm install`. Start the API with the in-memory store in one terminal:

```powershell
$env:STORAGE_BACKEND = 'memory'
$env:ALLOWED_ORIGINS = 'http://127.0.0.1:4179,http://127.0.0.1:8802'
npm run build; npm start
```

Then run `npm run dev` in a second terminal. Vite serves the app on port 4179 and proxies `/api` to port 8802. The
memory store loses every note when the server stops.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. `npx playwright test` builds the app and runs
the browser tests against the server on port 4180.

## Sync rules

- Every change carries a `mutationId`. The server records a receipt for each one, in the same transaction as the write,
  and keeps receipts permanently, so a retried request never applies twice.
- An edit based on an old version, or on a deleted note, is saved as a new note titled `<title> (copy)`. Both versions
  are kept.
- Edits made before a change is sent fold into it. Edits made after it is sent queue behind it and rebase onto the result.

## Notes

The header's `Ideas | Notes | Tasks` control switches between pages. `/notes` is a personal journal with one plain-text
entry per day. The entry's date is the local calendar day it was written on and never changes. Entries are grouped by
week (Monday to Sunday), newest week first, with search over the text and tags and a tag filter. The **New note** button
opens today's entry; older entries open from their card. The Calendar button opens a month view with marked entry days;
select any day to open its entry or start a blank one. Saving an empty entry asks to confirm, then deletes it.

Global notes have titles and tags, are not tied to a date, and appear above the journal entries. The global group and
each weekly group can be collapsed independently. The search box and tag filter cover both types of notes. Global note
titles are required, but the body can be empty.

Only the current week starts expanded; older weeks and global notes start collapsed. Modals use Cancel instead of
a close icon and open with an opacity-only fade.

Notes sync offline the same way ideas do, keyed by date instead of an id:

- An edit based on the current version replaces the entry.
- An edit based on an old version is appended below the current text under `--- Edit from mm/dd/yyyy HH:mm ---`, and
  the tags are combined. Text the entry already contains is not appended again.
- A delete based on an old version is ignored and the entry is kept. A delete leaves a tombstone, so a later save for
  that day restores the entry with a higher version.
- An entry holds up to 200,000 characters and 64 tags. If a merge would pass that, the change stays queued with a
  notice and nothing is dropped.

Global notes use UUIDs and the same offline mutation receipts. A current-version save replaces the note. A stale save
merges text and tags, preserving title-only edits in the edit separator. Deleting a stale version keeps the note;
deletion leaves a tombstone so a later save restores it without resetting its version.
An editor containing title or body text stays open on Escape, backdrop click and navigation; use Cancel or Save to close.

## Tasks

`/tasks` keeps Home and Work tasks separate. The selected section is remembered on this browser.
Each task has a title, optional details, a fixed local date and a completion checkbox.
Multiple tasks can share a day. Days are grouped into Monday-to-Sunday weeks, newest first;
only the current week starts expanded.

The calendar marks task days in the selected section. Selecting a populated day expands its week
and scrolls to it; selecting an empty day opens a new task for that date. New task uses today.
Editing a task can move it between Home and Work.

Drag a task's handle to reorder within its day and section, using a mouse or touch.
For keyboard ordering, focus the handle, press Space, use arrow keys, then press Space again.
Escape cancels a drag. Clear search before reordering. Completed tasks stay in place and can be reopened.
Task editors have the same wide desktop layout and draft protection as Notes.

Tasks have their own browser cache and offline outbox. Completion, text edits and ordering are
independent changes; editing text preserves completion. Category moves append to the destination.
Deletes leave tombstones and stale saves cannot restore them. Each mutation has a permanent retry receipt.
If another device moves or deletes a task before a reorder, the server keeps its current list and shows a notice.

## Solutions

An idea can link to one solution from Solution Directory and carries a status: open, in progress or done. Without a
solution, status is automatically N/A and cannot be changed. Selecting a solution changes N/A to Open. The server
reads the directory's `sites.json` from `SOLUTIONS_SOURCE` on every `/api/solutions` request, so a solution added to the
directory appears with no change here. If the directory is down, the server returns the last list it read; the browser
also keeps a copy for offline capture. An idea linked to a solution that later leaves the directory keeps its id.

The settings button beside the solution filter opens Manage solutions. Unchecking a solution hides it from the filter
and the idea dialog on every device; the server stores the setting in `public.disabled_solutions` and
`/api/solutions` returns it as `disabled`. Ideas already linked to it keep the link and still show its name. Changing
the setting needs a connection.

[docs/agent.md](docs/agent.md) describes how Copilot reads and updates ideas for a solution.

## Hosting

`deploy/application.json` describes the hosted release: port 8802, database `idea_notes`, readiness at `/api/health` and
the stop file in `SOLUTIONDEPLOY_STOP_FILE`. The schema is in `deploy/postgresql`. Provisioning follows "Add a new
solution" in `solution-deploy\docs\Deployment.md`.

`002_journal.sql` adds journal and global-note tables and moves the schema to version 2.
`003_tasks.sql` adds tasks and task receipts, then moves it to version 3. Apply pending migrations through
the reviewed database-change procedure in `Deployment.md` (stop the app, apply them in order as the migrator,
re-run the `Manage-Postgres.ps1` grant plan, then release). The server reports not ready until all tables
exist at schema version 3.

`TEST_DATABASE_URL` runs `tests/journal-postgres.test.ts` against a real database. It drops and recreates `public`, so
it only runs when the database name ends in `_test`; a disposable container is enough:

```powershell
docker run -d --rm --name idea-notes-pgtest -e POSTGRES_PASSWORD=localtest -e POSTGRES_DB=idea_notes_test -p 55432:5432 postgres:17-alpine
$env:TEST_DATABASE_URL = 'postgres://postgres:localtest@localhost:55432/idea_notes_test'
npx vitest run tests/journal-postgres.test.ts
docker stop idea-notes-pgtest
```
