import {
  boolean,
  char,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * MLB canonical schema — sourced from the MLB Stats API (statsapi).
 * Natural keys throughout (statsapi ids); no surrogate autoincrement ids.
 * Seeded/backfilled by the MLB canonical DB migration (see
 * docs/superpowers/plans/2026-07-2*-mlb-canonical-db*.md).
 */

export const mlbSeasons = mysqlTable("mlb_seasons", {
  season: int("season").primaryKey(),
  regularSeasonStart: date("regular_season_start", { mode: "string" }).notNull(),
  regularSeasonEnd: date("regular_season_end", { mode: "string" }).notNull(),
  postseasonEnd: date("postseason_end", { mode: "string" }),
  gamesExpected: int("games_expected").notNull(),
  notes: varchar("notes", { length: 255 }),
});

export const mlbFranchises = mysqlTable("mlb_franchises", {
  /** statsapi numeric team id — canonical join key. */
  teamId: int("team_id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  abbrev: varchar("abbrev", { length: 8 }).notNull(),
  league: varchar("league", { length: 4 }),
  division: varchar("division", { length: 16 }),
  active: boolean("active").notNull(),
  firstSeason: int("first_season"),
  lastSeason: int("last_season"),
  // ─── Crosswalks to other data sources (all null until backfilled) ──────────
  vsinSlug: varchar("vsin_slug", { length: 64 }),
  anSlug: varchar("an_slug", { length: 64 }),
  anTeamId: int("an_team_id"),
  brAbbrev: varchar("br_abbrev", { length: 8 }),
  mlbCode: varchar("mlb_code", { length: 8 }),
  anLogoSlug: varchar("an_logo_slug", { length: 64 }),
  dbSlug: varchar("db_slug", { length: 64 }),
});

export const mlbVenues = mysqlTable("mlb_venues", {
  venueId: int("venue_id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  active: boolean("active"),
  capacity: int("capacity"),
  turfType: varchar("turf_type", { length: 32 }),
  roofType: varchar("roof_type", { length: 32 }),
  leftLine: int("left_line"),
  leftField: int("left_field"),
  leftCenter: int("left_center"),
  center: int("center"),
  rightCenter: int("right_center"),
  rightField: int("right_field"),
  rightLine: int("right_line"),
  city: varchar("city", { length: 80 }),
  state: varchar("state", { length: 40 }),
  timezone: varchar("timezone", { length: 48 }),
});

export const mlbPeople = mysqlTable("mlb_people", {
  mlbamId: int("mlbam_id").primaryKey(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  firstName: varchar("first_name", { length: 60 }),
  lastName: varchar("last_name", { length: 60 }),
  primaryPosition: varchar("primary_position", { length: 8 }),
  batSide: char("bat_side", { length: 1 }),
  pitchHand: char("pitch_hand", { length: 1 }),
  birthDate: date("birth_date", { mode: "string" }),
  mlbDebut: date("mlb_debut", { mode: "string" }),
  active: boolean("active"),
  isUmpire: boolean("is_umpire").default(false).notNull(),
  // ─── Crosswalks to other data sources (all null until backfilled) ──────────
  brId: varchar("br_id", { length: 16 }),
  anPlayerId: int("an_player_id"),
  rotowireId: int("rotowire_id"),
  retrosheetId: varchar("retrosheet_id", { length: 16 }),
});

export const mlbGames = mysqlTable(
  "mlb_games",
  {
    /** statsapi gamePk — canonical join key across plays/pitches/boxscores. */
    gamePk: int("game_pk").primaryKey(),
    gameGuid: varchar("game_guid", { length: 64 }),
    season: int("season").notNull(),
    /** 'R' regular, 'F'/'D'/'L'/'W' postseason rounds, 'S' spring, etc. */
    gameType: char("game_type", { length: 1 }).notNull(),
    seriesDescription: varchar("series_description", { length: 48 }),
    officialDate: date("official_date", { mode: "string" }).notNull(),
    gameDatetimeUtc: datetime("game_datetime_utc").notNull(),
    dayNight: varchar("day_night", { length: 8 }),
    doubleHeader: char("double_header", { length: 1 }).notNull(),
    gameNumber: int("game_number").notNull(),
    gamesInSeries: int("games_in_series"),
    seriesGameNumber: int("series_game_number"),
    statusCode: varchar("status_code", { length: 4 }).notNull(),
    detailedState: varchar("detailed_state", { length: 48 }).notNull(),
    isTie: boolean("is_tie").default(false).notNull(),
    awayTeamId: int("away_team_id").notNull(),
    homeTeamId: int("home_team_id").notNull(),
    awayScore: int("away_score").notNull(),
    homeScore: int("home_score").notNull(),
    awayHits: int("away_hits"),
    homeHits: int("home_hits"),
    awayErrors: int("away_errors"),
    homeErrors: int("home_errors"),
    innings: int("innings").notNull(),
    scheduledInnings: int("scheduled_innings"),
    venueId: int("venue_id"),
    attendance: int("attendance"),
    durationMinutes: int("duration_minutes"),
    firstPitchUtc: datetime("first_pitch_utc"),
    weatherCondition: varchar("weather_condition", { length: 48 }),
    tempF: int("temp_f"),
    wind: varchar("wind", { length: 64 }),
    winnerPitcherId: int("winner_pitcher_id"),
    loserPitcherId: int("loser_pitcher_id"),
    savePitcherId: int("save_pitcher_id"),
    gamedayType: char("gameday_type", { length: 1 }),
    /** metaData.timeStamp from the statsapi feed — revision provenance. */
    feedTimestamp: varchar("feed_timestamp", { length: 16 }).notNull(),
    loadedAt: datetime("loaded_at").notNull(),
  },
  (t) => [
    index("idx_mlb_games_official_date").on(t.officialDate),
    index("idx_mlb_games_season_type").on(t.season, t.gameType),
    index("idx_mlb_games_away_season").on(t.awayTeamId, t.season),
    index("idx_mlb_games_home_season").on(t.homeTeamId, t.season),
    index("idx_mlb_games_venue").on(t.venueId),
  ],
);

export const mlbPlays = mysqlTable(
  "mlb_plays",
  {
    gamePk: int("game_pk").notNull(),
    atBatIndex: int("at_bat_index").notNull(),
    inning: int("inning").notNull(),
    half: varchar("half", { length: 6 }).notNull(),
    batterId: int("batter_id").notNull(),
    pitcherId: int("pitcher_id").notNull(),
    batSide: char("bat_side", { length: 1 }),
    pitchHand: char("pitch_hand", { length: 1 }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    event: varchar("event", { length: 64 }),
    description: text("description"),
    rbi: int("rbi").notNull(),
    awayScore: int("away_score").notNull(),
    homeScore: int("home_score").notNull(),
    isScoringPlay: boolean("is_scoring_play").notNull(),
    hasOut: boolean("has_out"),
    outsEnd: int("outs_end"),
    ballsEnd: int("balls_end"),
    strikesEnd: int("strikes_end"),
    menOnBaseSplit: varchar("men_on_base_split", { length: 16 }),
    startTimeUtc: datetime("start_time_utc"),
    endTimeUtc: datetime("end_time_utc"),
    runners: json("runners"),
    pitchCount: int("pitch_count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gamePk, t.atBatIndex] }),
    index("idx_mlb_plays_batter").on(t.batterId),
    index("idx_mlb_plays_pitcher").on(t.pitcherId),
    index("idx_mlb_plays_event_type").on(t.eventType),
  ],
);

export const mlbPitches = mysqlTable(
  "mlb_pitches",
  {
    /** statsapi playId — globally unique across games. */
    playId: varchar("play_id", { length: 40 }).primaryKey(),
    gamePk: int("game_pk").notNull(),
    season: int("season").notNull(),
    atBatIndex: int("at_bat_index").notNull(),
    pitchNumber: int("pitch_number").notNull(),
    batterId: int("batter_id").notNull(),
    pitcherId: int("pitcher_id").notNull(),
    isPitch: boolean("is_pitch").default(true).notNull(),
    callCode: varchar("call_code", { length: 4 }),
    callDescription: varchar("call_description", { length: 48 }),
    pitchTypeCode: varchar("pitch_type_code", { length: 4 }),
    pitchType: varchar("pitch_type", { length: 32 }),
    typeConfidence: decimal("type_confidence", { precision: 4, scale: 2 }),
    balls: int("balls"),
    strikes: int("strikes"),
    startSpeed: decimal("start_speed", { precision: 5, scale: 2 }),
    endSpeed: decimal("end_speed", { precision: 5, scale: 2 }),
    spinRate: int("spin_rate"),
    extension: decimal("extension", { precision: 5, scale: 2 }),
    plateTime: decimal("plate_time", { precision: 5, scale: 3 }),
    px: decimal("px", { precision: 6, scale: 3 }),
    pz: decimal("pz", { precision: 6, scale: 3 }),
    zone: int("zone"),
    szTop: decimal("sz_top", { precision: 5, scale: 3 }),
    szBot: decimal("sz_bot", { precision: 5, scale: 3 }),
    breakAngle: decimal("break_angle", { precision: 6, scale: 2 }),
    breakLength: decimal("break_length", { precision: 6, scale: 2 }),
    breakVertical: decimal("break_vertical", { precision: 6, scale: 2 }),
    breakHorizontal: decimal("break_horizontal", { precision: 6, scale: 2 }),
    isInPlay: boolean("is_in_play"),
    launchSpeed: decimal("launch_speed", { precision: 5, scale: 2 }),
    launchAngle: decimal("launch_angle", { precision: 5, scale: 2 }),
    totalDistance: int("total_distance"),
    trajectory: varchar("trajectory", { length: 32 }),
    hitCoordX: decimal("hit_coord_x", { precision: 7, scale: 2 }),
    hitCoordY: decimal("hit_coord_y", { precision: 7, scale: 2 }),
  },
  (t) => [
    index("idx_mlb_pitches_game_pk").on(t.gamePk),
    index("idx_mlb_pitches_pitcher_season").on(t.pitcherId, t.season),
    index("idx_mlb_pitches_batter_season").on(t.batterId, t.season),
  ],
);

export const mlbBoxscoreBatting = mysqlTable(
  "mlb_boxscore_batting",
  {
    gamePk: int("game_pk").notNull(),
    mlbamId: int("mlbam_id").notNull(),
    teamId: int("team_id").notNull(),
    battingOrder: int("batting_order"),
    position: varchar("position", { length: 8 }),
    ab: int("ab").notNull(),
    r: int("r").notNull(),
    h: int("h").notNull(),
    doubles: int("doubles").notNull(),
    triples: int("triples").notNull(),
    hr: int("hr").notNull(),
    rbi: int("rbi").notNull(),
    bb: int("bb").notNull(),
    so: int("so").notNull(),
    hbp: int("hbp").notNull(),
    sb: int("sb").notNull(),
    cs: int("cs").notNull(),
    lob: int("lob"),
    sacBunts: int("sac_bunts").notNull(),
    sacFlies: int("sac_flies").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gamePk, t.mlbamId] }),
    index("idx_mlb_boxscore_batting_mlbam_id").on(t.mlbamId),
  ],
);

export const mlbBoxscorePitching = mysqlTable(
  "mlb_boxscore_pitching",
  {
    gamePk: int("game_pk").notNull(),
    mlbamId: int("mlbam_id").notNull(),
    teamId: int("team_id").notNull(),
    outsRecorded: int("outs_recorded").notNull(),
    battersFaced: int("batters_faced").notNull(),
    h: int("h").notNull(),
    r: int("r").notNull(),
    er: int("er").notNull(),
    bb: int("bb").notNull(),
    so: int("so").notNull(),
    hr: int("hr").notNull(),
    pitches: int("pitches"),
    strikes: int("strikes"),
    win: boolean("win").notNull(),
    loss: boolean("loss").notNull(),
    save: boolean("save").notNull(),
    hold: boolean("hold"),
  },
  (t) => [
    primaryKey({ columns: [t.gamePk, t.mlbamId] }),
    index("idx_mlb_boxscore_pitching_mlbam_id").on(t.mlbamId),
  ],
);

export const mlbOfficials = mysqlTable(
  "mlb_officials",
  {
    gamePk: int("game_pk").notNull(),
    mlbamId: int("mlbam_id").notNull(),
    position: varchar("position", { length: 24 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gamePk, t.mlbamId] })],
);

export type SelectMlbSeason = typeof mlbSeasons.$inferSelect;
export type InsertMlbSeason = typeof mlbSeasons.$inferInsert;
export type SelectMlbFranchise = typeof mlbFranchises.$inferSelect;
export type InsertMlbFranchise = typeof mlbFranchises.$inferInsert;
export type SelectMlbVenue = typeof mlbVenues.$inferSelect;
export type InsertMlbVenue = typeof mlbVenues.$inferInsert;
export type SelectMlbPerson = typeof mlbPeople.$inferSelect;
export type InsertMlbPerson = typeof mlbPeople.$inferInsert;
export type SelectMlbGame = typeof mlbGames.$inferSelect;
export type InsertMlbGame = typeof mlbGames.$inferInsert;
export type SelectMlbPlay = typeof mlbPlays.$inferSelect;
export type InsertMlbPlay = typeof mlbPlays.$inferInsert;
export type SelectMlbPitch = typeof mlbPitches.$inferSelect;
export type InsertMlbPitch = typeof mlbPitches.$inferInsert;
export type SelectMlbBoxscoreBatting = typeof mlbBoxscoreBatting.$inferSelect;
export type InsertMlbBoxscoreBatting = typeof mlbBoxscoreBatting.$inferInsert;
export type SelectMlbBoxscorePitching = typeof mlbBoxscorePitching.$inferSelect;
export type InsertMlbBoxscorePitching = typeof mlbBoxscorePitching.$inferInsert;
export type SelectMlbOfficial = typeof mlbOfficials.$inferSelect;
export type InsertMlbOfficial = typeof mlbOfficials.$inferInsert;
