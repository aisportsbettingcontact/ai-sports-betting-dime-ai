---
name: verify
description: Build, boot, and drive this app's production server locally (and against live Railway) to verify changes end-to-end — server surfaces, bot prerender, and rendered pages.
---

# Verifying changes in this repo (Express + tRPC + Vite SPA)

## Build + boot the production artifact

```sh
pnpm run build          # client → dist/public, server → dist/index.js
APP_SESSION_SECRET=$(head -c 48 /dev/zero | base64) \
DATABASE_URL="mysql://u:p@127.0.0.1:3306/db" \
PUBLIC_ORIGIN="https://ai-sports-betting-dime-ai-production.up.railway.app" \
NODE_ENV=production PORT=3910 node dist/index.js
```

Boots fine with a dead DB — the crash guard holds and `/health` still returns
200 (`db.state` reports the circuit). Listen line: `✓ Server listening`.
Boot takes ~15–25s before the port opens; poll `/health` with `until curl…`.

## Drive the surfaces

```sh
node scripts/smoke-deploy.mjs http://127.0.0.1:3910   # 6 checks, exit 0 = pass
# Bot prerender (SEO snapshot; must carry X-Prerender: 1):
curl -s -D - http://127.0.0.1:3910/ -A "Googlebot/2.1" | less
# CSRF probe (expect 403 / 200):
curl -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3910/api/trpc/auth.logout?batch=1 \
  -H "content-type: application/json" -H "origin: https://evil.example.com" -d "{}"
```

Same script works against live: `node scripts/smoke-deploy.mjs https://ai-sports-betting-dime-ai-production.up.railway.app`

## Rendered pages (Playwright, pre-installed Chromium)

```js
import { chromium } from "/home/user/ai-sports-betting-dime-ai/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// viewport 1440×900 desktop / 390×844 mobile; waitUntil: "networkidle"
```

Don't `import "playwright-core"` from a scratchpad path — resolve the repo's
own `node_modules/playwright/index.mjs` by absolute path.

## Gotchas

- `pkill -f "node dist/index.js"` in a compound command kills the shell chain
  (exit 144) — stop the server in its own Bash call.
- Bot prerender is order-sensitive: `landingPrerenderMiddleware` must be
  mounted BEFORE `express.static` in `server/_core/vite.ts` (static serves
  index.html for `/` and shadows it). Guarded by `server/landingPrerender.test.ts`
  and smoke check 6.
- Vitest server tests need `APP_SESSION_SECRET` (44+ chars) + `DATABASE_URL`
  set to *anything* to pass the boot guard; DB-backed suites still need a real DB.
- Railway deploy: `railway up --ci --service $RAILWAY_SERVICE_ID`, then poll
  GraphQL `deployments(first:1…)` for SUCCESS/FAILED; build logs via
  `buildLogs(deploymentId:…)`.
