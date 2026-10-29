# Idea Notes

Idea Notes captures thoughts with tags, pins, search and archive. Notes sync to a PostgreSQL database through a small
Express server. The browser keeps an outbox, so capture works offline and changes upload when the connection returns.

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

## Solutions

An idea can link to one solution from Solution Directory and carries a status: open, in progress or done. The server
reads the directory's `sites.json` from `SOLUTIONS_SOURCE` on every `/api/solutions` request, so a solution added to the
directory appears with no change here. If the directory is down, the server returns the last list it read; the browser
also keeps a copy for offline capture. An idea linked to a solution that later leaves the directory keeps its id.

[docs/agent.md](docs/agent.md) describes how Copilot reads and updates ideas for a solution.

## Hosting

`deploy/application.json` describes the hosted release: port 8802, database `idea_notes`, readiness at `/api/health` and
the stop file in `SOLUTIONDEPLOY_STOP_FILE`. The schema is in `deploy/postgresql`. Provisioning follows "Add a new
solution" in `solution-deploy\docs\Deployment.md`.
