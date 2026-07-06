# Tier 4 Dime Activation — Progress State

## COMPLETED BLOCKS

### Block 0: Preflight Baseline ✓
- All P0 counts verified (104/49/16/88/88/2742/90/92)
- Tier 3 checks passed (0 null ESPN IDs, rec status correct)
- Backups created for Tier 4 work

### Block 1: Dime Auth/Subscription/Credit Gate ✓ (FULLY VERIFIED)
- Tables created: dime_user_entitlements, dime_credit_ledger, dime_request_audit, dime_context_audit, dime_response_audit
- Route: POST /api/dime/wc2026 (server/dime-wc2026.route.ts)
- Context builder: server/dime/wc2026Context.ts
- 14-step enforcement chain verified operational
- Tests: 401 (unauth), 403 (no sub), 200 (owner full pipeline)
- Claude response was source-grounded, zero hallucination
- Cited exact model versions, edge values, fair odds, holdout status
- Correctly reported 0 BET recommendations active

### Block 2: WC2026 Context Builder ✓ (embedded in Block 1)
- Loads 104 matches with teams/venues
- Loads odds (book_home_ml, book_draw, book_away_ml)
- Loads projections (latest version per match)
- Loads no-vig probabilities
- Loads edges
- Loads recommendations with status/freshness/market
- Loads model grades
- Builds structured context package for Claude

### Block 3: System Prompt ✓ (embedded in Block 1)
- Source-grounding contract: only cite data from context
- Refusal logic: refuse when data missing
- 22-path answer matrix support via intent classification

### Block 4: Response Logger + Credit Deduction ✓ (embedded in Block 1)
- dime_request_audit: logs every request lifecycle
- dime_response_audit: logs response content
- dime_credit_ledger: deducts 1 credit per ANSWER, 0 for refusals
- dime_context_audit: logs context build metadata

## REMAINING BLOCKS

### Block 5: 22-Path Dime Matrix Validation (NEXT)
Need to test all 22 response paths with actual requests.

### Block 6: Rate Limit and Abuse Control
- Already implemented in-memory (10 req/min)
- Need to test the rate limit enforcement

### Block 7: Final Tier 4 Activation Gate
- Score all criteria
- Produce report
- Save checkpoint

## KEY SCHEMA REFERENCE

### wc2026MatchOdds columns (1X2):
- book_home_ml (NOT book_home)
- book_draw
- book_away_ml (NOT book_away)
- odds_updated_at, odds_source, market_status

### wc2026_teams: name (NOT team_name)
### wc2026_venues: stadium (NOT venue_name), city

### JWT for app_session:
{ sub: String(userId), role, type: 'app_user', tv: tokenVersion }
Signed with HS256 using process.env.JWT_SECRET

### Owner test token generation:
```js
const { SignJWT } = require('jose');
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const token = await new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(secret);
```

### Route registration:
- server/_core/index.ts line 444: app.use("/api/dime", dimeWc2026Router)
- server/dime-wc2026.route.ts: full 14-step enforcement

### Bug fixes applied:
- wc2026_teams.team_name → name
- wc2026_venues.venue_name → stadium
- wc2026MatchOdds.book_home → book_home_ml (aliased)
- wc2026MatchOdds.book_away → book_away_ml (aliased)
- wc2026_model_grades.grade_value → metric_value (aliased)
