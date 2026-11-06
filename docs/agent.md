# Reading ideas as work direction

Ideas linked to a solution are instructions for work on that solution. Copilot reads them over Tailscale; the private
path relies on Tailscale access controls, so no token is needed.

## Read the open ideas for a solution

The solution id is the Solution Directory id, the same hyphenated name as the repo (`ferry-tracker`, `work-log`).

```powershell
$base = 'https://jimbrownhome1.tail8ad282.ts.net:8802'
(Invoke-RestMethod "$base/api/ideas?solution=ferry-tracker&status=open").ideas |
    Select-Object title, body, tags, status, updatedAt, version
```

| Query      | Values                                      |
| ---------- | ------------------------------------------- |
| `solution` | a solution id, or `none` for unlinked ideas |
| `status`   | `n/a`, `open`, `in-progress` or `done`      |
| neither    | every idea, archived ones included          |

`GET /api/solutions` lists the ids and names the app accepts, with `disabled: true` for solutions @jimb has hidden
from the pickers. A disabled solution still accepts links and keeps its ideas, so read its ideas the same way. A bad
filter returns 400.

Unlinked ideas always have status `n/a`. Removing a solution automatically sets it; assigning a solution changes
`n/a` to `open`. The server applies this rule to every write, including changes queued by older clients.

Treat archived ideas as parked and skip them unless asked. Times are UTC; show them in local time.

## Mark an idea in progress or done

Send an update with the full current fields and the version you read. If the version moved on since the read, the
server saves a separate copy, so read again right before writing.

```powershell
$base = 'https://jimbrownhome1.tail8ad282.ts.net:8802'
$idea = (Invoke-RestMethod "$base/api/ideas?solution=ferry-tracker").ideas |
    Where-Object title -eq 'Tide-aware arrival alerts'
$body = @{
    kind        = 'update'
    mutationId  = [guid]::NewGuid().ToString()
    id          = $idea.id
    baseVersion = $idea.version
    copyId      = [guid]::NewGuid().ToString()
    fields      = @{
        title     = $idea.title
        body      = $idea.body
        tags      = @($idea.tags)
        pinned    = $idea.pinned
        archived  = $idea.archived
        solution  = $idea.solution
        status    = 'done'
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
} | ConvertTo-Json -Depth 4
Invoke-RestMethod "$base/api/mutations" -Method Post -Body $body -ContentType 'application/json' `
    -Headers @{ Origin = $base }
```

The response `outcome` is `updated` on success and `copied` when the version was stale. Writes need the `Origin`
header above and a JSON body; anything else gets 403.

## Read personal notes

The Notes page is @jimb's journal: separate Home, Work and Unclassified entries per local day.
Read it for context when asked; don't write to it.

```powershell
$base = 'https://jimbrownhome1.tail8ad282.ts.net:8802'
(Invoke-RestMethod "$base/api/journal?from=2026-10-01&to=2026-10-31&tag=health").entries |
    Select-Object entryDate, category, body, tags, updatedAt
```

| Query            | Values                                                  |
| ---------------- | ------------------------------------------------------- |
| `from`, `to`     | `YYYY-MM-DD`, inclusive; either can be left out         |
| `tag`            | one tag, matched without regard to case                 |
| `includeDeleted` | `true` to include deleted days (`deleted: true`, empty) |
| none             | every entry that isn't deleted, newest day first        |

| Field                    | Meaning                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `entryDate`, `category`  | together identify an entry; category is `home`, `work`, or `null` (Unclassified) |
| `body`                   | plain text; `--- Edit from mm/dd/yyyy HH:mm ---` marks a merged offline edit     |
| `tags`                   | labels as typed                                                                  |
| `createdAt`, `updatedAt` | UTC timestamps; show them in local time                                          |
| `version`                | increases on every change, including deletes                                     |

A bad date or an unknown query key returns 400.

## Read date-agnostic global notes

Global notes have a title, body and tags. They are separate from daily journal entries and have no date filter. Read
them for context when asked; don't write to them.

```powershell
$base = 'https://jimbrownhome1.tail8ad282.ts.net:8802'
(Invoke-RestMethod "$base/api/global-notes").notes |
    Select-Object id, title, body, tags, updatedAt, version
```

`GET /api/global-notes` returns notes by newest update. Add `?includeDeleted=true` to include tombstones. Times are
UTC; show them in local time.

A global note needs a title and can have an empty body. Stale edits are merged into the current body under an
`--- Edit from mm/dd/yyyy HH:mm ---` separator; a different stale title is kept in the separator. Tags are unioned. A
stale delete keeps the note. Older queued saves containing a `pinned` field are accepted and the field is ignored.
API writes require the allowed `Origin` header, JSON content and a client-generated UUID `mutationId`; the server
records the first receipt for retries.

## Read personal tasks

Tasks have multiple rows per local calendar day, separated into Home and Work. Read them for context when asked;
don't write to them.

```powershell
$base = 'https://jimbrownhome1.tail8ad282.ts.net:8802'
(Invoke-RestMethod "$base/api/tasks?from=2026-11-02&to=2026-11-08&category=home").tasks |
    Select-Object id, taskDate, category, title, body, completed, position, updatedAt, version
```

`GET /api/tasks` accepts optional inclusive `from` and `to` calendar dates, `category=home` or `category=work`,
and `includeDeleted=true`. It hides tombstones by default and returns newest days first, then category, position
and id. Completed tasks stay in their existing order. Unknown query keys and invalid dates return 400.

The task date is immutable. Saves change title, details and category while preserving completion. Category
transfers append to the destination list. Completion sets an explicit boolean, and deletion retains a tombstone.
An offline save cannot restore a deleted task. Reorder puts supplied active ids first and appends omitted tasks in
their existing order; a missing, moved or deleted id keeps the entire order unchanged.

`POST /api/tasks/mutations` requires the existing allowed Origin and JSON protections. A permanent UUID receipt
records each mutation once. Every response contains the original `taskDate`, its outcome and all current rows for
that day across both categories, including tombstones. Timestamp fields are UTC; show them in local time.
