# K-props backtest sentinel overflowed its column (ER_DATA_TOO_LONG)

**Branch:** `fix/kprops-backtest-sentinel-length` · **Date:** 2026-08-06
**Found by:** the post-deploy audit of PR #416 (unrelated to that PR — pre-existing)
**Class:** silent production data-integrity defect · **Schema change:** none

## The defect

`server/kPropsBacktestService.ts` wrote `backtestResult: "NAME_MATCH_FAILED"` —
**17 characters** — into `mlb_strikeout_props.backtestResult`, declared
`varchar(16)`.

MySQL in strict mode **rejects** an oversized value rather than truncating, so
every one of those writes threw:

```
ER_DATA_TOO_LONG (errno 1406, sqlState 22001)
'Data Too Long, field len 16, data len 17'
update `mlb_strikeout_props` set `backtestResult` = 'NAME_MATCH_FAILED' …
```

It is the only value in the codebase that overflows. Every other literal written
to that column fits: `OVER` (4), `UNDER` (5), `PUSH` (4), `NFD` (3),
`PENDING` (7), `NO_LINE` (7), and on the HR table `WIN` (3), `LOSS` (4),
`NO_ACTION` (9).

### Impact, stated precisely

The obvious reading overstates this, so: **no gradeable rows were lost.** The
failed UPDATE leaves the row at its previous value (`NULL` or `PENDING`), and
the retry sweep selects on exactly those, so the row is picked up again next
cycle. What was actually lost:

- **the diagnostic** — "this pitcher could not be matched to a box-score name"
  never persisted, so the state is invisible in the data;
- **bounded retries** — the row is re-queued every cycle, forever;
- **log signal** — each attempt emits a full stack trace, adding noise to a log
  stream that operators read for real failures.

### Provenance

Introduced 2026-04-20. Confirmed still firing on the pre-#416 deployment, so it
is unambiguously not a regression from any recent PR.

## Why the sentinel was shortened rather than the column widened

Both were on the table. The deciding evidence is that **no production row can
contain the value**:

- the column was **created** as `varchar(16)` by migration
  `drizzle/0049_powerful_marvel_boy.sql` and re-declared at that width by
  `0051_panoramic_sebastian_shaw.sql`;
- the entire git history of `drizzle/schema.ts` contains exactly one form of the
  declaration — `length: 16`. It has never been any other width;
- therefore the 17-char write has failed since the day it was written, and the
  value was never stored.

So widening the column would be a **schema change** — riding `db-push.yml`
before any dependent code deploy, per the deploy law and the #370 hazard — to
accommodate a value that has never existed. Shortening the sentinel is
code-only, single-deploy, needs no migration, and carries no data-compatibility
risk. `NAME_MISMATCH` is 13 characters.

## The change

Sentinels are now a named const rather than scattered literals, with the column
constraint documented at the definition:

```ts
export const K_BACKTEST_SENTINEL = {
  PENDING: "PENDING",
  NO_LINE: "NO_LINE",
  NAME_MISMATCH: "NAME_MISMATCH",
} as const;
```

The retry sweep reads a named set instead of re-listing literals, and keeps two
legacy forms so a stranded row can still be rescued:

```ts
export const K_BACKTEST_RETRYABLE: readonly string[] = [
  K_BACKTEST_SENTINEL.PENDING,
  K_BACKTEST_SENTINEL.NAME_MISMATCH,
  "NAME_MATCH_FAILED", // unreachable under strict mode; free to keep
  "NAME_MATCH_FAIL",   // what non-strict mode would have truncated it to
];
```

Neither legacy value should exist — production is strict, which is *why* the
write threw instead of truncating. They are retained because a stranded row
would otherwise never be graded again and the cost is one array entry. Both are
pinned by a test so removing them is a deliberate decision, not a slip.

## The guard is written against the bug class, not the value

The root cause is "a string literal silently outgrew its column", so the test
reads the declared width **out of `drizzle/schema.ts`** and checks every
sentinel against it. If the column is resized, or a sentinel is added, the guard
tracks it without being edited. It also scans every `.ts` in `server/` for any
literal assigned to `backtestResult` that exceeds the width — the exact route
the original defect took — and covers **both** tables that declare the column
(`mlb_strikeout_props`, `mlb_hr_props`).

## A downstream coupling the fix itself created

Caught during pre-merge verification, not by the original change: **making the
marker persist changes what the owner UI receives.**

`client/src/pages/TheModelResults.tsx` renders each prop through `ResultBadge`.
Its early return covers `null` / `PENDING` / `NO_LINE`; everything else falls
through to graded styling, where `correct !== 1` renders an **XCircle**. Because
`modelCorrect` is untouched by the name-mismatch write, a `NAME_MISMATCH` row
would have rendered as ✗ — an **ungradeable** prop displayed as a *wrong
prediction*, on an accuracy page.

Under the old broken behaviour this was invisible: the write threw, the row
stayed `NULL`, and it displayed `PENDING`. Fixing the write is what would have
exposed it.

`NAME_MISMATCH` now joins the neutral branch and renders `NO MATCH` — the
diagnostic the owner should see, without the false-negative styling.

Aggregate accuracy is unaffected either way: the calibration query restricts to
`OVER` / `UNDER` / `PUSH`, so an ungradeable row was never counted.

### The guards were proven to bite

A test that cannot fail is worse than no test, and two earlier harnesses in this
series passed vacuously. So both mutations were run:

| Mutation | Result |
|---|---|
| sentinel reverted to the 17-char `"NAME_MATCH_FAILED"` | **3 red** |
| write site reverted to a bare literal past the const | **2 red** |
| UI neutral-branch guard removed | **1 red** |
| legacy rescue value dropped from the retry set | **1 red** |
| restored | **7/7 green** |

**One of these guards was vacuous on the first attempt and is worth recording.**
The UI test originally sliced the whole `ResultBadge` function and searched for
the sentinel anywhere inside it — which stayed green when the value was deleted
from the condition, because the badge's *label* ternary still mentioned it. The
rewrite asserts on the early-return condition only, with comments stripped so
prose cannot satisfy it. A second slicing bug surfaced on the way: `") {"`
matches the function signature's own `}) {` before the `if`, producing an
inverted empty slice that passes everything — the closing search is now anchored
after the `if (`. Both were found by running the mutation, not by reading the
test.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx prettier --check` | clean |
| `npx vitest run server/kPropsBacktestService.test.ts` | **7/7** (CI env: no `DATABASE_URL`) |
| `npx vitest run client/src` | **794/794** (no regression) |
| `mlbScoreRefresh` suites | **8/8** |
| `pnpm run build` | OK |
| build + boot + `smoke-deploy.mjs` | **10/10** — [`smoke.txt`](./smoke.txt) |
| compiled `dist/index.js` scanned for overflowing literals | **none** |
| compiled client chunk carries the UI guard | `TheModelResults-*.js` contains `NAME_MISMATCH` + `NO MATCH` |
| merge state vs `main` | 0 commits behind, 0 conflicts, no contended files |
| generated SQL diffed via `.toSQL()` | strict superset; `IS NULL` branch preserved; fully parameterized |
| schema / migration files touched | **none** — `db-push.yml` not required |

The compiled-artifact check matters: it confirms the fix survives bundling and
that no overflowing literal reaches the deployed server, rather than trusting
the source diff.

## Housekeeping folded into this PR

- Evidence for the three preceding feed PRs was archived to the contract path in
  the primary checkout (`docs/audits/*-evidence/screenshots/`, gitignored) and
  their worktrees and merged branches removed. Those are local-workspace actions
  with no repo-side diff; recorded here so the trail is complete.
- No stale reference to the old sentinel remains anywhere in `server/` or
  `client/` outside the deliberate rescue entry and the explanatory comments.

## Not addressed

`mlb_hr_props.backtestResult` shares the same `varchar(16)` width. Its writer
(`mlbHrPropsBacktestService.ts`) emits `WIN` / `LOSS` / `NO_ACTION`, all of
which fit, so there is nothing to fix — but it is now covered by the same guard,
so a future oversized value there fails the suite too.
