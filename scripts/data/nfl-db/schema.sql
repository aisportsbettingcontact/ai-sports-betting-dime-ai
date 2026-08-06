-- NFL unified analytical database, seasons 2010-2026.
--
-- Design decisions that are load-bearing (see the forensic audit at
-- docs/audits/2026-07-26-nflverse-stack-forensic-audit.md and the completion
-- audit at docs/audits/2026-07-27-nfl-db-completion/):
--
--   * franchise_id (ESPN) is the ONLY team identity. It survives relocation:
--     Raiders 13 across OAK->LV, Rams 14 across STL->LA->LAR, Chargers 24
--     across SD->LAC, Washington 28 across WAS->WSH. Abbreviations are
--     era-specific labels held in team_alias, never keys.
--   * week holds REGULAR-SEASON week only. Playoff rows have week NULL and a
--     playoff_round instead. Without this, week 18 means regular season in
--     2021+ but Wild Card in 2010-2020 -- one integer, two meanings. This
--     convention is now enforced on `game`, `team_game`, `snap_count`,
--     `roster_season` and `depth_chart` alike (D8, D20). Where a feed publishes
--     nflverse's continuous 1..22 counter it is preserved verbatim in
--     `source_week` / `source_game_type` so nothing is lost.
--   * espn_event_id is UNIQUE (D9). It was deliberately non-unique because
--     nflverse attached 301114022 to two genuinely different 2010 games; that
--     is an upstream defect, corrected in lib/corrections.py, and the audit
--     instructs every consumer to join on this key, so a collision must be
--     structurally impossible rather than merely absent today.
--   * Betting lines live in their own table. They exist only for played games
--     and carry their own provenance, so "no line recorded" stays structurally
--     distinct from "game not yet played".
--   * gsis_id is the player join key and also the game join key to every other
--     nflverse dataset. Both are carried.
--   * team_game is MATERIALISED, not a view. The long-format shape is what
--     trend queries want, and a UNION view cannot be indexed.
--   * team_game carries EXPLICIT result columns (ats_result / ou_result /
--     su_result). The legacy `covered` / `won` booleans each encoded three
--     states in two values: `covered IS NULL` meant push OR no line, `won IS
--     NULL` meant tie OR unplayed. A naive ATS win rate read 45.89% against a
--     true 50.00% because 544 unplayed 2026 rows counted as losses (D14).
--   * FOREIGN KEYS ARE ONLY ENFORCED WHEN THE CONNECTION ASKS. `PRAGMA
--     foreign_keys` is per-connection and is never persisted in the file, so
--     every reader must issue `PRAGMA foreign_keys = ON` itself (D22). The
--     loader does, at every connection, and proves it with a negative control.

PRAGMA foreign_keys = ON;

-- ================================================================ dimensions

CREATE TABLE team (
  franchise_id   INTEGER PRIMARY KEY,          -- ESPN franchise id, stable across relocation
  abbreviation   TEXT    NOT NULL UNIQUE,
  display_name   TEXT    NOT NULL UNIQUE,
  conference     TEXT    NOT NULL CHECK (conference IN ('AFC','NFC')),
  division       TEXT    NOT NULL
);

-- Every abbreviation ever published, mapped to the enduring franchise. This is
-- what makes a 2010 'OAK' row and a 2025 'LV' row the same team.
CREATE TABLE team_alias (
  abbreviation   TEXT    PRIMARY KEY,
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  is_current     INTEGER NOT NULL CHECK (is_current IN (0,1)),
  note           TEXT
);

CREATE TABLE player (
  gsis_id        TEXT PRIMARY KEY,             -- nflverse/NFL id; the universal player key
  display_name   TEXT,
  first_name     TEXT,
  last_name      TEXT,
  position       TEXT,
  position_group TEXT,
  birth_date     TEXT,
  height         INTEGER,
  weight         INTEGER,
  college        TEXT,
  draft_year     INTEGER,
  draft_round    INTEGER,
  draft_pick     INTEGER,
  draft_team     TEXT,
  rookie_year    INTEGER,
  last_season    INTEGER,
  status         TEXT,
  esb_id         TEXT,
  pfr_id         TEXT,                         -- bridge to Pro-Football-Reference data
  espn_id        TEXT,
  headshot_url   TEXT,
  -- One human, two gsis_ids: 10 split identities are documented in
  -- lib/player_dimension.py::CANONICAL_GSIS. Source ids are NEVER rewritten in
  -- fact tables -- that would break byte-level reconciliation against nflverse
  -- -- so the alias points at its canonical row instead. NULL means "this row
  -- is already canonical".
  canonical_gsis_id TEXT REFERENCES player(gsis_id)
);

-- ================================================================ fact: game

CREATE TABLE game (
  game_id          TEXT    PRIMARY KEY,
  espn_event_id    TEXT    NOT NULL UNIQUE,    -- D9: unique, and it must stay that way
  gsis_game_id     TEXT,                       -- cross-source join keys
  pfr_game_id      TEXT,
  ftn_game_id      TEXT,
  old_game_id      TEXT,
  data_source      TEXT    NOT NULL CHECK (data_source IN ('nflverse','espn')),

  season           INTEGER NOT NULL CHECK (season BETWEEN 2010 AND 2026),
  season_type      TEXT    NOT NULL CHECK (season_type IN ('REG','POST')),
  week             INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round    TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),

  kickoff_utc      TEXT    NOT NULL,
  gameday          TEXT,                       -- venue-local calendar date (D11)
  gametime_et      TEXT,
  weekday          TEXT,
  time_valid       INTEGER NOT NULL CHECK (time_valid IN (0,1)),

  result_status    TEXT    NOT NULL CHECK (result_status IN ('final','scheduled','tbd')),

  away_franchise_id INTEGER REFERENCES team(franchise_id),
  home_franchise_id INTEGER REFERENCES team(franchise_id),
  away_abbr        TEXT,                       -- era-correct label as published
  home_abbr        TEXT,

  away_score       INTEGER CHECK (away_score >= 0),
  home_score       INTEGER CHECK (home_score >= 0),
  result           INTEGER,                    -- home_score - away_score
  total            INTEGER,                    -- home_score + away_score
  overtime         INTEGER CHECK (overtime IN (0,1)),
  div_game         INTEGER CHECK (div_game IN (0,1)),

  -- situational / modelling features
  location         TEXT CHECK (location IN ('Home','Neutral')),
  away_rest        INTEGER CHECK (away_rest >= 0),   -- actual rest, recomputed (D15)
  home_rest        INTEGER CHECK (home_rest >= 0),
  temp             INTEGER,                    -- NULL for dome/closed roof by construction
  wind             INTEGER,
  away_qb_id       TEXT REFERENCES player(gsis_id),
  home_qb_id       TEXT REFERENCES player(gsis_id),
  away_qb_name     TEXT,
  home_qb_name     TEXT,
  away_coach       TEXT,
  home_coach       TEXT,
  referee          TEXT,

  roof             TEXT,
  surface          TEXT,
  stadium_id       TEXT,
  stadium          TEXT,
  venue_id         INTEGER,                    -- ESPN venue id (a different id space)
  broadcast        TEXT,
  note             TEXT,

  -- Upstream values preserved wherever lib/corrections.py diverges from the
  -- published feed, so the divergence stays auditable (D15, D16-D19 pattern).
  away_rest_upstream INTEGER,                  -- nflverse rest, vs ORIGINAL schedule
  home_rest_upstream INTEGER,

  -- week and playoff_round are mutually exclusive and jointly exhaustive.
  -- This constraint is what permanently kills the week-18 ambiguity.
  CHECK ((season_type = 'REG' AND week IS NOT NULL AND playoff_round IS NULL)
      OR (season_type = 'POST' AND week IS NULL AND playoff_round IS NOT NULL)),

  CHECK ((result_status = 'final'  AND away_score IS NOT NULL AND home_score IS NOT NULL
                                   AND result = home_score - away_score
                                   AND total  = home_score + away_score)
      OR (result_status <> 'final' AND away_score IS NULL AND home_score IS NULL
                                   AND result IS NULL AND total IS NULL)),

  CHECK ((result_status = 'tbd' AND away_franchise_id IS NULL AND home_franchise_id IS NULL)
      OR (result_status <> 'tbd' AND away_franchise_id IS NOT NULL AND home_franchise_id IS NOT NULL)),

  CHECK (away_franchise_id IS NULL OR away_franchise_id <> home_franchise_id)
);

CREATE TABLE game_line (
  game_id           TEXT PRIMARY KEY REFERENCES game(game_id) ON DELETE CASCADE,
  spread_line       REAL NOT NULL,             -- positive = home favoured
  total_line        REAL NOT NULL,
  away_moneyline    INTEGER NOT NULL,
  home_moneyline    INTEGER NOT NULL,
  away_spread_odds  INTEGER NOT NULL,
  home_spread_odds  INTEGER NOT NULL,
  over_odds         INTEGER NOT NULL,
  under_odds        INTEGER NOT NULL,
  odds_source       TEXT NOT NULL,
  CHECK (total_line > 0),
  CHECK (away_moneyline <> 0 AND home_moneyline <> 0)
);

-- ================================================= fact: team-game (Tier 2)
-- Materialised long format: one row per team per game. This is the shape most
-- trend queries want, and unlike a UNION view it can carry real indexes.

CREATE TABLE team_game (
  game_id        TEXT    NOT NULL REFERENCES game(game_id) ON DELETE CASCADE,
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  opponent_id    INTEGER NOT NULL REFERENCES team(franchise_id),
  season         INTEGER NOT NULL,
  season_type    TEXT    NOT NULL CHECK (season_type IN ('REG','POST')),
  week           INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round  TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),
  kickoff_utc    TEXT    NOT NULL,
  is_home        INTEGER NOT NULL CHECK (is_home IN (0,1)),
  points_for     INTEGER,
  points_against INTEGER,
  margin         INTEGER,                      -- points_for - points_against
  spread         REAL,                         -- from this team's perspective
  total_line     REAL,
  moneyline      INTEGER,
  rest_days      INTEGER,                      -- actual rest from played kickoffs (D15)
  rest_days_upstream INTEGER,                  -- nflverse rest, vs ORIGINAL schedule

  -- Legacy booleans. RETAINED for byte-level continuity with the prior build
  -- and every downstream query written against it, but DEPRECATED: each
  -- overloads two distinct NULL meanings. Use the *_result columns.
  won            INTEGER CHECK (won IN (0,1)), -- NULL = tie OR unplayed
  covered        INTEGER CHECK (covered IN (0,1)), -- NULL = push OR no line

  -- D14. Explicit, three-valued, and NULL for exactly one reason each:
  --   su_result  NULL <=> the game has not been played (result_status <> 'final')
  --   ats_result NULL <=> not played, OR no spread was recorded
  --   ou_result  NULL <=> not played, OR no total was recorded
  -- 'P' is a push (margin exactly equals the spread / total exactly equals the
  -- line); 'T' is a tied game. Neither is a loss and neither is a NULL.
  su_result      TEXT CHECK (su_result  IN ('W','L','T')),
  ats_result     TEXT CHECK (ats_result IN ('W','L','P')),
  -- Over/under has no team perspective -- both sides share one total -- so its
  -- vocabulary is O/U/P rather than W/L/P. Forcing W/L here would require
  -- nominating "over" as a win, which is not a fact about the game.
  ou_result      TEXT CHECK (ou_result  IN ('O','U','P')),

  game_number    INTEGER,                      -- nth game of that team's season
  PRIMARY KEY (game_id, franchise_id),
  CHECK (franchise_id <> opponent_id),

  -- Mirrors `game`. team_game satisfied this on all 9,270 rows already; it was
  -- simply never enforced (S1 G-8).
  CHECK ((season_type = 'REG' AND week IS NOT NULL AND playoff_round IS NULL)
      OR (season_type = 'POST' AND week IS NULL AND playoff_round IS NOT NULL)),

  -- The result columns must be derivable from the inputs on the same row.
  -- These are what make "45.89% vs 50.00%" impossible to reproduce.
  CHECK (su_result IS NULL OR margin IS NOT NULL),
  CHECK (su_result IS NULL
      OR su_result = CASE WHEN margin > 0 THEN 'W' WHEN margin < 0 THEN 'L' ELSE 'T' END),
  CHECK ((su_result IS NULL) = (margin IS NULL)),

  CHECK (ats_result IS NULL OR (margin IS NOT NULL AND spread IS NOT NULL)),
  CHECK (ats_result IS NULL
      OR ats_result = CASE WHEN margin > spread THEN 'W'
                           WHEN margin < spread THEN 'L' ELSE 'P' END),
  CHECK ((ats_result IS NULL) = (margin IS NULL OR spread IS NULL)),

  CHECK (ou_result IS NULL
         OR (points_for IS NOT NULL AND points_against IS NOT NULL AND total_line IS NOT NULL)),
  CHECK (ou_result IS NULL
      OR ou_result = CASE WHEN points_for + points_against > total_line THEN 'O'
                          WHEN points_for + points_against < total_line THEN 'U' ELSE 'P' END),
  CHECK ((ou_result IS NULL)
         = (points_for IS NULL OR points_against IS NULL OR total_line IS NULL))
);

-- ============================================== fact: player-level (Tier 3)

CREATE TABLE player_game_stats (
  gsis_id        TEXT    NOT NULL REFERENCES player(gsis_id),
  season         INTEGER NOT NULL,
  -- nflverse's CONTINUOUS 1..22 counter, preserved exactly as published. It is
  -- NOT the schema's regular-season week: 18..22 are playoff rounds here. Join
  -- to `game` through game_id, never through (season, week).
  week           INTEGER NOT NULL,
  season_type    TEXT    NOT NULL,
  -- D1. The source CSV resolves this for 286,843 of 286,843 rows and the old
  -- loader discarded it, which is why v_player_game returned NULL game context,
  -- NULL spread_line and NULL total_line on all 12,050 postseason rows.
  game_id        TEXT    NOT NULL REFERENCES game(game_id),
  franchise_id   INTEGER REFERENCES team(franchise_id),
  opponent_id    INTEGER REFERENCES team(franchise_id),
  position       TEXT,
  position_group TEXT,
  completions    INTEGER, attempts INTEGER, passing_yards INTEGER, passing_tds INTEGER,
  interceptions  INTEGER, sacks_suffered REAL, passing_epa REAL,
  carries        INTEGER, rushing_yards INTEGER, rushing_tds INTEGER, rushing_epa REAL,
  receptions     INTEGER, targets INTEGER, receiving_yards INTEGER, receiving_tds INTEGER,
  receiving_epa  REAL, target_share REAL, air_yards_share REAL,
  fantasy_points REAL, fantasy_points_ppr REAL,
  PRIMARY KEY (gsis_id, season, week, season_type)
);

-- snap_counts ships no gsis_id -- its only player key is pfr_player_id, resolved
-- through lib/snap_crosswalk.py. gsis_id is NOT NULL and FK-checked: the prior
-- build shipped 227 orphan rows behind a ">=95%" gate (D4).
CREATE TABLE snap_count (
  gsis_id        TEXT    NOT NULL REFERENCES player(gsis_id),
  pfr_player_id  TEXT    NOT NULL,
  -- D7. The old loader's pick(row,'game_id','pfr_game_id') put the *nflverse*
  -- id in the column named pfr_game_id, so every join to game.pfr_game_id
  -- returned zero rows silently. Both ids are now carried under their own name.
  game_id        TEXT    NOT NULL REFERENCES game(game_id),
  pfr_game_id    TEXT    NOT NULL,             -- e.g. '201309080ram'
  season         INTEGER NOT NULL,
  -- D20. The feed publishes REG/WC/DIV/CON/SB and a continuous 1..22 week; the
  -- schema convention is REG/POST + playoff_round. Both are stored: the derived
  -- pair for joining, the source pair for reconciliation.
  season_type    TEXT    NOT NULL CHECK (season_type IN ('REG','POST')),
  week           INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round  TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),
  source_game_type TEXT  NOT NULL CHECK (source_game_type IN ('REG','WC','DIV','CON','SB')),
  source_week    INTEGER NOT NULL CHECK (source_week BETWEEN 1 AND 22),
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  -- D16: 4 Super Bowls have every snap row on the opponent's team upstream.
  -- The correction swaps franchise_id; this keeps what nflverse published, so
  -- the divergence stays auditable and byte-reconcilable.
  franchise_id_upstream INTEGER NOT NULL REFERENCES team(franchise_id),
  position       TEXT,
  offense_snaps  INTEGER, offense_pct REAL,
  defense_snaps  INTEGER, defense_pct REAL,
  st_snaps       INTEGER, st_pct REAL,
  PRIMARY KEY (pfr_player_id, pfr_game_id),    -- D23: verified collision-free
  CHECK ((season_type = 'REG' AND week IS NOT NULL AND playoff_round IS NULL)
      OR (season_type = 'POST' AND week IS NULL AND playoff_round IS NOT NULL))
);

CREATE TABLE roster_season (
  -- Surrogate key. The natural key (gsis_id, season, franchise_id, week,
  -- source_game_type) collides on exactly 4 rows, all of them upstream
  -- duplicate person records that differ only in crosswalk ids the loader does
  -- not keep (espn_id / pfr_id / rotowire_id / sportradar_id). source_ordinal
  -- is the 1-based occurrence index within that key, read off the source file
  -- -- it is a fact about the source, not an invented value -- and it makes the
  -- 4 rows distinguishable instead of silently identical (D23, N8).
  roster_row_id  INTEGER PRIMARY KEY,
  gsis_id        TEXT REFERENCES player(gsis_id),  -- NULL on 18 rows (N9, upstream)
  season         INTEGER NOT NULL,
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  -- N8: the old loader discarded week and game_type entirely, which is what
  -- made those 4 rows indistinguishable in the first place.
  season_type    TEXT    NOT NULL CHECK (season_type IN ('REG','POST')),
  week           INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round  TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),
  source_game_type TEXT  NOT NULL CHECK (source_game_type IN ('REG','WC','DIV','CON','SB')),
  source_week    INTEGER NOT NULL CHECK (source_week BETWEEN 1 AND 22),
  position       TEXT,
  depth_chart_position TEXT,
  jersey_number  INTEGER,
  status         TEXT,
  full_name      TEXT,
  years_exp      INTEGER,
  source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 1),
  UNIQUE (gsis_id, season, franchise_id, source_week, source_game_type, source_ordinal),
  CHECK ((season_type = 'REG' AND week IS NOT NULL AND playoff_round IS NULL)
      OR (season_type = 'POST' AND week IS NULL AND playoff_round IS NOT NULL))
);

-- B3's DDL, adopted verbatim except for the surrogate key and source_ordinal
-- (D23) and the player FK. Holds BOTH nflverse depth-chart shapes:
--   Shape A (552,514 rows, 2010-2024) -- the historical NFL/Elias feed.
--   Shape B (554,215 rows, 2025-08-03..2026-03-14) -- a near-daily ESPN scrape
--     with no season/week column, recovered from its `dt` instant (D6).
CREATE TABLE depth_chart (
  depth_chart_id INTEGER PRIMARY KEY,          -- D23
  -- provenance ------------------------------------------------------------
  source_shape   TEXT    NOT NULL CHECK (source_shape IN ('A','B')),
  snapshot_ts    TEXT,                         -- shape B only: ISO-8601 Z capture instant
  source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 1),
  -- when ------------------------------------------------------------------
  season         INTEGER NOT NULL CHECK (season BETWEEN 2010 AND 2026),
  season_type    TEXT    CHECK (season_type IN ('REG','POST')),
  week           INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round  TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),
  bucket         TEXT    NOT NULL
                 CHECK (bucket IN ('preseason','regular','postseason','offseason')),
  source_game_type TEXT  CHECK (source_game_type IN ('REG','WC','DIV','CON','SB','SBBYE')),
  source_week    INTEGER CHECK (source_week BETWEEN 1 AND 22),  -- nflverse continuous week
  -- who -------------------------------------------------------------------
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  gsis_id        TEXT    REFERENCES player(gsis_id),
  gsis_source    TEXT    CHECK (gsis_source IN ('feed','T0','T1','T2','T3','T4')),
  espn_id        TEXT,
  full_name      TEXT,
  jersey_number  INTEGER,
  -- what ------------------------------------------------------------------
  position       TEXT,     -- shape A only; shape B never publishes a position
  depth_position TEXT,     -- the slot, as published
  depth_position_canonical TEXT,               -- POSITION_CROSSWALK output
  depth_order    INTEGER CHECK (depth_order >= 1),  -- A: 1-3 team; B: 1-15 rank. Not one scale.
  unit           TEXT    CHECK (unit IN ('Offense','Defense','Special Teams')),
  scheme         TEXT    CHECK (scheme IN ('3WR 1TE','Base 3-4 D','Base 4-3 D','Special Teams')),
  pos_slot       INTEGER CHECK (pos_slot BETWEEN 1 AND 12),
  elias_id       TEXT,
  -- week / playoff_round exclusivity, mirroring `game` ----------------------
  CHECK (week IS NULL OR playoff_round IS NULL),
  CHECK ((week          IS NOT NULL AND season_type = 'REG')
      OR (playoff_round IS NOT NULL AND season_type = 'POST')
      OR (week IS NULL AND playoff_round IS NULL AND season_type IS NULL)),
  -- both NULL is legal only where season S has no next event to forecast
  CHECK (week IS NOT NULL OR playoff_round IS NOT NULL
         OR bucket IN ('postseason','offseason')),
  CHECK ((source_shape = 'B') = (snapshot_ts IS NOT NULL)),
  CHECK (gsis_id IS NOT NULL OR espn_id IS NOT NULL)   -- holds for all 363 exceptions too
);

-- ========================================================== audit: corrections
-- Every value lib/corrections.py changes, with the value the published feed
-- carries, the value written, and the evidence. INTEGRATION.md requires the
-- upstream value be preserved alongside the correction for D16-D19; this table
-- does it for all nine corrected defects, uniformly and queryably:
--
--   SELECT defect, COUNT(*) FROM data_correction GROUP BY 1;
--   SELECT * FROM data_correction WHERE target_table = 'game' AND defect = 'D15';
CREATE TABLE data_correction (
  correction_id  INTEGER PRIMARY KEY,
  defect         TEXT NOT NULL,               -- D9, D10, D11, D12, D13, D15..D19
  target_table   TEXT NOT NULL,
  target_key     TEXT NOT NULL,               -- the row's identity, as text
  column_name    TEXT NOT NULL,
  upstream_value TEXT,                        -- what the source publishes
  corrected_value TEXT,                       -- what this database stores
  source         TEXT NOT NULL,               -- the citation. Never empty.
  CHECK (length(source) > 0),
  CHECK (upstream_value IS NOT corrected_value)
);
CREATE INDEX idx_correction_defect ON data_correction(defect);
CREATE INDEX idx_correction_target ON data_correction(target_table, target_key);

-- ================================================================== indexes

CREATE INDEX idx_game_season              ON game(season);
CREATE INDEX idx_game_season_week         ON game(season, week);
CREATE INDEX idx_game_season_type         ON game(season, season_type);
CREATE INDEX idx_game_playoff             ON game(season, playoff_round);
CREATE INDEX idx_game_kickoff             ON game(kickoff_utc);
CREATE INDEX idx_game_gameday             ON game(gameday);
-- espn_event_id is covered by the UNIQUE constraint's autoindex (D9).
CREATE INDEX idx_game_gsis                ON game(gsis_game_id);
CREATE INDEX idx_game_pfr                 ON game(pfr_game_id);
CREATE INDEX idx_game_home                ON game(home_franchise_id, season);
CREATE INDEX idx_game_away                ON game(away_franchise_id, season);
CREATE INDEX idx_game_status              ON game(result_status);
CREATE INDEX idx_game_source              ON game(data_source);
CREATE INDEX idx_game_qb_home             ON game(home_qb_id);
CREATE INDEX idx_game_qb_away             ON game(away_qb_id);
CREATE INDEX idx_game_venue               ON game(venue_id);
-- Partial index: 94% of analytical queries touch only completed games.
CREATE INDEX idx_game_final_season        ON game(season, week) WHERE result_status = 'final';

CREATE INDEX idx_line_source              ON game_line(odds_source);
CREATE INDEX idx_line_spread              ON game_line(spread_line);
CREATE INDEX idx_line_total               ON game_line(total_line);

-- Covering index: team trend queries read these columns and never touch the table.
CREATE INDEX idx_tg_team_season           ON team_game(franchise_id, season, week);
CREATE INDEX idx_tg_cover                 ON team_game(franchise_id, season, is_home,
                                                       margin, spread, covered, won);
CREATE INDEX idx_tg_result                ON team_game(franchise_id, season, is_home,
                                                       ats_result, ou_result, su_result);
CREATE INDEX idx_tg_opponent              ON team_game(opponent_id, season);
CREATE INDEX idx_tg_kickoff               ON team_game(kickoff_utc);
CREATE INDEX idx_tg_season_type           ON team_game(season, season_type);

CREATE INDEX idx_pgs_player_season        ON player_game_stats(gsis_id, season, week);
CREATE INDEX idx_pgs_season_week          ON player_game_stats(season, week);
CREATE INDEX idx_pgs_game                 ON player_game_stats(game_id);
CREATE INDEX idx_pgs_team                 ON player_game_stats(franchise_id, season, week);
CREATE INDEX idx_pgs_position             ON player_game_stats(position, season);
CREATE INDEX idx_pgs_opponent             ON player_game_stats(opponent_id, season);
-- Covering index for the core prop query: a receiver's usage over recent weeks.
CREATE INDEX idx_pgs_prop_rec             ON player_game_stats(gsis_id, season, week,
                                              targets, receptions, receiving_yards, receiving_tds);
CREATE INDEX idx_pgs_prop_rush            ON player_game_stats(gsis_id, season, week,
                                              carries, rushing_yards, rushing_tds);
CREATE INDEX idx_pgs_prop_pass            ON player_game_stats(gsis_id, season, week,
                                              attempts, completions, passing_yards, passing_tds);

CREATE INDEX idx_snap_player              ON snap_count(gsis_id, season, week);
CREATE INDEX idx_snap_pfr                 ON snap_count(pfr_player_id, season, week);
CREATE INDEX idx_snap_game                ON snap_count(game_id);          -- nflverse id (D7)
CREATE INDEX idx_snap_pfr_game            ON snap_count(pfr_game_id);      -- PFR's own id (D7)
CREATE INDEX idx_snap_team                ON snap_count(franchise_id, season, week);
CREATE INDEX idx_snap_join                ON snap_count(gsis_id, game_id, franchise_id);

CREATE INDEX idx_roster_player            ON roster_season(gsis_id, season);
CREATE INDEX idx_roster_team              ON roster_season(franchise_id, season);

CREATE INDEX idx_depth_player             ON depth_chart(gsis_id, season, week);
CREATE INDEX idx_depth_team               ON depth_chart(franchise_id, season, week,
                                                         depth_position_canonical);
CREATE INDEX idx_depth_snap               ON depth_chart(snapshot_ts);
CREATE INDEX idx_depth_espn               ON depth_chart(espn_id);
CREATE INDEX idx_depth_bucket             ON depth_chart(season, bucket);
-- B3 proves the keep-all decision: collision-free over all 554,215 shape-B rows.
CREATE UNIQUE INDEX uq_depth_snapshot
  ON depth_chart(snapshot_ts, franchise_id, scheme, pos_slot, depth_order)
  WHERE snapshot_ts IS NOT NULL;

CREATE INDEX idx_player_name              ON player(display_name);
CREATE INDEX idx_player_position          ON player(position);
CREATE INDEX idx_player_pfr               ON player(pfr_id);
CREATE INDEX idx_player_espn              ON player(espn_id);   -- D24
CREATE INDEX idx_player_canonical         ON player(canonical_gsis_id);

-- ==================================================================== views

CREATE VIEW v_game AS
SELECT g.game_id, g.season, g.season_type, g.week, g.playoff_round,
       g.kickoff_utc, g.weekday, g.result_status, g.location,
       g.away_franchise_id, at.abbreviation AS away_team, at.display_name AS away_name,
       g.home_franchise_id, ht.abbreviation AS home_team, ht.display_name AS home_name,
       g.away_abbr AS away_abbr_as_published, g.home_abbr AS home_abbr_as_published,
       g.away_score, g.home_score, g.result, g.total, g.overtime, g.div_game,
       g.away_rest, g.home_rest, g.home_rest - g.away_rest AS home_rest_edge,
       g.temp, g.wind, g.roof, g.surface, g.stadium, g.stadium_id, g.venue_id,
       g.away_qb_id, g.away_qb_name, g.home_qb_id, g.home_qb_name,
       g.away_coach, g.home_coach, g.referee, g.broadcast,
       l.spread_line, l.total_line, l.away_moneyline, l.home_moneyline,
       l.away_spread_odds, l.home_spread_odds, l.over_odds, l.under_odds, l.odds_source,
       g.espn_event_id, g.gsis_game_id, g.pfr_game_id, g.data_source
FROM game g
LEFT JOIN team at ON at.franchise_id = g.away_franchise_id
LEFT JOIN team ht ON ht.franchise_id = g.home_franchise_id
LEFT JOIN game_line l ON l.game_id = g.game_id;

CREATE VIEW v_backtest AS
SELECT v.*,
       CASE WHEN v.result > v.spread_line THEN 'home'
            WHEN v.result < v.spread_line THEN 'away'
            ELSE 'push' END AS ats_winner,
       v.result - v.spread_line AS home_ats_margin,
       CASE WHEN v.total > v.total_line THEN 'over'
            WHEN v.total < v.total_line THEN 'under'
            ELSE 'push' END AS total_result,
       v.total - v.total_line   AS total_margin
FROM v_game v
WHERE v.result_status = 'final' AND v.spread_line IS NOT NULL;

CREATE VIEW v_team_game AS
SELECT tg.*, t.abbreviation AS team, t.display_name AS team_name,
       o.abbreviation AS opponent, g.roof, g.surface, g.temp, g.wind, g.div_game
FROM team_game tg
JOIN team t ON t.franchise_id = tg.franchise_id
JOIN team o ON o.franchise_id = tg.opponent_id
JOIN game g ON g.game_id = tg.game_id;

CREATE VIEW v_season_coverage AS
SELECT season,
       SUM(season_type = 'REG')      AS reg_games,
       SUM(season_type = 'POST')     AS post_games,
       SUM(result_status = 'final')  AS final_games,
       SUM(result_status = 'scheduled') AS scheduled_games,
       SUM(result_status = 'tbd')    AS tbd_games,
       (SELECT COUNT(*) FROM game_line l JOIN game g2 ON g2.game_id = l.game_id
         WHERE g2.season = g.season) AS games_with_lines,
       (SELECT COUNT(*) FROM player_game_stats p WHERE p.season = g.season) AS player_rows
FROM game g GROUP BY season;

-- Player-game joined to its game context: the base surface for prop modelling.
--
-- D1. The game join is on game_id. The old view joined on
-- (season, week, season_type) plus a franchise predicate, which can never match
-- a postseason row because `game` stores POST as week NULL + playoff_round
-- while player_game_stats stores nflverse's continuous weeks 18-22. All 12,050
-- POST rows came back with NULL game_id, NULL kickoff, NULL roof, NULL
-- spread_line and NULL total_line.
--
-- D2. The snap join carries franchise_id and game_id. Without the franchise
-- predicate a player with snaps for two teams in one week fans out and picks up
-- the wrong team's usage (Jalen Davis 00-0034446, 2021 wk 12); the view
-- returned 274,794 REG rows against a 274,793-row base.
CREATE VIEW v_player_game AS
SELECT p.gsis_id, pl.display_name, p.position, p.position_group,
       p.season, p.week, p.season_type,
       p.franchise_id, t.abbreviation AS team,
       p.opponent_id, o.abbreviation AS opponent,
       p.game_id, g.season_type AS game_season_type, g.week AS game_week,
       g.playoff_round, g.kickoff_utc, g.roof, g.surface, g.temp, g.wind,
       CASE WHEN g.home_franchise_id = p.franchise_id THEN 1 ELSE 0 END AS is_home,
       p.completions, p.attempts, p.passing_yards, p.passing_tds, p.interceptions, p.passing_epa,
       p.carries, p.rushing_yards, p.rushing_tds, p.rushing_epa,
       p.receptions, p.targets, p.receiving_yards, p.receiving_tds, p.receiving_epa,
       p.target_share, p.air_yards_share, p.fantasy_points, p.fantasy_points_ppr,
       s.offense_snaps, s.offense_pct, s.defense_snaps, s.defense_pct,
       l.spread_line, l.total_line
FROM player_game_stats p
LEFT JOIN player pl ON pl.gsis_id = p.gsis_id
LEFT JOIN team t ON t.franchise_id = p.franchise_id
LEFT JOIN team o ON o.franchise_id = p.opponent_id
JOIN game g ON g.game_id = p.game_id
LEFT JOIN snap_count s ON s.gsis_id = p.gsis_id
     AND s.game_id = p.game_id
     AND s.franchise_id = p.franchise_id
LEFT JOIN game_line l ON l.game_id = p.game_id;

-- Observed-only betting lines. S1's standing-rule-1 note: four assumed -110
-- juice values sit in game_line under odds_source='manual-2026-07-27' by
-- explicit owner instruction. Isolation currently depends on every consumer
-- remembering to filter. This view makes observed-only the default path.
CREATE VIEW v_game_line_observed AS
SELECT * FROM game_line WHERE odds_source = 'nflverse';
