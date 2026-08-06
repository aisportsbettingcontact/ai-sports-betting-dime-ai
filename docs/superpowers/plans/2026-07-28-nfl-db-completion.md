# NFL Database Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every known gap in `scripts/data/nfl-db/nfl.db` and independently verify the forensic audit that identified them, so the database's completeness claim rests on checked evidence rather than on the auditors' own reports.

**Architecture:** The database is rebuilt end-to-end by `build_db.py` from raw nflverse extracts plus a `lib/` layer of importable modules (crosswalks, aliases, dimension builders, corrections). Nothing is patched in place — every change is a code change plus a rebuild, and every claim is an absolute assertion inside one of four validation passes. Recovery work adds new `lib/` modules that follow that same shape; verification work runs read-only against a copy.

**Tech Stack:** Python 3 (stdlib only — no new dependencies), SQLite, ESPN public JSON APIs, Pro-Football-Reference HTML (via the Internet Archive or a headed browser), covers.com / SportsOddsHistory.

## Global Constraints

- **Never fabricate a value.** A gap that cannot be sourced is an itemized exception with a named cause. This outranks every completeness target in this plan.
- **No percentage gates.** Every gate is an absolute assertion. `≥95%` is what shipped 227 orphan rows in the first place.
- **Corrections assert their prior value** and fail loudly if upstream changes shape. Follow the existing pattern in `lib/corrections.py` (`_assert_prior`, `_record`, `verify_in_database`).
- **Preserve upstream values** alongside corrections so divergence stays auditable (`franchise_id_upstream` is the precedent).
- **Internal validation is never described as external.** Report the split honestly, per row.
- **The validation suite stands at 165/165.** Every task must raise that number or leave it unchanged — never lower it, never replace a check with a weaker one.
- **Every new gate must be proven to fail on deliberately broken data** before it counts as a gate.
- `nfl.db.pre-N0-fix` and `nfl.db.pre-completion-backup` are historical snapshots. **Never modify or delete them.**

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `scripts/data/nfl-db/build_db.py` | Loader + 4 validation passes (`pass_structural` L524, `pass_reconciliation` L702, `pass_rowloss` L944, `pass_external` L1016) | modify |
| `scripts/data/nfl-db/schema.sql` | DDL: 13 tables, 66 indexes, 6 views | modify |
| `scripts/data/nfl-db/lib/corrections.py` | All data corrections + `verify_in_database()` | modify |
| `scripts/data/nfl-db/lib/snap_crosswalk.py` | `pfr_id → gsis_id` resolution | reuse |
| `scripts/data/nfl-db/lib/recovery_snaps_2012.py` | **NEW** — parse 2012 snaps from PFR HTML | create |
| `scripts/data/nfl-db/lib/venues.py` | **NEW** — venue id ↔ stadium reconciliation | create |
| `scripts/data/nfl-db/audit/validate_snaps_external.py` | **NEW** — external validation of the 204k unresolved | create |
| `docs/audits/2026-07-27-nfl-db-forensic/reports/V1-completeness.md` | **NEW** — independent coverage proof | create |
| `docs/audits/2026-07-27-nfl-db-forensic/reports/V2-adversarial.md` | **NEW** — false-MATCH hunt | create |

---

# Phase 0 — Verify the audit before building on it

**Why first:** nine agents graded their own homework and all reported passing. Every time a supervisor ran during this project it found something the workers missed — including 36 bad corrections introduced by the coordinator. Phase 1's targets are independently confirmed, so Phase 1 may run in parallel; Phase 2 Task 7 is **gated** on Task 2's finding.

### Task 1: V1 — independent completeness proof

**Files:**
- Create: `docs/audits/2026-07-27-nfl-db-forensic/reports/V1-completeness.md`
- Read: `docs/audits/2026-07-27-nfl-db-forensic/ledger/findings/*.json`, `ledger/F0*.jsonl.gz`, `reports/F0*.md`
- Read-only: `scripts/data/nfl-db/nfl.db.pre-N0-fix` (the exact database the agents audited)

- [ ] **Step 1: Reconcile ledger keys against database rows, per table**

Merged ledger totals to reconcile against: 2,674,628 lines — NOT_COMPARABLE 1,833,659 · MATCH 618,909 · UNRESOLVED 204,033 · MISMATCH 10,605 · REF_ONLY 7,310 · DB_ONLY 112.

For each table, produce three numbers: rows in DB, distinct row keys in the merged ledger, and the set difference **both ways**.

```bash
python3 - <<'PY'
import gzip, json, glob, sqlite3, collections
keys = collections.defaultdict(set)
dupes = collections.Counter()
for p in sorted(glob.glob('docs/audits/2026-07-27-nfl-db-forensic/ledger/*.jsonl.gz')):
    agent = p.split('/')[-1].split('.')[0]
    for line in gzip.open(p, 'rt'):
        r = json.loads(line)
        if r.get('field') != '*':      # row-level records only
            continue
        k = (r['table'], r['row_key'])
        if k in keys[r['table']]:
            dupes[k] += 1
        keys[r['table']].add(r['row_key'])
conn = sqlite3.connect('scripts/data/nfl-db/nfl.db.pre-N0-fix')
for t in ('game','game_line','team_game','player','player_game_stats',
          'snap_count','roster_season','depth_chart','team','team_alias','data_correction'):
    n = conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    print(f'{t:20} db={n:>9,}  ledger={len(keys[t]):>9,}  diff={n-len(keys[t]):>+8,}')
print('double-counted keys:', len(dupes))
PY
```

Expected: `diff` is 0 for every table and `double-counted keys: 0`. **Any non-zero is the finding** — report the specific rows, not just the count.

- [ ] **Step 2: Test whether `NOT_COMPARABLE` was earned or claimed**

It is 69% of the ledger. Sample at least 300 records stratified across all nine agents and all tables. For each, answer: *could the named authority have ruled on this row?* A row where ESPN publishes the field but the agent declined is a **downgraded verdict**. Report every instance with agent, table, field, and what the authority actually has.

- [ ] **Step 3: Quantify the recoverable share of `UNRESOLVED`**

204,033 rows, overwhelmingly `snap_count` where PFR returned 403. F03 succeeded via the Internet Archive; F07 succeeded via a headed browser; F04/F05/F06/F08 stopped. Break the 204,033 down by agent, season, and table, and state how many are reachable by the two proven routes.

- [ ] **Step 4: Verify evidence integrity**

Sample ≥200 records across all nine agents. For each: does the cited `evidence` path exist, **and does that file actually contain the claimed `ref_value`?** A path that resolves but does not support its verdict is worse than a missing one — report separately.

- [ ] **Step 5: Adjudicate the known inter-agent contradictions**

At minimum: F01's 403 `game_line` mismatches vs F07's finding that ESPN consensus favours the DB ~2.5:1; F02's "±1 is a fallback value" vs F04's "favourite-assignment convention"; whether all nine agree on the snap-count era boundary and on `roster_season` semantics.

- [ ] **Step 6: Name what nobody checked**

The partition was the coordinator's and its blind spots are invisible from inside it. Cover at least: the 6 views, index correctness (not presence), `data_correction` outside F09's partition, cross-season referential integrity, and any `schema.sql` object no report mentions.

- [ ] **Step 7: Commit**

```bash
git add docs/audits/2026-07-27-nfl-db-forensic/reports/V1-completeness.md
git commit -m "audit(v1): independent completeness proof of the 9-agent forensic audit"
```

---

### Task 2: V2 — hunt false MATCHes and adjudicate the 24 close games

**Files:**
- Create: `docs/audits/2026-07-27-nfl-db-forensic/reports/V2-adversarial.md`
- Read-only: `nfl.db.pre-N0-fix`, the ledgers, `cache/a*/`, `cache/f0*/`

**Interfaces:**
- Consumes: nothing from Task 1 — run them concurrently and let V1 and V2 disagree if they will.
- Produces: a verdict on the **±1 fallback hypothesis** that Phase 2 Task 7 is gated on.

- [ ] **Step 1: Identify the 24 games where the spread sign actually matters**

```sql
SELECT g.game_id, g.away_abbr, g.home_abbr, g.away_score, g.home_score,
       l.spread_line, (g.home_score - g.away_score) AS home_margin
FROM game g JOIN game_line l ON l.game_id = g.game_id
WHERE ABS(g.home_score - g.away_score) <= 1.5
  AND ABS(l.spread_line) <= 1.5
ORDER BY g.season, g.week;
```

Expected: exactly 24 rows. These are the only games where a one-point favourite-side disagreement can flip an ATS result.

- [ ] **Step 2: Adjudicate all 24 against two independent sources**

covers.com / SportsOddsHistory **and** ESPN's multi-book consensus. For each, record: our spread, each source's spread, which side each makes the favourite, and whether our stored `ats_result` survives. Do not pick a winner without evidence; log genuine three-way disagreements as contradictions.

- [ ] **Step 3: Test the ±1 fallback hypothesis — this drives a schema decision**

F02's lead: 53 of 306 disputed rows carry `|spread| == 1.0`, as do 11 of 12 favourite-flips. If nflverse writes ±1 where it has no line, those rows are **not market data** and should be NULL.

```sql
SELECT ABS(spread_line) AS mag, COUNT(*) AS games,
       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM game_line), 2) AS pct
FROM game_line GROUP BY mag ORDER BY games DESC LIMIT 12;
```

A ±1 bucket materially larger than ±1.5 and ±2 is evidence for the fallback reading (real spread distributions are smooth and favour key numbers 3 and 7, not 1). Cross-check every ±1 game against covers/ESPN: if a large share have a *different* real line, the hypothesis holds. State a verdict.

- [ ] **Step 4: Hunt false MATCHes**

Stratified sample of ≥400 `MATCH` verdicts, biased toward where a false match hides: duplicate names in `player`, mid-season team changes, overtime/postponed/neutral-site/international games, the abandoned 2022 Bills–Bengals fixture, and any table where one agent reported far fewer mismatches than its neighbours. Re-derive each from cached evidence. **A MATCH whose evidence file lacks the claimed value is a fabricated verdict** — the most serious finding available.

- [ ] **Step 5: Try to break the four strongest claims**

Build a *different* detector for each; do not reuse the original agent's method.

1. "Super Bowl snap transposition is confined to 2 games" (F03, F05)
2. "The 2025 depth-chart week assignment is leakage-free" — 554,215 rows, 0 violations (F08)
3. "`team_game` arithmetic is exact" — all agents, 100%
4. "Zero duplicate `pfr_id`/`espn_id` in `player`" (F09)

- [ ] **Step 6: Commit**

```bash
git add docs/audits/2026-07-27-nfl-db-forensic/reports/V2-adversarial.md
git commit -m "audit(v2): adversarial verification and 24-game spread-sign adjudication"
```

## Phase 0 verification

- [ ] Both reports exist and each carries a verdict, a method, and an itemized exception list.
- [ ] Coverage reconciliation runs and its per-table `diff` column is reproducible by a third party.
- [ ] Every false MATCH, downgraded verdict, and evidence failure is itemized with agent and row key.
- [ ] A verdict on the ±1 fallback hypothesis exists — Task 7 cannot start without it.
- [ ] `nfl.db` md5 is unchanged (both tasks are read-only): `md5 -q scripts/data/nfl-db/nfl.db`

---

# Phase 1 — Recover the missing data

All three gaps are independently confirmed by the coordinator and do not depend on Phase 0.

### Task 3: Recover the 2012 snap-count season

**Context:** `snap_count` holds **0** rows for 2012. nflverse's `snap_counts_2012.csv` is a **154-byte header-only file** (2013's is 2,148,056 bytes / 23,800 rows), while nflverse's own `scraped_games_snapcounts.csv` manifest lists 266 games for 2012 as scraped. PFR publishes ~23,820 rows across all 267 games. F02 cached all 267 boxscores and wrote a working parser.

**Files:**
- Create: `scripts/data/nfl-db/lib/recovery_snaps_2012.py`
- Modify: `scripts/data/nfl-db/build_db.py` (snap loading path; `pass_rowloss`)
- Modify: `scripts/data/nfl-db/schema.sql` (provenance column, see Step 3)
- Read: `scripts/data/nfl-db/audit/f02.py` (reuse `parse_pfr_snaps()`), `scripts/data/nfl-db/cache/f02/`

**Interfaces:**
- Consumes: `snap_crosswalk.resolve(pfr_id) -> str | None`
- Produces: `load_2012_snaps(cache_dir, game_index, resolve) -> tuple[list[dict], list[dict]]` returning `(rows, exceptions)`. Row dicts use the same keys `build_db.py` already writes for `snap_count`.

- [ ] **Step 1: Write the failing assertion first**

Add to `build_db.py`'s `pass_rowloss` (near L944, beside the existing per-table reconciliations):

```python
n = conn.execute("SELECT COUNT(*) FROM snap_count WHERE season = 2012").fetchone()[0]
check(3, "snap_count: 2012 is populated (nflverse ships an empty file; recovered from PFR)",
      n >= 23000, f"{n} rows")
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
python3 scripts/data/nfl-db/build_db.py 2>&1 | grep -E "2012 is populated|TOTAL"
```
Expected: `[FAIL] snap_count: 2012 is populated ... 0 rows`

- [ ] **Step 3: Add the provenance column**

`snap_count` must distinguish PFR-recovered rows from nflverse-sourced ones. In `schema.sql`, add to the `snap_count` table:

```sql
    source TEXT NOT NULL DEFAULT 'nflverse'
        CHECK (source IN ('nflverse', 'pfr-recovery-2026-07')),
```

- [ ] **Step 4: Write the module**

`scripts/data/nfl-db/lib/recovery_snaps_2012.py`, no import-time side effects:

```python
SEASON = 2012
EXPECTED_GAMES = 267
MIN_ROWS = 23000
SOURCE_TAG = "pfr-recovery-2026-07"

def load_2012_snaps(cache_dir, game_index, resolve):
    """Return (rows, exceptions).

    game_index maps a PFR boxscore id to our game_id; resolve is
    snap_crosswalk.resolve. Every returned row carries a real gsis_id and a
    real game_id -- unresolvable players go to exceptions with a named reason,
    never a silent drop and never an invented id.
    """
```

Requirements, each enforced by the module's own `__main__` self-check:
- All 267 games parsed; a missing boxscore is a hard failure, not a skip.
- Every row resolves to a `gsis_id` present in `player` **and** a `game_id` present in `game`. Zero orphans.
- Every row tagged `source = SOURCE_TAG`.
- Exceptions itemize player name, PFR id, game, and cause.

- [ ] **Step 5: Wire into `build_db.py` and rebuild**

```bash
cp scripts/data/nfl-db/nfl.db scripts/data/nfl-db/nfl.db.pre-task3
python3 scripts/data/nfl-db/build_db.py 2>&1 | tail -8
```
Expected: `[PASS] snap_count: 2012 is populated`, TOTAL ≥ 166/166, `snap_count` ≈ 348,431.

- [ ] **Step 6: Prove the gate fails on broken data**

```bash
cp scripts/data/nfl-db/nfl.db /tmp/probe.db
sqlite3 /tmp/probe.db "DELETE FROM snap_count WHERE season=2012 LIMIT 5000;"
# re-run the 2012 check against /tmp/probe.db -- it must FAIL
```

- [ ] **Step 7: Commit**

```bash
git add scripts/data/nfl-db/lib/recovery_snaps_2012.py scripts/data/nfl-db/build_db.py scripts/data/nfl-db/schema.sql
git commit -m "feat(nfl-db): recover the 2012 snap-count season from PFR (nflverse ships an empty file)"
```

---

### Task 4: Reconcile the venue seam

**Context:** the two halves of `game` use different venue columns and neither has both — 2010–2025 has `stadium` on 4,363 rows and `venue_id` on **0**; 2026 has `venue_id` on 273 and `stadium` on **0**. Any query grouping by venue breaks at the seam. ESPN publishes `venue_id` for historical games (verified: Super Bowl 50 → venue 4738, Levi's Stadium).

**Files:**
- Create: `scripts/data/nfl-db/lib/venues.py`
- Modify: `scripts/data/nfl-db/build_db.py`, `scripts/data/nfl-db/schema.sql`
- Read: `scripts/data/nfl-db/cache/a1/`, `cache/f0*/` (ESPN `summary` payloads already contain `gameInfo.venue`)

- [ ] **Step 1: Write the failing assertions**

```python
n = conn.execute("SELECT COUNT(*) FROM game WHERE result_status='final' AND venue_id IS NULL").fetchone()[0]
check(2, "every played game has a venue_id", n == 0, f"{n} missing")
n = conn.execute("SELECT COUNT(*) FROM game WHERE season=2026 AND away_abbr IS NOT NULL AND stadium IS NULL").fetchone()[0]
check(2, "every scheduled 2026 game has a stadium name", n == 0, f"{n} missing")
```

- [ ] **Step 2: Run and confirm both fail** — expect `4363 missing` and `273 missing`.

- [ ] **Step 3: Build the venue dimension**

`lib/venues.py` exposing `venue_by_game(cache_dirs) -> dict[str, dict]` keyed by `espn_event_id`, each value `{"venueId", "fullName", "city", "state"}`, sourced from cached ESPN `summary` payloads with a live fetch only for misses. Add a `venue` table to `schema.sql` (id, name, city, state) so venue attributes are stored once rather than denormalized onto 4,648 game rows.

- [ ] **Step 4: Backfill both directions and rebuild**

Populate `venue_id` for all played games and `stadium` for 2026. **Where ESPN has no venue, leave NULL and itemize** — the 12 unscheduled 2026 playoff placeholders legitimately have none, and those must be excluded from the assertion rather than filled.

- [ ] **Step 5: Verify the seam is closed**

```sql
SELECT COUNT(DISTINCT venue_id) AS venues, COUNT(*) AS games
FROM game WHERE venue_id IS NOT NULL;
-- and prove a cross-seam query now works:
SELECT v.name, COUNT(*) FROM game g JOIN venue v ON v.venue_id=g.venue_id
WHERE g.season BETWEEN 2024 AND 2026 GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
```

- [ ] **Step 6: Commit**

```bash
git add scripts/data/nfl-db/lib/venues.py scripts/data/nfl-db/build_db.py scripts/data/nfl-db/schema.sql
git commit -m "feat(nfl-db): reconcile the venue seam - backfill venue_id for 2010-2025 and stadium for 2026"
```

---

### Task 5: Externally validate the 204,033 unresolved snap rows

**Context:** these are `snap_count` rows where an agent hit Cloudflare and stopped. **Two routes are proven:** the Internet Archive's crawl of PFR (F03, 26% coverage, 86,828 comparisons, 0 disagreements) and a headed browser (F07, complete coverage, 370,447 comparisons, 0 disagreements).

**Files:**
- Create: `scripts/data/nfl-db/audit/validate_snaps_external.py`
- Create: `docs/audits/2026-07-27-nfl-db-forensic/reports/EXT-snap-validation.md`
- Read-only against `nfl.db`; cache under `scripts/data/nfl-db/cache/ext/`

- [ ] **Step 1: Enumerate the target set** — by season and agent, from `ledger/findings/*.jsonl` where `verdict == "UNRESOLVED"`.
- [ ] **Step 2: Implement both fetch routes** with the archive as primary (politer, cacheable) and the headed browser as fallback. Rate-limit; cache every response.
- [ ] **Step 3: Validate in priority order — 2016–2025 before 2013–2015**, because recent seasons are what a live model trains on. Compare all snap fields, not just totals.
- [ ] **Step 4: Report the split honestly** — rows now externally validated, rows still internal-only, and the exact cause for every remaining gap. **Never describe internal validation as external.**
- [ ] **Step 5: Commit**

```bash
git add scripts/data/nfl-db/audit/validate_snaps_external.py docs/audits/2026-07-27-nfl-db-forensic/reports/EXT-snap-validation.md
git commit -m "audit(ext): external snap-count validation via archive and headed-browser routes"
```

## Phase 1 verification

- [ ] `SELECT season, COUNT(*) FROM snap_count GROUP BY season` shows non-zero for **2012–2025** (2010–2011 genuinely absent upstream — leave empty and documented).
- [ ] Zero played games without `venue_id`; zero scheduled 2026 games without `stadium`.
- [ ] A venue query spanning 2024–2026 returns coherent results across the seam.
- [ ] `UNRESOLVED` count is materially reduced, with the residue itemized by cause.
- [ ] Validation suite ≥ 168/168 and every new gate proven to fail on perturbed data.

---

# Phase 2 — Complete the partial corrections

### Task 6: Finish D17 — the derived columns are still contaminated

**Context:** D17 corrected the nine **counting** columns inflated by nflverse's duplicated plays in `2011_13_DET_NO` and `2011_10_DET_CHI`, but left every **derived** column computed from the bad source: `sacks_suffered`, `target_share`, `fantasy_points`, `fantasy_points_ppr`, and EPA. F01's proof: recomputing fantasy points across 34,988 rows, **exactly 12 rows have a residual that is not a multiple of 2 — all 12 in those two games.**

**Files:** Modify `scripts/data/nfl-db/lib/corrections.py` (D17 block), `scripts/data/nfl-db/build_db.py`

- [ ] **Step 1: Write the failing assertion** — recompute fantasy points from the corrected counting stats for all rows in both games; assert zero residual.
- [ ] **Step 2: Run and confirm it fails** on 12 rows.
- [ ] **Step 3: Extend D17.** Recompute `fantasy_points` / `fantasy_points_ppr` from corrected counting stats; recompute `target_share` against the corrected team target total (F01: 25 rows divide by 65 where the corrected total is 60); correct `sacks_suffered` (Stafford +1 in both games, contradicted by ESPN). **EPA columns cannot be recomputed without play-by-play** — set NULL and record the reason, or preserve with an explicit contamination flag. Do not leave a plausible wrong number in place.
- [ ] **Step 4: Rebuild; confirm the assertion passes and the suite rises.**
- [ ] **Step 5: Commit** — `fix(nfl-db): extend D17 to the derived columns (fantasy points, target share, sacks, EPA)`

---

### Task 7: Adjudicate the line outliers — **GATED on Task 2 Step 3**

**Do not start until V2 has returned a verdict on the ±1 fallback hypothesis.** If ±1 is a fallback, the fix is to NULL those spreads; if it is a real convention, the fix is documentation only. The two lead to opposite changes, and guessing wrong corrupts `team_game`.

**Files:** Modify `scripts/data/nfl-db/lib/corrections.py`, `build_db.py`; create `docs/audits/2026-07-27-nfl-db-forensic/reports/LINE-outliers.md`

- [ ] **Step 1: Assemble the outlier set** — F07 flags 28 games differing ≥2.0 points; F08 flags 12. Deduplicate to the real list (~40).
- [ ] **Step 2: Adjudicate each against three sources** — covers.com, ESPN multi-book consensus, and PFR (F02 has PFR lines cached). One known concrete case: nflverse is 12.5 points wrong on `2013_12_JAX_HOU`; SOH is wrong on `2013_16_PIT_GB`. **Errors run both ways** — do not assume one archive.
- [ ] **Step 3: Apply corrections only where two independent sources agree against us.** Everything else is a recorded contradiction.
- [ ] **Step 4: If V2 confirms the ±1 fallback**, NULL those `spread_line` values and set the dependent `team_game` columns to the unpriced state — `ats_result` NULL means "no line", which the schema already distinguishes from `P` (push). Add an assertion that no `spread_line` is exactly ±1 unless corroborated.
- [ ] **Step 5: Rebuild, verify `team_game` recomputes cleanly, commit.**

---

### Task 8: Make `roster_season` answer week-level membership

**Context:** the table is keyed per player-season with no week dimension, so mid-season movers are recorded only under their final team. Christian McCaffrey's 2022 row shows **only SF** while `player_game_stats` correctly has CAR weeks 1–6 and SF weeks 7–21. But **549 player-seasons do carry multiple team rows**, so a single row is ambiguous — it may mean "never moved" or "moved and we kept the last team." Queries fail silently with a confident wrong answer.

**Files:** Modify `scripts/data/nfl-db/schema.sql`, `build_db.py`, `lib/player_dimension.py`

- [ ] **Step 1: Write the failing assertion** — for every player with stat rows on two franchises in one season, assert `roster_season` represents both.
- [ ] **Step 2: Run and confirm it fails** (McCaffrey 2022 is the canonical case).
- [ ] **Step 3: Choose and implement one:**
  - **(a)** a `roster_week` table derived from `player_game_stats` plus source roster snapshots — most correct, most work; or
  - **(b)** keep `roster_season` and add `first_week` / `last_week` / `is_partial_season` so the ambiguity becomes visible.
  **(b) is the recommendation** — it closes the silent-failure mode without inventing week-level membership for players who were rostered but inactive, which no source supports.
- [ ] **Step 4: Document the residual limit explicitly** — neither option recovers a player who was rostered and never played.
- [ ] **Step 5: Rebuild, commit.**

### Task 9: Sweep the small confirmed defects

**Context:** the audit confirmed a set of individually small, individually evidenced defects that no other task covers. Each has a named source and a known correct value. They are grouped into one task because they share a mechanism — a `lib/corrections.py` entry asserting its prior value — not because they are related.

**Files:** Modify `scripts/data/nfl-db/lib/corrections.py`, `scripts/data/nfl-db/build_db.py`, `scripts/data/nfl-db/lib/depth_charts.py`

| Defect | Detail | Found by |
|---|---|---|
| `player.espn_id` misattributions | ~45 players carry an `espn_id` pointing at the wrong ESPN athlete. Upstream — our table is byte-identical to `players.csv`. Correct ids are listed in the agent reports. | F09 (45), F02 (12), F01 (13), F04 (8), F06 (5), F05 (4) |
| Referee names | `2018_11_MIN_CHI` and `2017_04_OAK_DEN` record "John Perry" for **John Parry**; `2023_05_GB_LV` records "Alan Eck" for **Brad Allen** (ESPN and PFR agree). | F05, F07 |
| Overtime flag | `2021_12_LV_DAL` has `overtime = 0`; the game went to overtime (ESPN reports 5 periods). Upstream is wrong too. | F06 |
| `st_pct` out of range | 3 snap rows carry `st_pct = 1.01`; 7 more are irreconcilable. A percentage above 1.0 is impossible. | F05, A5 |
| Zero-snap rows | 4 `snap_count` rows record zero snaps in all three phases — a row that asserts a player played nothing. | F06 |
| Unmapped depth labels | 370 `depth_chart` position labels have no crosswalk entry, so they are unqueryable alongside their shape-A equivalents. | F06 |

- [ ] **Step 1: Write one failing assertion per defect class** in the appropriate validation pass. Example for the range violation:

```python
n = conn.execute("SELECT COUNT(*) FROM snap_count WHERE st_pct > 1.0 OR offense_pct > 1.0 OR defense_pct > 1.0").fetchone()[0]
check(1, "no snap percentage exceeds 1.0", n == 0, f"{n} rows")
```

- [ ] **Step 2: Run and confirm each fails**, recording the exact count so the correction can assert it.

- [ ] **Step 3: Apply corrections**, each asserting its prior value and citing its source. For `espn_id`, gather the correct ids from the agent reports and **verify each against ESPN before writing it** — a correction sourced from another agent's summary rather than from the authority is exactly the second-hand reasoning this project has been eliminating.

- [ ] **Step 4: Decide the `st_pct` and zero-snap cases explicitly.** A percentage above 1.0 is impossible, but the correct value may be unknowable — if so, NULL it with a recorded reason rather than clamping to 1.0, which would invent a number. Zero-snap rows may be legitimate (a player active but never on the field is recorded by PFR); establish which before deleting anything.

- [ ] **Step 5: Extend the depth-chart position crosswalk** in `lib/depth_charts.py` to cover the 370 unmapped labels, and assert the crosswalk is total — every label in the data maps.

- [ ] **Step 6: Rebuild, confirm every assertion passes, commit**

```bash
git commit -m "fix(nfl-db): correct espn_id misattributions, referee names, overtime flag, and snap-percentage violations"
```

## Phase 2 verification

- [ ] Fantasy-point residual is zero across all `player_game_stats` rows.
- [ ] Every line outlier is either corrected with two-source agreement or logged as a contradiction.
- [ ] No player-season with two franchises in `player_game_stats` is represented as single-team without an explicit partial-season marker.
- [ ] No snap percentage exceeds 1.0; every depth-chart position label maps.
- [ ] Every corrected `espn_id` was verified against ESPN directly, not copied from a report.
- [ ] Validation suite ≥ 175/175, every new gate perturbation-proven.

---

# Phase 3 — Harden and land

### Task 10: Close the silent-empty failure class permanently

**Context:** the 2012 snap gap existed because a 154-byte header-only file loaded as success. The original nflverse audit flagged this exact class — `nflreadr` returns an empty frame with only a warning, and `memoise` caches it as a success. It has now bitten this project twice.

**Files:** Modify `scripts/data/nfl-db/build_db.py`, `scripts/data/nfl-db/lib/rowloss.py`

- [ ] **Step 1:** Add a per-season floor assertion for every season-partitioned table — any season inside its documented coverage window with zero rows is a hard build failure, naming the table and season.
- [ ] **Step 2:** Assert every raw input file exceeds a minimum byte size before parsing, so a header-only file fails at read time rather than loading zero rows.
- [ ] **Step 3:** Perturbation-test both — truncate a raw CSV to its header and confirm the build fails with a clear message.
- [ ] **Step 4: Commit** — `feat(nfl-db): fail the build on empty-but-well-formed source files`

### Task 11: Commit the whole body of work

**Context:** `git ls-files scripts/data/nfl-db` returns **0**. Nothing from this project is in version control. `.gitignore` already excludes the regenerable bulk (raw extracts, caches, `*.db`, raw ledgers), so a commit stages source and documentation only.

- [ ] **Step 1:** `git status --porcelain --untracked-files=all | wc -l` — confirm the count is in the low hundreds, not tens of thousands.
- [ ] **Step 2:** Confirm no file over 5 MB is staged except `nfl-unified-2010-2026/games.json`.
- [ ] **Step 3:** Create a branch and commit in logical groups — schema/loader, lib modules, audit scripts, audit reports and ledger findings.
- [ ] **Step 4:** Open a PR summarizing the defects found and corrected, with the ledger totals.

## Phase 3 verification

- [ ] Truncating any raw input to its header fails the build with a named table and season.
- [ ] `git ls-files scripts/data/nfl-db | wc -l` is non-zero.
- [ ] Repository size increase is under ~50 MB.
- [ ] Full suite green from a clean rebuild: `python3 scripts/data/nfl-db/build_db.py`

---

# Risks and unknowns

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **PFR access fails again** (Cloudflare tightens, archive rate-limits) | Medium | Tasks 3 and 5 stall | Two proven routes exist. F02's 267 boxscores are **already cached** — Task 3 can complete offline. Task 5 degrades to partial coverage, reported honestly. |
| **V2 finds false MATCHes at scale** | Low–Medium | Undermines the audit; Phase 1–2 targets may shift | Phase 0 runs first for exactly this reason. If false matches are systemic, stop and re-audit rather than building on it. |
| **The ±1 fallback hypothesis is wrong** | Medium | Task 7 NULLs real market data — corrupting `game_line` | Task 7 is hard-gated on Task 2. Requires two independent sources before any change. |
| **EPA columns cannot be corrected** | High | Two games keep contaminated EPA | Accepted. Set NULL with a recorded reason rather than leaving a plausible wrong number. Play-by-play re-derivation is out of scope. |
| **2012 recovery introduces new orphan players** | Medium | FK failures at build | Task 3 Step 4 asserts zero orphans. Ordering matters: player dimension is built before the crosswalk (the constraint that governed the earlier integration). |
| **Schema changes break the 6 views** | Medium | Silent query breakage | Every task rebuilds and runs the full suite; views are exercised by `pass_structural`. |
| **Repo has no Python test runner** | Certain | No pytest-style TDD | Follow the established convention: each `lib/` module ships a `__main__` self-check that exits non-zero, and every claim becomes an assertion inside a `build_db.py` validation pass. |

**Genuine unknowns:**
- How many of the 204,033 unresolved rows are reachable — depends on archive coverage, which varies by season and is not known until Task 5 runs.
- Whether ESPN has a `venue_id` for every one of the 4,363 played games, particularly 2010–2013 where its historical records are thinnest.
- Whether V1 finds rows in no ledger. All nine agents claim zero, but no independent party has checked.

# Out of scope

- **Porting the schema to Drizzle/MySQL.** This is a local analytical SQLite database. Touching production schema requires the manual `db-push.yml` workflow per the project's deploy law, and is a separate decision.
- **Any change to the live application** — `server/`, `client/`, tRPC routers, the Dime feed. This plan touches `scripts/data/nfl-db/` and `docs/` only.
- **Play-by-play ingestion.** Would make the 2011 duplication detectable league-wide and let EPA be recomputed, but it is a new dataset of a different order and a separate project.
- **2010–2011 snap counts.** Genuinely absent upstream; PFR's coverage does not extend there in usable form. Documented as a permanent boundary, not a gap to close.
- **Historical depth charts before 2010, or 2026 depth charts.** No public source for the former; the latter does not exist yet.
- **Re-litigating the three recorded contradictions** (`2021_10_DET_PIT`, `2020_01_LV_CAR`, the Bills Toronto Series). These are owner decisions with evidence already gathered, not implementation tasks.
- **Resolving whether the four assumed −110 juice values on `2017_04_CHI_GB` should remain.** Owner-directed, documented, and flagged; changing it is a product decision.
- **The 5 weather readings of unverifiable provenance** on 2025 international games. No source can confirm or refute them. They are already gate-protected and flagged; inventing a replacement would violate the first global constraint.
- **Backfilling the 861 draft fields** ESPN could supply (F09). This is enrichment, not gap-closure — the rows are complete for every purpose the database currently serves. Worth doing later; not part of a completeness plan.
- **Stadium metadata for Croke Park, Olympic Stadium Berlin, and Santiago Bernabéu.** Deferred during integration because no source publishes `stadium_id` / `roof` / `surface` for them. Task 4 leaves them NULL and itemized rather than guessed.
