# Session B REDO — Full-Stack Audit Corrections

**Date:** 2026-07-07  
**Scope:** Disposition 15 vanished full-stack findings, correct §7/§11/§12, decide-or-remediate 4 confirmed-live issues  
**Machinery:** OPERATING-RULES 1-10; INCIDENTS.md = SoT; labels VERIFIED/INFERRED/UNKNOWN  
**Supersedes:** AUDIT-REPORT-V2.1.md (which covered v1 findings only; this REDO covers the 15 full-stack findings from WC2026_APLUS_AUDIT_V2.md that were not dispositioned)

---

## 1. Disposition Table — 15 Vanished Full-Stack Findings

These findings were identified in `WC2026_APLUS_AUDIT_V2.md` but were NOT dispositioned in the prior Session B report (AUDIT-REPORT-V2.1.md). Each is now dispositioned with live evidence.

| ID | Title | Disposition | Evidence | Label |
|---|---|---|---|---|
| SEC-003 | JWT lifetime 90d (stayLoggedIn) | **CARRIED** (open debt) | `appUsers.ts:80` → `.setExpirationTime("90d")`; line 430 → `sessionDays = stayLoggedIn ? 90 : 1` | VERIFIED |
| DB-003 | DIME tables lack FK constraints | **CARRIED** (open debt) | `grep -n "references\|foreignKey" drizzle/dime.schema.ts` → exit 1 (ZERO matches). All 6 DIME tables have no FK enforcement. | VERIFIED |
| DB-004 | DIME new users default 100 credits | **DOWNGRADED** (accepted risk) | `dime-wc2026.route.ts:134` → `balance = rows?.[0]?.balance ?? 100`. Intentional free-tier design. | VERIFIED |
| DB-005 | worldCupRound enum missing r16 | **CARRIED** (schema debt) | `wc2026.schema.ts:549` → enum `["group","r32","quarterfinals","semifinals","third_place","finals"]`. Missing `"r16"`. The `wc2026_matches.stage` enum (line 54) has `"R16"` but `worldCupRound` on odds table does not. | VERIFIED |
| DB-006 | Waitlist no dedicated rate limiter | **CARRIED** (open debt) | `grep -rn "rateLimit\|rateLimiter\|express-rate-limit" server/routers/waitlist.ts` → zero results. Comment on line 8 claims "rate-limited by IP at router level" but only the global 200 req/min/IP limiter (`server/_core/index.ts:325`) covers it. No waitlist-specific throttle. | VERIFIED |
| PERF-002 | Permissive img-src/connect-src in CSP | **DOWNGRADED** (accepted risk) | `server/_core/index.ts:244-245` → `imgSrc: ["'self'","data:","blob:","https:","http:"]`, `connectSrc: ["'self'","wss:","ws:","https:"]`. Required for CDN images + external APIs. | VERIFIED |
| SCRIPT-003 | Python/MJS scraper credential handling | **STRUCK** (resolved) | `betexplorer_scraper.py:84` → `os.environ.get("DATABASE_URL","")`. ESPN scraper uses `getDb()` from `server/db.ts` (env-only). No hardcoded secrets in any scraper file. | VERIFIED |
| PROD-002 | Server never enforces termsAccepted | **CARRIED** (P1 compliance) | `termsAccepted` stored/returned (`appUsers.ts:545,561,562,587,588`) but NO middleware/guard blocks access for `termsAccepted=false` users. Frontend-only gate. | VERIFIED |
| PROD-003 | No cookie-consent mechanism | **CARRIED** (compliance debt) | `grep -rn "cookie.consent\|cookieConsent\|cookie-consent\|CookieBanner" client/src/` → zero results. No GDPR cookie consent UI exists. | VERIFIED |
| PROD-004 | No GDPR data deletion/export | **CARRIED** (compliance debt) | `grep -rn "deleteAccount\|exportMyData\|gdpr\|GDPR" server/` → zero results. No user self-service data deletion or export path. | VERIFIED |
| FE-001 | Admin UI pages lack owner-role gate (client) | **DOWNGRADED** (cosmetic) | `App.tsx:152-162` → admin routes use `RequireAuth` only (auth check). Server uses `ownerProcedure` (19 usages in appUsers.ts, 7 in security.ts, etc.). Non-owner sees empty/error page but CANNOT execute privileged actions. UX issue, not security vulnerability. | VERIFIED |
| FE-002 | Same as FE-001 (SecurityEvents, PublishProjections) | **MERGED** with FE-001 | Same evidence. All admin tRPC procedures use ownerProcedure. | VERIFIED |
| FE-004 | Hero uses emoji sport icons | **DOWNGRADED** (cosmetic/polish) | `Hero.tsx:175-182` → emoji array. Screen readers announce them as text. Not a functional defect. | VERIFIED |
| DEAD-001 | DashboardLayout.tsx unused | **DOWNGRADED** (template artifact) | `grep -rn "DashboardLayout" client/src/` → zero imports outside its own file. Template-provided, never used. | VERIFIED |
| DEAD-003 | AIChatBox.tsx unused | **DOWNGRADED** (template artifact) | `grep -rn "AIChatBox" client/src/` → zero imports outside its own file. Template-provided, never used. | VERIFIED |

### Summary

| Category | Count | IDs |
|----------|-------|-----|
| CARRIED (open debt) | 7 | SEC-003, DB-003, DB-005, DB-006, PROD-002, PROD-003, PROD-004 |
| DOWNGRADED (accepted risk/cosmetic) | 6 | DB-004, PERF-002, FE-001, FE-004, DEAD-001, DEAD-003 |
| STRUCK (resolved) | 1 | SCRIPT-003 |
| MERGED | 1 | FE-002 → FE-001 |

---

## 2. Decide-or-Remediate — 4 Confirmed-Live Issues

### PROD-002: Server never enforces termsAccepted

| Field | Value |
|-------|-------|
| Status | CONFIRMED LIVE |
| Evidence | `termsAccepted` stored in DB, `acceptTerms` mutation exists (line 561), but NO middleware blocks access for `termsAccepted=false` users |
| Decision | **PROPOSE ONLY** (gambling-compliance item, owner decision required) |
| Proposed fix | Add `termsEnforcedProcedure` middleware that checks `user.termsAccepted === true` before subscription-gated features. Exempt: login, profile read, acceptTerms mutation. |
| Blast radius | All authenticated endpoints behind subscription gate |
| Rollback | Remove middleware |

### DB-006: Waitlist no dedicated rate limiter

| Field | Value |
|-------|-------|
| Status | CONFIRMED LIVE |
| Evidence | Zero waitlist-specific rate-limit references. Global 200/min/IP covers it but is too permissive for a public form endpoint. |
| Decision | **CAN IMPLEMENT** (pure security hardening, no compliance concern) |
| Proposed fix | Add `express-rate-limit` to waitlist submit endpoint (5 req/15min/IP) |
| Blast radius | Waitlist submit endpoint only |
| Rollback | Remove middleware |

### PROD-004: No GDPR data deletion/export

| Field | Value |
|-------|-------|
| Status | CONFIRMED LIVE |
| Evidence | Zero GDPR mechanisms in codebase |
| Decision | **PROPOSE ONLY** (legal/compliance, owner decision required) |
| Proposed fix | Add `deleteMyAccount` and `exportMyData` tRPC mutations behind `appUserProcedure` |
| Blast radius | New endpoints only |
| Rollback | Remove mutations |

### SEC-003: 90-day JWT lifetime

| Field | Value |
|-------|-------|
| Status | CONFIRMED LIVE |
| Evidence | `appUsers.ts:80` → `.setExpirationTime("90d")`; line 430 → 90-day cookie |
| Decision | **PROPOSE ONLY** (auth behavior change, owner decision required) |
| Proposed fix | Reduce to 30d with stayLoggedIn, 1d without. Add refresh-token rotation. |
| Blast radius | All existing sessions invalidated on deploy |
| Rollback | Revert expiry constant |

---

## 3. §7 Correction: DB Inventory

### Phantom `stripe_events`: CONFIRMED ABSENT

```
$ grep -rn "stripe_events\|stripeEvents" drizzle/*.ts
(zero results — exit code 1)
```

`stripe_events` does NOT exist as a Drizzle table. The Stripe webhook handler (`server/stripeWebhook.ts`) processes events inline without a dedicated events table. The prior report's reference to this table was incorrect.

### Corrected Inventory: 67 Drizzle Tables

| Domain | Count | Key Tables |
|--------|-------|-----------|
| App/Auth | 6 | app_users, users, user_sessions, discord_invite_tokens, discord_login_states, discord_oauth_states |
| Betting | 6 | bet_edit_requests, games, odds_history, tracked_bets, user_favorite_games, waitlist |
| MLB | 15 | mlb_bullpen_stats, mlb_calibration_constants, mlb_drift_state, mlb_game_backtest, mlb_hr_props, mlb_lineups, mlb_model_learning_log, mlb_park_factors, mlb_pitcher_rolling5, mlb_pitcher_stats, mlb_players, mlb_schedule_history, mlb_strikeout_props, mlb_team_batting_splits, mlb_teams |
| WC2026 | 20 | wc2026_matches, wc2026_teams, wc2026_venues, wc2026_team_aliases, wc2026_match_odds, wc2026_odds_snapshots, wc2026_lineups, wc2026_match_stats, wc2026_match_events, wc2026_model_projections, wc2026_frozen_book_odds, wc2026_espn_bracket, wc2026_espn_matches, wc2026_espn_team_stats, wc2026_espn_match_stats, wc2026_espn_expected_goals, wc2026_espn_glossary, wc2026_espn_lineups, wc2026_espn_player_stats, wc2026_espn_shot_map |
| DIME | 6 | dime_context_audit, dime_credit_ledger, dime_request_audit, dime_response_audit, dime_soak_test_results, dime_user_entitlements |
| Other | 14 | jack_mac_sync_jobs, model_files, nba_teams, nba_schedule_history, ncaam_teams, nhl_teams, nhl_schedule_history, rg_session_cache, security_events, mlb_umpire_modifiers, + 4 more |

**Verification command:** `grep -c "mysqlTable" drizzle/*.ts | awk -F: '{sum+=$2} END {print sum}'` → **67**

---

## 4. §11 Correction: UI/UX Per-Surface (Real Inspection)

### Complete Surface Map (from App.tsx routes)

| # | Surface | Path | Auth | Server Gate | Notes |
|---|---------|------|------|-------------|-------|
| 1 | Landing | `/` | None (public) | N/A | Pre-launch (waitlist mode); 14 lazy sections |
| 2 | Privacy | `/privacy` | None | N/A | Prerendered to ALL UAs (FE-005 CLOSED) |
| 3 | Terms | `/terms` | None | N/A | Prerendered to ALL UAs (FE-005 CLOSED) |
| 4 | Login | `/login` | None | N/A | App user auth form |
| 5 | Pricing | `/pricing` | None | N/A | Standalone pricing page (accessible via direct URL) |
| 6 | Subscribe Success/Cancel | `/subscribe/*` | None | N/A | Post-checkout redirects |
| 7 | Reset Password | `/reset-password` | None | N/A | Self-service |
| 8 | Feed | `/feed` | RequireAuth | appUserProcedure | Primary dashboard (model projections) |
| 9 | Betting Splits | `/betting-splits` | RequireAuth | appUserProcedure | Data display |
| 10 | WC2026 | `/wc2026` | RequireAuth | appUserProcedure | World Cup data |
| 11 | DIME Chat | `/chat` | RequireAuth | Credit-gated (100 free) | AI chat interface |
| 12 | Bet Tracker | `/bet-tracker` | RequireAuth | appUserProcedure | Bet tracking |
| 13 | Admin (11 routes) | `/admin/*` | RequireAuth | ownerProcedure | Owner-only |
| 14 | Mobile Owner | `/m/*` | RequireAuth | ownerProcedure | Mobile layout |

### Landing Page — Pre-Launch Mode Finding

**PricingCTA is NOT rendered.** Line 49 of `LandingPage.tsx`:
```
{/* Waitlist capture — replaces PricingCTA + PremiumValueAnchor during pre-launch */}
```

**WaitlistCapture** has `id="waitlist"` (line 237). There is NO element with `id="pricing"` in the rendered DOM.

### Dead Anchor Links (3)

| Component | Line | Link | Target | Status |
|-----------|------|------|--------|--------|
| ComparisonSection.tsx | 106 | `href="/#pricing"` | No `id="pricing"` element exists | **DEAD** |
| ProductMechanism.tsx | 84 | `href="/#pricing"` | No `id="pricing"` element exists | **DEAD** |
| PremiumValueAnchor.tsx | 23 | `href="/#pricing"` | Component itself is not rendered | **DEAD** |

**Correction to prior V2.1 report:** The V2.1 report stated these links "resolve to the WaitlistCapture section in pre-launch mode, which is the correct behavior." This is FALSE. WaitlistCapture has `id="waitlist"`, not `id="pricing"`. These 3 links scroll to nothing.

---

## 5. §12 Correction: Four False Compliance Claims

The prior report made compliance assertions based on shallow grep evidence. Each is corrected:

### 1. "No picks" — UNREVIEWED BY COUNSEL

| Aspect | Detail |
|--------|--------|
| Grep evidence | `Hero.tsx:139` says "No picks. No lock-of-the-day hype." |
| Reality | App surfaces model projections with win probabilities, implied odds, and edge calculations. Whether this constitutes "picks" under gambling regulation is a legal classification question. |
| Honest status | **UNREVIEWED BY COUNSEL** — text disclaimer does not create legal safe harbor |

### 2. "Gamble responsibly" — TEXT PRESENT, ENFORCEMENT ABSENT

| Aspect | Detail |
|--------|--------|
| Grep evidence | `LandingFooter.tsx:17`, `EdgeExplanation.tsx:146`, `TrustBoundary.tsx:126` contain responsible-gambling text |
| Reality | Server does NOT enforce `termsAccepted` (PROD-002). `AgeModal` is frontend-only. No server-side age verification. No geofencing. NCPG hotline IS linked in Privacy page. |
| Honest status | **TEXT PRESENT, ENFORCEMENT ABSENT** |

### 3. ARIA count (37) — UNKNOWN COMPLIANCE LEVEL

| Aspect | Detail |
|--------|--------|
| Grep evidence | `grep -rc "aria-" client/src/pages/landing/` → 37 attributes |
| Reality | No WCAG 2.1 AA conformance test run. No screen-reader testing. No keyboard-nav audit. Presence of `aria-*` does not prove correct usage. |
| Honest status | **UNKNOWN** — no formal accessibility audit performed |

### 4. Trust signals — UNVERIFIED

| Aspect | Detail |
|--------|--------|
| Grep evidence | `TrustBoundary` component exists, `Hero.tsx:56` has "Eyebrow trust line" |
| Reality | Component renders marketing copy (internal claims). No third-party trust badges (Norton Seal, BBB, SOC2). No external verification. |
| Honest status | **UNVERIFIED** — marketing copy only, no third-party certification |

---

## 6. Corrections.md Pointer Fixes

| Correction | Original Claim | Updated Status |
|------------|---------------|----------------|
| Correction 2 (PROD-001) | "SPA-only, Google executes JS" | **SUPERSEDED:** Server-side prerender added for /privacy and /terms (FE-005 fix). All UAs receive full HTML legal content. |
| Correction 3 (DB-001) | "Cannot test from sandbox, theoretical proof only" | **SUPERSEDED:** 10-concurrent test executed against production DB. Result: 1 success, 9 rejections. Empirically verified. |

Corrections 1, 4, 5, 6, 7 remain accurate as written.

---

## 7. Checkout Procedure Verification (9/9 PASS — Carry Forward)

All 9 Stripe integration checklist items verified PASS in prior Session B work:

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | customer_email prefilled | PASS | Line 100-101: `customerParam = { customer_email: prefillEmail }` |
| 2 | metadata.user_id | PASS | Line 124: `user_id: String(userId)` |
| 3 | client_reference_id | PASS | Line 122: `client_reference_id: userId != null ? String(userId) : undefined` |
| 4 | allow_promotion_codes | PASS | Line 159: `allow_promotion_codes: true` |
| 5 | origin from frontend | PASS | Input schema: `z.string().url()`, frontend passes `window.location.origin` |
| 6 | success_url with session_id | PASS | Line 86: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}&plan=${planId}` |
| 7 | Rate limiting | PASS | 10 per 15min per IP (server/_core/index.ts:348) |
| 8 | Webhook at /api/stripe/webhook | PASS | Configured and verified in SEC-002 |
| 9 | evt_test_ handling | PASS | Returns `{ verified: true }` for test events |

---

## 8. Final Register — Full-Stack Findings

| ID | Status | Owner | Priority |
|----|--------|-------|----------|
| SEC-003 | CARRIED (open debt) | Owner decision | P2 |
| DB-003 | CARRIED (open debt) | Owner decision | P3 |
| DB-004 | DOWNGRADED (accepted risk) | Accepted | — |
| DB-005 | CARRIED (schema debt) | Agent (can fix) | P3 |
| DB-006 | CARRIED (open debt) | Agent (can implement) | P2 |
| PERF-002 | DOWNGRADED (accepted risk) | Accepted | — |
| SCRIPT-003 | STRUCK (resolved) | N/A | — |
| PROD-002 | CARRIED (P1 compliance) | Owner decision | P1 |
| PROD-003 | CARRIED (compliance) | Owner decision | P2 |
| PROD-004 | CARRIED (compliance) | Owner decision | P2 |
| FE-001 | DOWNGRADED (cosmetic) | Backlog | P4 |
| FE-002 | MERGED with FE-001 | — | — |
| FE-004 | DOWNGRADED (cosmetic) | Backlog | P4 |
| DEAD-001 | DOWNGRADED (template artifact) | Backlog | P5 |
| DEAD-003 | DOWNGRADED (template artifact) | Backlog | P5 |

---

## 9. User-Owned Actions

1. **PROD-002 decision:** Accept risk OR approve `termsEnforcedProcedure` implementation
2. **SEC-003 decision:** Accept 90d JWT OR approve reduction to 30d + refresh-token rotation
3. **PROD-003 decision:** Accept risk OR approve cookie-consent banner implementation
4. **PROD-004 decision:** Accept risk OR approve GDPR delete/export implementation
5. **DB-006 approval:** Approve waitlist rate-limiter implementation (5 req/15min/IP)
6. **DB-005 fix:** Approve adding `"r16"` to `worldCupRound` enum (requires schema change)
7. **Dead links:** 3 `/#pricing` anchor links in ComparisonSection, ProductMechanism, PremiumValueAnchor — fix by adding `id="pricing"` to WaitlistCapture or updating links to `/#waitlist`
8. **ROTATION-CHECKLIST.md:** Complete MUST ROTATE items (SEC-006 closer)
9. **Legal review:** Picks classification, responsible-gambling enforcement, Terms §11 governing law

---

## 10. Blockers

| Blocker | Blocks | Resolution |
|---------|--------|-----------|
| drizzle-kit hangs | DB-007 zero-drift proof, DB-002 closure | Manual SHOW CREATE TABLE comparison |
| Owner decisions (4) | PROD-002, SEC-003, PROD-003, PROD-004 | Awaiting owner verdict |
| INC-007 (sandbox landmine) | Clean git history | Platform ticket or accept risk |
| INC-002 (PAT rotation) | SEC-006 closure | User-owned, never request token |

---

## 11. Session B REDO Verdict

This REDO report supersedes `AUDIT-REPORT-V2.1.md` for the 15 full-stack findings. Combined with the V2.1 report (which covers the 20 v1 findings), the complete audit disposition is:

- **V1 findings (20):** 8 REMEDIATED, 8 OPEN (various debt), 1 PARTIALLY REMEDIATED, 2 ACCEPTED, 1 NOT CHECKED
- **Full-stack findings (15):** 7 CARRIED, 6 DOWNGRADED, 1 STRUCK, 1 MERGED
- **Checkout procedure:** 9/9 PASS
- **§7 DB inventory:** 67 tables (stripe_events = phantom, removed)
- **§11 surface map:** 14 surfaces, 3 dead `/#pricing` links identified
- **§12 compliance:** All 4 claims corrected to honest status (UNREVIEWED/ABSENT/UNKNOWN/UNVERIFIED)

**Session C scope (next, after acceptance):** Landing-page + Stripe deep audits (read-only).  
**Workstream W (after acceptance):** WC2026 data population from live scrapers.
