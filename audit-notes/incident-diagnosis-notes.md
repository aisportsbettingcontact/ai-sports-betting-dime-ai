# Incident Diagnosis Notes — SEC-004 Heartbeat Auth Failure

## Key Finding from references/periodic-updates.md

### Section 1 — Two Flavors
Both flavors (Heartbeat HTTP cron AND AGENT cron) hit the SAME `/api/scheduled/*` endpoint with the SAME auth shape: `sdk.authenticateRequest(req)` returns `user.isCron === true` with `user.taskUid` set — **after** the §5c patches are applied.

### Section 4a — Project-level Heartbeat (sandbox CLI)
> This path **does not require** the §5c patches — the CLI talks to the platform directly with the project owner identity, no `sdk.authenticateRequest` involved on the create path.

BUT the callback handler still needs to authenticate the incoming POST. The doc says both flavors use the same auth shape.

### Section 4b — AGENT cron
> Without §5c, you can read the trigger task UID from `req.headers["x-manus-cron-task-uid"]` instead and trust the platform gateway (which restricts `/api/scheduled/*` to cron callers only).

This is the FALLBACK path — if §5c isn't working, you can trust the header.

### Critical Insight from §5c
> If you only ever use AGENT cron (§4b) or sandbox-CLI Heartbeat (§4a), **skip this section**. Apply only when end-users will create / update / delete crons through your tRPC handlers and you want `user.isCron` / `user.taskUid` to type-check inside `/api/scheduled/*` handlers.

This means: §5c patches are ONLY needed for end-user-driven crons (§3). For §4a/§4b crons, the platform may NOT send a cron-prefixed JWT — it may send the owner's regular session or just the x-manus-cron-task-uid header.

## Hypothesis
The production heartbeats were created via §4a (sandbox CLI `manus-heartbeat create`). The platform sends a request with either:
- The owner's regular JWT (not cron-prefixed) → `isCron` would be false → handler rejects with "cron-only"
- OR the `x-manus-cron-task-uid` header without a cron-prefixed openId

The auth gate I added checks `if (!user.isCron)` which fails for §4a-flavor crons that don't have a cron-prefixed openId.

## Fix Direction
The auth gate should accept EITHER:
1. `user.isCron === true` (§3 end-user crons with cron_ prefix)
2. OR presence of `x-manus-cron-task-uid` header (§4a/§4b platform crons)
3. OR owner identity (user.openId === OWNER_OPEN_ID for project-level crons)

Need to check what the heartbeat configs actually are (fg-lineups-heartbeat.json etc.)
