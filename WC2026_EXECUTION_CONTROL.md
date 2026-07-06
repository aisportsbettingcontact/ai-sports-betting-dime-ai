# WC2026 Execution Control

**Created:** 2026-07-06  
**Branch:** wc2026-tier1-repair  
**Target:** Tier 1 Basic Display Safe  
**Status:** TIER 1 GATE PASSED

---

## Execution Order

| Step | Fix ID | Description | Status | Verified |
|------|--------|-------------|--------|----------|
| 1 | A1 | espnIngest → ownerProcedure | COMPLETE | ✓ TypeScript compiles, ownerProcedure confirmed |
| 2 | A2 | Dime backend auth middleware | COMPLETE | ✓ TypeScript compiles, sdk.authenticateRequest before Claude call |
| 3 | A3 | Deduplicate projections | COMPLETE | ✓ 14 extras archived, 0 duplicates remain, 92 rows |
| 4 | A4 | Add UNIQUE(match_id, model_version) | COMPLETE | ✓ uq_match_version created, duplicate INSERT rejected |
| 5 | A5 | Align Drizzle model_version to varchar(128) | COMPLETE | ✓ Drizzle=128, DB=128, UNIQUE index compound |

---

## Non-Negotiable Rules

1. One fix at a time.
2. Pre-state captured before every change.
3. Post-state verified immediately after.
4. Rollback commands recorded for every fix.
5. No model math, odds canonicalization, Dime context, CLV, lineage redesign, UI, or warehouse expansion until Tier 1 passes.
6. Fail closed on ambiguous data.
7. No silent writes.

---

## Gate Criteria (Tier 1)

- [x] Non-owner espnIngest call returns 401 (UNAUTHORIZED via tRPC) ✓
- [x] Unauthenticated Dime curl returns 401 (no Claude call made) ✓
- [x] Duplicate projection query returns 0 rows (was 14 extras, now 0) ✓
- [x] INFORMATION_SCHEMA shows UNIQUE(match_id, model_version) via uq_match_version ✓
- [x] ON DUPLICATE KEY UPDATE now functional (UNIQUE constraint enforces upsert) ✓
- [x] /wc2026 returns HTTP 200, tRPC endpoints return valid match data ✓
- [x] Repair manifest complete with all 5 fixes documented ✓

## Tier 1 Gate: PASSED

**All 7 criteria verified. System is at Tier 1 Basic Display Safe.**
