# Recovery Artifacts Index

Exported: 2026-07-08T06:35Z  
Purpose: Remove Manus sandbox as single point of failure. All artifacts needed for P1-P4 population are here.

## BetExplorer Odds Captures (R16, Jul 4-5)

| File | Content | Matches |
|------|---------|---------|
| jul4_fresh_scrape.json | Structured multi-market odds | r16-089, r16-090 |
| jul4_final_state.json | Full publication state | r16-089, r16-090 |
| jul5_complete_book_odds.txt | All markets text | r16-091, r16-092 |
| jul5_final_state.txt | Full publication state | r16-091, r16-092 |
| betexplorer_jul4_odds.txt | Raw BetExplorer scrape output | r16-089, r16-090 |
| jul4_db_state.txt | DB state at time of Jul 4 audit | Reference |
| jul4_db_vs_fresh.txt | Comparison: DB vs fresh scrape | Reference |

## Seed Scripts (frozen_book_odds writers)

| File | Matches Covered |
|------|-----------------|
| seedJune28CAN_RSA.mjs | r32-073 |
| seedJune29Direct.ts | r32-074, 075, 076 |
| seedJune30Direct.ts | r32-077, 078, 079 |
| seedJuly1Direct.ts | r32-080, 081, 082 |
| seedJuly2BookOdds.ts | r32-083, 084, 085 |
| fix_seeded_odds.mjs | Original fix (superseded) |
| fix_seeded_odds_v2.mjs | DATA-001 swap fix (r16-089/090) + R32 corrections |

## ESPN Audit Reports

| File | Content |
|------|---------|
| WC2026_ESPN_FORENSIC_AUDIT_REPORT.md | 4 R32 matches, 1101 PASS / 0 FAIL |
| WC2026_FORENSIC_AUDIT_500X_REPORT.md | Full system state Jul 6 |
| espn_ingest_test_760414.txt | Sample ESPN ingest test (group stage) |
| espn_ingest_test_760415.txt | Sample ESPN ingest test (group stage) |
| espn_ingest_test_760416.txt | Sample ESPN ingest test (group stage) |

## Production Write Artifacts

| File | Content |
|------|---------|
| r16-096_raw_payload.json | ESPN raw API response for r16-096 |
| r16-096_ingest_result.json | Ingest result with row counts |
| r16-096_run_log.md | Full run log with evidence |

## Not Exported (available in .manus-logs/)

- 86 ESPN ingest test files (.manus-logs/espn_ingest_test_*.txt) — too large for bulk copy, 3 samples included above
- Full forensic audit raw data — summarized in reports above

## Provenance Notes

- All BetExplorer files are timestamped Jul 4-5 2026, match-time captures
- Seed scripts define hardcoded values from original manual research
- fix_seeded_odds_v2.mjs was NEVER applied to live DB (DATA-001 still open at time of export)
- ESPN forensic audit: 100% pass rate on 4 R32 matches (truth anchor: 760487 JPN vs BRA 1-2)
