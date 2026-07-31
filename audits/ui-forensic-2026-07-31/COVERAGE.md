# COVERAGE — route × breakpoint × theme × state

Route census source: [client/src/App.tsx:231-517](../../client/src/App.tsx#L231-L517) (wouter `<Switch>`) plus the shell-ownership branch at [App.tsx:194-215](../../client/src/App.tsx#L194-L215) (`/chat` at all widths; feed/splits/tracker/trends ≥768px render inside `DimeAppShell`). Breakpoint set derived from [index.css:14-19](../../client/src/index.css#L14-L19) (`xs 375 / sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1600`) and the shell boundary [dime-shell/breakpoints.ts:8](../../client/src/pages/dime-shell/breakpoints.ts#L8) (768). Audited widths: 320, 390, 640, 767, 768, 1280, 1600 — both sides of the load-bearing 768 boundary; 1024's differences were audited via CSS only (its media tiers are enumerated in code) and its rendered cells are UNKNOWN.

Cell legend — **V**: screenshot captured and visually reviewed. **M**: DOM-measured (census/probe JSON). **C**: screenshot captured, not individually reviewed (available in `evidence/`). **CODE**: state audited from source only. **—**: not applicable. **UNKNOWN**: not audited.

## Product surfaces

| Route (file:line) | 390 dark | 390 light | 767 dark | 768 dark | 1280 dark | 1280 light | 1600 dark | Loading | Empty | Error |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` landing ([App.tsx:231](../../client/src/App.tsx#L231)) | C+M | UNKNOWN | UNKNOWN | UNKNOWN | V+M (full-page) | UNKNOWN¹ | UNKNOWN | — (eager) | — | UNKNOWN |
| `/feed/model/mlb` ([App.tsx:283-296](../../client/src/App.tsx#L283)) | V+M | V+M | V | V | V+M | V+M | C | V (`probe-feed-preview-1280-dark.png`) | V (`feed-empty-1280-dark.png`) | CODE² |
| `/betting-splits/mlb` ([App.tsx:298-311](../../client/src/App.tsx#L298)) | C+M | UNKNOWN | UNKNOWN | UNKNOWN | V+M | C | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| `/chat` (shell branch, [App.tsx:202-215](../../client/src/App.tsx#L202)) | C | UNKNOWN | UNKNOWN | UNKNOWN | V+M | UNKNOWN | UNKNOWN | UNKNOWN (SSE stream) | V (empty = home state) | UNKNOWN |
| `/trends` ([App.tsx:315](../../client/src/App.tsx#L315), shell-only ≥768) | — (redirects) | — | — | UNKNOWN | C³ | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | C³ (401 render) |
| `/bet-tracker` ([App.tsx:459-465](../../client/src/App.tsx#L459)) | C+M | UNKNOWN | UNKNOWN | UNKNOWN | V+M | UNKNOWN | UNKNOWN | UNKNOWN | V (0-bets state in same capture) | UNKNOWN |
| `/login` ([App.tsx:253](../../client/src/App.tsx#L253)) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | C | UNKNOWN | UNKNOWN | UNKNOWN | — | UNKNOWN |
| 404 catch-all ([App.tsx:516-517](../../client/src/App.tsx#L516)) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | C | UNKNOWN | UNKNOWN | — | — | — |
| Reflow probes | 320 no-overflow M | — | — | — | 640 no-overflow M (zoom-200% proxy) | — | — | — | — | — |
| Reduced-motion | M (`census-feed-390-reduced.json`) | — | — | — | CODE (kill-list gap = DIME-UI-003) | — | — | — | — | — |

¹ Landing is dark-fixed by design (landing-v2.css owns its palette); a light-mode landing does not exist as a distinct design — treated N/A-by-design pending owner confirmation, cell left UNKNOWN rather than assumed.
² Feed error state audited from source (error branch in DimeModelFeed); not renderable on demand against the live server without fault injection, which the read-only rig avoided.
³ `/trends` data procedures require real server-side auth; the capture shows its 401/error rendering (23 console errors) — an artifact of the rig for data, but a genuine capture of the surface's error presentation. Populated Trends: UNKNOWN.

## Redirect-only routes (behavior confirmed from source; rendered audit N/A)

`/home`, `/dashboard`, `/projections`, `/splits`, `/pricing`, `/landingpage`, `/landingpage-v2`, `/feed`, `/betting-splits` (bare), `/trends` (<768), `/m` (→`/m/feed`), `/admin/f5-edge` — [App.tsx:233-265,271-278,309-315,388,507](../../client/src/App.tsx#L233).

## Auth-gated, data-gated, or peripheral routes — UNKNOWN (not audited)

| Route group | Routes | Why not audited |
|---|---|---|
| Admin (owner-only) | `/admin`, `/admin/users`, `/admin/publish`, `/admin/activity`, `/admin/plans`, `/admin/ingest-an`, `/admin/model-results`, `/admin/security`, `/admin/model-status`, `/admin/postponed-games`, `/admin/backtest`, `/admin/waitlist`, `/admin/claude` ([App.tsx:323-435,475-483](../../client/src/App.tsx#L323)) | Server-verified `ownerProcedure` data; read-only rig cannot render populated states. Code-level findings for these surfaces (emoji UI, blur, hex debt) are filed in the ledger. |
| Team schedules | `/mlb/team/:slug`, `/nba/team/:slug`, `/nhl/team/:slug` ([App.tsx:437-457](../../client/src/App.tsx#L437)) | Secondary surfaces; not captured. |
| Account/identity | `/account`, `/profile`, `/reset-password`, `/subscribe/success`, `/subscribe/cancel`, `/checkout` | Not captured (checkout additionally requires Stripe state). |
| Legal | `/privacy`, `/terms` | Not captured; copy-level "AI-powered" hits noted in ledger context (legal prose, out of badging scope). |
| World Cup | `/wc2026` | Not captured; code findings included in sweeps. |
| Mobile `/m/*` screens | `/m/feed`, `/m/chat`, `/m/props`, `/m/profile`, `/m/splits` ([App.tsx:508-514](../../client/src/App.tsx#L508)) | Reachability from primary nav unconfirmed; code findings (Sparkles, MobileGameCard) filed. |

## Engine and modality limits

- Chromium-only (matches the repo's own supported-viewport contract, MASTER.md §"Supported viewport contract": WebKit/Firefox unverified there too).
- True browser zoom 200% approximated by 640px-viewport reflow (no overflow measured); sub-pixel zoom rendering UNKNOWN.
- Screen-reader announcement of odds strings ("-103", edge badges): UNKNOWN — no AT was driven; aria-label *presence* was verified on the controls listed in the ledger.
- Live SSE chat streaming states: UNKNOWN (would require exercising the Claude gateway; out of read-only scope).
