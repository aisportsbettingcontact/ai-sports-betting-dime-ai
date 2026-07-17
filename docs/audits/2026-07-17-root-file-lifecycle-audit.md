# Root-file lifecycle audit

**Audit date:** 2026-07-17  
**Scope:** all 205 tracked, extant files at repository root after the confirmed cleanup in this change. Nested production source, migrations, and convention-discovered tests were checked for references but are not cleanup targets in this report.

## Executive result

- **33 active root control files** are manifests, deployment/build/test configuration, security policy, or maintained operating documentation. Keep them at root.
- **108 root executable scripts** have no package-script, CI, Railway, Docker, application import, or maintained runbook entry point. They are **inactive as automated software**. They may still be manually invoked operational tools, so absence of a reference is not enough to delete them.
- **31 files named `test*` at root are not discovered by Vitest or Playwright.** They are manual probes, not repository test coverage. Do not count them as passing tests.
- **27 manual scripts contain static mutation signals.** They were syntax-checked only and were not executed against an unknown database.
- **64 remaining root artifacts** are reports, raw outputs, plans, logs, or extensionless documentation. They are inactive at runtime and are archive candidates, but several document model/data provenance and rollback evidence. Retain pending an explicit retention decision.
- **3 confirmed dead files are deleted in this change:** an invalid superseded BAL@TB audit, a CommonJS DB probe that cannot run under this ESM package and is replaced by an `.mjs` version, and a byte-identical CommonJS World Cup audit duplicate with the correct `.cjs` copy retained.

## Evidence and validation method

1. Checked `package.json`, `.github/workflows`, `railway.json`, `Dockerfile`, `scripts/`, `server/`, `client/`, `docs/`, and `references/` for exact filename references.
2. Confirmed none of the 108 root scripts is an automated entry point.
3. Ran `node --check` on every root `.js`, `.mjs`, and `.cjs` candidate. The deleted `audit_baltb.mjs` was the only syntax failure because it contained TypeScript assertions in an `.mjs` file.
4. Parsed every root `.ts`/`.mts` candidate with esbuild and every root Python candidate with `ast.parse`; all parsed successfully.
5. Did **not** execute database, publishing, grading, scraping, or repair scripts. Static inspection found mutation signals in 27 scripts, and many remaining scripts use fixed historical dates/IDs or production credentials.
6. Compared suspected duplicates byte-for-byte. `wc_audit_june19.js` and `wc_audit_june19.cjs` were identical; only the `.cjs` file is valid for CommonJS in this `type: module` package.

## Confirmed deletion register

| Deleted file | Evidence | Retained replacement / reversal |
|---|---|---|
| `audit_baltb.mjs` | Not referenced; `node --check` fails; later `audit_baltb2.ts` and `audit_baltb3.ts` cover the same fixed BAL@TB incident. | Retain successors; recover from Git if forensic comparison is ever needed. |
| `test_db_conn.js` | Not referenced; uses `require` even though the package is ESM; `test_db_conn.mjs` provides the maintained ESM probe. | `test_db_conn.mjs`; recover from Git. |
| `wc_audit_june19.js` | Byte-identical to `wc_audit_june19.cjs`; `.js` is interpreted as ESM and cannot use its top-level `require`. | `wc_audit_june19.cjs`; recover from Git. |

## Active root control surface — keep

- `.dockerignore`
- `.env.example`
- `.gitignore`
- `.gitkeep`
- `.gitleaks.toml`
- `.gitleaksignore`
- `.mcp.json`
- `.npmrc`
- `.prettierignore`
- `.prettierrc`
- `CLAUDE.md`
- `Dockerfile`
- `INCIDENTS.md`
- `OPERATING-RULES.md`
- `RELEASING.md`
- `bundle-budget.json`
- `components.json`
- `drizzle.config.ts`
- `osv-scanner.toml`
- `package.json`
- `playwright.config.ts`
- `pnpm-lock.yaml`
- `railway.json`
- `requirements.txt`
- `ruff.toml`
- `setup.cfg`
- `skills-lock.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`
- `vitest.config.ts`
- `vitest.environment-failure-allowlist.json`
- `vulture_whitelist.py`

## Root `test*` files — inactive manual probes

These are excluded by `vitest.config.ts`, which discovers tests only under `server/`, `perf/`, `shared/`, `client/src/`, and `scripts/`. Most require a database, network access, or fixed historical records.

- `test-dh-frontend-fix.mjs`
- `test-dh-pipeline-v2.mjs`
- `test-dh-pipeline.mjs`
- `test-grade-bet60008.mjs`
- `test_22_path_matrix.mjs`
- `test_backfill.ts`
- `test_db_conn.mjs`
- `test_dime_soak_dry_run.mjs`
- `test_dime_soak_v3_certified.mjs`
- `test_dime_wc2026_soak_100.mjs`
- `test_idempotency_block4.mjs`
- `test_idempotency_fix.mjs`
- `test_jackmac_pipeline.mts`
- `test_nhl_pl_audit.ts`
- `test_p0_baseline_v3.mjs`
- `test_p0_postsoak.mjs`
- `test_p0_postsoak_v2.mjs`
- `test_p0_postsoak_v3.mjs`
- `test_ratelimit_block5.mjs`
- `test_ratelimit_block5_v2.mjs`
- `test_remodel_apr16_v2.ts`
- `test_remodel_nhl_apr16.ts`
- `test_rg_proxy.mts`
- `test_tier5_gap_assessment.mjs`
- `test_tier5_gap_v2.mjs`
- `test_upsert.ts`
- `test_upsert2.ts`
- `test_upsert3.ts`
- `test_upsert4.ts`
- `test_upsert5.ts`
- `test_zod.mjs`

## Root audit/check/query files — inactive manual diagnostics

These are not automated and generally target a named incident, date, matchup, or schema investigation. Keep only while their incident-recovery or provenance value is required; otherwise archive them as a batch rather than presenting them as maintained commands.

- `audit_an_api.ts`
- `audit_baltb2.ts`
- `audit_baltb3.ts`
- `audit_espn_vs_db.mjs`
- `audit_espn_vs_db_v2.mjs`
- `audit_jul4_deep.mjs`
- `audit_layer1_db_integrity.mjs`
- `audit_layer2_code_integrity.mjs`
- `audit_layer3_credit.mjs`
- `audit_layer4_trail.mjs`
- `audit_may20.mjs`
- `audit_may20_deep.mjs`
- `audit_may20_v2.mjs`
- `audit_requests.mjs`
- `audit_vgk_col.mjs`
- `audit_vgk_col2.mjs`
- `check_bets.mjs`
- `check_bets2.mjs`
- `check_bets3.mjs`
- `check_bets4.mjs`
- `check_goalies.ts`
- `check_jul5_matches.mjs`
- `check_last5.ts`
- `check_lineups.mjs`
- `check_mlb_games.mjs`
- `check_mlb_players.mts`
- `check_nhl_feed.mjs`
- `check_open.ts`
- `check_pl_db.ts`
- `check_rl_pop.mjs`
- `db_audit.ts`
- `db_audit2.ts`
- `diagnose_games.mjs`
- `pull_bets.mjs`
- `pull_db_audit.mjs`
- `pull_wc2026_backtest_data.mjs`
- `query_jul4.mjs`
- `query_picks.mjs`
- `validate_apr16.ts`
- `validate_mlb_june27.mjs`
- `verify_jul5_final.mjs`
- `wc_audit_june19.cjs`
- `wc_full_audit.cjs`
- `wc_model_audit_june18.cjs`
- `wc_verify_an_odds.mjs`
- `wc_verify_roi_june18.cjs`

## Other root executables — manual operational or one-off

These include repair, publication, backfill, scraper, trigger, and evidence builders. They have no automated caller. Files with names such as `fix_*`, `populate_*`, `publish*`, `cleanup_*`, and `wc_fix_*` should be treated as potentially destructive.

- `analyze_bundle.py`
- `build_charts.mjs`
- `build_evidence_final.mjs`
- `cleanup_approved.mjs`
- `extract_evidence.sql`
- `find_inline.py`
- `fix_duplicate.mjs`
- `fix_jul5_projections.mjs`
- `force_refresh_nhl.ts`
- `gather_evidence.mjs`
- `get_june27_fixtures.mjs`
- `jul4_full_audit.py`
- `jul4_model_validate.py`
- `jul5_publish.mjs`
- `jul5_publish_v2.mjs`
- `jul5_scrape_betexplorer.py`
- `nhl_verify.ts`
- `populate_jul5_projections_full.mjs`
- `run_june7_mlb.mts`
- `run_mil_ath_rerun.mts`
- `run_nhl_model_today.mjs`
- `trigger_model_may20.mjs`
- `trigger_nhl_batch.ts`
- `trigger_nhl_sync.ts`
- `wc_correct_dk_june19.mjs`
- `wc_fix_june18_final.cjs`
- `wc_fix_june18_orientation.cjs`
- `wc_fix_model_dc.mjs`
- `wc_fix_totals_june18.cjs`
- `wc_rescrape_june19.mjs`
- `wc_sim_router.cjs`

## Static mutation-signal list — do not execute casually

This is a conservative text scan, not proof that every path mutates data. Conversely, scripts absent from this list can still have side effects through imported functions or HTTP calls.

- `audit_espn_vs_db_v2.mjs`
- `audit_layer2_code_integrity.mjs`
- `audit_may20.mjs`
- `audit_may20_deep.mjs`
- `audit_may20_v2.mjs`
- `build_evidence_final.mjs`
- `check_nhl_feed.mjs`
- `cleanup_approved.mjs`
- `fix_duplicate.mjs`
- `fix_jul5_projections.mjs`
- `gather_evidence.mjs`
- `jul4_full_audit.py`
- `jul5_publish.mjs`
- `jul5_publish_v2.mjs`
- `populate_jul5_projections_full.mjs`
- `run_nhl_model_today.mjs`
- `test_dime_soak_v3_certified.mjs`
- `test_upsert2.ts`
- `test_upsert3.ts`
- `test_upsert4.ts`
- `test_upsert5.ts`
- `wc_correct_dk_june19.mjs`
- `wc_fix_june18_final.cjs`
- `wc_fix_june18_orientation.cjs`
- `wc_fix_model_dc.mjs`
- `wc_fix_totals_june18.cjs`
- `wc_rescrape_june19.mjs`

## Reports, raw outputs, and planning artifacts — runtime inactive, retention uncertain

These do not participate in build, test discovery, deployment, or runtime imports. Many are dated evidence packages or model snapshots. Their value is historical rather than executable; move them under a dated archive only after the owner defines retention requirements.

- `EVIDENCE_SQL_RAW.txt`
- `EXECUTION_LOG.md`
- `MLB_BACKTEST_AUDIT_REPORT.md`
- `MLB_MAY23_2026_PROJECTIONS.md`
- `MOBILE_OWNER_TABS_PHASE2_REPORT.md`
- `P0_RAILWAY_LEDGER.md`
- `SOAK_V2_RAW_OUTPUT.txt`
- `T4_EXECUTION_NOTES.md`
- `T4_PROGRESS_STATE.md`
- `T4_SCHEMA_REFERENCE.md`
- `TIER4_EVIDENCE_PACKAGE.md`
- `TIER4_EVIDENCE_PACKAGE.txt`
- `TIER4_FULL_AUDIT_REPORT.md`
- `TIER4_SOAK_REPORT.md`
- `TRIPLE_TEST_V4_CERTIFIED.txt`
- `WC2026_500X_AUDIT_REPORT.md`
- `WC2026_APLUS_AUDIT_REPORT.md`
- `WC2026_APLUS_AUDIT_V2.md`
- `WC2026_DEFINITIVE_AUDIT.md`
- `WC2026_EXECUTION_CONTROL.md`
- `WC2026_P0_DATA_PRESERVATION_AUDIT.md`
- `WC2026_REPAIR_MANIFEST.md`
- `WC2026_ROLLBACK_LEDGER.md`
- `WC2026_TIER2_VALIDATION_GATE_REPORT.md`
- `WC2026_TIER3_ACTIVATION_REPORT.md`
- `WC2026_TIER3_EXECUTION_PLAN.md`
- `WC2026_TIER3_READINESS_VALIDATION_REPORT.md`
- `WC2026_TIER4_DIME_ACTIVATION_REPORT.md`
- `WC2026_VALIDATION_GATE_REPORT.md`
- `aibettinganalystdesignlog.txt`
- `april22_projections.md`
- `betexplorer_jul4_odds.txt`
- `dime-ai-sol-iteration.md`
- `ideas.md`
- `jul4_betexplorer_data.txt`
- `jul4_db_state.txt`
- `jul4_db_vs_fresh.txt`
- `jul4_final_state.json`
- `jul4_fresh_bet365_odds.txt`
- `jul4_fresh_scrape.json`
- `jul4_model_validation_results.txt`
- `jul5_bet365_final.json`
- `jul5_bet365_odds.json`
- `jul5_betexplorer_complete.txt`
- `jul5_betexplorer_data.txt`
- `jul5_complete_book_odds.txt`
- `jul5_final_state.txt`
- `jul5_publish_notes.txt`
- `jul5_publish_state.txt`
- `jul5_scraper_fix_plan.txt`
- `llm-blueprint`
- `llm-blueprint.md`
- `phase2_progress.txt`
- `prez-ai-skills-directory.md`
- `todo.md`
- `ui-ux_log.txt`
- `v18_full_output.txt`
- `v18_rerun_jul4.txt`
- `v19_jul5_output.txt`
- `v19_output.txt`
- `v4_jul5_output.txt`
- `wc2026_audit_findings.md`
- `wc2026modeling.txt`
- `wcfilecleanup.txt`

## Recommended next cleanup sequence

1. **Do not mass-delete the inactive scripts.** First identify the owner and last required recovery use for each incident family (`May20`, `BAL@TB`, `VGK@COL`, `Jul4/Jul5`, Tier 4, and WC June 18/19).
2. Move retained manual commands into `scripts/ops/`, with a README declaring read/write behavior, required environment, safe target, and rollback.
3. Move historical reports and raw outputs into `docs/audits/<date-or-incident>/`; preserve only the final report plus inputs required to reproduce it.
4. Convert any manual probe that still protects production behavior into a deterministic Vitest/integration test under a discovered directory.
5. Delete superseded numbered iterations only after comparing outputs and confirming the final retained script covers the same incident purpose.

## Confidence and limitation

- **Confirmed:** automation/reference status, test-discovery status, syntax/parse status, exact duplicate status, and the three deletions above.
- **Strongly supported:** most root scripts are one-off incident tools because their filenames and source contain fixed dates, game IDs, teams, or historical phases.
- **Uncertain:** whether an operator invokes any root script externally or requires raw evidence for legal, model-governance, or incident-retention purposes. Git history alone may not satisfy those policies.
