// World Cup 2026 schema — Drizzle ORM (mysql-core, TiDB-compatible)
// Matches wc2026_migration.sql. Drop into your Drizzle schema directory.

import {
  mysqlTable, varchar, char, smallint, tinyint, date, datetime,
  boolean, mysqlEnum, index, uniqueIndex, bigint, double, text, timestamp,
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
    status: mysqlEnum("status", ["SCHEDULED", "LIVE", "FT"])
      .notNull()
      .default("SCHEDULED"),
    // TRUE only for USA/CAN/MEX playing inside their own country —
    // zero out neutral-site home advantage in the model otherwise.
    isHostHome: boolean("is_host_home").notNull().default(false),
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
