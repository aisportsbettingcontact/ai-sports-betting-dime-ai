# Remediation Log — Phase 3+ (write-authorized at CHECKPOINT ALPHA, 2026-07-25)

Every batch: snapshot-backed (B1), dry-run first, transactional, idempotent, StatsAPI-verified
where external facts were needed. Scripts in `tools/remediation/`. Timestamps UTC.

| Batch | Time | Action | Rows | Evidence |
|---|---|---|---|---|
| B1 | 14:30 | Snapshots: `games` (MLB), `mlb_game_backtest`, `mlb_strikeout_props`, `mlb_hr_props`, `mlb_schedule_history` → `*_audit_bak_20260725` | 7,230 + 12,720 + 2,883 + 17,505 + 10,442 copied, counts verified equal | b1 output in action log |
| B2 | 14:35 | 49 updates: 37 zombie live/upcoming→final with scores, 3 →postponed, 7 score fills, SF@ATL 6/16 postponed→final, All-Star final. Finals 1,508→1,547; finals missing actuals → 0 | 49 | b2 output |
| B3 | 14:50 | DH/postponement reconciliation, 16 updates keyed by mlbGamePk, all StatsAPI-verified: 9 date moves (games existed under stale pre-postponement dates), 3 score corrections on final rows that held the twin game's score (STL@CIN G2 8-1→6-7, DET@BAL G1 4-1→3-5, MIL@STL G2 4-3→10-2 — finding D-011), 4 flag fixes. Schedule: BOS@BAL dup row 287485 → 4/25 17-1; TB@BOS 287980 stale scheduled → postponed. Finals = 1,556 = schedule complete count. First execute aborted+rolled back on games_matchup_unique (fixed by ordering renumbers before date moves) | 16 + 2 | b3 output |
| B3b | 15:05 | 4/30 DH G2 pk transfers: physical games listed twice (4/29 postponed leftovers 2250429/2250432 held pks 824850/823471; manual 4/30 G2 rows 3270003/3270004 held actuals+props). Pk moved to canonical played-game rows; 4/29 rows remain factual postponement records; their 4 pregame K props book-void (EX-POSTPONED-PROP) | 4 | b3b output |
| B4 | 14:58 | Derived actuals: NRFI binary from string ×512; actualFgTotal fill ×563; StatsAPI linescores ×564 games → F5 away/home/total + first-inning NRFI. Post-state over 1,556 finals: missing F5=1, NRFI=1, fgTotal=0 (the 1 = All-Star exhibition, EX-ALLSTAR) | 512 + 563 + 564 games | b4 output |
| B5 | 15:02+15:08 | Prop actuals from 607+322 boxscores: 614 K actualKs (starter-verified; 56 scratches exempted EX-SCRATCH-K), 1,648+38 HR actualHr (663 remaining = scratches + ASG, exempted). Exemptions in census/exemptions.csv (deduped) | 614 K + 1,686 HR | b5 output |
