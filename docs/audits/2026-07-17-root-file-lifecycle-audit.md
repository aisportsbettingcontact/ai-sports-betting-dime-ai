# Repository lifecycle cleanup audit

**Audit date:** 2026-07-17  
**Scope:** tracked root files plus executable and audit/report candidates under `scripts/`, `server/`, `server/wc2026/`, and `docs/audits/`.

## Outcome

This cleanup removes **370 confirmed inactive files** in the current batch:

| Category | Deleted | Evidence |
|---|---:|---|
| Root one-off scripts, undiscovered probes, reports, raw outputs, and completed plans | 160 | No package, CI, deployment, runtime, or maintained runbook entry point |
| Nested dated audit/backfill/check/fix/run/seed/trigger/validation scripts | 209 | No filename reference from manifests, workflows, runtime code, tests, or another retained executable |
| Superseded unreferenced audit reports under `docs/audits/` | 1 | No incoming documentation or tooling reference |

The prior cleanup commits removed another **7 generated, duplicate, invalid, or superseded files**. Across the cleanup series, the total is **377 files removed**.

## Safety gates

Every deletion in this batch passed the following repository-local gates:

1. It is not named by `package.json`, Railway, Docker, or a GitHub Actions workflow.
2. It is not imported, spawned, copied, or referenced by retained application code or a retained test.
3. It is not a migration, schema snapshot, lockfile, fixture discovered by test configuration, production static asset, skill package, or deployment configuration.
4. Dated scripts were treated as inactive only when they had no incoming executable reference. Historical Git revisions remain the reversal mechanism.
5. Scripts with an incoming reference were retained even when they appear historical.
6. Potentially mutating scripts were not executed against an unknown database merely to prove inactivity.

## Root result

The root is reduced from 205 extant tracked files to **45 retained files**. The retained set consists of:

- **33 active controls:** manifests, lockfiles, build/test/deployment configuration, security configuration, and operating documentation.
- **3 configured or linked tools/documents:** `analyze_bundle.py`, `find_inline.py`, and `dime-ai-sol-iteration.md`.
- **9 files with incoming references:** `audit_espn_vs_db.mjs`, `audit_espn_vs_db_v2.mjs`, `llm-blueprint`, `llm-blueprint.md`, `prez-ai-skills-directory.md`, `todo.md`, `wc_correct_dk_june19.mjs`, `wc_rescrape_june19.mjs`, and `wc_sim_router.cjs`.

The root `test*` files deleted here were not tests in the repository test suite. `vitest.config.ts` discovers tests only below `server/`, `perf/`, `shared/`, `client/src/`, and `scripts/`; Playwright discovers the configured E2E suite. The deleted root probes required production-like databases, credentials, fixed historical records, or direct mutation and had no automated caller.

## Nested executable result

The nested cleanup targets naming families that encode one-time lifecycle intent:

- `audit*`, `check*`, and date-specific validation scripts;
- `fix*`, `backfill*`, `reseed*`, and `populate*` repair scripts;
- historical `run*` and `trigger*` commands with no caller;
- obsolete World Cup engines and seed/audit generations superseded by retained production engines;
- incident-specific scripts for fixed April, May, June, July, matchup, or game-ID cases.

Convention-discovered `*.test.*` and `*.spec.*` files were explicitly excluded even when they had no literal filename reference, because Vitest discovers them by glob.

## Validation performed

Before the batch deletion:

- all extant root JavaScript-family executables were checked with `node --check`;
- all extant root TypeScript-family executables were parsed with esbuild;
- all extant root Python executables were parsed with Python `ast.parse`;
- exact references were searched across manifests, infrastructure, application code, tests, scripts, and documentation.

After deletion, the repository is validated with:

- TypeScript type checking;
- the environment-aware full Vitest gate;
- production client/server build and preview-production verification;
- stale-reference searches for every deleted path;
- final diff and working-tree inspection.

## Retained uncertainty

Static analysis cannot see commands invoked exclusively from an operator's shell history or an external scheduler not represented in this repository. The user-directed repository policy is that such unregistered commands are inactive and should not remain tracked. Git history is the recovery path if an external dependency is later identified.

## Reversal

Restore a removed file from the cleanup commit's parent when necessary:

```bash
git restore --source=<cleanup-commit>^ -- path/to/file
```

Do not restore an entire historical batch without re-establishing an active manifest, workflow, runtime, test, or runbook owner for each file.
