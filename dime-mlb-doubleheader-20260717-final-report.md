# Dime AI — MLB Doubleheader Incident 2026-07-17 — Final Report

## 1. Executive verdict

The Dime AI MLB feed showed only the 7:10 PM Rays@Red Sox game on 2026-07-17
because **nothing in the pipeline could ever create the 1:35 PM makeup game**:
the `games` table was pre-seeded once per season, every runtime MLB job was
update-only (unmatched provider games were logged `NO_MATCH` and dropped), and
event identity was matchup-derived, so even a manual insert of the second game
would have been swallowed by the `(gameDate, awayTeam, homeTeam, gameNumber)`
upsert with `gameNumber` defaulting to 1. The repair introduces canonical
provider-event identity (`mlbGamePk`) end-to-end: an idempotent schedule
reconciliation sync that inserts/adopts every distinct provider event,
DB-level uniqueness on `mlbGamePk`, doubleheader-safe claim-based matching in
every touched matcher, hardened client render keys, and loud cardinality
reconciliation so future event loss cannot be silent. All local gates pass;
live provider verification is network-blocked in this environment.

**Final verdict: `FIXED BUT LIVE VERIFICATION BLOCKED`** (see §23).

## 2. Incident anchor

- Date: Friday, **2026-07-17** (execution date of this remediation = incident day).
- Tampa Bay Rays @ Boston Red Sox, Fenway Park, America/New_York.
- Expected: **Game 1 1:35 PM ET** (split-DH front half, makeup of the 2026-05-09
  rainout) and **Game 2 7:10 PM ET** (originally scheduled).
- Observed: feed displayed only the 7:10 PM game.

## 3. Repository / branch / environment

- Repo `aisportsbettingcontact/ai-sports-betting-dime-ai`, branch
  `claude/mlb-doubleheader-handling-khphfa`, base commit
  `12f5d58a0c024924d0713a8263d1c95a71342417` (tree `5942bf…6953e`), clean tree.
- Node v22.22.2, pnpm 10.33.0, Python 3.11.15. No local MySQL binary; no
  DATABASE_URL in this container (DB checks run in the CI `db-tests` job's
  isolated MySQL 8 container).
- Remote execution environment; outbound network restricted by policy.

## 4. Reproduction evidence

- **Live reproduction: BLOCKED.** The environment's network policy denies
  `statsapi.mlb.com`, `www.mlb.com`, and `site.api.espn.com` (curl CONNECT 403
  + WebFetch 403; recorded in ledger event 4). Schedule facts corroborated via
  web search (boston.com 2026-05-09 rainout report, si.com Game 1 preview,
  StubHub Game 2 listing): split day-night DH, 1:35 PM + 7:10 PM ET.
- **Code-level reproduction (deterministic):**
  `server/mlbEventIdentity.test.ts` › *incident reproduction* constructs the
  exact pre-fix DB state (one pre-seeded 7:10 PM row + the postponed May 9
  row) and asserts the feed-visible set contains **1** game (the defect), then
  proves the sync plan restores **2**. `server/mlbDoubleheader.db.test.ts`
  [DH-DB-7] replays the same shape against a real database.
- **Pre-fix matcher defect demonstrated live in-test:** during development the
  claim-based matcher initially let Game 1 claim the lone legacy 7:10 row via
  the schema-default `gameNumber=1` (ledger event 8, preserved FAIL) — the
  same class of misattribution the old single-slot map guaranteed.

## 5. Authoritative game identities

Live capture of the two gamePks was **BLOCKED** (above). Per the evidence
contract, identifiers were **not** fabricated: fixtures use clearly-labeled
SYNTHETIC gamePks (`900101`/`900102`, `server/mlbDoubleheaderFixtures.ts`)
with payload shape mirroring statsapi exactly (`officialDate`, `gameDate`,
`doubleHeader:"S"`, `gameNumber`, `seriesGameNumber`, `dayNight`,
`rescheduledFrom:"2026-05-09"`, status, team ids 139/111, venue Fenway Park).
First production run of `syncMlbSchedule` will stamp the real gamePks.

## 6. Boundary-count table — before fix

| Boundary | Expected | Observed | Distinct IDs | Duplicates | Missing |
|---|---|---|---|---|---|
| Provider response | 2 | 2 (corroborated; live BLOCKED) | 2 | 0 | — |
| Provider adapter | 2 | 2 (`fetchMlbLiveScores` parses all) | 2 | 0 | — |
| Normalization | 2 | 2 | 2 | 0 | — |
| Persistence input | 2 | **1** | **1** | 0 | G1 makeup |
| Database storage | 2 | **1** | **1** | 0 | G1 row |
| Cache population | 2 | 1 (inherited) | 1 | 0 | inherited |
| API response | 2 | 1 (inherited) | 1 | 0 | inherited |
| Client normalization | 2 | 2-if-served | — | 0 | — |
| Rendered feed | 2 | **1** (7:10 PM only) | 1 | 0 | 1:35 PM |

## 7. Proven first-loss boundary

**Persistence.** The provider adapter surfaced both games every 10 minutes,
but `refreshMlbScores` only *updates* rows — the unmatched makeup game was
dropped at `NO_MATCH` (old `server/mlbScoreRefresh.ts:588-596`) and no other
code path inserts post-seed MLB rows (full-writer sweep, ledger events 3, 8:
`refreshMlb` returns `inserted: 0` by design; `refreshAnApiOdds` skips
NO_MATCH; the postponed tracker only notifies — its claim that
`mlbScheduleHistoryScheduler` would insert the game was false, that scheduler
writes the BetTracker `mlb_schedule_history` table, not the feed's `games`).

## 8. Root cause

1. **No provider→DB schedule reconciliation existed.** The season was seeded
   once; makeup games/split doubleheaders created mid-season had no insert path.
2. **Event identity was matchup-derived.** Uniqueness was
   `(gameDate, awayTeam, homeTeam, gameNumber)` with `gameNumber` defaulting
   to 1 and `mlbGamePk` unconstrained; `insertGames`' upsert silently converts
   a second same-matchup insert into an UPDATE of the first row.
3. **Matchup-keyed matching throughout:** single-slot `away@home` maps
   (`mlbScoreRefresh`), first-match `find` (`refreshAnApiOdds`), `limit(1)`
   (lineups), teams-only fallbacks (outcome ingestor) — all structurally
   unable to address two same-day events.

## 9. Contributing conditions

- Postponed tracker documentation promised an auto-insert that didn't exist.
- `doubleHeader`/`gameNumber` provider fields were never parsed by the score
  refresh; AN slate DH detection was positional (matchup-count), not identity-based.
- Client fallback id `${away}-${home}` (latent) would merge a DH if `g.id` were null.
- History is squash-flattened (platform import `b568594`, 2026-07-11) — supporting
  evidence only.

## 10. Files and symbols changed

| File | Change |
|---|---|
| `server/mlbEventIdentity.ts` **(new)** | Canonical identity contract; `classifyDoubleheaderGroup`/`classifySlate` (confidence EXPLICIT/CORROBORATED/POSSIBLE/NOT_DOUBLEHEADER/UNKNOWN); pure `planMlbScheduleSync` (gamePk match → closest-start-time legacy adoption → insert; collision/rejection ledger; status-regression guard; N-events invariant) |
| `server/mlbScheduleSync.ts` **(new)** | `fetchMlbScheduleWindow`, `normalizeRawScheduleGame`, `applyMlbScheduleSyncPlan`, `syncMlbSchedule` (run id, per-stage counts, provider→DB reconcile, owner alert on loss, idempotent backfill/replay) |
| `server/vsinAutoRefresh.ts` | `runMlbCycleOnce` Step 0.5 = schedule sync; `refreshAnApiOdds` MLB match is claim-based + closest-start-time (was first-`find`) |
| `server/mlbScoreRefresh.ts` | Parses `doubleHeader`/`gameNumber`/`gameDate`; new pure `matchMlbLiveGamesToDbRows` (gamePk → teams+gameNumber [only when rows encode distinct numbering] → closest-start-time → teams; claim semantics); `[CARDINALITY]` error on residual noMatch |
| `server/mlbOutcomeIngestor.ts` | Team-name fallback refuses ambiguous (≥2 same-matchup) outcomes |
| `server/mlbPostponedTracker.ts` | Notification text now names the real insert path |
| `server/db.ts` | `sortGamesByStartTime` gains deterministic id tie-break |
| `drizzle/schema.ts` | `games.rescheduledFrom` column; `games_mlb_gamepk_unique` unique index; contract comments on `games_matchup_unique` |
| `drizzle/0114_mlb_doubleheader_identity.sql` **(new)** | Migration + pre-deploy dup check + rollback note |
| `client/src/pages/DimeModelFeed.tsx` | Fallback card id is per-event (date+time+gameNumber); `mlbRowToCard` exported for tests |
| Tests **(new)** | `server/mlbDoubleheaderFixtures.ts`, `server/mlbEventIdentity.test.ts` (30), `server/mlbScoreRefresh.matching.test.ts` (7), `server/mlbScheduleSync.normalize.test.ts` (6), `server/mlbDoubleheader.db.test.ts` (7, CI db job), `client/src/pages/DimeModelFeed.doubleheader.test.ts` (4) |
| CI/tooling | `.github/workflows/ci.yml` db-tests runs the new suite; `scripts/test-db-local.sh` ditto; `vitest.environment-failure-allowlist.json` per-test entries + expectedCiSkips |

## 11. Database / migration changes

`drizzle/0114_mlb_doubleheader_identity.sql`:
`ALTER TABLE games ADD rescheduledFrom varchar(10);`
`ALTER TABLE games ADD CONSTRAINT games_mlb_gamepk_unique UNIQUE(mlbGamePk);`
Multiple NULLs are permitted (non-MLB sports, legacy rows). **Pre-deploy check**
(in the migration header; must return 0 rows):
`SELECT mlbGamePk, COUNT(*) c FROM games WHERE mlbGamePk IS NOT NULL GROUP BY mlbGamePk HAVING c > 1;`
Schema changes require the manual `db-push.yml` workflow before code deploy
(repo deploy law). Migration was **not** executed against production.

## 12. Event-identity contract

Documented in `server/mlbEventIdentity.ts` (header): identity =
`provider(statsapi) + sport(MLB) + gamePk`; matchup/date/time are never
identities; grouping never gates retention; re-ingest same pk = idempotent
update of that row only; second same-matchup pk = second row; UTC instants +
provider `officialDate` for schedule dates; deterministic sort (start time,
then id); presentation labels never used as identity.

## 13. Doubleheader-detection contract

`classifyDoubleheaderGroup`: groups by (officialDate, team pair); resolves
`gameNumber` (provider values when they form a consistent 1..N set, else
chronological with gamePk tie-break); confidence `EXPLICIT` (flag Y/S),
`CORROBORATED` (≥2 independent signals: consistent numbers, day/night split,
reschedule linkage), `POSSIBLE`, `NOT_DOUBLEHEADER`, `UNKNOWN`. Missing or
conflicting flags produce warnings and NEVER remove an event; distinct gamePks
always take precedence over inferred duplication.

## 14. Reconciliation & observability controls

Every `syncMlbSchedule` run: unique run id; counts for fetched/parsed/
rejected(reason)/inserted/updated/unchanged/adopted; `[DH]` classification
lines; per-row insert/update logs with identity; provider→DB reconcile
(`missing gamePks` after apply); `[VERIFY] PASS|FAIL`; on any loss/collision/
apply-error → `console.error` + `notifyOwner` (existing notification system).
`refreshMlbScores` emits `[CARDINALITY]` errors for residual NO_MATCH. The
sync is the backfill/replay tool (idempotent, arbitrary windows). Retries:
provider fetch failure skips the cycle harmlessly (additive-only design) and
the 10-minute cycle is the retry loop; malformed events are rejected
individually with reasons.

## 15. Test matrix results

New tests: **47 pure + 7 real-DB**. Pure suites: 47/47 PASS locally
(`mlbEventIdentity` 30, `mlbScoreRefresh.matching` 7,
`mlbScheduleSync.normalize` 6, `DimeModelFeed.doubleheader` 4). Matrix
mapping: items 1–10 ✅ (identity tests 1–10); 11–16 ✅ in `mlbDoubleheader.db.test.ts`
(CI db job; BLOCKED locally — no DB); 17–18 ⚠ BLOCKED (CI provisions schema
via `drizzle-kit push`, not migration replay — pre-existing repo constraint;
rollback SQL documented); 19–21 ⚠ by-inspection (array-valued caches keyed
sport:date cannot collapse members; sync invalidates on write); 22–24 ✅
API pass-through verified + DB reconcile (pagination N/A — API is unpaginated);
25–29 ✅ client tests; 30 ✅ lane-B sweep (all consumers key by `g.id`);
31–40 ✅ (status mapping, regression guard, reschedule metadata, Y/S flags,
UTC-midnight officialDate, DST fall-back date test); 41–44 ✅; 45 N/A
(provider unpaginated); 46–48 ✅ pure + [DH-DB-5] concurrent DB race in CI.
Property-style: 250-seed slate invariant + 100-seed group uniqueness
(deterministic Mulberry32; fast-check not a repo dependency).

Full existing suite: `pnpm run test:gated:local` → **PASS**
(1745 passed, 66 env-bound failures all allowlisted, 0 unexpected, 0 skipped).
Typecheck **PASS**; lint **N/A** (no root lint script — Prettier only);
`build:client` + `build:server` + bundle budget **PASS** (204,635B gzip vs
215,882B ceiling).

## 16. Boundary-count table — after fix

| Boundary | Expected | Observed | Distinct IDs | Result |
|---|---|---|---|---|
| Provider response | 2 | 2 (fixture; live BLOCKED) | 2 | FIXTURE PASS |
| Provider adapter | 2 | 2 | 2 | PASS (tests) |
| Normalization | 2 | 2 | 2 | PASS (tests) |
| Persistence input | 2 | 2 (plan: adopt G2 + insert G1) | 2 | PASS (tests) |
| Database storage | 2 | 2 | 2 | PASS (CI db tests) |
| Cache population | 2 | 2 (array-valued, invalidated) | 2 | PASS (inspection) |
| API response | 2 | 2 (pass-through) | 2 | PASS (inspection+tests) |
| Client normalization | 2 | 2 | 2 | PASS (tests) |
| Rendered feed | 2 | 2 cards | 2 | PASS (tests) |

## 17. Rays vs Red Sox verification

Fixture replay of the exact incident state (one legacy 7:10 row + postponed
May 9 row): sync adopts the legacy row for the 7:10 event (closest start time
— preserving its odds/model data and stamping identity + `gameNumber=2` +
`doubleHeader:"S"`), inserts a new 1:35 PM row (`gameNumber=1`,
`rescheduledFrom` 2026-05-09), leaves May 9 untouched, and is idempotent on
replay. Verified at plan level, DB level ([DH-DB-7]), and card level.

## 18. Generalized verification

No TB/BOS-specific logic exists anywhere in the fix. The 250-seed generator
varies teams (10 franchises), home/away order, dates (incl. DST boundaries),
UTC-midnight crossings, start times, flags (correct/missing/wrong),
gameNumbers (correct/missing/duplicated), statuses, payload order, and replay
— the N-distinct-events invariant holds for every seed.

## 19. Remaining risks

1. **Data-attribution (not event-loss) gaps remain** in scrapers whose sources
   lack per-game disambiguators: VSiN splits apply the same matchup values to
   both DH rows; Rotowire lineups `limit(1)` + unique `mlb_lineups.gameId`
   attach only G1's lineup; HR-props map keys `teams|date`; F5/NRFI relies on
   AN-vs-DB ordering. Both games now exist and render; these feeds may show
   G1-derived odds/lineups on G2 until each scraper is made pk-aware.
2. If production already contains duplicate `mlbGamePk` rows, the 0114 index
   creation fails at db-push; the pre-deploy check + manual dedupe resolve it.
3. First production sync will adopt legacy rows by start-time distance; a
   pathological legacy row with a wrong stored time could adopt the wrong
   sibling once (subsequent syncs are pk-exact).

## 20. Blocked / unverified production assumptions

- Live statsapi payload (real gamePks, flags) unverifiable from this
  environment; production behavior after deploy is **not** claimed verified.
- Production DB contents (row for 7:10 game, absence of 1:35 row, gamePk
  duplicates) inferred from code, not queried.
- Migration forward-run against production-shaped data and rollback were not
  executed (no disposable DB here; CI provisions fresh schema via push).

## 21. Rollback procedure

Code: revert the branch commit(s). Schema (only if 0114 was pushed):
`DROP INDEX games_mlb_gamepk_unique ON games; ALTER TABLE games DROP COLUMN rescheduledFrom;`
Runtime kill-switch: the sync is confined to `runMlbCycleOnce` Step 0.5 —
removing that block restores prior (update-only) behavior; all other fixes are
strictly narrowing (claim-based matching) and safe to keep. Data inserted by
the sync is identifiable (`mlbGamePk IS NOT NULL AND fileId = 0`).

## 22. Audit ledger

`dime-mlb-doubleheader-20260717-audit-log.jsonl` — append-only, hash-chained.
**10 events, 14,600 bytes, file SHA-256
`e30307b5a93349b67f868f61b0cfc9b0a38e533f18350e84a7f02308b9bd3ca4`.**
Chain verified intact before commit (events 1–9 terminal record sha
`9ef23d1e…6f6936f`; event 10 is the terminal reconciliation record). Verify by
recomputing sha256 over each record minus `current_sha256` (sorted keys,
ensure_ascii=false) and comparing to the embedded chain.

## 23. Final verdict

**`FIXED BUT LIVE VERIFICATION BLOCKED`** — root cause proven from code with a
deterministic reproduction; generalized identity repair implemented at every
responsible layer; 47 pure tests + full repo gates pass locally; 7 DB
invariants execute in CI's isolated MySQL job; live provider capture and
production verification are impossible from this environment's network policy
and are explicitly not claimed. Not `FIXED AND VERIFIED` because the
completion gates require live/production evidence this environment cannot
produce.
