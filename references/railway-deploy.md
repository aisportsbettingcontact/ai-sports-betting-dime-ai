# Railway deployment runbook

Target architecture for the migration off the legacy platform. Railway hosts the whole app —
the Express server serves both the API and the built Vite client:

```
Browser ──► Railway (custom domain)
             │  Express + tRPC + SSE (dist/index.js)
             │  serves static client (dist/public) + SPA fallback
             │  /health ← Railway healthcheck
             └─ MySQL/TiDB (DATABASE_URL)
```

The client calls **relative** URLs (`/api/trpc`, `/api/dime/chat`) against the
same origin, so session cookies are first-party, there are no CORS preflights,
and SSE streams directly.

> **History:** an earlier plan split hosting across Railway (backend) and a
> separate standalone frontend host (proxying `/api/*`). That frontend host was
> dropped 2026-07-11 — Railway serves everything now — and its build config and
> ops workflow were removed. The repo was disconnected from that host's
> dashboard to stop preview deploy statuses on PRs.

## Repo artifacts

| File | Purpose |
|---|---|
| `Dockerfile` | Railway image: Node 22 + Debian Python 3.11 (+ numpy/pandas/scipy/requests) — matches the hardcoded `/usr/bin/python3*` paths in the model runners and fixes the historical `spawn /usr/bin/python3 ENOENT` Railway failure. Runs the full `pnpm run build` (client + server) |
| `railway.json` | Dockerfile builder, `node dist/index.js` start, `/health` healthcheck, on-failure restarts, `numReplicas: 1` (see [§3b](#3b-replica-count-and-background-jobs-data-integrity--do-not-change-without-a-distributed-lock) — do not raise without a distributed lock) |
| `package.json` | `build:client` (Vite) and `build:server` (esbuild) split; `build` runs both |
| `scripts/smoke-deploy.mjs` | Post-deploy smoke suite (health, SPA shell, asset caching, tRPC mount, dime-chat auth gate) — run against any origin: `node scripts/smoke-deploy.mjs https://<domain>` |
| `.github/workflows/deploy-smoke.yml` | Runs the smoke suite against the live Railway origin after pushes to `main`, or on demand (workflow_dispatch takes a custom origin) |

**Parallel-track law (historical):** this stack ran separate from and parallel
to the legacy production, which is now retired. The Railway track must not
depend on the legacy platform at runtime:
- `/dime-storage/*` images are **vendored** in `client/public/dime-storage/`
  and served local-first by `server/_core/storageProxy.ts` (the legacy gateway
  signed-URL redirect remains as the fallback). Smoke
  check 7 guards this on every deploy.
- Remaining known legacy dependency: the retired OAuth login flow
  (`OAUTH_SERVER_URL` etc., unset on Railway) — a dead code path; production
  auth is Discord. Session cookies are verified locally
  (`APP_SESSION_SECRET` JWT), and password-reset/Discord flows exist.

Dockerfile gotchas learned the hard way (don't regress these):
- `patches/` + `.npmrc` must be COPY'd **before** `pnpm install` — package.json
  declares `patchedDependencies`, and `.npmrc` carries `allow-build=puppeteer`.
- The seed scripts' CLI guards must match on filename, not
  `import.meta.url === file://argv[1]` — in the esbuild bundle that comparison
  is always true and the seeders' `process.exit()` kills the server at boot.
- Chromium's Debian shared libraries are installed for the puppeteer scrapers.

## One-time setup

### 1. Railway

1. New project → **Deploy from GitHub repo** → this repo. Railway picks up
   `railway.json` + `Dockerfile` automatically.
2. Set environment variables (Service → Variables). `PUBLIC_ORIGIN` must equal
   the app's public origin (the custom domain once DNS points at Railway).
   Everything the server reads — from `.env.example`: `APP_SESSION_SECRET`,
   `DATABASE_URL`, `PUBLIC_ORIGIN`, Stripe, Discord, scraper credentials,
   `ANTHROPIC_API_KEY` *or* the Anthropic-compatible gateway pair
   (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`), plus:
   - `ADDITIONAL_ALLOWED_ORIGINS` — the `*.up.railway.app` URL if you'll
     exercise the backend on it directly while the custom domain is primary
   - Do **not** set `PORT` — Railway injects it and the server binds it.
3. Generate a public domain (Settings → Networking) and note it:
   `https://<service>.up.railway.app`.
4. Point the custom domain (e.g. `aisportsbettingmodels.com`) at Railway
   (Settings → Networking → Custom Domain). `PUBLIC_ORIGIN` must equal this
   origin.
5. Client-side `VITE_*` env vars (from `.env.example`) are baked in at build
   time — set them as Railway build-time variables.

### 2. Cron

Scheduled work is HTTP-triggered (`server/cron/cronRoutes.ts`): keep the
GitHub Actions schedules curling `POST /api/cron/*` with the cron secret,
pointed at the **Railway** domain. The MLB Monte-Carlo model that previously
failed on Railway (`spawn /usr/bin/python3 ENOENT`) is unblocked by the
Dockerfile's Debian Python — re-test it on Railway before relying on it.

### 3b. Replica count and background jobs (data-integrity — do not change without a distributed lock)

`odds_history`, `games`, `mlb_lineups`, and `dime_credit_ledger` have **no unique
constraints** in TiDB — a duplicate write from a second writer is silent and
unrecoverable (no constraint violation, no error, just a duplicate row). The
in-process overlap guard (`CronJobRunner` in `server/cron/cronRunner.ts`) is an
**in-memory instance field**: it only prevents overlap *within one process*, not
across replicas. Given that:

- `railway.json` pins `deploy.numReplicas: 1`. **Do not raise this** unless a
  distributed lock (e.g. a DB-backed or Redis-backed mutex) replaces the
  in-memory `CronJobRunner` guard — a second replica would silently double-write
  the tables above.
- `DISABLE_BACKGROUND_JOBS=1` **must** be set on any Railway web replica whose
  job is only to serve HTTP traffic. Leaving it unset starts 15+ in-process
  timers (`server/_core/index.ts`) that write the same tables the GitHub Actions
  crons and the legacy heartbeat platform also wrote.
- Exactly **one** process may run background jobs at any given time — whichever
  one has `DISABLE_BACKGROUND_JOBS` unset (or `0`). With `numReplicas: 1` this
  is automatically satisfied as long as the single replica is the one intended
  to run jobs; it stops being true the moment a second replica is added without
  also gating it off.
- The 8 `.github/workflows/cron-*.yml` GitHub Actions crons that target the
  legacy-orphaned `/api/scheduled/*` endpoints must stay **disabled** in the
  Actions UI (⋯ → Disable workflow) until the legacy heartbeat platform is
  confirmed fully decommissioned — running both at once double-writes the same
  tables from two independent triggers, same failure mode as the replica case
  above.

### 4. Stripe webhooks

Point the webhook endpoint at the Railway domain
(`https://<service>.up.railway.app/api/stripe/webhook`, or the custom domain
once it points at Railway — same origin either way).

## How the pieces behave

- **Cookies**: Express has `trust proxy` set and reads `x-forwarded-proto`,
  so `Secure` session cookies work behind Railway's proxy. Single origin →
  cookies are first-party.
- **CSRF**: mutations are origin-checked (`server/_core/trpc.ts`). The allowed
  set must contain the app domain (`PUBLIC_ORIGIN`); extra domains via
  `ADDITIONAL_ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_SUFFIXES`.
- **SSE** (`POST /api/dime/chat`): served directly by Express; the route
  disables buffering via `Cache-Control: no-transform`.
- **Auto-deploy**: unlike the legacy host, Railway deploys on push to `main` once
  connected. Schema changes still require the manual `db-push.yml` workflow
  **before** the code deploy.

## Cutover checklist

1. Railway service green (`/health` returns 200, logs clean).
2. Smoke: `node scripts/smoke-deploy.mjs https://<domain>` — login, tRPC reads
   + a mutation, `/chat` SSE stream, Stripe checkout.
3. Update Stripe webhook + GitHub Actions cron URLs to the Railway origin.
4. Move DNS for the custom domain to Railway; confirm `PUBLIC_ORIGIN` matches.
5. Decommission the legacy deployment (done — its runbook has been removed
   from the repo).
