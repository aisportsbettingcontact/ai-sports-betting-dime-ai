// World Cup 2026 schema — Drizzle ORM (mysql-core, TiDB-compatible)
// Matches wc2026_migration.sql. Drop into your Drizzle schema directory.

import {
  mysqlTable, varchar, char, smallint, tinyint, date, datetime,
  boolean, mysqlEnum, index, uniqueIndex, bigint, double, text, timestamp, int,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

export const wc2026Teams = mysqlTable(
  "wc2026_teams",
  {
    teamId: varchar("team_id", { length: 8 }).primaryKey(), // lowercase FIFA code
    name: varchar("name", { length: 64 }).notNull(),        // canonical (results.csv convention)
    fifaCode: char("fifa_code", { length: 3 }).notNull(),
    groupLetter: char("group_letter", { length: 1 }).notNull(),
    flagCode: varchar("flag_code", { length: 8 }).notNull(),  // flagcdn.com code
    flagUrl: varchar("flag_url", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_team_name").on(t.name),
    uniqueIndex("uq_fifa_code").on(t.fifaCode),
    uniqueIndex("uq_team_slug").on(t.slug),
    index("idx_group").on(t.groupLetter),
  ],
);

// Name-normalization layer: every external feed name (Action Network,
// FIFA.com, results.csv historical) resolves through here to a team_id.
export const wc2026TeamAliases = mysqlTable("wc2026_team_aliases", {
  alias: varchar("alias", { length: 64 }).primaryKey(), // 'Türkiye', 'Korea Republic', 'USMNT', ...
  teamId: varchar("team_id", { length: 8 })
    .notNull()
    .references(() => wc2026Teams.teamId),
});

export const wc2026Venues = mysqlTable("wc2026_venues", {
  venueId: varchar("venue_id", { length: 32 }).primaryKey(),
  city: varchar("city", { length: 64 }).notNull(),
  country: varchar("country", { length: 32 }).notNull(),
  stadium: varchar("stadium", { length: 96 }).notNull(),
  timezone: varchar("timezone", { length: 48 }).notNull(),
  elevationM: smallint("elevation_m").notNull(), // model feature: altitude (Azteca = 2240m)
});

export const wc2026Fixtures = mysqlTable(
  "wc2026_fixtures",
  {
    fixtureId: varchar("fixture_id", { length: 16 }).primaryKey(), // wc26-g-001..072
    matchDate: date("match_date").notNull(),       // local date; kickoff from odds/FIFA feed
    kickoffUtc: datetime("kickoff_utc"),           // populate from Action Network / FIFA
    stage: mysqlEnum("stage", ["GROUP", "R32", "R16", "QF", "SF", "THIRD", "FINAL"])
      .notNull()
      .default("GROUP"),
    groupLetter: char("group_letter", { length: 1 }),
    matchday: tinyint("matchday"),
    homeTeamId: varchar("home_team_id", { length: 8 })
      .notNull()
      .references(() => wc2026Teams.teamId),
    awayTeamId: varchar("away_team_id", { length: 8 })
      .notNull()
      .references(() => wc2026Teams.teamId),
    venueId: varchar("venue_id", { length: 32 })
      .notNull()
      .references(() => wc2026Venues.venueId),
    homeScore: tinyint("home_score"),
    awayScore: tinyint("away_score"),
    status: mysqlEnum("status", ["SCHEDULED", "LIVE", "HT", "ET", "SHOOTOUT", "FT"])
      .notNull()
      .default("SCHEDULED"),
    // TRUE only for USA/CAN/MEX playing inside their own country —
    // zero out neutral-site home advantage in the model otherwise.
    isHostHome: boolean("is_host_home").notNull().default(false),
    // ESPN event ID for automated result ingestion
    espnEventId: varchar("espn_event_id", { length: 16 }),
    // Attendance (from ESPN)
    attendance: int("attendance"),
    // Custom display order for date-based feeds (overrides kickoff_utc sort when set)
    displayOrder: int("display_order"),
    // Knockout stage: team that advanced past this match (set after result is confirmed)
    // References wc2026Teams.teamId — e.g. 'bra', 'can', 'par'
    advancingTeamId: varchar("advancing_team_id", { length: 8 })
      .references(() => wc2026Teams.teamId),
    // [LIVE 2026-06-30] Live match minute string set by fifaLiveScraper.ts
    // Examples: "18", "45+2", "90+3", "ETHT" (extra time half time), null when not live
    matchMinute: varchar("match_minute", { length: 16 }),
    // [LIVE 2026-06-30] FIFA official match ID for live scraping correlation
    // Used by fifaLiveScraper.ts to map FIFA match IDs to DB fixture IDs
    fifaMatchId: varchar("fifa_match_id", { length: 32 }),
  },
  (t) => [
    index("idx_date").on(t.matchDate),
    index("idx_group_md").on(t.groupLetter, t.matchday),
  ],
);

// ─── Odds Snapshots ─────────────────────────────────────────────────────────
// One row per book × market × selection × snapshot timestamp.
// isClosing=true marks the final snapshot before kickoff (used as closing line).
export const wc2026OddsSnapshots = mysqlTable(
  "wc2026_odds_snapshots",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    snapshotTs: timestamp("snapshot_ts").notNull().default(sql`CURRENT_TIMESTAMP`),
    bookId: smallint("book_id").notNull(),
    market: mysqlEnum("market", ["1X2", "TOTAL", "ASIAN_HANDICAP", "BTTS", "DOUBLE_CHANCE"])
      .notNull()
      .default("1X2"),
    selection: varchar("selection", { length: 16 }).notNull(), // 'home'|'away'|'draw'|'over'|'under'
    line: double("line"),                                       // total line or handicap value
    americanOdds: smallint("american_odds").notNull(),
    impliedProb: double("implied_prob").notNull(),
    isClosing: boolean("is_closing").notNull().default(false),
  },
  (t) => [
    index("idx_snap_fixture").on(t.fixtureId),
    index("idx_snap_ts").on(t.snapshotTs),
    index("idx_snap_closing").on(t.fixtureId, t.isClosing),
  ],
);

export type InsertWc2026OddsSnapshot = typeof wc2026OddsSnapshots.$inferInsert;

// ─── Betting Splits ──────────────────────────────────────────────────────────
// VSIN DraftKings splits: tickets% and money% per market per team per snapshot.
export const wc2026BettingSplits = mysqlTable(
  "wc2026_betting_splits",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    snapshotTs: timestamp("snapshot_ts").notNull().default(sql`CURRENT_TIMESTAMP`),
    teamId: varchar("team_id", { length: 8 })
      .notNull()
      .references(() => wc2026Teams.teamId),
    market: mysqlEnum("market", ["ML", "TOTAL", "SPREAD"]).notNull().default("ML"),
    ticketsPct: double("tickets_pct"),
    moneyPct: double("money_pct"),
  },
  (t) => [
    index("idx_splits_fixture").on(t.fixtureId),
    index("idx_splits_ts").on(t.snapshotTs),
  ],
);

export type InsertWc2026BettingSplit = typeof wc2026BettingSplits.$inferInsert;

// ─── Lineups ─────────────────────────────────────────────────────────────────
// Rotowire predicted/confirmed lineups. One row per player per fixture.
export const wc2026Lineups = mysqlTable(
  "wc2026_lineups",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    teamId: varchar("team_id", { length: 8 })
      .notNull()
      .references(() => wc2026Teams.teamId),
    scrapedAt: timestamp("scraped_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    isConfirmed: boolean("is_confirmed").notNull().default(false),
    playerName: varchar("player_name", { length: 96 }).notNull(),
    position: varchar("position", { length: 8 }).notNull(), // GK/DC/MC/FW etc.
    isStarter: boolean("is_starter").notNull().default(true),
    injuryStatus: varchar("injury_status", { length: 16 }), // QUES/OUT/DTD or null
    jerseyNumber: tinyint("jersey_number"),
  },
  (t) => [
    index("idx_lineup_fixture").on(t.fixtureId),
    index("idx_lineup_team").on(t.teamId),
  ],
);

export type InsertWc2026Lineup = typeof wc2026Lineups.$inferInsert;

// ─── Match Stats ─────────────────────────────────────────────────────────────
// Post-match box score stats from ESPN API. One row per fixture (upserted after FT).
export const wc2026MatchStats = mysqlTable(
  "wc2026_match_stats",
  {
    fixtureId: varchar("fixture_id", { length: 16 })
      .primaryKey()
      .references(() => wc2026Fixtures.fixtureId),
    ingestedAt: timestamp("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    // Possession
    homePossessionPct: double("home_possession_pct"),
    awayPossessionPct: double("away_possession_pct"),
    // Shots
    homeTotalShots: tinyint("home_total_shots"),
    awayTotalShots: tinyint("away_total_shots"),
    homeShotsOnTarget: tinyint("home_shots_on_target"),
    awayShotsOnTarget: tinyint("away_shots_on_target"),
    // Corners
    homeCorners: tinyint("home_corners"),
    awayCorners: tinyint("away_corners"),
    // Fouls
    homeFouls: tinyint("home_fouls"),
    awayFouls: tinyint("away_fouls"),
    // Cards
    homeYellowCards: tinyint("home_yellow_cards"),
    awayYellowCards: tinyint("away_yellow_cards"),
    homeRedCards: tinyint("home_red_cards"),
    awayRedCards: tinyint("away_red_cards"),
    // Offsides
    homeOffsides: tinyint("home_offsides"),
    awayOffsides: tinyint("away_offsides"),
    // Saves
    homeSaves: tinyint("home_saves"),
    awaySaves: tinyint("away_saves"),
    // Passes
    homeTotalPasses: smallint("home_total_passes"),
    awayTotalPasses: smallint("away_total_passes"),
    homeAccuratePasses: smallint("home_accurate_passes"),
    awayAccuratePasses: smallint("away_accurate_passes"),
    homePassPct: double("home_pass_pct"),
    awayPassPct: double("away_pass_pct"),
    // Tackles
    homeEffectiveTackles: tinyint("home_effective_tackles"),
    awayEffectiveTackles: tinyint("away_effective_tackles"),
    // Interceptions
    homeInterceptions: tinyint("home_interceptions"),
    awayInterceptions: tinyint("away_interceptions"),
    // xG (computed from shot quality model — shots × conversion rate by zone)
    homeXg: double("home_xg"),
    awayXg: double("away_xg"),
    // Blocked shots
    homeBlockedShots: tinyint("home_blocked_shots"),
    awayBlockedShots: tinyint("away_blocked_shots"),
  },
  (t) => [
    index("idx_ms_fixture").on(t.fixtureId),
  ],
);

export type InsertWc2026MatchStats = typeof wc2026MatchStats.$inferInsert;

// ─── Match Events ─────────────────────────────────────────────────────────────
// Goal scorers, cards, substitutions from ESPN API. One row per event per fixture.
export const wc2026MatchEvents = mysqlTable(
  "wc2026_match_events",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    teamId: varchar("team_id", { length: 8 })
      .references(() => wc2026Teams.teamId),
    eventType: mysqlEnum("event_type", ["GOAL", "OWN_GOAL", "PENALTY", "YELLOW", "RED", "SUB", "VAR"])
      .notNull(),
    playerName: varchar("player_name", { length: 96 }),
    assistPlayerName: varchar("assist_player_name", { length: 96 }),
    minuteStr: varchar("minute_str", { length: 8 }),  // "45+2'", "90+5'"
    minuteNum: tinyint("minute_num"),                  // numeric minute for sorting
    isFirstHalf: boolean("is_first_half").notNull().default(true),
  },
  (t) => [
    index("idx_me_fixture").on(t.fixtureId),
    index("idx_me_type").on(t.eventType),
  ],
);

export type InsertWc2026MatchEvent = typeof wc2026MatchEvents.$inferInsert;

// ─── Model Projections ───────────────────────────────────────────────────────
// Dixon-Coles Poisson v4.2 model outputs. One row per fixture (upserted by seed scripts).
export const wc2026ModelProjections = mysqlTable(
  "wc2026_model_projections",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    modelVersion: varchar("model_version", { length: 32 }).notNull(),
    nSimulations: int("n_simulations").notNull().default(1000000),
    homeTeam: varchar("home_team", { length: 64 }),
    awayTeam: varchar("away_team", { length: 64 }),
    homeLambda: double("home_lambda"),
    awayLambda: double("away_lambda"),
    homeWinProb: double("home_win_prob"),
    drawProb: double("draw_prob"),
    awayWinProb: double("away_win_prob"),
    projHomeScore: double("proj_home_score"),
    projAwayScore: double("proj_away_score"),
    projTotal: double("proj_total"),
    projSpread: double("proj_spread"),
    over05: double("over_0_5"),
    over15: double("over_1_5"),
    over25: double("over_2_5"),
    under25: double("under_2_5"),
    over35: double("over_3_5"),
    bttsProb: double("btts_prob"),
    modelHomeML: smallint("model_home_ml"),
    modelDrawML: smallint("model_draw_ml"),
    modelAwayML: smallint("model_away_ml"),
    modelTotal: double("model_total"),
    overOdds: smallint("over_odds"),
    underOdds: smallint("under_odds"),
    modelSpread: double("model_spread"),
    modelSpreadRaw: double("model_spread_raw"),
    homeSpreadOdds: smallint("home_spread_odds"),
    awaySpreadOdds: smallint("away_spread_odds"),
    nvHomeProb: double("nv_home_prob"),
    nvDrawProb: double("nv_draw_prob"),
    nvAwayProb: double("nv_away_prob"),
    // Double chance (1X / X2) — no-vig probabilities and American odds
    nvDc1X: double("nv_dc_1x"),
    nvDcX2: double("nv_dc_x2"),
    dc1XOdds: smallint("dc_1x_odds"),
    dcX2Odds: smallint("dc_x2_odds"),
    // No draw (Away or Home ML) — no-vig probabilities and American odds
    nvNoDrawHome: double("nv_no_draw_home"),
    nvNoDrawAway: double("nv_no_draw_away"),
    noDrawHomeOdds: smallint("no_draw_home_odds"),
    noDrawAwayOdds: smallint("no_draw_away_odds"),
    // BTTS American odds (btts_prob already stores the probability)
    bttsYesOdds: smallint("btts_yes_odds"),
    bttsNoOdds: smallint("btts_no_odds"),
    // To Advance (knockout rounds — who advances past this match)
    toAdvanceHomeProb: double("to_advance_home_prob"),
    toAdvanceAwayProb: double("to_advance_away_prob"),
    toAdvanceHomeOdds: smallint("to_advance_home_odds"),
    toAdvanceAwayOdds: smallint("to_advance_away_odds"),
    // Model total raw (simulation-validated expected total goals)
    modelTotalRaw: double("model_total_raw"),
    homeEdge: double("home_edge"),
    drawEdge: double("draw_edge"),
    awayEdge: double("away_edge"),
    modelLean: varchar("model_lean", { length: 8 }),
    leanProb: double("lean_prob"),
    topScorelinesJson: text("top_scorelines"),
    // Freeze flag — when true, the router serves these values as-is without any live re-query
    isFrozen: boolean("is_frozen").notNull().default(false),
    frozenAt: timestamp("frozen_at"),
    modeledAt: timestamp("modeled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_mp_fixture").on(t.fixtureId),
    index("idx_mp_fixture").on(t.fixtureId),
  ],
);

export type InsertWc2026ModelProjection = typeof wc2026ModelProjections.$inferInsert;
export type SelectWc2026ModelProjection = typeof wc2026ModelProjections.$inferSelect;

// ─── Frozen Book Odds Snapshot ───────────────────────────────────────────────
// Stores the hardcoded book lines at the time of freezing.
// Once a row exists for a fixture_id, the router serves these values and
// never overwrites them unless explicitly instructed.
export const wc2026FrozenBookOdds = mysqlTable(
  "wc2026_frozen_book_odds",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    fixtureId: varchar("fixture_id", { length: 16 })
      .notNull()
      .references(() => wc2026Fixtures.fixtureId),
    frozenAt: timestamp("frozen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    frozenBy: varchar("frozen_by", { length: 64 }).notNull().default("system"),
    // Book (DraftKings) 1X2 moneylines
    bookHomeMl: smallint("book_home_ml"),
    bookDrawMl: smallint("book_draw_ml"),
    bookAwayMl: smallint("book_away_ml"),
    // Book spread
    bookSpreadLine: double("book_spread_line"),
    bookHomeSpreadOdds: smallint("book_home_spread_odds"),
    bookAwaySpreadOdds: smallint("book_away_spread_odds"),
    // Book total
    bookTotalLine: double("book_total_line"),
    bookOverOdds: smallint("book_over_odds"),
    bookUnderOdds: smallint("book_under_odds"),
    // Book BTTS
    bookBttsYesOdds: smallint("book_btts_yes_odds"),
    bookBttsNoOdds: smallint("book_btts_no_odds"),
    // Book double chance
    bookDc1XOdds: smallint("book_dc_1x_odds"),
    bookDcX2Odds: smallint("book_dc_x2_odds"),
    // Book no draw
    bookNoDrawHomeOdds: smallint("book_no_draw_home_odds"),
    bookNoDrawAwayOdds: smallint("book_no_draw_away_odds"),
    // Book to advance (knockout rounds — who advances past this match)
    toAdvanceHomeOdds: smallint("to_advance_home_odds"),
    toAdvanceAwayOdds: smallint("to_advance_away_odds"),
    // Source label
    bookSource: varchar("book_source", { length: 32 }).notNull().default("DraftKings"),
  },
  (t) => [
    uniqueIndex("uq_frozen_book_fixture").on(t.fixtureId),
    index("idx_frozen_book_fixture").on(t.fixtureId),
  ],
);

export type InsertWc2026FrozenBookOdds = typeof wc2026FrozenBookOdds.$inferInsert;
export type SelectWc2026FrozenBookOdds = typeof wc2026FrozenBookOdds.$inferSelect;

export const wc2026TeamsRelations = relations(wc2026Teams, ({ many }) => ({
  aliases: many(wc2026TeamAliases),
  homeFixtures: many(wc2026Fixtures, { relationName: "home" }),
  awayFixtures: many(wc2026Fixtures, { relationName: "away" }),
}));

export const wc2026FixturesRelations = relations(wc2026Fixtures, ({ one }) => ({
  homeTeam: one(wc2026Teams, {
    fields: [wc2026Fixtures.homeTeamId],
    references: [wc2026Teams.teamId],
    relationName: "home",
  }),
  awayTeam: one(wc2026Teams, {
    fields: [wc2026Fixtures.awayTeamId],
    references: [wc2026Teams.teamId],
    relationName: "away",
  }),
  venue: one(wc2026Venues, {
    fields: [wc2026Fixtures.venueId],
    references: [wc2026Venues.venueId],
  }),
}));
