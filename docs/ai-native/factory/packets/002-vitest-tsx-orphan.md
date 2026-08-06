# Packet 002 — Re-attach the orphaned .tsx test to the vitest suite

Second factory exercise: a bounded correction entering the factory without rebuilding
the process (reuses template, gates, taxonomy from Packet 001).

## Evidence (why this, now)
- Audit gap G11: `client/src/pages/admin/DeviceActivityPanel.test.tsx` matched no vitest
  `include` glob (`vitest.config.ts` listed only `client/src/**/*.test.ts`) — 6 assertions
  silently never ran in CI or locally.
- Verified before fixing: `npx vitest run client/src/pages/admin/DeviceActivityPanel.test.tsx`
  → "No test files found, exiting with code 1".
- Inspected the test before changing config: it is a DOM-free source-contract test
  (reads the component source with `node:fs`), safe under `environment: "node"`.

## Specification
- In scope: add `client/src/**/*.test.tsx` to the vitest include list.
- Out of scope: converting the test, adding jsdom, touching the component.

## Executable acceptance criteria
- [x] `npx vitest run client/src/pages/admin/DeviceActivityPanel.test.tsx` → 6/6 pass
- [x] Full suite still green apart from pre-existing env-bound exclusions

## DRI and boundaries
- DRI: builder-operator. No approval needed (local, reversible, test-only config).

## Deterministic gates — results
1. Orphan suite now runs: PASS (6/6, 270 ms).
2. Repo typecheck unaffected (config file, excluded from tsc include set).

## Probabilistic rubric
- N/A.

## Defects found
| # | Symptom | Class | Smallest correction | Regression rerun |
|---|---|---|---|---|
| 1 | .tsx test orphaned by include globs | schema (config contract) | one glob line + comment | 6/6 pass; full-suite rerun at Gate 6 |

## Outcome
- Result metric: executed-test count +6; silent-rot class (orphaned client .tsx tests) closed
  structurally — any future `*.test.tsx` under client/src now runs.
- Status: VERIFIED_COMPLETE.
