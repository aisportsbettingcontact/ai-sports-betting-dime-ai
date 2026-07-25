# CFB 2026 Database

Runbook for the verified 2026 college football corpus stored in `cfb_teams`,
`cfb_games`, and `cfb_players`. Schema: `drizzle/cfb.schema.ts`. Seed data:
`scripts/data/cfb-2026/*.json`. Loader: `scripts/seedCfb2026.mts`.

## Tables

- **`cfb_teams`** (138 rows) — one row per FBS team: ESPN display name and
  abbreviation, the fbschedules.com name/slug used to join the source
  schedule, conference, division (only Sun Belt teams have one, "East" or
  "West"; null otherwise), ESPN group id, and roster count.
- **`cfb_games`** (902 rows) — the full 2026 schedule, weeks 0-15: kickoff
  date/time, away/home team names and ESPN ids, TV network, and the quirk
  flags below.
- **`cfb_players`** (14,933 rows) — every roster athlete: ESPN athlete id,
  team ESPN id, name, jersey, position, height/weight, class year, hometown.

These counts are golden — `scripts/cfbSeedData.test.ts` and the loader
itself both assert them and refuse to proceed if the seed JSON disagrees.

## Join key

The ESPN numeric team id (`espn_id` on `cfb_teams`, `away_espn_id`/
`home_espn_id` on `cfb_games`, `team_espn_id` on `cfb_players`) is the
universal join key across all three tables. It is the only reliable key —
team names differ between the fbschedules source and ESPN, so joins should
never be done on name strings.

## Kickoff datetime convention

Each game carries three kickoff fields, deliberately not collapsed into one:

- `kickoff_date` — the source football date (ET calendar date) as reported
  by fbschedules.com, stored as a plain date string.
- `kickoff_time_et` — the raw source time string, unparsed (e.g. `"12:00pm"`,
  `"Time TBA"`, `"3:30-8:00pm"`).
- `kickoff_utc` — the derived UTC instant, computed only when
  `kickoff_time_et` names one concrete ET clock time. It is null when the
  source has no single time (TBA games, or broadcast windows like
  `"3:30-8:00pm"`). Conversion is DST-correct (`shared/cfbKickoff.ts`, no
  fixed UTC offset assumed).

Consumers needing "is this game before/after X" should use `kickoff_utc`
when present and fall back to `kickoff_date` otherwise — it is not always
populated.

## Data quirks (carried into the data, not hidden)

- **`is_placeholder`** — true for every week-14 game. Week 14 is conference
  championship week; the source lists placeholder matchups (e.g. team names
  like `"ACC No. 1"` vs `"ACC No. 2"`) rather than real teams, so
  `away_espn_id`/`home_espn_id` are null for these rows.
- **`is_flex`** — true for 8 games with a source-side flex annotation, each
  with an explanatory `note`: 4 Mountain West games (gameIds 223068-223071,
  "MW Flex Game placeholder rematch") and 4 AAC games (gameIds 223613,
  223615, 223616, 223617, whose source TV field carries an "or Fri., Nov. 27"
  flex annotation).
- **Game 226431** carries a `note` recording a source/ESPN date
  disagreement: the fbschedules source lists Friday Nov 27, while ESPN lists
  Saturday Nov 28 (the source's own ticket URL agrees with the ESPN date).
  This is not auto-corrected — the discrepancy is preserved as data plus a
  note; reconciling to the ESPN date is a future decision, out of scope here.

## Operating order

The schema and the data are deployed as two separate, ordered steps:

1. **Merge this PR.**
2. **Run the `db-push.yml` workflow** (Actions → DB Push → Run workflow).
   This applies the Drizzle migration and creates `cfb_teams`, `cfb_games`,
   and `cfb_players` — no data yet.
3. **Run the `seed-cfb.yml` workflow** (Actions → Seed CFB 2026 → Run
   workflow). This populates the three tables from
   `scripts/data/cfb-2026/*.json`. The loader is idempotent
   (`INSERT ... ON DUPLICATE KEY UPDATE` on primary keys), so it is safe to
   re-run at any time to pick up a corrected seed file. Pass `dry_run: true`
   to validate the seed files against the manifest counts without writing to
   the database.

Do not run `seed-cfb.yml` before `db-push.yml` — the tables must exist first.

## Provenance

Seed data was pulled from the fbschedules.com admin-ajax weekly schedule
endpoint and ESPN's site/core APIs (teams, standings, rosters), then
verified by a multi-agent audit on 2026-07-25 (strict-verify PASS, 56/56
checks). `scripts/data/cfb-2026/manifest.json` records the generation date,
source description, and golden counts.

Regeneration endpoints and known scraping gotchas are documented in the
project memory under `cfb-2026-dataset`; this file only covers what is
already committed and how to deploy it.
