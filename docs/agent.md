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
| `status`   | `open`, `in-progress` or `done`             |
| neither    | every idea, archived ones included          |

`GET /api/solutions` lists the ids and names the app accepts. A bad filter returns 400.

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
