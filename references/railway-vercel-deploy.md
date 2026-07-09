# Railway + Vercel deployment runbook

Target architecture for the migration off Manus:

```
Browser ──► Vercel (custom domain)
             │  static Vite client (dist/public)
             │  rewrites /api/* ──► Railway backend (Express + tRPC + SSE)
             │                       │  /health   ← Railway healthcheck
             │                       └─ MySQL/TiDB (DATABASE_URL)
             └─ everything else ──► /index.html (SPA fallback)
```

The client keeps calling **relative** URLs (`/api/trpc`, `/api/dime/chat`) and
Vercel proxies them server-side to Railway. That keeps session cookies
**first-party** on the app domain — no third-party-cookie breakage in Safari,
no CORS preflights, and SSE streams straight through the proxy.

## Repo artifacts

| File | Purpose |
|---|---|
| `Dockerfile` | Railway image: Node 22 + Debian Python 3.11 (+ numpy/pandas/scipy/requests) — matches the hardcoded `/usr/bin/python3*` paths in the model runners and fixes the historical `spawn /usr/bin/python3 ENOENT` Railway failure |
| `railway.json` | Dockerfile builder, `node dist/index.js` start, `/health` healthcheck, on-failure restarts |
| `vercel.json` | Vite client build (`pnpm run build:client` → `dist/public`), `/api/*` rewrite to Railway, SPA fallback |
| `package.json` | `build:client` (Vite) and `build:server` (esbuild) split; `build` runs both |

## One-time setup

### 1. Railway (backend)

1. New project → **Deploy from GitHub repo** → this repo. Railway picks up
   `railway.json` + `Dockerfile` automatically.
2. Set environment variables (Service → Variables). Everything the server
   reads — from `.env.example`: `APP_SESSION_SECRET`, `DATABASE_URL`,
   `PUBLIC_ORIGIN` (the **Vercel-served app domain**), Stripe, Discord,
   scraper credentials, `ANTHROPIC_API_KEY` *or* the AI Gateway pair
   (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` — see
   `references/ai-gateway-setup.md`), plus:
   - `ADDITIONAL_ALLOWED_ORIGINS` — the Vercel production URL (and the
     `*.up.railway.app` URL itself if you'll exercise the backend directly)
   - `ALLOWED_ORIGIN_SUFFIXES` — optional, for Vercel preview deploys; scope
     it to your team slug (e.g. `-yourteam.vercel.app`), never bare `.vercel.app`
   - Do **not** set `PORT` — Railway injects it and the server binds it.
3. Generate a public domain (Settings → Networking) and note it:
   `https://<service>.up.railway.app`.

### 2. Vercel (frontend)

1. New project → import this repo. `vercel.json` supplies the build command
   (`pnpm run build:client`) and output dir (`dist/public`) — no framework preset.
2. **Edit `vercel.json`**: replace `REPLACE-WITH-RAILWAY-DOMAIN.up.railway.app`
   with the Railway domain from step 1.3, commit, push.
3. Point the custom domain (e.g. `aisportsbettingmodels.com`) at the Vercel
   project. `PUBLIC_ORIGIN` on Railway must equal this origin.
4. Client-side `VITE_*` env vars (from `.env.example`) go in Vercel Project →
   Environment Variables — they're baked in at build time.

### 3. Cron

Scheduled work is HTTP-triggered (`server/cron/cronRoutes.ts`): keep the
GitHub Actions schedules curling `POST /api/cron/*` with the cron secret,
pointed at the **Railway** domain (not the Vercel proxy, to avoid its function
timeout on slow jobs). The MLB Monte-Carlo model that previously failed on
Railway (`spawn /usr/bin/python3 ENOENT`) is unblocked by the Dockerfile's
Debian Python — re-test it on Railway before relying on it.

### 4. Stripe webhooks

Point the webhook endpoint at the Railway domain directly
(`https://<service>.up.railway.app/api/stripe/webhook` or via the app domain —
either works; direct-to-Railway skips one proxy hop and Vercel's body handling).

## How the pieces behave

- **Cookies**: Express has `trust proxy` set and reads `x-forwarded-proto`,
  so `Secure`/`SameSite=None` session cookies work behind both proxies. Because
  the browser only ever talks to the app domain, cookies are first-party.
- **CSRF**: mutations are origin-checked (`server/_core/trpc.ts`). The Vercel
  proxy forwards the browser's `Origin` header, so the allowed set must contain
  the app domain (`PUBLIC_ORIGIN`) — previews/extra domains via
  `ADDITIONAL_ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_SUFFIXES`.
- **SSE** (`POST /api/dime/chat`): streams through the Vercel rewrite; the
  route disables buffering via `Cache-Control: no-transform`.
- **Standalone backend**: the Docker image also builds and serves the client,
  so the raw Railway URL renders the app too (useful for smoke tests; add it to
  `ADDITIONAL_ALLOWED_ORIGINS` if you log in there).
- **Auto-deploy**: unlike Manus, both platforms deploy on push to `main` once
  connected. Schema changes still require the manual `db-push.yml` workflow
  **before** the code deploy.

## Cutover checklist

1. Railway service green (`/health` returns 200, logs clean).
2. Vercel deploy green; `vercel.json` rewrite points at the Railway domain.
3. Smoke: login, tRPC reads + a mutation, `/chat` SSE stream, Stripe checkout.
4. Update Stripe webhook + GitHub Actions cron URLs.
5. Move DNS for the custom domain to Vercel; confirm `PUBLIC_ORIGIN` matches.
6. Decommission the Manus deployment; `RELEASING.md` (Manus runbook) becomes
   historical after this point.
