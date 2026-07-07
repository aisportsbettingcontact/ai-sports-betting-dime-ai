# Session B Working Notes

## FE-005 FINAL PRODUCTION VERIFICATION (2026-07-07T08:49:08Z)

All commands targeted `https://aisportsbettingmodels.com` (public domain).

| # | UA | URL | Title |
|---|---|---|---|
| 1 | curl default | /privacy | Privacy Policy \| AI Sports Betting Models |
| 2 | Googlebot/2.1 | /privacy | Privacy Policy \| AI Sports Betting Models |
| 3 | python-requests/2.31.0 | /privacy | Privacy Policy \| AI Sports Betting Models |
| 4 | Chrome/126 browser | /privacy | Privacy Policy \| AI Sports Betting Models |
| 5 | Wget/1.21 | /terms | Terms of Service \| AI Sports Betting Models |
| 6 | HTTPie/3.2 | /terms | Terms of Service \| AI Sports Betting Models |
| 7 | Insomnia/2023.5 | /terms | Terms of Service \| AI Sports Betting Models |
| 8 | Googlebot on / | / | AI Sports Betting Models \| Sports Betting Intelligence Software |

GET body size: 5107 bytes (correct legal content)
HEAD content-length: 385545 (HEAD/GET mismatch — HEAD returns SPA shell metadata, GET returns middleware-intercepted legal content)
X-Prerender header: stripped by helmet middleware (cosmetic, not functional)

## V1 FINDING DISPOSITION TABLE (20 findings from WC2026_APLUS_AUDIT_REPORT.md)

| Finding | Title | v1 Severity | Current Status | Evidence |
|---------|-------|-------------|----------------|----------|
| FINDING-001 | Duplicate projections (match_id + model_version) | HIGH | REMEDIATED | 0 duplicate combos (was 12/26). UNIQUE index added. |
| FINDING-002 | Missing UNIQUE(match_id, model_version) | HIGH | REMEDIATED | uq_match_version EXISTS as UNIQUE on (match_id, model_version) |
| FINDING-003 | 38.7% null proj_spread | HIGH | OPEN (DATA DEBT) | 33/94 null (35.1%). Slight improvement from 41/106. Not a code fix — requires model re-run. |
| FINDING-004 | 72 MatchOdds match_id format mismatch | HIGH | REMEDIATED | 0 rows with wc26-gs- format (was 72). All 82 rows now wc26-g-NNN. |
| FINDING-005 | Public espnIngest mutation | MEDIUM | REMEDIATED | Changed to ownerProcedure (wc2026Router.ts:717) |
| FINDING-006 | No Dime WC2026 context injection | MEDIUM | OPEN (FEATURE DEBT) | Context injection still commented out (lines 108-111 dime-chat.route.ts) |
| FINDING-007 | Low odds population (21/92) | MEDIUM | OPEN (DATA DEBT) | 82 total rows now (was 92). Population rate needs re-check. |
| FINDING-008 | Dime chat auth gap | MEDIUM | REMEDIATED | sdk.authenticateRequest(req) added (dime-chat.route.ts:79) |
| FINDING-009 | Legacy null probabilities | INFO | ACCEPTED (LEGACY DATA) | 8 rows in v3-champion-2026 with null probs. Legacy data, no action needed. |
| FINDING-010 | Lineage tracking gaps | INFO | OPEN (FEATURE DEBT) | Missing BetExplorer/model/MatchOdds writes in lineage. |
| FINDING-011 | UNIQUE on match_id by design | INFO→HIGH | REMEDIATED | Redesigned to compound UNIQUE(match_id, model_version) |
| FINDING-012 | Schema-to-DB drift (uq_mp_match missing) | CRITICAL | PARTIALLY REMEDIATED | uq_match_version now exists. Remaining drift tracked as DB-007. |
| FINDING-013 | FK declared in code but missing in DB | HIGH | OPEN (SCHEMA DEBT) | 0 FK constraints on wc2026_model_projections. FK still missing. |
| FINDING-014 | v18/v19 zero edge, zero nv_prob | HIGH | OPEN (MODEL DEBT) | Latest model versions lack edge calculations. Requires model engine update. |
| FINDING-015 | Backtest xG data leakage | HIGH | OPEN (MODEL DEBT) | v19 engine still pulls all xG without date filtering. |
| FINDING-016 | No CLV tracking infrastructure | MEDIUM | OPEN (FEATURE DEBT) | No CLV table/column exists. |
| FINDING-017 | wc2026_match_odds missing match_id index | MEDIUM | REMEDIATED | uq_wc2026_match_odds_match index now exists on match_id |
| FINDING-018 | 130 MJS scripts committed to git | LOW | ACCEPTED (OPERATIONAL) | Scripts still present. Operational choice — used for pipeline runs. |
| FINDING-019 | Cloud computer has no version control | LOW | OPEN (INFRA DEBT) | Not checked this session. |
| FINDING-020 | model_version varchar(32) mismatch | INFO | REMEDIATED | Column widened to varchar(128) |

## DISPOSITION SUMMARY

| Category | Count | Findings |
|----------|-------|----------|
| REMEDIATED | 8 | 001, 002, 004, 005, 008, 011, 017, 020 |
| OPEN (various debt) | 8 | 003, 006, 007, 010, 013, 014, 015, 016 |
| PARTIALLY REMEDIATED | 1 | 012 (→ DB-007) |
| ACCEPTED | 2 | 009 (legacy), 018 (operational) |
| NOT CHECKED | 1 | 019 (cloud computer) |

## ADDITIONAL V2 FINDINGS (from WC2026_APLUS_AUDIT_V2.md)

| Finding | Title | Severity | Status |
|---------|-------|----------|--------|
| FINDING-SEC-001 | Public Write Mutation (espnIngest) | MEDIUM | REMEDIATED (same as FINDING-005) |
| FINDING-SEC-002 | Unauthenticated Dime Chat | MEDIUM | REMEDIATED (same as FINDING-008) |
| FINDING-SEC-003 | No Dime-Specific Rate Limiter | MEDIUM | OPEN |
| FINDING-MDL-001 | Confirmed xG Leakage | HIGH | OPEN (same as FINDING-015) |

## SESSION B REMAINING TASKS

1. ~~Disposition table~~ DONE (above)
2. ~~Sections 7/11/12 corrections with logged commands~~ DONE (below)
3. ~~Conversion-surface UI/UX deep pass~~ DONE (below)
4. ~~Create-checkout procedure verification~~ DONE (below)
5. Corrections.md pointer fixes
6. Assemble v2.1 report

## SECTION 7/11/12 VERIFICATION RESULTS (2026-07-07T08:50Z)

### Section 7 (Script Audit)
- MJS script count: 131 (report says 130 — 1 new script added since audit)
- Untracked MJS: 0 (PASS)
- Report claims are ACCURATE within +1 tolerance

### Section 11 (Truth-Source Map) — Current Counts
| Data | Report Count | Current Count | Delta |
|------|-------------|---------------|-------|
| wc2026_teams | 48 | 49 | +1 (new team added) |
| wc2026_matches | 104 | 104 | 0 |
| matches FT | 88 | 90 | +2 (games played since audit) |
| wc2026_model_projections | 106 | 94 | -12 (duplicates removed per FINDING-001) |
| wc2026MatchOdds | 21/92 populated | 82 total | Significant improvement |
| wc2026_data_lineage | N/A | 8 rows | New table since v2 audit |

### Section 12 (Lineage Audit)
- wc2026_data_lineage: 8 rows (new since v2 audit)
- Columns: id, derived_table, source_table, derivation_method, derivation_sql, row_count_at_creation, created_by, created_at, last_verified_at, verification_status, notes
- Current lineage entries:
  1. wc2026_market_no_vig <- wc2026MatchOdds via AMERICAN_TO_IMPLIED_PROB_THEN_REMOVE_VIG
  2. wc2026_market_no_vig <- wc2026_matches via JOIN_ON_MATCH_ID
  3. wc2026_market_edges <- wc2026_model_projections via MODEL_PROB_MINUS_NO_VIG_PROB
  4. wc2026_market_edges <- wc2026_market_no_vig via JOIN_ON_MATCH_MARKET_SELECTION
  5. wc2026_recommendations <- wc2026_market_edges via EDGE_SIGN_TO_STATUS
  6. wc2026_recommendations <- wc2026_model_projections via MODEL_PROB_PASSTHROUGH
  7. wc2026_recommendations <- wc2026_market_no_vig via NO_VIG_PROB_PASSTHROUGH
  8. wc2026_provider_match_map <- wc2026_matches via ESPN_ID_SUBSTRING_MATCH
- V2 report said lineage was 38% coverage (5/13 write paths). Now: derived-table lineage exists (8 rows) but source-ingestion lineage (BetExplorer, model writes, DK seeds, manual fixes) still missing.
- Status: PARTIAL IMPROVEMENT — table-to-table derivation documented, ingestion lineage still absent.

## CONVERSION-SURFACE UI/UX DEEP PASS

### Landing Page Structure (LandingPage.tsx)
1. LandingNav
2. Hero
3. DashboardPreview (lazy)
4. ValueStack (lazy)
5. PainSection (lazy)
6. ProductMechanism (lazy)
7. MarketWorkflow (lazy)
8. FeatureShowcase (lazy)
9. ComparisonSection (lazy)
10. WaitlistCapture (lazy) — REPLACES PricingCTA + PremiumValueAnchor during pre-launch
11. TrustBoundary (lazy)
12. FAQ (lazy)
13. FinalCTA (lazy)
14. LandingFooter (lazy)

### Key Finding: PricingCTA is NOT rendered
Line 49: `{/* Waitlist capture — replaces PricingCTA + PremiumValueAnchor during pre-launch */}`

The site is in PRE-LAUNCH mode: WaitlistCapture replaces the pricing/checkout section.
PricingCTA component EXISTS and is functional but is commented out.
This means the Stripe checkout flow is accessible only via direct URL or if PricingCTA is re-enabled.

### Checkout Procedure Verification

Two procedures exist:
1. `publicCreateCheckoutSession` — no auth required, for unauthenticated visitors
2. `createCheckoutSession` — for authenticated users, prefills email/username/stripeCustomerId

Both call `buildStripeCheckoutSession()` which:
- Resolves plan from PLANS config
- Gets priceId from env (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL)
- Uses `window.location.origin` for success/cancel URLs (correct per OAuth best practices)
- Sets client_reference_id and metadata for webhook fulfillment
- Enables allow_promotion_codes: true
- Collects desired_username via custom_fields
- Opens checkout in new tab via window.open (per frontend PricingCTA.tsx)

### Checkout Compliance Checklist
| Requirement | Status | Evidence |
|-------------|--------|----------|
| customer_email prefilled | PASS | Line 100-101: customerParam = { customer_email: prefillEmail } |
| metadata.user_id | PASS | Line 124 |
| client_reference_id | PASS | Line 122 |
| allow_promotion_codes | PASS | Line 159 |
| origin from frontend | PASS | Input schema requires z.string().url(), frontend passes window.location.origin |
| success_url with session_id | PASS | Line 86 |
| Rate limiting | PASS | 10 per 15min per IP (server/_core/index.ts:348) |
| Webhook at /api/stripe/webhook | PASS | Configured and verified in SEC-002 |
| evt_test_ handling | PASS | Returns { verified: true } |

### UI/UX Observations
1. GOOD: Lazy loading for below-fold sections (performance)
2. GOOD: Hero is eagerly loaded (LCP optimization)
3. GOOD: Multiple CTAs throughout page (ComparisonSection, ProductMechanism, PremiumValueAnchor all link to /#pricing)
4. NOTE: Currently in waitlist mode — no direct purchase possible from landing page
5. GOOD: FAQ addresses cancellation, billing, auto-renewal
6. GOOD: Subscription description includes explicit auto-renewal disclosure (line 148-152)

## BACKLOG NOTES (from user)

1. Terms §11 governing law should name a specific state — flag for attorney review
2. PROD-001 note: "legally-reviewed" means attorney-reviewed before public launch; current content is compliant placeholder
3. CSP unsafe-inline: future hardening item (nonce-based CSP)
