import { boolean, date, index, int, mysqlTable, smallint, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * CFB 2026 verified corpus (fbschedules.com schedule + ESPN teams/rosters).
 * Seeded by scripts/seedCfb2026.mts from scripts/data/cfb-2026/*.json.
 * Join key across all three tables is the ESPN numeric team id.
 */
export const cfbTeams = mysqlTable(
  "cfb_teams",
  {
    /** ESPN numeric team id — canonical join key (see fbs-team-crosswalk). */
    espnId: int("espn_id").primaryKey(),
    espnDisplayName: varchar("espn_display_name", { length: 80 }).notNull(),
    espnAbbreviation: varchar("espn_abbreviation", { length: 10 }).notNull(),
    fbschedulesName: varchar("fbschedules_name", { length: 80 }).notNull(),
    fbschedulesSlug: varchar("fbschedules_slug", { length: 120 }).notNull(),
    conference: varchar("conference", { length: 60 }).notNull(),
    /** Division within conference; 2026: only Sun Belt has divisions ("East"/"West"). */
    division: varchar("division", { length: 20 }),
    espnGroupId: int("espn_group_id").notNull(),
    rosterCount: int("roster_count").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_cfb_teams_conference").on(t.conference)],
);

export const cfbGames = mysqlTable(
  "cfb_games",
  {
    /** fbschedules numeric game id (source primary key). */
    gameId: int("game_id").primaryKey(),
    /** 0-15; week 14 = championship placeholders, week 15 = Army-Navy. */
    week: int("week").notNull(),
    /** Source football date (ET calendar) — kickoff-datetime-convention. */
    kickoffDate: date("kickoff_date", { mode: "string" }).notNull(),
    /** Raw source time string: "12:00pm", "Time TBA", "3:30-8:00pm". */
    kickoffTimeEt: varchar("kickoff_time_et", { length: 20 }).notNull(),
    /** Derived UTC instant; null when source time is TBA or a window. */
    kickoffUtc: timestamp("kickoff_utc"),
    /** Source listing order: teams[0]; visitor for "at" games, first-listed for neutral sites. */
    awayTeamName: varchar("away_team_name", { length: 80 }).notNull(),
    homeTeamName: varchar("home_team_name", { length: 80 }).notNull(),
    /** Null for FCS opponents and week-14 placeholders. */
    awayEspnId: int("away_espn_id"),
    homeEspnId: int("home_espn_id"),
    tv: varchar("tv", { length: 120 }),
    isPlaceholder: boolean("is_placeholder").default(false).notNull(),
    isFlex: boolean("is_flex").default(false).notNull(),
    /** Source-inherited caveats (flex annotations, known date discrepancy). */
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_cfb_games_week").on(t.week),
    index("idx_cfb_games_kickoff_date").on(t.kickoffDate),
    index("idx_cfb_games_home").on(t.homeEspnId),
    index("idx_cfb_games_away").on(t.awayEspnId),
  ],
);

export const cfbPlayers = mysqlTable(
  "cfb_players",
  {
    /** ESPN numeric athlete id. */
    athleteId: int("athlete_id").primaryKey(),
    teamEspnId: int("team_espn_id").notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    jersey: varchar("jersey", { length: 4 }),
    position: varchar("position", { length: 8 }).notNull(),
    heightIn: smallint("height_in"),
    weightLb: smallint("weight_lb"),
    classYear: varchar("class_year", { length: 12 }),
    hometown: varchar("hometown", { length: 120 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_cfb_players_team").on(t.teamEspnId),
    index("idx_cfb_players_position").on(t.position),
  ],
);

export type SelectCfbTeam = typeof cfbTeams.$inferSelect;
export type InsertCfbTeam = typeof cfbTeams.$inferInsert;
export type SelectCfbGame = typeof cfbGames.$inferSelect;
export type InsertCfbGame = typeof cfbGames.$inferInsert;
export type SelectCfbPlayer = typeof cfbPlayers.$inferSelect;
export type InsertCfbPlayer = typeof cfbPlayers.$inferInsert;
