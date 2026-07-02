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
// Column layout mirrors the feed display order: Away top, Home bottom.
// DC semantics: 1X = Away WD (Away or Draw), X2 = Home WD (Home or Draw),
//               12 = No Draw (either team wins, no draw — single combined price).
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
    // ── To Advance (Knockout) ─────────────────────────────────────────────────
    bookAwayToAdvance: smallint("book_away_to_advance"),
    modelAwayToAdvance: smallint("model_away_to_advance"),
    bookHomeToAdvance: smallint("book_home_to_advance"),
    modelHomeToAdvance: smallint("model_home_to_advance"),
    // ── 1X2 Moneylines ───────────────────────────────────────────────────────
    bookAwayMl: smallint("book_away_ml"),
    modelAwayMl: smallint("model_away_ml"),
    // ── Double Chance: Away WD (1X = Away or Draw) ───────────────────────────
    bookAwayWd: smallint("book_away_wd"),
    modelAwayWd: smallint("model_away_wd"),
    // ── Draw ML ──────────────────────────────────────────────────────────────
    bookDraw: smallint("book_draw"),
    modelDraw: smallint("model_draw"),
    // ── No Draw (12 = either team wins, no draw — single combined price) ─────
    bookNoDraw: smallint("book_no_draw"),
    modelNoDraw: smallint("model_no_draw"),
    // ── Home ML ──────────────────────────────────────────────────────────────
    bookHomeMl: smallint("book_home_ml"),
    modelHomeMl: smallint("model_home_ml"),
    // ── Double Chance: Home WD (X2 = Home or Draw) ───────────────────────────
    bookHomeWd: smallint("book_home_wd"),
    modelHomeWd: smallint("model_home_wd"),
    // ── Spread (Asian Handicap) ───────────────────────────────────────────────
    bookPrimarySpread: double("book_primary_spread"),
    modelPrimarySpread: double("model_primary_spread"),
    bookAwayPrimarySpreadOdds: smallint("book_away_primary_spread_odds"),
    modelAwayPrimarySpreadOdds: smallint("model_away_primary_spread_odds"),
    bookHomePrimarySpreadOdds: smallint("book_home_primary_spread_odds"),
    modelHomePrimarySpreadOdds: smallint("model_home_primary_spread_odds"),
    // ── Total (Over/Under) ────────────────────────────────────────────────────
    bookTotal: double("book_total"),
    modelTotal: double("model_total"),
    bookOverOdds: smallint("book_over_odds"),
    modelOverOdds: smallint("model_over_odds"),
    bookUnderOdds: smallint("book_under_odds"),
    modelUnderOdds: smallint("model_under_odds"),
    // ── Both Teams To Score ───────────────────────────────────────────────────
    bookBttsYes: smallint("book_btts_yes"),
    modelBttsYes: smallint("model_btts_yes"),
    bookBttsNo: smallint("book_btts_no"),
    modelBttsNo: smallint("model_btts_no"),
    // ── Source / Audit ────────────────────────────────────────────────────────
    bookSource: varchar("book_source", { length: 32 }).notNull().default("bet365"),
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

// ─── WC2026 ESPN Bracket ─────────────────────────────────────────────────────
//
// Stores the full bracket tree from https://www.espn.com/soccer/bracket
// Primary source: embedded JSON blob → matchups[] array
// Covers all 32 matchups: R32 (16) + R16 (8) + QF (4) + SF (2) + Final/3rd (2)
//
// Key design decisions:
//   - gameId (ESPN event ID) is the natural PK and FK to wc2026_espn_matches
//   - matchNumber is the human-readable label ("Match 80") — critical for bracket display
//   - matchupId is ESPN's internal bracket slot ID (used for advancement seeding)
//   - roundId: 1=R32, 2=R16, 3=QF, 4=SF, 5=Final/3rd
//   - bracketLocation: ESPN positional slot within the round (1-based)
//   - homeAway: competitorOne=home (order=1), competitorTwo=away (order=2)
//   - isTBD flags: true for unresolved future slots
//   - advancementSlug: URL slug from ESPN link (e.g. "congo-dr-england")
//
export const wc2026EspnBracket = mysqlTable(
  "wc2026_espn_bracket",
  {
    id:              bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),

    // ── ESPN identifiers ──────────────────────────────────────────────────────
    /** ESPN event/game ID (e.g. "760495"). FK → wc2026_espn_matches.matchId */
    gameId:          varchar("game_id", { length: 16 }).notNull().unique(),
    /** ESPN internal bracket slot ID (e.g. "78"). Used for advancement seeding chain */
    matchupId:       varchar("matchup_id", { length: 8 }).notNull(),

    // ── Bracket structure ─────────────────────────────────────────────────────
    /** Human-readable match label (e.g. "Match 80"). Critical for bracket display */
    matchNumber:     varchar("match_number", { length: 32 }),
    /** Round ID: 1=R32, 2=R16, 3=QF, 4=SF, 5=Final/3rd */
    roundId:         smallint("round_id").notNull(),
    /** Round human label */
    roundLabel:      varchar("round_label", { length: 64 }).notNull(),
    /** ESPN positional slot within the round (1-based). Used for bracket layout */
    bracketLocation: smallint("bracket_location"),

    // ── Schedule ──────────────────────────────────────────────────────────────
    /** Kickoff datetime in UTC ISO format (e.g. "2026-07-01T16:00:00Z") */
    dateUtc:         varchar("date_utc", { length: 32 }),
    /** ESPN status detail: "FT", "FT-Pens", "Scheduled", "Live", etc. */
    statusDetail:    varchar("status_detail", { length: 32 }),
    /** ESPN status state: "pre", "in", "post" */
    statusState:     varchar("status_state", { length: 8 }),
    /** Venue city/state (e.g. "Inglewood, California") */
    location:        varchar("location", { length: 128 }),
    /** Broadcast networks comma-separated (e.g. "FOX,Tele") */
    broadcasts:      varchar("broadcasts", { length: 64 }),

    // ── Odds (pre-match only, null post-match) ────────────────────────────────
    /** ESPN odds string as displayed on bracket (e.g. "ENG -340") */
    oddsDisplay:     varchar("odds_display", { length: 32 }),

    // ── Home team (competitorOne, order=1, homeAway="home") ───────────────────
    homeTeamId:      varchar("home_team_id", { length: 16 }),
    homeTeamName:    varchar("home_team_name", { length: 64 }),
    homeTeamAbbrev:  varchar("home_team_abbrev", { length: 8 }),
    homeTeamLogo:    text("home_team_logo"),
    homeScore:       varchar("home_score", { length: 16 }),
    homeWinner:      tinyint("home_winner").default(0).notNull(),
    /** True when home team is not yet determined (future bracket slot) */
    homeIsTBD:       tinyint("home_is_tbd").default(0).notNull(),

    // ── Away team (competitorTwo, order=2, homeAway="away") ───────────────────
    awayTeamId:      varchar("away_team_id", { length: 16 }),
    awayTeamName:    varchar("away_team_name", { length: 64 }),
    awayTeamAbbrev:  varchar("away_team_abbrev", { length: 8 }),
    awayTeamLogo:    text("away_team_logo"),
    awayScore:       varchar("away_score", { length: 16 }),
    awayWinner:      tinyint("away_winner").default(0).notNull(),
    /** True when away team is not yet determined (future bracket slot) */
    awayIsTBD:       tinyint("away_is_tbd").default(0).notNull(),

    // ── Advancement seeding ───────────────────────────────────────────────────
    /** Full ESPN match URL path */
    espnLink:        text("espn_link"),
    /** URL slug only (e.g. "congo-dr-england"). Encodes away-home order */
    advancementSlug: varchar("advancement_slug", { length: 128 }),

    // ── Metadata ──────────────────────────────────────────────────────────────
    /** UTC ms timestamp of last successful bracket scrape */
    scrapedAt:       bigint("scraped_at", { mode: "number" }).notNull(),
    createdAt:       bigint("created_at", { mode: "number" }).notNull(),
    updatedAt:       bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("idx_wc2026_espn_bracket_game_id").on(t.gameId),
    index("idx_wc2026_espn_bracket_matchup_id").on(t.matchupId),
    index("idx_wc2026_espn_bracket_round_id").on(t.roundId),
    index("idx_wc2026_espn_bracket_match_number").on(t.matchNumber),
    index("idx_wc2026_espn_bracket_bracket_loc").on(t.roundId, t.bracketLocation),
    index("idx_wc2026_espn_bracket_status_state").on(t.statusState),
    index("idx_wc2026_espn_bracket_home_team").on(t.homeTeamAbbrev),
    index("idx_wc2026_espn_bracket_away_team").on(t.awayTeamAbbrev),
  ],
);

export type InsertWc2026EspnBracket = typeof wc2026EspnBracket.$inferInsert;
export type SelectWc2026EspnBracket = typeof wc2026EspnBracket.$inferSelect;

// ─── WC2026 Match Odds (Book + Model) ────────────────────────────────────────
// Production odds table — stores both bet365 book lines (scraped via BetExplorer
// AJAX endpoint, bid=16) and v15 model projections side-by-side.
//
// Column layout mirrors feed display order: Away top, Home bottom.
// DC semantics: 1X = Away WD (Away or Draw), X2 = Home WD (Home or Draw),
//               12 = No Draw (either team wins, no draw — single combined price).
// AH/Spread: line is from HOME perspective (negative = home favored).
// book_source default = 'bet365' (BetExplorer AJAX bid=16 international).
//
// Upserted by: wc2026_betexplorer_scraper_v4.py (book_ columns)
// Upserted by: v15_engine.mjs (model_ columns)
// Column order is canonical — matches DB exactly (id + 40 user-spec columns)
export const wc2026MatchOdds = mysqlTable(
  "wc2026MatchOdds",
  {
    id:                bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),

    // ── Identity ─────────────────────────────────────────────────────────────
    fixtureId:         varchar("fixture_id", { length: 16 }).notNull(),
    espnMatchId:       varchar("espn_match_id", { length: 64 }),
    espnSlug:          varchar("espn_slug", { length: 64 }),

    // ── BetExplorer Identity ─────────────────────────────────────────────────
    betExplorerMatchId: varchar("bet_explorer_match_id", { length: 16 }),
    betExplorerSlug:    varchar("bet_explorer_slug", { length: 128 }),

    // ── Tournament Context ────────────────────────────────────────────────────
    worldCupStage: mysqlEnum("world_cup_stage", ["group", "knockout"]),
    worldCupRound: mysqlEnum("world_cup_round", ["group", "r32", "quarterfinals", "semifinals", "third_place", "finals"]),

    // ── Audit / Provenance ────────────────────────────────────────────────────
    insertedAt:        timestamp("inserted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    insertMethod:      varchar("insert_method", { length: 255 }),
    lastInsertedAt:    timestamp("last_inserted_at"),
    lastInsertMethod:  varchar("last_insert_method", { length: 255 }),

    // ── Teams (ESPN team IDs as integers) ────────────────────────────────────
    awayTeam:          int("away_team"),
    homeTeam:          int("home_team"),

    // ── Model Lambdas & Projected Goals ─────────────────────────────────────
    lambdaAway:                  double("lamba_away"),
    lambdaHome:                  double("lamba_home"),
    modelProjectedAwayGoals:     double("model_projected_away_goals"),
    modelProjectedHomeGoals:     double("model_projected_home_goals"),

    // ── To Advance (Knockout only — NULL if unavailable) ─────────────────────
    bookAwayToAdvance:  smallint("book_away_to_advance"),
    modelAwayToAdvance: smallint("model_away_to_advance"),
    bookHomeToAdvance:  smallint("book_home_to_advance"),
    modelHomeToAdvance: smallint("model_home_to_advance"),

    // ── 1X2 Moneylines ────────────────────────────────────────────────────────
    bookAwayMl:  smallint("book_away_ml"),
    modelAwayMl: smallint("model_away_ml"),

    // ── Double Chance: Away WD (X2 = Away or Draw) ────────────────────────────
    bookAwayWd:  smallint("book_away_wd"),
    modelAwayWd: smallint("model_away_wd"),

    // ── Draw ML ───────────────────────────────────────────────────────────────
    bookDraw:  smallint("book_draw"),
    modelDraw: smallint("model_draw"),

    // ── No Draw (12 = either team wins, no draw) ──────────────────────────────
    bookNoDraw:  smallint("book_no_draw"),
    modelNoDraw: smallint("model_no_draw"),

    // ── Home ML ───────────────────────────────────────────────────────────────
    bookHomeMl:  smallint("book_home_ml"),
    modelHomeMl: smallint("model_home_ml"),

    // ── Double Chance: Home WD (1X = Home or Draw) ────────────────────────────
    bookHomeWd:  smallint("book_home_wd"),
    modelHomeWd: smallint("model_home_wd"),

    // ── Spread / Asian Handicap (line from HOME perspective) ──────────────────
    bookPrimarySpread:          double("book_primary_spread"),
    modelPrimarySpread:         double("model_primary_spread"),
    bookAwayPrimarySpreadOdds:  smallint("book_away_primary_spread_odds"),
    modelAwayPrimarySpreadOdds: smallint("model_away_primary_spread_odds"),
    bookHomePrimarySpreadOdds:  smallint("book_home_primary_spread_odds"),
    modelHomePrimarySpreadOdds: smallint("model_home_primary_spread_odds"),

    // ── Total (Over/Under) ────────────────────────────────────────────────────
    bookTotal:      double("book_total"),
    modelTotal:     double("model_total"),
    bookOverOdds:   smallint("book_over_odds"),
    modelOverOdds:  smallint("model_over_odds"),
    bookUnderOdds:  smallint("book_under_odds"),
    modelUnderOdds: smallint("model_under_odds"),

    // ── Both Teams To Score ───────────────────────────────────────────────────
    bookBttsYes:  smallint("book_btts_yes"),
    modelBttsYes: smallint("model_btts_yes"),
    bookBttsNo:   smallint("book_btts_no"),
    modelBttsNo:  smallint("model_btts_no"),
  },
  (t) => [
    uniqueIndex("uq_wc2026_match_odds_fixture").on(t.fixtureId),
    index("idx_wc2026_match_odds_fixture").on(t.fixtureId),
  ],
);

export type InsertWc2026MatchOdds = typeof wc2026MatchOdds.$inferInsert;
export type SelectWc2026MatchOdds = typeof wc2026MatchOdds.$inferSelect;
