# FE-005 Session A Evidence Log

## Timestamp: 2026-07-07T08:29Z

## Q1: What my verification curls actually hit

Commands used (verbatim from session `fe005-verify`):
```
curl -s --max-time 15 https://aisportsbettingmodels.com/privacy | grep -o "<title>[^<]*</title>"
curl -s --max-time 15 -H "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://aisportsbettingmodels.com/privacy | grep -o "<title>[^<]*</title>"
curl -s --max-time 15 -H "User-Agent: python-requests/2.28.0" https://aisportsbettingmodels.com/privacy | grep -o "<title>[^<]*</title>"
curl -s --max-time 15 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" https://aisportsbettingmodels.com/privacy | grep -o "<title>[^<]*</title>"
```

**Target:** PUBLIC DOMAIN (aisportsbettingmodels.com), NOT localhost.
**All returned:** `<title>Privacy Policy | AI Sports Betting Models</title>`

## Current production state (re-verified 08:28Z)

- GET /privacy → 5107 bytes, `<title>Privacy Policy | AI Sports Betting Models</title>`
- OG:title = "Privacy Policy | AI Sports Betting Models"
- Meta description = "Privacy Policy for AI Sports Betting Models — how we collect, use, and protect your data."
- Canonical = https://aisportsbettingmodels.com/privacy
- ZERO homepage content (no "Be First to Access", no "Join Waitlist")
- ZERO JS bundle references (no `<script src=...>`)
- Full 10-section legal text present

## HEAD/GET mismatch (bug found)

- HEAD /privacy → content-length: 385545 (SPA index.html size)
- GET /privacy → actual body: 5107 bytes (prerendered legal page)
- The middleware intercepts GET but NOT HEAD requests

## Production headers (GET)

```
HTTP/2 200
date: Tue, 07 Jul 2026 08:27:56 GMT
content-type: text/html; charset=UTF-8
content-length: 385545  ← WRONG (HEAD mismatch)
cf-ray: a17578d88f5bc68f-MRS
cf-cache-status: DYNAMIC
cache-control: no-cache, no-store, must-revalidate
etag: W/"5e209-19f3ba29e88"
expires: 0
last-modified: Tue, 07 Jul 2026 08:12:21 GMT
server: cloudflare
vary: Accept-Encoding
pragma: no-cache
```

Key: `cf-cache-status: DYNAMIC` = NOT cached by Cloudflare.
`cache-control: no-cache, no-store, must-revalidate` = no caching.

## Version deployed

- Production version.json: `{"timestamp":1783411688199,"version":"c1ed37de"}`
- Checkpoint: 460c4791 (published by user)
- Previous version (pre-fix): 8e3ccd06

## Q2: Production code path

In `server/_core/vite.ts`:
- Line ~48: dev mode registers `landingPrerenderMiddleware`
- Line ~110: production mode ALSO registers `landingPrerenderMiddleware`

The middleware in `server/landingPrerender.ts`:
- Checks `req.path === '/privacy' || req.path === '/terms'` FIRST (before bot check)
- Returns full legal HTML for ALL user agents on those paths
- Only falls through to bot-UA check for `/` (landing page)

## User's contradicting claim

User said: "external fetch of https://aisportsbettingmodels.com/privacy AFTER checkpoint 6e74aa4c still returns full homepage content"

My re-test at 08:28Z shows the fix IS working. Possible explanations:
1. User tested between checkpoint save and publish (deploy lag)
2. User's tool renders JavaScript (but prerendered page has NO JS, so this shouldn't apply)
3. Brief CDN propagation window
4. HEAD/GET mismatch confused a tool that checks content-length first

## Action items

1. Fix HEAD/GET mismatch (middleware should also intercept HEAD for /privacy, /terms)
2. File INC-008 for the verification timing issue
3. Ask user to re-test now and report what tool they used
