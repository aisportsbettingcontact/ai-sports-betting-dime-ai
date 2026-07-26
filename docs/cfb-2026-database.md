# CFB + NFL 2026 Database

Runbook for the verified 2026 college football and NFL corpora. CFB is stored
in `cfb_teams`, `cfb_games`, and `cfb_players`; NFL is stored in `nfl_venues`,
`nfl_teams`, `nfl_games`, and `nfl_players`. Both leagues follow the same
idioms (ESPN numeric id joins, idempotent loaders, manual population
workflows) but are otherwise independent — read whichever section applies.

## CFB

Schema: `drizzle/cfb.schema.ts`. Seed data: `scripts/data/cfb-2026/*.json`.
Loader: `scripts/seedCfb2026.mts`.

### Tables

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

### Join key

The ESPN numeric team id (`espn_id` on `cfb_teams`, `away_espn_id`/
`home_espn_id` on `cfb_games`, `team_espn_id` on `cfb_players`) is the
universal join key across all three tables. It is the only reliable key —
team names differ between the fbschedules source and ESPN, so joins should
never be done on name strings.

### Kickoff datetime convention

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

### Data quirks (carried into the data, not hidden)

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

### Provenance

Seed data was pulled from the fbschedules.com admin-ajax weekly schedule
endpoint and ESPN's site/core APIs (teams, standings, rosters), then
verified by a multi-agent audit on 2026-07-25 (strict-verify PASS, 56/56
checks). `scripts/data/cfb-2026/manifest.json` records the generation date,
source description, and golden counts.

Regeneration endpoints and known scraping gotchas are documented in the
project memory under `cfb-2026-dataset`; this file only covers what is
already committed and how to deploy it.

## NFL

Schema: `drizzle/nfl.schema.ts` (migration `0118`). Seed data:
`scripts/data/nfl-2026/*.json`. Loader: `scripts/seedNfl2026.mts`.

### Tables

- **`nfl_venues`** (38 rows) — every distinct venue referenced by a team home
  stadium or a game, including the 8 international sites (Germany, Brazil,
  Spain, France, England, Mexico, Australia). `capacity` is null across the
  source for all venues; ships nullable for future fill.
- **`nfl_teams`** (32 rows) — one row per franchise: ESPN display name and
  abbreviation, conference (AFC/NFC, 16 each), division (8 divisions × 4
  teams), home venue id, roster count.
- **`nfl_games`** (285 rows) — the full 2026-27 schedule: 272 regular-season
  games across weeks 1-18 (per-week counts
  `[16,16,16,16,15,14,14,14,15,14,13,16,14,15,16,16,16,16]`) plus 13
  postseason slots (6 wild card, 4 divisional, 2 conference, 1 Super Bowl
  LXI, played Feb 14 2027). ESPN's postseason week 4 (Pro Bowl / all-star
  event) is excluded — it carries no real games.
- **`nfl_players`** (2,929 rows) — every roster athlete: ESPN athlete id,
  team ESPN id, name, jersey, position, height/weight, experience, hometown.

These counts are golden — `scripts/nflSeedData.test.ts` and the loader
itself both assert them and refuse to proceed if the seed JSON disagrees.

### Join key

Same convention as CFB: the ESPN numeric id (`espn_id` on `nfl_teams`,
`away_espn_id`/`home_espn_id` on `nfl_games`, `team_espn_id` on
`nfl_players`, `venue_id` linking `nfl_teams`/`nfl_games` to `nfl_venues`) is
the only reliable join key.

### Venue semantics

`nfl_teams.venue_id` is **schedule-derived**, not taken from ESPN's
team-detail franchise-venue field — that field is stale for the Rams and
Chargers (both still point at their pre-SoFi venues). Each team's home venue
is instead computed as the mode of that team's home-game venues across the
verified schedule pull, which correctly resolves both LAR and LAC to SoFi
Stadium (venue 7065) and confirms the Giants/Jets shared-venue case (MetLife
Stadium, 3839) — 32 teams collapse to exactly 30 distinct home venues.

Game venue is a separate, independent field (`nfl_games.venue_id`) and is
**not** always equal to the home team's venue: international games (London,
Munich, São Paulo, Madrid) are played at a neutral/away-country site. The 12
playoff slots that precede bracket resolution (all postseason games except
the already-fixed matchups) carry `venue_id: null` until the real matchup —
and its venue — is known.

### TBD playoff handling

Postseason slots are generated before the bracket is known, so ESPN
represents them with sentinel data: competitor ids `-1`/`-2`, both team
names `"TBD"`. The loader maps these to `away_espn_id`/`home_espn_id: null`,
`away_team_name`/`home_team_name: "TBD"`, and `is_tbd: true`. These rows are
otherwise normal games (same table, same indexes) and are safe to query as
long as consumers check `is_tbd` before assuming team ids are populated.

Because the loader is idempotent (`INSERT ... ON DUPLICATE KEY UPDATE` on
`event_id`), re-running it after a future re-scrape — once ESPN has resolved
a matchup — updates the same row in place: `is_tbd` flips to `false`,
`away_espn_id`/`home_espn_id` populate, and `venue_id` fills in. No manual
cleanup or backfill script is needed.

### Kickoff datetime convention (both paths)

NFL kickoffs arrive UTC-native from ESPN (`kickoff_utc`, a real instant),
unlike CFB's ET-string source, but the derived `kickoff_date` follows the
same "pick the calendar day football fans mean" idea via
`shared/kickoffDate.ts` (`deriveKickoffDate`):

- **Concrete kickoffs** (`time_valid: true`) derive their date in
  **America/Los_Angeles**. This keeps late Sunday/Monday-night games that
  cross into the next UTC day (e.g. an 8:20pm ET kickoff = 00:20 UTC Monday)
  on their correct football day.
- **TBD sentinels** (`time_valid: false`) derive their date in
  **America/New_York** instead — ESPN stores these at midnight ET, so the PT
  path would wrongly roll them back a day. This is a deliberate amendment to
  the PT-by-default rule, documented in `shared/kickoffDate.ts`.

### Data quirks (NE1-NE6, carried into the data, not hidden)

- **NE1** — 24 regular-season games have no broadcast listed (weeks 16: 4,
  17: 4, 18: 16) — `broadcast: null`.
- **NE2** — the 13 postseason events use ESPN's TBD sentinel competitors —
  see TBD playoff handling above.
- **NE3** — ESPN postseason week 4 (Pro Bowl slot) has zero real events and
  is excluded from `nfl_games` entirely.
- **NE4** — team home venues are schedule-derived, not from the (stale)
  ESPN team-detail franchise-venue field — see Venue semantics above.
- **NE5** — `capacity` is null for every venue in both source endpoints;
  the column ships nullable rather than being dropped.
- **NE6** — exactly 12 postseason events (every playoff slot before the
  Super Bowl's matchup is fixed) have `venue_id: null`.

### Provenance

Seed data was pulled from ESPN's site/core APIs (venues, teams/structure,
schedule weeks 1-18 + postseason weeks 1-3 and 5, rosters), verified against
the golden invariants above on 2026-07-25.
`scripts/data/nfl-2026/manifest.json` records the generation date, source
description, and golden counts.

## Operating order

The schema and the data for both leagues are deployed as separate, ordered
steps. CFB and NFL are independent once the schema exists — only the
db-push step must happen first for each league's tables.

1. **Merge this PR.**
2. **Run the `db-push.yml` workflow** (Actions → DB Push → Run workflow).
   This applies the Drizzle migrations and creates `cfb_teams`/`cfb_games`/
   `cfb_players` and `nfl_venues`/`nfl_teams`/`nfl_games`/`nfl_players` — no
   data yet.
3. **Run `seed-cfb.yml` (Actions → Seed CFB 2026) and/or `seed-nfl.yml`
   (Actions → Seed NFL 2026 — populate nfl_* tables) — Run workflow.** Both
   loaders are idempotent (`INSERT ... ON DUPLICATE KEY UPDATE` on primary
   keys), so it is safe to re-run either at any time to pick up a corrected
   seed file, and **the order between the two seeders does not matter** —
   run one, the other, or both, in either order. Pass `dry_run: true` to
   validate a seed file against its manifest counts without writing to the
   database.

Do not run either seed workflow before `db-push.yml` — the tables must
exist first.
