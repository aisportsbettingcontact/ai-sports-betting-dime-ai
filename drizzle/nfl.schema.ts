import { boolean, date, index, int, mysqlTable, smallint, timestamp, varchar } from "drizzle-orm/mysql-core";

/** NFL 2026 verified corpus (ESPN site/core APIs). Seeded by scripts/seedNfl2026.mts. */
export const nflVenues = mysqlTable("nfl_venues", {
  venueId: int("venue_id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  city: varchar("city", { length: 60 }).notNull(),
  state: varchar("state", { length: 30 }),
  /** Non-null for the 8 international venues (Germany, Brazil, Spain, France, England, Mexico, Australia). */
  country: varchar("country", { length: 40 }),
  /** Null across the source (NE5) — nullable for future fill. */
  capacity: int("capacity"),
  indoor: boolean("indoor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const nflTeams = mysqlTable(
  "nfl_teams",
  {
    espnId: int("espn_id").primaryKey(),
    displayName: varchar("display_name", { length: 60 }).notNull(),
    abbreviation: varchar("abbreviation", { length: 5 }).notNull(),
    conference: varchar("conference", { length: 3 }).notNull(),
    /** Full division label, e.g. "AFC East". */
    division: varchar("division", { length: 12 }).notNull(),
    venueId: int("venue_id").notNull(),
    rosterCount: int("roster_count").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_nfl_teams_division").on(t.division)],
);

export const nflGames = mysqlTable(
  "nfl_games",
  {
    /** ESPN event id. */
    eventId: int("event_id").primaryKey(),
    /** 2 = regular season (weeks 1-18), 3 = postseason (1 WC, 2 Div, 3 Conf, 5 SB). */
    seasonType: int("season_type").notNull(),
    week: int("week").notNull(),
    kickoffUtc: timestamp("kickoff_utc").notNull(),
    /** Derived per kickoff-date convention (PT concrete / ET TBD). */
    kickoffDate: date("kickoff_date", { mode: "string" }).notNull(),
    timeValid: boolean("time_valid").notNull(),
    awayTeamName: varchar("away_team_name", { length: 60 }).notNull(),
    homeTeamName: varchar("home_team_name", { length: 60 }).notNull(),
    /** Null for TBD playoff slots. */
    awayEspnId: int("away_espn_id"),
    homeEspnId: int("home_espn_id"),
    /** Event venue — differs from the home team's stadium for international/neutral games. */
    venueId: int("venue_id"),
    broadcast: varchar("broadcast", { length: 120 }),
    isTbd: boolean("is_tbd").default(false).notNull(),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_nfl_games_week").on(t.seasonType, t.week),
    index("idx_nfl_games_kickoff_date").on(t.kickoffDate),
    index("idx_nfl_games_home").on(t.homeEspnId),
    index("idx_nfl_games_away").on(t.awayEspnId),
  ],
);

export const nflPlayers = mysqlTable(
  "nfl_players",
  {
    athleteId: int("athlete_id").primaryKey(),
    teamEspnId: int("team_espn_id").notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    jersey: varchar("jersey", { length: 4 }),
    position: varchar("position", { length: 8 }).notNull(),
    heightIn: smallint("height_in"),
    weightLb: smallint("weight_lb"),
    /** ESPN experience displayValue, e.g. "R", "2nd Season". */
    experience: varchar("experience", { length: 20 }),
    hometown: varchar("hometown", { length: 120 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_nfl_players_team").on(t.teamEspnId),
    index("idx_nfl_players_position").on(t.position),
  ],
);

export type SelectNflVenue = typeof nflVenues.$inferSelect;
export type SelectNflTeam = typeof nflTeams.$inferSelect;
export type SelectNflGame = typeof nflGames.$inferSelect;
export type SelectNflPlayer = typeof nflPlayers.$inferSelect;
