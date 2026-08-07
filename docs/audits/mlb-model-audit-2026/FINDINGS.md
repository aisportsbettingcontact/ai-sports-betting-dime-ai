# Findings Register — MLB Model Audit 2026

Status values: OPEN / FIX EXECUTED (evidence) / RECOMMENDED ONLY. Nothing below has been fixed;
all writes are gated behind CHECKPOINT ALPHA. Series: M (model logic), D (data/coverage),
C (calibration/bias), P (pipeline/process). Evidence class per claim: VERIFIED unless marked
INFERRED. Locations reference the audit artifacts that contain the full evidence.

| ID | Sev | Market(s) | Finding | Evidence | Status |
|---|---|---|---|---|---|
| M-101 | **P0** | F5, NRFI, FG | `games` grading columns grade a fixed away-side bet, not the model's pick; 104/104 stored `f5MlCorrect` follow "away won F5"; `nrfiCorrect` source vanished; `fgMlCorrect` never populated. Any consumer of these columns misreports accuracy. | GRADING-REPORT §M-101; query log 13:5x UTC | OPEN |
| M-103 | P1 | K props | Stored grades contradict raw data: 108/1,945 side labels, 197/1,943 correct flags, `modelError` matches no consistent definition. | grading/consistency-k-mismatches.csv | OPEN |
| C-001 | P1 | FG total | Totals under-projected −0.54 ±0.23 runs (n=1,467); survives leakage exclusion (−0.575 ±0.283, n=966); present in all slices, Apr/Jun/Jul. | GRADING-REPORT §C-001 | OPEN |
| C-002 | **P0** | K props | `kProj` biased −0.99 ±0.11 K; published over-probabilities anti-calibrated in tails (stated 7% → observed 46%; stated 84% → observed 31%); 87% of picks forced UNDER. | GRADING-REPORT §C-002; reliability tables | OPEN |
| C-003 | P1 | HR props | Negative Brier skill vs 10.97% base rate (0.09867 vs 0.09767, n=7,529); mean predicted 0.094 vs 0.110 actual (≈4.4σ low). | GRADING-REPORT §C-003 | OPEN |
| C-004 | P1 | NRFI | No signal: hit 51.3% ±2.5, Brier 0.2502 ≈ coin flip, non-monotone reliability. | GRADING-REPORT §C-004 | OPEN |
| C-005 | P2 | FG/F5 ML | Probabilities compressed toward 0.5 (underconfident); monotone reliability → scaling candidate. | GRADING-REPORT §C-005 | OPEN |
| D-001 | P1 | all | 11 completed games (8 DH game-2s) never created in `games`; zero projections, silently absent from product. | CENSUS-REPORT §D-001 | OPEN |
| D-002 | P1 | all | May 5–7 outage: 37 zombie games stuck live/upcoming, no outcome ingestion. | CENSUS-REPORT §D-002 | OPEN |
| D-003 | P2 | all | BOS@BAL 4/25→4/26 reschedule left a reverse orphan + unlinked schedule row. | CENSUS-REPORT §D-003 | OPEN |
| D-004 | P1 | game markets | 17 completed games lack all projections (incl. Opening Day NYY@SF). | CENSUS-REPORT §D-004 | OPEN |
| D-005 | P2 | NRFI | 512 games: `nrfiActualResult` set, `actualNrfiBinary` null (pure derivation). | CENSUS-REPORT §D-005 | OPEN |
| D-006 | P1 | HR props | June outage: 368/392 June games have zero HR props; Apr 5,529 rows lack projections; 1,990 rows on completed games lack actuals. | CENSUS-REPORT §D-006 | OPEN |
| D-007 | P1 | all game markets | Backtest ledger enrollment collapsed June onward: 654 completed games absent (Jun 341, Jul 202, May 111). | CENSUS-REPORT §D-007 | OPEN |
| D-008 | P1 | all | CLV/closingOdds never populated (0/12,720 rows) despite closing lines captured since 4/11; closing capture itself only ~65%. | CENSUS-REPORT §D-008 | OPEN |
| D-009 | P2 | K props | 539 completed-game prop rows lack `actualKs`; presumed scratches, needs row-level verification. | CENSUS-REPORT §D-009 | OPEN |
| D-010 | P2 | all | March: 100% of games quarantined in ledger (provenance, odds, actuals gaps). | CENSUS-REPORT §D-010 | OPEN |
| P-001 | P1 | all | Projection provenance destroyed: `modelRunAt` clobbered by re-runs (286 games ≥ first pitch, props avg +8.9h); pregame provenance unprovable; INFERRED values are genuine pregame (poor accuracy inconsistent with post-hoc contamination). | GRADING-REPORT §P-001 | OPEN |
| P-002 | P1 | all | No projection-level grading existed in production; ledger grades bets only; games grading columns dead. | GRADING-REPORT §P-002 | OPEN |
| P-003 | P2 | all | Probability scale inconsistency across columns (0–100 vs 0–1: `modelOverRate` vs `modelF5OverRate`/`modelPNrfi`). | schema + scale probes, action log | OPEN |
| P-004 | P2 | all | Zombie statuses (`live`/`upcoming` on past games) also poison `gameStatus`-derived logic; 2 games have `gameNumber=2` with `doubleHeader='N'`. | census probes | OPEN |

M-2xx reserved for Phase 0 dossier finding candidates (workflow in flight at time of writing;
appended after verification).

Not confirmed (logged to prevent re-litigation): F5 RL 47.7% (CI reaches 51%), FG-total tail
buckets (n small), June F5-total bias −1.5 (outage-contaminated sample). Retest post-backfill.

## M-2xx — Phase 0 dossier findings (curated; full candidate lists in phase0/*.md)

Verification status per section: `fullgame` and `hrprops` were adversarially verified by
independent agents (74 claims: 69 confirmed/5 corrected/0 unbacked; 121: 115/6/0). The other six
sections are tracer-output with **supervisor spot-verification of the load-bearing claims marked
SV below**; their full verification is queued (verifier agents hit the session usage limit —
P-005). Unmarked claims from those sections are single-agent traced, not yet independently
verified.

| ID | Sev | Section | Finding | Status |
|---|---|---|---|---|
| M-201 | P1 | fullgame✓/exposure | `publishedModel`/`publishedToFeed` set true unconditionally on every write (`mlbModelRunner.ts:4337-4338` — the cite formerly read `:2548`, which is stale); the 70%-accuracy publication gate (`mlbPublicationGate.ts`) is dead code, imported only by its own test; public reads never check the flags for MLB (`db.ts` gates on `row.sport !== 'NCAAM'`) — owner retraction impossible; post-write validation is log-only | MECHANISM SHIPPED 2026-08-07, ENFORCEMENT PENDING OWNER — a server-side per-market reader now exists (`server/mlbMarketGates.ts` + `feedGating.ts`), inert unless `MLB_MARKET_GATE_MODE=on`. The unconditional write at `:4337-4338` and the dead `mlbPublicationGate.ts` are both UNCHANGED and still open |
| M-202 | P1 | fullgame✓ | +3pp `FG_ML_HOME_EDGE` post-hoc home shim (`MLBAIModel.py:1609-1627`) contaminates published win%, ML odds, and the RL clamp chain; repo's own audit blames it for RL home bias; backtest compensates with an 18% away-RL threshold instead of a source fix | OPEN |
| M-203 | P1 SV | nrfi/gradecal | `brierScore` divides by 100 unconditionally (`mlbOutcomeIngestor.ts:162`) while fed 0–1 `modelPNrfi` (line 226) and `modelF5OverRate` (line 218) — all stored `brierNrfi`/`brierF5Total` values are garbage (p≈0.005); owner Brier-trend chart wrong for those markets | OPEN |
| M-204 | **P0** SV | kprops | Root cause of C-002: λ is book-line-anchored (`ip_expected = bookLine/pitcher_k9*9`, service header) so kProj ≈ bookLine × xfip_adj × opp_adj × 0.87; `opp_adj = team_k9/8.2` where team k9 is on a K/AB×27 scale (measured league mean 6.69–6.87 vs divisor 8.2 ⇒ opp_adj ≈ 0.83) ⇒ kProj structurally ≈ 0.72×bookLine. Deterministically reproduces the observed −0.99 K bias and 87% UNDER lean | OPEN |
| M-205 | P1 SV | f5 | F5 RL cover probabilities exclude ties (`MLBAIModel.py:1309-1310`: away +0.5 cover counted only on outright away win) — away side understated by the ~15% tie mass; explains F5 RL 47.7% pick accuracy | OPEN |
| M-206 | P1 | f5 | F5 total priced at synthetic line (FG book total × 0.555 snapped), then graded/displayed against the real book `f5Total`; model never re-runs when F5 book lines land | OPEN |
| M-207 | P1 SV | gradecal | `mlb_calibration_constants` is write-only: live code hardcodes K factors 0.870/0.810 (`mlbKPropsModelService.ts:88-89`, verified) while DB holds 0.776 (written 2026-05-11 by an out-of-repo process, read by nothing); fg_ml_home_edge and nrfi_rate similarly drifted | OPEN |
| M-208 | P1 | ingestion | Outcome ingestion, closing-line capture, drift, and schedule refresh exist only as in-process schedulers; runbook prescribes `DISABLE_BACKGROUND_JOBS=1` on web replicas with exactly one job-runner replica; no cron/CI fallback. INFERRED prime suspect for the May 5–7 and June collapses (D-002/006/007). Railway-side env verification was permission-denied this session; local shell does not set the flag | OPEN |
| M-209 | P1 | ingestion | No live code path creates daily MLB `games` rows or populates `mlbGamePk` — the seeder was external (retired Manus workflow); explains D-001 (missed DH game 2s) and makes game creation an operational cliff | OPEN |
| M-210 | P1 | ingestion | Closing-line capture requires the 5-min in-process tick, fires only while status='inprogress', book 68 strictly, no backfill — explains the 65% capture rate (D-008) | OPEN |
| M-211 | P1 | hrprops✓ | HR props structurally ungradable in the multi-market backtest (0.65 confidence gate vs `modelPHr` ≤ ~0.22) and the HR backtest report filters on a `modelRunAt` the live pipeline never writes | OPEN |
| M-212 | P2 | hrprops✓ | `hr9` (per 27 AB) consumed as per-PA rate ×4.22 (~10-13% λ inflation absorbed into the calibration factor); Statcast inputs refreshed only by an unscheduled one-off script — both feed C-003 | OPEN |
| M-213 | P1 | kprops | AN K-prop fetch keys dates by server-local clock vs the pipeline's PT dates — evening cycles can attach tomorrow's lines to today's games; no pre-game freeze (lines/probs keep updating in-game). Explains the 108 stored side-label contradictions (M-103) | OPEN |
| M-214 | P2 | gradecal | K grading credits/blames the substitute starter's Ks when the listed pitcher is scratched (books void) — contaminates stored `actualKs`-based grades and, transitively, this audit's K ledger for scratched rows | OPEN |
| M-215 | P2 | exposure | All MLB model numbers exposed via unauthenticated public tRPC endpoints; paywall is client-side only | OPEN |
| M-216 | P2 | ingestion | Odds-refresh path mutates model outputs (mirrors `modelTotal` to book, rewrites model spreads, clears `modelRunAt`) — a concrete mechanism behind P-001 provenance destruction | OPEN |
| M-217 | P2 | nrfi/gradecal | 0–1 probabilities stored in `decimal(5,2)` (`modelPNrfi`, `mlb_game_backtest.modelProb`) — 1%-granularity truncation degrades all downstream edge/calibration math | OPEN |
| P-005 | P2 | process | 6 of 8 dossier verifier agents failed on session usage limits at first attempt. Re-run 2026-07-25 ~17:45 UTC: all 6 sections verified — 602 claims checked, 576 confirmed, 26 corrected inline, 0 unbacked. Dossier now 8/8 adversarially verified | **RESOLVED** (evidence: phase0/*.md '## Verification (re-run)' appendices; workflow wf_ee0b2678) |
| P-006 | P2 | all game markets | Mid-day lineup changes are a silent no-op for already-modeled games: `mlbLineupsWatcher.ts:583` calls plain `runMlbModelForDate(dateStr)` whose same-date `modelRunAt` skip guard bypasses re-modeling; the targeted `forceRerun` pattern exists only in RL-invalidation and Layer3 paths (found during P-005 re-verification) | OPEN |
| M-105 | P1→note | all | Sharpens M-101: the PUBLIC `games.list` feed (publicProcedure) returns the grading/Brier columns on MLB rows (`stripSportNullFields` strips them only from non-MLB) — the defective away-side grades and /100 Briers were publicly readable all season. Post-B6/B6b those columns now carry corrected model-pick grades | OPEN (fixed data; exposure fact recorded) |

## M-3xx / D-01x — 5x5 granular fleet findings (2026-07-25 evening; full evidence in granular/*/)

| ID | Sev | Finding | Status |
|---|---|---|---|
| M-301 | P2 | Pass-2 NRFI logistic was inert: predict() required exact feature-key equality → silent passthrough on 1,086/1,087 rows while calibMeta claimed mode=logistic; the one firing row saturated at 1.0 (nested `*.starter_mlbam_id` + `cutoffMs` entered the design matrix — id exclusion was top-level only). First daily run confirmed the harm: polluted logistic Brier 0.2599 (worse than coin flip) | **FIX EXECUTED** (canonical union keyspace + prediction clamp + nested-id/cutoff exclusion; daily v2 rerun in flight; evidence: fullgame-modeler report + p2d firing count 1,084/1,087) |
| M-302 | P1 | F5 simulation omits home-field advantage: mu_f5 built from pre-HFA state mus while FG mus get the home/away HFA multipliers — structural F5 ML/RL bias | RECOMMENDED ONLY (root-cause fix in MLBAIModel F5 mu construction; walk-forward validation would follow) |
| M-303 | P2 | F5 needs its own environment multiplier: F5 actual/projected exceeds the FG ratio by +5.1–6.7pp every post-seed month; an F5-specific walk-forward mult cuts F5 total bias materially (f5-reinforcer, full population) | RECOMMENDED ONLY (calibrator change, ~20 lines) |
| M-304 | P1 | FG_ML_HOME_EDGE (+0.03 live, 0.0178 in DB) is mis-signed for 2026: season-fitted optimum −0.0109, 95% CI [−0.0355,+0.0137] excludes both stored values; the model undervalues away favorites by 7–9pp (assessor, z≈−3.8) | RECOMMENDED ONLY (set DB constant to 0.0 now; add walk-forward home-edge logit shift to the calibration layer) |
| M-305 | P3 | T_f5 temperature fitted on mismatched scales (absolute three-way probability vs decided-games outcomes); K tail probabilities remain overconfident in both directions (stated 94% → 13% observed) — Poisson under-dispersion; isotonic/negative-binomial layer candidate | RECOMMENDED ONLY |
| D-012 | P1 | games.awayRunLineOdds/homeRunLineOdds corrupted pre-June: 284 finals hold mirrored vig-free pairs (all 75 March + 209 April–May) — RL price data unusable for those games | OPEN (source odds unrecoverable in-repo) |
| D-013 | P2 | Stale MISSING_DATA/VOID ledger rows on now-final games (B7b drive misses) | **FIX EXECUTED** (105 games re-driven, 0 errors, provenance post-pass re-applied 2026-07-25 ~21:45; remaining 268 rows decompose into exempt classes: ~30 games with no live projection (EX-NO-PROJ-RETRO — a bet ledger cannot grade bets never offered; replay ledger covers them) and no-line markets (EX-NO-LINE); evidence: b8m1kcjmn output + market/input decomposition query) |
| D-014 | P2 | mlb_schedule_history BOS@BAL 4/26 row (287441) also holds 17-1 after the odds refresh re-imported it (B3's fix survives on 287485; the AN book-fallback rewrite re-corrupts — ingestion dossier P1 mechanism); census/game-universe.csv leaves 13 pk-finals invisible to CSV-only linkage (11 makeups + 2 DH G2s) | OPEN |
| P-007 | P2 | Gate-relevant honesty: FG RL 58.9% hit is structural (95% of picks are the +1.5 dog; base cover rate 59.0%); FG ML pick skill ≤0.5pp over always-book-favorite; pick-CLV ≈ 0 for ML/RL/TOTAL — the model tracks the market, it does not beat the close | OPEN (feeds gate verdicts) |
| P-008 | P2 | Fleet attrition: 12/25 granular agents (all HR-props roles, most K-props roles, 2 NRFI roles) failed on session limits/server errors; K/HR granular coverage is provided by the deep-dive analyzer + earlier test fleet instead — per-pitcher/park-level K/HR reports are thinner than the fullgame/F5 groups | OPEN (rerun possible after limit reset) |
