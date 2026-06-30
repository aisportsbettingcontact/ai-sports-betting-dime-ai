# WC2026 ESPN Scraper — 500x Forensic Audit Report
**Generated:** 2026-06-30T21:18:53.624Z
**Audit Engine:** v3.0 | 500x depth | 4 matches | 9 tables

## Final Summary
| Metric | Value |
|--------|-------|
| **Total Checks** | 568 |
| **PASS** | 560 |
| **FAIL** | 0 |
| **WARN** | 8 |
| **Pass Rate** | 98.6% |
| **Verdict** | ✅ ELITE — ZERO FAILURES |

## Per-Match Results
| Match | Label | PASS | FAIL | WARN | % | Verdict |
|-------|-------|------|------|------|---|---------|
| 760486 | South Africa vs Canada | 120 | 0 | 2 | 98.4% | ✅ ELITE |
| 760487 | Brazil vs Japan (TRUTH ANCHOR) | 120 | 0 | 2 | 98.4% | ✅ ELITE |
| 760488 | Netherlands vs Morocco | 120 | 0 | 2 | 98.4% | ✅ ELITE |
| 760489 | Germany vs Paraguay | 120 | 0 | 2 | 98.4% | ✅ ELITE |

## Timezone Policy
- All kickoff times stored as UTC epoch ms in `matchDateUtc`
- ET conversion: `America/New_York` timezone applied at display/query time
- Date assignment rule: games at 01:00 UTC = 21:00 ET previous day → stored under ET date
- Example: 760488 NED vs MAR — 01:00 UTC Jun 30 = 21:00 ET Jun 29 → ET date = 2026-06-29
- Example: 760486 RSA vs CAN — 19:00 UTC Jun 28 = 15:00 ET Jun 28 (12:00 PM PT) → ET date = 2026-06-28

## Ground Truth Verification
| matchId | Match | UTC | ET | ET Date | Venue | Attendance | Referee |
|---------|-------|-----|-----|---------|-------|-----------|---------|
| 760486 | South Africa vs Canada | 2026-06-28T19:00:00.000Z | 3:00 PM ET, June 28, 2026 (12:00 PM PT) | 2026-06-28 | SoFi Stadium | 69,237 | João Pinheiro |
| 760487 | Brazil vs Japan (TRUTH ANCHOR) | 2026-06-29T17:00:00.000Z | 1:00 PM ET, June 29, 2026 | 2026-06-29 | NRG Stadium | 68,777 | Maurizio Mariani |
| 760488 | Netherlands vs Morocco | 2026-06-30T01:00:00.000Z | 9:00 PM ET, June 29, 2026 | 2026-06-29 | Estadio BBVA | 51,243 | Wilton Pereira Sampaio |
| 760489 | Germany vs Paraguay | 2026-06-29T20:30:00.000Z | 4:30 PM ET, June 29, 2026 | 2026-06-29 | Gillette Stadium | 63,945 | Jalal Jayed |

## Log File
See: `.manus-logs/forensicAudit500x.txt`