# Deferred Defects (PR #198) — Evidence Report (2026-07-24)

**Verdict: `INCOMPLETE`** — deliberately unchanged. Every item PR #198 scoped is closed or
evidence-rejected below, but X-HEX-EPIDEMIC remains the open HIGH defect (a carve-out plus a
ratchet is containment, not closure), and the real-hardware, input-method, safe-area,
full-Cartesian, and orientation gates remain unexecuted or physically blocked. No coverage is
claimed that was not executed.

Plan: `2026-07-24-deferred-defects-pr198.md`. Base: `main` @ `e660ac7c`. Original ledger:
`2026-07-24-sitewide-design-repair-report.md` (see its dated addendum pointing here).

## What changed since the original audit's environment

The audit ran auth-less and DB-less (25/51 surfaces runtime-inspected, 26 blocked). This session
stood up the blocked runtime: ephemeral Docker `mysql:8` + `drizzle-kit push` schema (73 tables),
service env injected per-process via `railway run` with `DATABASE_URL` overridden to
`127.0.0.1:3306/dime_test` (override observed in-child before every run, never inferred),
`DISABLE_BACKGROUND_JOBS=1`, seeded users (`user` + promoted `owner`) through the real bcrypt
path, two seeded `games` rows, and an authenticated browser session.

## Reachability census (the 25/51 gate)

**25 of the 26 previously-blocked surfaces runtime-inspected; route-level coverage 50/51.**
Newly inspected: the feed family with data (`/feed` dated model route, `/betting-splits`,
`/trends`, aliases `/dashboard` `/projections` `/splits`), all 13 distinct admin surfaces
(`RequireOwner`-gated — probed fact: `role='admin'` is rejected, `owner` required),
`/account`, `/profile`, `/chat`, `/bet-tracker`, `/wc2026`, `/m/feed`, `/mlb/team/:slug`,
`/subscribe/success`, `/subscribe/cancel`. Aliases observed: `/admin/f5-edge` →
`/admin/model-results`. **Still blocked (1/26):** external-completion states (a real Discord
OAuth grant, a live Stripe payment) — deliberately not driven against production services.
Observation recorded, not in scope: `RequireOwner` serves a stale cached role for one navigation
after a mid-session role change.

## Suspect adjudications (verdict follows the probe, in both directions)

| Suspect | Verdict | Evidence |
|---|---|---|
| X-STALE-RESIZE | REJECTED | Nav state tracks viewport across 320↔1440 flips and lands exactly on the documented `<768` boundary (true at 767, false at 768); cleanups at `GlobalMobileNav.tsx:44-45`, `DimeChatPage.tsx:1403-1406`; 0px overflow after resize cycles |
| X-LOSSRED-D | REJECTED | Every `--loss-red`/`--bt-red` consumer sits in the sanctioned Bet Tracker/calendar scope; the `.bt-page` remap *enforces* the exception; 0 raw `text-red-*`/`bg-red-*` utilities in TSX |
| X-1023-IDIOM | REJECTED | `1023.98px` is the correct complement to `min-width:1024px`; boundary probe at 1023/1024/1025 on authed `/feed`: content continuous, 0 overflow |
| X-OVERFLOW-X | No active harm | 4,484/4,484 integer-width probes (320–1440 × `/feed` `/chat` `/admin/backtest` `/admin/activity`, authed) — 0 overflow >1px, 0 page errors. Removing the guards themselves stays future work |
| X-ADMIN-ALPHA | **CONFIRMED → FIXED** | 29 alpha fills across 13 admin-family files (the population the 149-site conversion couldn't reach). Converted to solid law tokens; Tailwind `ring-*` kept (renders as box-shadow, inside the law's carve-out). Runtime: 0 alpha-fill elements on `/admin/plans`, header solid, blur none |
| X-STAR-ANCHOR | REJECTED | Three candidates all law-compliant (chat star mint 11px + aria-label; ★ ANNUAL foreground-on-card; GameCard `isBest` bookmark = mint signal with `title`). Synthetic `dominantBaseline` measurement: Chromium dy −0.75px vs WebKit dy −0.63px, dx 0 both — 0.12px cross-engine divergence on an 8px glyph |

## Fixes landed

- **WcFeedInline carve-out** (`424d7630`): deadness re-proven at HEAD (0 import/lazy references);
  deleted with its superseded source-contract test — all five money-critical invariants already
  guarded against the live surface by `dimeModelFeed.test.ts:64-76,186-195`, behaviorally in the
  round-label case. Gated suite after: 2,261 passed / 64 environmentBound / 0 new failures.
- **Hex ceiling ratchet** (`ae9eaaf2` + ratchet-downs): `client/src/hexLiteralCeiling.test.ts`
  IS the canonical metric — pattern `#[0-9a-fA-F]{3,8}\b`, file set `client/src/**/*.{ts,tsx,css}`
  including tests (self excluded), Discord `#5865F2`/`#4752C4` exempted. **Current frozen total:
  1,795 literals across 66 files** (`hexLiteralCeilings.json`). New files get ceiling 0; ceilings
  only ratchet down; tripwire proven red-green in session. (Metric-note: the original ledger's
  "≈2,000/1,644" figures used narrower pattern/file-set variants; this definition supersedes them
  and is reproducible by one command.)
- **D-MOTION-LAW** (`605c65b9`): 17 sites in the locked five files normalized to
  `duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]`; runtime computed 0.16s. Residuals
  recorded, not touched (outside the locked list): `MobileGameCard.tsx:1076,1110`,
  `ui/navigation-menu.tsx:78` (duration-300).
- **X-PY-CARDGEN** (`35da66c5`, owner-approved scope): generator chrome only — neon → mint,
  purple heat ramp → mint ramp at identical alphas, negative red → law grey; unknown-team
  fallbacks (941/944) → achromatic greys, never mint. Crest dict lines 161–191 byte-identical
  (sha `b09e2a11` before == after). Gate grep: 0 banned values; `ast.parse` OK.
- **D-BG-SEAM** (`3cd9fe07` + `87ce5598`, owner-approved): both System-mode grey blocks removed
  (index.css and the mobile remap layer's twin — the latter caught by the WebKit probe re-pinning
  grey at ≤767px). System now follows Dark exactly. Probe matrix: system/dark = `rgb(0,0,0)`,
  light = `rgb(255,255,255)`, on `/login` + `/feed`, mobile + desktop widths, Chromium + WebKit.
  Prerendered legal pages already pin black — the public/app seam is gone.
- **X-PRERENDER-V1**: not reproducible at `e660ac7c` — every hex in `landingPrerender.ts` maps to
  a law-v2 ramp row. Fixed the stale comment claiming IBM Plex Mono stacks. Prerender tests 7/7.
- **X-ZINDEX** (`67ce373e`): census found zero simultaneous-layer collisions (the 268/640 scare
  was widths/durations sharing census lines). Ladder + slot rules documented in `index.css`; no
  z value changed.
- **Bounded px** (same commit, locked six-file list only): six sub-10px sites raised to the
  MASTER 10px micro-label floor (GameCard badges/glyph 8–9px, MetricsPanel bar labels 9px).
  `text-[10px]` micro-labels are law-sanctioned and untouched.

## Cross-engine statement (exact)

**WebKit 26.0 (Playwright webkit v2248, macOS host) executed** against `/`, `/login`, and authed
`/feed` at 1440×900 and 390×844: 0 overflow, 0 page errors, canvas matrix correct — plus the
synthetic star measurement above. The cross-engine gate moves from "blocked" to **PARTIAL: 3
routes × 2 viewports probed on WebKit**; the full 51-surface matrix and Firefox remain
unexecuted. Chromium remains the primary engine for all other results.

## Gates that remain failed/blocked (unchanged by #198, restated)

Real-hardware coverage, touch/pen/switch input, notched safe-area measurement, full W×H
Cartesian probes, orientation simulation: blocked or unexecuted. High-severity open:
X-HEX-EPIDEMIC (1,795 frozen literals — containment, not closure). Deferred with owner sign-off:
X-IMPORTANT (151 `!important`, own PR), X-DUAL-SYSTEMS. Verdict stays `INCOMPLETE`.
