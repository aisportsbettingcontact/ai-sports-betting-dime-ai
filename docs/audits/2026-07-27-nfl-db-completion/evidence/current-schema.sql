CREATE TABLE team (
  franchise_id   INTEGER PRIMARY KEY,          -- ESPN franchise id, stable across relocation
  abbreviation   TEXT    NOT NULL UNIQUE,
  display_name   TEXT    NOT NULL UNIQUE,
  conference     TEXT    NOT NULL CHECK (conference IN ('AFC','NFC')),
  division       TEXT    NOT NULL
);
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
  headshot_url   TEXT
);
CREATE TABLE game (
  game_id          TEXT    PRIMARY KEY,
  espn_event_id    TEXT    NOT NULL,           -- indexed, deliberately NOT unique
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
  gameday          TEXT,
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
  away_rest        INTEGER CHECK (away_rest >= 0),
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
CREATE TABLE team_game (
  game_id        TEXT    NOT NULL REFERENCES game(game_id) ON DELETE CASCADE,
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  opponent_id    INTEGER NOT NULL REFERENCES team(franchise_id),
  season         INTEGER NOT NULL,
  season_type    TEXT    NOT NULL,
  week           INTEGER,
  playoff_round  TEXT,
  kickoff_utc    TEXT    NOT NULL,
  is_home        INTEGER NOT NULL CHECK (is_home IN (0,1)),
  points_for     INTEGER,
  points_against INTEGER,
  margin         INTEGER,                      -- points_for - points_against
  spread         REAL,                         -- from this team's perspective
  total_line     REAL,
  moneyline      INTEGER,
  rest_days      INTEGER,
  won            INTEGER CHECK (won IN (0,1)), -- NULL for ties and unplayed
  covered        INTEGER CHECK (covered IN (0,1)),
  game_number    INTEGER,                      -- nth game of that team's season
  PRIMARY KEY (game_id, franchise_id),
  CHECK (franchise_id <> opponent_id)
);
CREATE TABLE player_game_stats (
  gsis_id        TEXT    NOT NULL REFERENCES player(gsis_id),
  season         INTEGER NOT NULL,
  week           INTEGER NOT NULL,
  season_type    TEXT    NOT NULL,
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
CREATE TABLE snap_count (
  gsis_id        TEXT,                          -- may be null: source keys on pfr_player_id
  pfr_player_id  TEXT,
  pfr_game_id    TEXT    NOT NULL,
  season         INTEGER NOT NULL,
  week           INTEGER NOT NULL,
  season_type    TEXT,
  franchise_id   INTEGER REFERENCES team(franchise_id),
  position       TEXT,
  offense_snaps  INTEGER, offense_pct REAL,
  defense_snaps  INTEGER, defense_pct REAL,
  st_snaps       INTEGER, st_pct REAL
);
CREATE TABLE roster_season (
  gsis_id        TEXT,
  season         INTEGER NOT NULL,
  franchise_id   INTEGER REFERENCES team(franchise_id),
  position       TEXT,
  depth_chart_position TEXT,
  jersey_number  INTEGER,
  status         TEXT,
  full_name      TEXT,
  years_exp      INTEGER
);
CREATE TABLE depth_chart (
  gsis_id        TEXT,
  season         INTEGER NOT NULL,
  week           INTEGER,
  season_type    TEXT,
  franchise_id   INTEGER REFERENCES team(franchise_id),
  position       TEXT,
  depth_position TEXT,
  depth_order    INTEGER,
  full_name      TEXT
);
CREATE INDEX idx_game_season              ON game(season);
CREATE INDEX idx_game_season_week         ON game(season, week);
CREATE INDEX idx_game_season_type         ON game(season, season_type);
CREATE INDEX idx_game_playoff             ON game(season, playoff_round);
CREATE INDEX idx_game_kickoff             ON game(kickoff_utc);
CREATE INDEX idx_game_gameday             ON game(gameday);
CREATE INDEX idx_game_espn_event          ON game(espn_event_id);
CREATE INDEX idx_game_gsis                ON game(gsis_game_id);
CREATE INDEX idx_game_pfr                 ON game(pfr_game_id);
CREATE INDEX idx_game_home                ON game(home_franchise_id, season);
CREATE INDEX idx_game_away                ON game(away_franchise_id, season);
CREATE INDEX idx_game_status              ON game(result_status);
CREATE INDEX idx_game_source              ON game(data_source);
CREATE INDEX idx_game_qb_home             ON game(home_qb_id);
CREATE INDEX idx_game_qb_away             ON game(away_qb_id);
CREATE INDEX idx_game_final_season        ON game(season, week) WHERE result_status = 'final';
CREATE INDEX idx_line_source              ON game_line(odds_source);
CREATE INDEX idx_line_spread              ON game_line(spread_line);
CREATE INDEX idx_line_total               ON game_line(total_line);
CREATE INDEX idx_tg_team_season           ON team_game(franchise_id, season, week);
CREATE INDEX idx_tg_cover                 ON team_game(franchise_id, season, is_home,
                                                       margin, spread, covered, won);
CREATE INDEX idx_tg_opponent              ON team_game(opponent_id, season);
CREATE INDEX idx_tg_kickoff               ON team_game(kickoff_utc);
CREATE INDEX idx_tg_season_type           ON team_game(season, season_type);
CREATE INDEX idx_pgs_player_season        ON player_game_stats(gsis_id, season, week);
CREATE INDEX idx_pgs_season_week          ON player_game_stats(season, week);
CREATE INDEX idx_pgs_team                 ON player_game_stats(franchise_id, season, week);
CREATE INDEX idx_pgs_position             ON player_game_stats(position, season);
CREATE INDEX idx_pgs_opponent             ON player_game_stats(opponent_id, season);
CREATE INDEX idx_pgs_prop_rec             ON player_game_stats(gsis_id, season, week,
                                              targets, receptions, receiving_yards, receiving_tds);
CREATE INDEX idx_pgs_prop_rush            ON player_game_stats(gsis_id, season, week,
                                              carries, rushing_yards, rushing_tds);
CREATE INDEX idx_pgs_prop_pass            ON player_game_stats(gsis_id, season, week,
                                              attempts, completions, passing_yards, passing_tds);
CREATE INDEX idx_snap_player              ON snap_count(gsis_id, season, week);
CREATE INDEX idx_snap_pfr                 ON snap_count(pfr_player_id, season, week);
CREATE INDEX idx_snap_game                ON snap_count(pfr_game_id);
CREATE INDEX idx_snap_team                ON snap_count(franchise_id, season, week);
CREATE INDEX idx_roster_player            ON roster_season(gsis_id, season);
CREATE INDEX idx_roster_team              ON roster_season(franchise_id, season);
CREATE INDEX idx_depth_player             ON depth_chart(gsis_id, season, week);
CREATE INDEX idx_depth_team               ON depth_chart(franchise_id, season, week, position);
CREATE INDEX idx_player_name              ON player(display_name);
CREATE INDEX idx_player_position          ON player(position);
CREATE INDEX idx_player_pfr               ON player(pfr_id);
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
LEFT JOIN game_line l ON l.game_id = g.game_id
/* v_game(game_id,season,season_type,week,playoff_round,kickoff_utc,weekday,result_status,location,away_franchise_id,away_team,away_name,home_franchise_id,home_team,home_name,away_abbr_as_published,home_abbr_as_published,away_score,home_score,result,total,overtime,div_game,away_rest,home_rest,home_rest_edge,"temp",wind,roof,surface,stadium,stadium_id,venue_id,away_qb_id,away_qb_name,home_qb_id,home_qb_name,away_coach,home_coach,referee,broadcast,spread_line,total_line,away_moneyline,home_moneyline,away_spread_odds,home_spread_odds,over_odds,under_odds,odds_source,espn_event_id,gsis_game_id,pfr_game_id,data_source) */;
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
WHERE v.result_status = 'final' AND v.spread_line IS NOT NULL
/* v_backtest(game_id,season,season_type,week,playoff_round,kickoff_utc,weekday,result_status,location,away_franchise_id,away_team,away_name,home_franchise_id,home_team,home_name,away_abbr_as_published,home_abbr_as_published,away_score,home_score,result,total,overtime,div_game,away_rest,home_rest,home_rest_edge,"temp",wind,roof,surface,stadium,stadium_id,venue_id,away_qb_id,away_qb_name,home_qb_id,home_qb_name,away_coach,home_coach,referee,broadcast,spread_line,total_line,away_moneyline,home_moneyline,away_spread_odds,home_spread_odds,over_odds,under_odds,odds_source,espn_event_id,gsis_game_id,pfr_game_id,data_source,ats_winner,home_ats_margin,total_result,total_margin) */;
CREATE VIEW v_team_game AS
SELECT tg.*, t.abbreviation AS team, t.display_name AS team_name,
       o.abbreviation AS opponent, g.roof, g.surface, g.temp, g.wind, g.div_game
FROM team_game tg
JOIN team t ON t.franchise_id = tg.franchise_id
JOIN team o ON o.franchise_id = tg.opponent_id
JOIN game g ON g.game_id = tg.game_id
/* v_team_game(game_id,franchise_id,opponent_id,season,season_type,week,playoff_round,kickoff_utc,is_home,points_for,points_against,margin,spread,total_line,moneyline,rest_days,won,covered,game_number,team,team_name,opponent,roof,surface,"temp",wind,div_game) */;
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
FROM game g GROUP BY season
/* v_season_coverage(season,reg_games,post_games,final_games,scheduled_games,tbd_games,games_with_lines,player_rows) */;
CREATE VIEW v_player_game AS
SELECT p.gsis_id, pl.display_name, p.position, p.position_group,
       p.season, p.week, p.season_type,
       p.franchise_id, t.abbreviation AS team,
       p.opponent_id, o.abbreviation AS opponent,
       g.game_id, g.kickoff_utc, g.roof, g.surface, g.temp, g.wind,
       CASE WHEN g.home_franchise_id = p.franchise_id THEN 1 ELSE 0 END AS is_home,
       p.completions, p.attempts, p.passing_yards, p.passing_tds, p.interceptions, p.passing_epa,
       p.carries, p.rushing_yards, p.rushing_tds, p.rushing_epa,
       p.receptions, p.targets, p.receiving_yards, p.receiving_tds, p.receiving_epa,
       p.target_share, p.air_yards_share, p.fantasy_points, p.fantasy_points_ppr,
       s.offense_snaps, s.offense_pct,
       l.spread_line, l.total_line
FROM player_game_stats p
LEFT JOIN player pl ON pl.gsis_id = p.gsis_id
LEFT JOIN team t ON t.franchise_id = p.franchise_id
LEFT JOIN team o ON o.franchise_id = p.opponent_id
LEFT JOIN game g ON g.season = p.season AND g.week = p.week
     AND g.season_type = p.season_type
     AND (g.home_franchise_id = p.franchise_id OR g.away_franchise_id = p.franchise_id)
LEFT JOIN snap_count s ON s.gsis_id = p.gsis_id AND s.season = p.season AND s.week = p.week
LEFT JOIN game_line l ON l.game_id = g.game_id
/* v_player_game(gsis_id,display_name,position,position_group,season,week,season_type,franchise_id,team,opponent_id,opponent,game_id,kickoff_utc,roof,surface,"temp",wind,is_home,completions,attempts,passing_yards,passing_tds,interceptions,passing_epa,carries,rushing_yards,rushing_tds,rushing_epa,receptions,targets,receiving_yards,receiving_tds,receiving_epa,target_share,air_yards_share,fantasy_points,fantasy_points_ppr,offense_snaps,offense_pct,spread_line,total_line) */;
CREATE TABLE sqlite_stat1(tbl,idx,stat);
CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample);
