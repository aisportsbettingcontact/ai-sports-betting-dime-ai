# Sitewide Design Repair — Final Evidence Report (2026-07-24)

**Verdict: `INCOMPLETE`** — by the contract's own binary gates, honestly computed. Every
in-scope executed check passed; the gates that fail do so because of (a) 15 deliberately
deferred confirmed defects with documented remediation paths and (b) environment-blocked
coverage (no real hardware, Chromium-only, no database, no authentication). No unresolved
defect is hidden and no coverage is claimed that was not executed.

Companion plan: `2026-07-24-sitewide-design-repair.md`. Session evidence (probe JSONs,
sweeps, screenshots, reconciled ledger, verifier report) lived in the session scratchpad;
the durable facts are summarized here.

## Revisions

- Audit baseline: `310bf72` (= origin/main at audit time)
- Final: `3b7da85` (B1–B8, eight commits)
- Execution medium: **BROWSER_EMULATION** throughout (Playwright + Chromium 1194).
  No REAL_HARDWARE results exist. WebKit/Firefox: **not available, unverified**.

## Process actually executed

1. Five independent read-only audit subagents in isolated git worktrees pinned to
   `310bf72` (inventory / apple-design / ui-ux-pro-max / stop-slop forensics /
   device-viewport). All returned clean `git status`. 74 raw findings.
2. Reconciliation to 44 canonical defects: **28 fixed in-session**, 13 deferred with
   rationale, 3 rejected with evidence (environment artifact; documented law exceptions).
3. Implementation batches B1–B6 (foundations → landing → auth → checkout/docs →
   feed/chat/404 → law-doc sync), each with per-batch runtime verification.
4. Independent fresh-context verifier: reran sweeps and matrix, adversarially re-checked
   all 28 — **21 VERIFIED, 7 PARTIAL**. B7 realigned six source-contract tests broken by
   the dead-code deletion (invariants repointed at live surfaces, one strengthened
   repo-wide). B8 closed five of the seven partials; two residuals moved to deferred
   with rationale (below).

## Toolchain results (final revision)

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| Production build + preview-production gate | PASS (104 files scanned) |
| Bundle budget (chat critical path) | 218,187B vs 218,442B ceiling — PASS (recalibration5, +512B documented; vendor-motion chunks: 0) |
| Gated test suite (`test:gated:local`) | PASS — 2,266 passed / 64 environment-bound (allowlisted) / 0 new failures |
| gitleaks (origin/main..HEAD) | no leaks |
| Integer width sweep 320–1440 (`/`, 404), post-fix | 1,121/1,121 widths per route, 0 overflow >1px, 0 page errors |
| Height sweep 500–1000 (`/` at 390 & 1440 wide) | 501 heights × 2, 0 failures |
| Console census (public routes) | only the environment egress-proxy reset of fonts.googleapis remains (R-CONNRESET, not a product defect) |

## Defect ledger outcome (44 canonical from 74 findings)

- **26 RESOLVED and independently VERIFIED** (21 at the verifier pass + 5 closed in B8 and
  re-probed: worst landing micro-label contrast now 5.73:1; no em dash in served landing
  text; reset-password back-links; `/login` title; 404 CTA on the 160ms brand curve).
- **15 deferred, all documented** (was 13, +2 verifier residuals):
  high: X-HEX-EPIDEMIC (≈2,000 raw hex literals in legacy TSX — token-migration project).
  medium: X-DUAL-SYSTEMS (GameCard vs ProjectionCard consolidation), X-PX-SWEEP,
  X-PY-CARDGEN (owner call), X-ADMIN-ALPHA (auth-blocked verify), X-IMPORTANT
  (dime-mobile.css remap layer + .feed-tab tiers), **D-MOTION-LAW residual**
  (duration-700/500 utilities on auth-gated surfaces), **D-BG-SEAM residual**
  (system-grey #121212 default canvas vs pinned-#000 public surfaces — full coverage,
  no measured visible seam post-B1.1; canvas-default unification needs an owner
  decision). low: X-PRERENDER-V1, X-STAR-ANCHOR, X-ZINDEX, X-LOSSRED-D (suspected),
  X-1023-IDIOM (suspected), X-STALE-RESIZE (suspected), X-OVERFLOW-X.
- **3 REJECTED_WITH_EVIDENCE**: R-CONNRESET (egress-proxy artifact), R-CREST-GOLD
  (documented Law exception), R-EMOJI-FLAGS (owner directive 2026-07-18 wins).

## Binary gates (exact, no rounding up)

| Gate | Result | Numerator / denominator, and why |
|---|---|---|
| Surface inventory enumerated | PASS | 51/51 surfaces enumerated from code |
| Surfaces runtime-inspected | FAIL (blocked) | 25/51 — 26 surfaces auth- or DB-gated; code-audited only |
| Material-state coverage | FAIL (blocked) | data-rich, authenticated, Stripe-success, OAuth states unreachable in this environment |
| Confirmed-defect closure | FAIL | 26/41 confirmed closed (3 of 44 were rejected as non-defects); 15 open, all documented |
| Skill-decision traceability (fixed scope) | PASS | 28/28 fixed defects trace to apple-design / ui-ux-pro-max / stop-slop criteria + brand law in ledger & commits |
| Integer width sweep on swept routes | PASS | 1,121/1,121 × 2 routes × before+after |
| Width sweep on ALL layout families | FAIL (blocked) | feed/chat/admin families auth-gated |
| Full W×H Cartesian probes | FAIL | not executed (~562k pairs/route); no equivalence proofs claimed |
| Container-dimension sweeps | FAIL | not executed |
| Device-class / real-hardware coverage | FAIL (blocked) | emulation only |
| Cross-engine coverage | FAIL (blocked) | Chromium 1/1 available; WebKit, Firefox absent |
| DPR 1–3, zoom 200%, text 130% | PASS (probed scope) | probed on `/` + 404; calculated backing pixels labeled as calculated |
| Orientation/aspect via resize events | FAIL | width/height sweeps only; no rotation simulation |
| Input-method coverage | FAIL (blocked) | keyboard+mouse emulation; touch/pen/switch unavailable |
| Safe-area / virtual keyboard | FAIL (blocked) | `env()` present and consumed, but no notched hardware to measure |
| Required repository checks | PASS | table above |
| Critical defects | PASS | zero found by any of five auditors or the verifier |
| High-severity open | FAIL | 1 open (X-HEX-EPIDEMIC, deferred migration project) |
| Unresolved confirmed slop (any severity) | FAIL | 15 open, documented |
| Unexplained responsive exceptions | PASS | every exception carries a documented reason |
| Unverified completion claims | PASS | all claims labeled VERIFIED / PARTIAL / BLOCKED / deferred |

Secondary /100 score: **not computed** — the contract only scores after all binary gates
pass.

## What changed (B1–B8, high-level)

Foundations: `:where(.flex)` min-size fix; GG Sans @font-face deleted (4 CSP errors/page →
0); loading-shell reduced-motion guard + visible boot-failure state with focused Reload;
global `animate-*` reduced-motion guard; unified 2px mint base focus ring; 14 dead files
deleted (zero importers, dynamic imports checked). Landing: `/#pricing` fragment scrolling;
≤820px section menu (real button + menu semantics); contrast retier with new achromatic
`--text-tertiary`; 11px floors; rem-based base size; slipbar safe-area + 44px targets;
`:active` press feedback; scaleX progress bars at 160ms; dead blur/shadows removed;
stop-slop copy pass (34 em dashes, 12 antitheses, 3 negative listings, dup pull-quote)
mirrored into the server prerender with parity tests green. Auth: labels/placeholder
tiers/44px targets on login; reset-password destination + aria-live + focus management;
RequireAuth client-side navigation with queryClient.clear(). Checkout/docs: bare
`/checkout` sells $99 (not the retired $99.99); error-branch h1; page titles; legal pages
(server-rendered) get escape header, `<main>`, brand titles, focus outlines, grey tiers.
Feed: outage renders "Projections unavailable" + Retry instead of the false empty state.
Chat CSS: IBM Plex Mono stacks → Familjen per the single-font mandate. Docs: MASTER.md
supersession notes + NEW evidence-derived viewport support contract (320–1920 / 500–1000+ /
DPR 1–3; WebKit/Firefox unverified).
