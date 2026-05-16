import {
  bigint,
  boolean,
  decimal,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── App Users (custom accounts managed by owner) ────────────────────────────

export const appUsers = mysqlTable("app_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["owner", "admin", "handicapper", "user"]).default("user").notNull(),
  hasAccess: boolean("hasAccess").default(true).notNull(),
  /** NULL means lifetime access; otherwise a UTC timestamp in ms */
  expiryDate: bigint("expiryDate", { mode: "number" }),
  /** Whether the user has accepted the Age & Responsibility notice */
  termsAccepted: boolean("termsAccepted").default(false).notNull(),
  /** UTC timestamp (ms) when the user accepted the terms; NULL if not yet accepted */
  termsAcceptedAt: bigint("termsAcceptedAt", { mode: "number" }),
  /**
   * Session invalidation version. Incremented on force-logout.
   * JWT payload must carry a matching `tv` claim — mismatches are rejected immediately.
   * forceLogout(userId): increment this user's tokenVersion
   * forceLogoutAll(): increment ALL users' tokenVersion in one SQL UPDATE
   */
  tokenVersion: int("tokenVersion").default(1).notNull(),
  // ─── Discord account linking ────────────────────────────────────────────────
  /** Discord user ID (snowflake string), NULL = not linked */
  discordId: varchar("discordId", { length: 32 }),
  /** Discord username, e.g. "prezb3ts" */
  discordUsername: varchar("discordUsername", { length: 64 }),
  /** Discord avatar hash for CDN URL construction */
  discordAvatar: varchar("discordAvatar", { length: 128 }),
  /** UTC timestamp (ms) when the Discord account was linked */
  discordConnectedAt: bigint("discordConnectedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
  /**
   * Password reset token (SHA-256 hex of a random 32-byte secret).
   * NULL when no reset is pending. Cleared on successful reset or expiry.
   */
  passwordResetToken: varchar("passwordResetToken", { length: 64 }),
  /**
   * UTC timestamp (ms) when the password reset token expires.
   * Tokens are valid for 30 minutes from issuance.
   */
  passwordResetExpiresAt: bigint("passwordResetExpiresAt", { mode: "number" }),
});

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

// ─── Discord OAuth CSRF state store (DB-backed, survives server restarts) ────
//
// WHY DB-BACKED:
//   Cloud Run can run multiple instances simultaneously. The /connect request
//   may hit instance A (stores state in memory) while the /callback request
//   hits instance B (empty pendingStates → state_mismatch → OAuth fails).
//   Storing state in the DB ensures all instances share the same state store.
//
// TTL: 10 minutes. Expired rows are cleaned up on each /callback request.
export const discordOAuthStates = mysqlTable("discord_oauth_states", {
  /** Random CSRF state token generated in /connect */
  state:     varchar("state",     { length: 64 }).primaryKey(),
  /** app_users.id of the user who initiated the OAuth flow */
  userId:    int("userId").notNull(),
  /** UTC timestamp (ms) when this state expires (10 min from creation) */
  expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
  /** UTC timestamp (ms) when this row was created */
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type DiscordOAuthState = typeof discordOAuthStates.$inferSelect;
export type InsertDiscordOAuthState = typeof discordOAuthStates.$inferInsert;

// ─── Model files (uploaded CSVs) ────────────────────────────────────────────

export const modelFiles = mysqlTable("model_files", {
  id: int("id").autoincrement().primaryKey(),
  uploadedBy: int("uploadedBy").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull().default("text/csv"),
  sizeBytes: int("sizeBytes").notNull().default(0),
  sport: varchar("sport", { length: 64 }).notNull().default("NCAAM"),
  gameDate: varchar("gameDate", { length: 20 }),
  status: mysqlEnum("status", ["pending", "processing", "done", "error"])
    .notNull()
    .default("pending"),
  rowsImported: int("rowsImported").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModelFile = typeof modelFiles.$inferSelect;
export type InsertModelFile = typeof modelFiles.$inferInsert;

// ─── Games (parsed from CSV) ─────────────────────────────────────────────────

export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  fileId: int("fileId").notNull(),
  gameDate: varchar("gameDate", { length: 20 }).notNull(),
  startTimeEst: varchar("startTimeEst", { length: 12 }).notNull().default("TBD"),
  awayTeam: varchar("awayTeam", { length: 128 }).notNull(),
  awayBookSpread: decimal("awayBookSpread", { precision: 6, scale: 1 }),
  awayModelSpread: decimal("awayModelSpread", { precision: 6, scale: 1 }),
  homeTeam: varchar("homeTeam", { length: 128 }).notNull(),
  homeBookSpread: decimal("homeBookSpread", { precision: 6, scale: 1 }),
  homeModelSpread: decimal("homeModelSpread", { precision: 6, scale: 1 }),
  bookTotal: decimal("bookTotal", { precision: 6, scale: 1 }),
  modelTotal: decimal("modelTotal", { precision: 6, scale: 1 }),
  spreadEdge: varchar("spreadEdge", { length: 128 }),
  spreadDiff: decimal("spreadDiff", { precision: 5, scale: 1 }),
  totalEdge: varchar("totalEdge", { length: 128 }),
  totalDiff: decimal("totalDiff", { precision: 5, scale: 1 }),
  sport: varchar("sport", { length: 64 }).notNull().default("NCAAM"),
  /** 'regular_season' or 'conference_tournament' */
  gameType: mysqlEnum("gameType", ["regular_season", "conference_tournament"]).notNull().default("regular_season"),
  /** Conference name for tournament games, e.g. 'MAC', 'Big East' */
  conference: varchar("conference", { length: 128 }),
  /** Whether this game has been published to the member feed by the owner */
  publishedToFeed: boolean("publishedToFeed").notNull().default(false),
  /** Whether the model projections for this game have been approved by the owner for public display */
  publishedModel: boolean("publishedModel").notNull().default(false),
  // ─── VSiN Betting Splits (integer 0-100, null = not yet scraped) ───────────
  /** % of spread bets placed on the away team */
  spreadAwayBetsPct: tinyint("spreadAwayBetsPct"),
  /** % of spread money wagered on the away team */
  spreadAwayMoneyPct: tinyint("spreadAwayMoneyPct"),
  /** % of total (O/U) bets placed on the Over */
  totalOverBetsPct: tinyint("totalOverBetsPct"),
  /** % of total (O/U) money wagered on the Over */
  totalOverMoneyPct: tinyint("totalOverMoneyPct"),
  /** % of moneyline bets placed on the away team */
  mlAwayBetsPct: tinyint("mlAwayBetsPct"),
  /** % of moneyline money wagered on the away team */
  mlAwayMoneyPct: tinyint("mlAwayMoneyPct"),
  /** Away team moneyline odds, e.g. "+120" or "-900" */
  awayML: varchar("awayML", { length: 16 }),
  /** Home team moneyline odds, e.g. "-142" or "+600" */
  homeML: varchar("homeML", { length: 16 }),
  /**
   * Puck line / spread juice for the away team, e.g. "-226" or "+184".
   * Populated from MetaBet consensus board for NHL games.
   * For NCAAM/NBA the spread is almost always -110 so this is typically null.
   */
  awaySpreadOdds: varchar("awaySpreadOdds", { length: 16 }),
  /** Puck line / spread juice for the home team, e.g. "+184" or "-226" */
  homeSpreadOdds: varchar("homeSpreadOdds", { length: 16 }),
  /** Over odds for the O/U total, e.g. "-107" (null = not available / standard -110) */
  overOdds: varchar("overOdds", { length: 16 }),
  /** Under odds for the O/U total, e.g. "-113" (null = not available / standard -110) */
  underOdds: varchar("underOdds", { length: 16 }),
  // ─── Action Network Open Lines (opening odds at time of market creation) ─────
  /** AN opening spread for the away team, e.g. "+8.5" or "-3" */
  openAwaySpread: varchar("openAwaySpread", { length: 16 }),
  /** AN opening spread juice for the away team, e.g. "-102" or "-110" */
  openAwaySpreadOdds: varchar("openAwaySpreadOdds", { length: 16 }),
  /** AN opening spread for the home team, e.g. "-8.5" or "+3" */
  openHomeSpread: varchar("openHomeSpread", { length: 16 }),
  /** AN opening spread juice for the home team, e.g. "-120" or "-110" */
  openHomeSpreadOdds: varchar("openHomeSpreadOdds", { length: 16 }),
  /** AN opening total (over line), e.g. "151.5" */
  openTotal: varchar("openTotal", { length: 16 }),
  /** AN opening over juice, e.g. "-110" */
  openOverOdds: varchar("openOverOdds", { length: 16 }),
  /** AN opening under juice, e.g. "-110" */
  openUnderOdds: varchar("openUnderOdds", { length: 16 }),
  /** AN opening moneyline for the away team, e.g. "+285" */
  openAwayML: varchar("openAwayML", { length: 16 }),
  /** AN opening moneyline for the home team, e.g. "-365" */
  openHomeML: varchar("openHomeML", { length: 16 }),
  // Note: DK NJ current lines are stored in the primary book columns:
  // awayBookSpread, homeBookSpread, bookTotal, awayML, homeML,
  // awaySpreadOdds, homeSpreadOdds, overOdds, underOdds
  // These are populated by the ingestAnHtml tRPC procedure (AN HTML best-odds table).
  /** Model fair value moneyline for the away team, e.g. "+225" or "-670" */
  modelAwayML: varchar("modelAwayML", { length: 16 }),
  /** Model fair value moneyline for the home team, e.g. "-225" or "+670" */
  modelHomeML: varchar("modelHomeML", { length: 16 }),
  /** Model projected score for the away team (decimal, hundredths precision) */
  modelAwayScore: decimal("modelAwayScore", { precision: 6, scale: 2 }),
  /** Model projected score for the home team (decimal, hundredths precision) */
  modelHomeScore: decimal("modelHomeScore", { precision: 6, scale: 2 }),
  /** Model over rate from 250k simulations (0-100) */
  modelOverRate: decimal("modelOverRate", { precision: 5, scale: 2 }),
  /** Model under rate from 250k simulations (0-100) */
  modelUnderRate: decimal("modelUnderRate", { precision: 5, scale: 2 }),
  /** Model fair odds for away team at book spread line, e.g. "-118" or "+105" */
  modelAwaySpreadOdds: varchar("modelAwaySpreadOdds", { length: 16 }),
  /** Model fair odds for home team at book spread line, e.g. "+105" or "-118" */
  modelHomeSpreadOdds: varchar("modelHomeSpreadOdds", { length: 16 }),
  /** Away team win probability from model (0-100) */
  modelAwayWinPct: decimal("modelAwayWinPct", { precision: 5, scale: 2 }),
  /** Home team win probability from model (0-100) */
  modelHomeWinPct: decimal("modelHomeWinPct", { precision: 5, scale: 2 }),
  /** Whether the model spread was clamped to band limit */
  modelSpreadClamped: boolean("modelSpreadClamped").default(false),
  /** Whether the model total was clamped to band limit */
  modelTotalClamped: boolean("modelTotalClamped").default(false),
  /** Cover/total correlation direction: 'OVER', 'UNDER', or 'NONE' */
  modelCoverDirection: varchar("modelCoverDirection", { length: 8 }),
  /** UTC timestamp (ms) when the model last ran for this game */
  modelRunAt: bigint("modelRunAt", { mode: "number" }),
  /** WagerTalk rotation numbers e.g. '689/690' (away/home) */
  rotNums: varchar("rotNums", { length: 32 }),
  /** WagerTalk display order — lower number appears first */
  sortOrder: int("sortOrder").notNull().default(9999),
  /** NCAA contest ID (unique per game) — used to dedup NCAA-only games (e.g. TBA vs TBA) */
  ncaaContestId: varchar("ncaaContestId", { length: 20 }),
  // ─── March Madness Bracket Progression ──────────────────────────────────────
  /** NCAA.com bracket game ID, e.g. 101 (FF), 201-232 (R64), 301-316 (R32), etc. */
  bracketGameId: int("bracketGameId"),
  /** Tournament round: 'FIRST_FOUR', 'R64', 'R32', 'S16', 'E8', 'F4', 'CHAMPIONSHIP' */
  bracketRound: varchar("bracketRound", { length: 20 }),
  /** Tournament region: 'EAST', 'WEST', 'SOUTH', 'MIDWEST', 'FINAL_FOUR' */
  bracketRegion: varchar("bracketRegion", { length: 20 }),
  /** Slot within the region (1-8 for R64, 1-4 for R32, 1-2 for S16, 1 for E8) */
  bracketSlot: int("bracketSlot"),
  /** NCAA.com bracket game ID of the next-round game this winner advances to */
  nextBracketGameId: int("nextBracketGameId"),
  /** Whether the winner of this game fills the 'top' or 'bottom' slot in the next game */
  nextBracketSlot: mysqlEnum("nextBracketSlot", ["top", "bottom"]),
  /** Game status: 'upcoming' (pre-game), 'live' (in-progress), 'final' (completed), 'postponed' (game postponed/cancelled) */
  gameStatus: mysqlEnum("gameStatus", ["upcoming", "live", "final", "postponed", "suspended"]).notNull().default("upcoming"),
  /** Away team current/final score (null = not started) */
  awayScore: int("awayScore"),
  /** Home team current/final score (null = not started) */
  homeScore: int("homeScore"),
  /** Game clock string for live games, e.g. "15:07 1st" or "HALF" (null = not live) */
  gameClock: varchar("gameClock", { length: 32 }),
  // ─── MLB-specific fields ──────────────────────────────────────────────────
  /** MLB.com gamePk (unique game ID from statsapi.mlb.com) */
  mlbGamePk: int("mlbGamePk"),
  /** Primary TV broadcaster for the game, e.g. "Netflix", "ESPN", "FOX" */
  broadcaster: varchar("broadcaster", { length: 128 }),
  /** Away team starting pitcher name, e.g. "Gerrit Cole" */
  awayStartingPitcher: varchar("awayStartingPitcher", { length: 128 }),
  /** Home team starting pitcher name, e.g. "Logan Webb" */
  homeStartingPitcher: varchar("homeStartingPitcher", { length: 128 }),
  /** Whether the away starting pitcher is confirmed (true) or projected (false) */
  awayPitcherConfirmed: boolean("awayPitcherConfirmed").default(false),
  /** Whether the home starting pitcher is confirmed (true) or projected (false) */
  homePitcherConfirmed: boolean("homePitcherConfirmed").default(false),
  /** Ballpark / venue name, e.g. "Oracle Park" */
  venue: varchar("venue", { length: 128 }),
  /** Whether this is a doubleheader: 'N'=no, 'Y'=yes game 1, 'S'=yes game 2 */
  doubleHeader: varchar("doubleHeader", { length: 2 }).default("N"),
  /** Game number within a doubleheader (1 or 2; 1 for non-DH games) */
  gameNumber: tinyint("gameNumber").default(1),
  /** Away team run line (spread), e.g. "-1.5" or "+1.5" */
  awayRunLine: varchar("awayRunLine", { length: 8 }),
  /** Home team run line (spread), e.g. "+1.5" or "-1.5" */
  homeRunLine: varchar("homeRunLine", { length: 8 }),
  /** Away run line juice, e.g. "+135" or "-160" */
  awayRunLineOdds: varchar("awayRunLineOdds", { length: 16 }),
  /** Home run line juice, e.g. "-160" or "+135" */
  homeRunLineOdds: varchar("homeRunLineOdds", { length: 16 }),
  /** % of run line bets placed on the away team */
  rlAwayBetsPct: tinyint("rlAwayBetsPct"),
  /** % of run line money wagered on the away team */
  rlAwayMoneyPct: tinyint("rlAwayMoneyPct"),
  // ─── NHL-specific fields ──────────────────────────────────────────────────
  /** Starting goalie for the away team (NHL only), e.g. "Jeremy Swayman" */
  awayGoalie: varchar("awayGoalie", { length: 128 }),
  /** Starting goalie for the home team (NHL only), e.g. "Andrei Vasilevskiy" */
  homeGoalie: varchar("homeGoalie", { length: 128 }),
  /** Whether the away goalie is confirmed (true) or projected (false) */
  awayGoalieConfirmed: boolean("awayGoalieConfirmed").default(false),
  /** Whether the home goalie is confirmed (true) or projected (false) */
  homeGoalieConfirmed: boolean("homeGoalieConfirmed").default(false),
  /** Model puck line cover probability for the away team (0-100) */
  modelAwayPLCoverPct: decimal("modelAwayPLCoverPct", { precision: 5, scale: 2 }),
  /** Model puck line cover probability for the home team (0-100) */
  modelHomePLCoverPct: decimal("modelHomePLCoverPct", { precision: 5, scale: 2 }),
  /** Model puck line spread for the away team, e.g. "+1.5" or "-2.5" */
  modelAwayPuckLine: varchar("modelAwayPuckLine", { length: 8 }),
  /** Model puck line spread for the home team, e.g. "-1.5" or "+2.5" */
  modelHomePuckLine: varchar("modelHomePuckLine", { length: 8 }),
  /** Model fair value odds for the away puck line, e.g. "-133" or "+115" */
  modelAwayPLOdds: varchar("modelAwayPLOdds", { length: 16 }),
  /** Model fair value odds for the home puck line, e.g. "+133" or "-115" */
  modelHomePLOdds: varchar("modelHomePLOdds", { length: 16 }),
  /** Model fair value odds for the Over, e.g. "+131" or "-108" */
  modelOverOdds: varchar("modelOverOdds", { length: 16 }),
  /** Model fair value odds for the Under, e.g. "-131" or "+108" */
  modelUnderOdds: varchar("modelUnderOdds", { length: 16 }),

  // ─── Full Game Backtest Results ──────────────────────────────────────────────
  /** Actual away team final score (populated after game FINAL) */
  actualAwayScore: int("actualAwayScore"),
  /** Actual home team final score (populated after game FINAL) */
  actualHomeScore: int("actualHomeScore"),
  /** FG ML backtest result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' */
  fgMlResult: varchar("fgMlResult", { length: 16 }),
  /** FG Run Line backtest result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' */
  fgRlResult: varchar("fgRlResult", { length: 16 }),
  /** FG Total backtest result: 'OVER' | 'UNDER' | 'PUSH' | 'PENDING' */
  fgTotalResult: varchar("fgTotalResult", { length: 16 }),
  /** Model ML prediction correct: 1=yes 0=no null=pending */
  fgMlCorrect: tinyint("fgMlCorrect"),
  /** Model RL prediction correct: 1=yes 0=no null=pending */
  fgRlCorrect: tinyint("fgRlCorrect"),
  /** Model Total prediction correct: 1=yes 0=no null=pending */
  fgTotalCorrect: tinyint("fgTotalCorrect"),
  /** UTC ms when FG backtest was last run */
  fgBacktestRunAt: bigint("fgBacktestRunAt", { mode: "number" }),

  // ─── First Five Innings (F5) — FanDuel NJ source ────────────────────────────
  /** F5 away run line from FanDuel NJ, e.g. "-0.5" */
  f5AwayRunLine: varchar("f5AwayRunLine", { length: 8 }),
  /** F5 home run line from FanDuel NJ, e.g. "+0.5" */
  f5HomeRunLine: varchar("f5HomeRunLine", { length: 8 }),
  /** F5 away run line odds from FanDuel NJ, e.g. "+106" */
  f5AwayRunLineOdds: varchar("f5AwayRunLineOdds", { length: 16 }),
  /** F5 home run line odds from FanDuel NJ, e.g. "-138" */
  f5HomeRunLineOdds: varchar("f5HomeRunLineOdds", { length: 16 }),
  /** F5 total line from FanDuel NJ, e.g. "4.5" */
  f5Total: varchar("f5Total", { length: 8 }),
  /** F5 over odds from FanDuel NJ, e.g. "-115" */
  f5OverOdds: varchar("f5OverOdds", { length: 16 }),
  /** F5 under odds from FanDuel NJ, e.g. "-105" */
  f5UnderOdds: varchar("f5UnderOdds", { length: 16 }),
  /** F5 away ML from FanDuel NJ, e.g. "-130" */
  f5AwayML: varchar("f5AwayML", { length: 16 }),
  /** F5 home ML from FanDuel NJ, e.g. "+110" */
  f5HomeML: varchar("f5HomeML", { length: 16 }),
  /** Model projected away team score through 5 innings */
  modelF5AwayScore: decimal("modelF5AwayScore", { precision: 5, scale: 2 }),
  /** Model projected home team score through 5 innings */
  modelF5HomeScore: decimal("modelF5HomeScore", { precision: 5, scale: 2 }),
  /** Model projected F5 total (combined runs through 5 innings) */
  modelF5Total: decimal("modelF5Total", { precision: 5, scale: 1 }),
  /** Model F5 over probability (0-100) */
  modelF5OverRate: decimal("modelF5OverRate", { precision: 5, scale: 2 }),
  /** Model F5 under probability (0-100) */
  modelF5UnderRate: decimal("modelF5UnderRate", { precision: 5, scale: 2 }),
  /** Model F5 away win probability (0-100) */
  modelF5AwayWinPct: decimal("modelF5AwayWinPct", { precision: 5, scale: 2 }),
  /** Model F5 home win probability (0-100) */
  modelF5HomeWinPct: decimal("modelF5HomeWinPct", { precision: 5, scale: 2 }),
  /** Model F5 away ML fair value odds, e.g. "-133" */
  modelF5AwayML: varchar("modelF5AwayML", { length: 16 }),
  /** Model F5 home ML fair value odds, e.g. "+113" */
  modelF5HomeML: varchar("modelF5HomeML", { length: 16 }),
  /** Model F5 away run line cover probability (0-100) */
  modelF5AwayRLCoverPct: decimal("modelF5AwayRLCoverPct", { precision: 5, scale: 2 }),
  /** Model F5 home run line cover probability (0-100) */
  modelF5HomeRLCoverPct: decimal("modelF5HomeRLCoverPct", { precision: 5, scale: 2 }),
  /** Model F5 away run line fair value odds, e.g. "-118" */
  modelF5AwayRlOdds: varchar("modelF5AwayRlOdds", { length: 16 }),
  /** Model F5 home run line fair value odds, e.g. "+104" */
  modelF5HomeRlOdds: varchar("modelF5HomeRlOdds", { length: 16 }),
  /** Model F5 over fair value odds, e.g. "-108" */
  modelF5OverOdds: varchar("modelF5OverOdds", { length: 16 }),
  /** Model F5 under fair value odds, e.g. "+108" */
  modelF5UnderOdds: varchar("modelF5UnderOdds", { length: 16 }),
  /** Model P(F5 push/tie) — three-way Bayesian-blended push probability (0-100) */
  modelF5PushPct: decimal("modelF5PushPct", { precision: 6, scale: 4 }),
  /** Raw simulation P(F5 push/tie) before Bayesian blending with empirical 15.07% (0-100, diagnostic) */
  modelF5PushRaw: decimal("modelF5PushRaw", { precision: 6, scale: 4 }),
  /** Actual away team score through 5 innings (populated after game) */
  actualF5AwayScore: int("actualF5AwayScore"),
  /** Actual home team score through 5 innings (populated after game) */
  actualF5HomeScore: int("actualF5HomeScore"),
  /** F5 ML backtest result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' */
  f5MlResult: varchar("f5MlResult", { length: 16 }),
  /** F5 Run Line backtest result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' */
  f5RlResult: varchar("f5RlResult", { length: 16 }),
  /** F5 Total backtest result: 'OVER' | 'UNDER' | 'PUSH' | 'PENDING' */
  f5TotalResult: varchar("f5TotalResult", { length: 16 }),
  /** Model F5 ML prediction correct: 1=yes 0=no null=pending */
  f5MlCorrect: tinyint("f5MlCorrect"),
  /** Model F5 RL prediction correct: 1=yes 0=no null=pending */
  f5RlCorrect: tinyint("f5RlCorrect"),
  /** Model F5 Total prediction correct: 1=yes 0=no null=pending */
  f5TotalCorrect: tinyint("f5TotalCorrect"),
  /** UTC ms when F5 backtest was last run */
  f5BacktestRunAt: bigint("f5BacktestRunAt", { mode: "number" }),

  // ─── NRFI / YRFI — FanDuel NJ source ────────────────────────────────────────
  /** NRFI over (no run) odds from FanDuel NJ, e.g. "-130" */
  nrfiOverOdds: varchar("nrfiOverOdds", { length: 16 }),
  /** YRFI under (yes run) odds from FanDuel NJ, e.g. "+110" */
  yrfiUnderOdds: varchar("yrfiUnderOdds", { length: 16 }),
  /** Model P(NRFI) — probability no run scores in inning 1 (0-100) */
  modelPNrfi: decimal("modelPNrfi", { precision: 5, scale: 2 }),
  /** Model fair value odds for NRFI, e.g. "-143" */
  modelNrfiOdds: varchar("modelNrfiOdds", { length: 16 }),
  /** Model fair value odds for YRFI, e.g. "+121" */
  modelYrfiOdds: varchar("modelYrfiOdds", { length: 16 }),
  /** Actual result: 'NRFI' | 'YRFI' | 'PENDING' */
  nrfiActualResult: varchar("nrfiActualResult", { length: 16 }),
  /** NRFI backtest result: 'WIN' | 'LOSS' | 'PENDING' (from model perspective) */
  nrfiBacktestResult: varchar("nrfiBacktestResult", { length: 16 }),
  /** Model NRFI prediction correct: 1=yes 0=no null=pending */
  nrfiCorrect: tinyint("nrfiCorrect"),
  /** UTC ms when NRFI backtest was last run */
  nrfiBacktestRunAt: bigint("nrfiBacktestRunAt", { mode: "number" }),
  /**
   * Combined pitcher NRFI signal = (awayPitcherNrfiRate + homePitcherNrfiRate) / 2
   * Computed from 3-year empirical NRFI rates (n=5,109 games, seeded 2026-04-14).
   * Optimal filter threshold: >= 0.56 (grid search: 69.38% win rate, 32.46% ROI)
   * Null if either pitcher lacks 3yr NRFI data (< 3 starts).
   */
  nrfiCombinedSignal: double("nrfiCombinedSignal"),
  /**
   * Whether the game passes the 3yr NRFI filter (combinedSignal >= 0.56).
   * 1 = passes (strong NRFI edge), 0 = fails, null = no data.
   */
  nrfiFilterPass: tinyint("nrfiFilterPass"),

  // ─── HR Props (team-level from MLBAIModel.py) ────────────────────────────────
  /** Model P(away team hits ≥1 HR) (0-100) */
  modelAwayHrPct: decimal("modelAwayHrPct", { precision: 5, scale: 2 }),
  /** Model P(home team hits ≥1 HR) (0-100) */
  modelHomeHrPct: decimal("modelHomeHrPct", { precision: 5, scale: 2 }),
  /** Model P(both teams hit ≥1 HR) (0-100) */
  modelBothHrPct: decimal("modelBothHrPct", { precision: 5, scale: 2 }),
  /** Model expected HR count for away team */
  modelAwayExpHr: decimal("modelAwayExpHr", { precision: 4, scale: 2 }),
  /** Model expected HR count for home team */
  modelHomeExpHr: decimal("modelHomeExpHr", { precision: 4, scale: 2 }),

  // ─── Inning-by-Inning Projections (I1-I9, backtest-calibrated 2026-04-13) ────
  /**
   * JSON array [I1..I9]: expected home runs per inning from Monte Carlo simulation.
   * Backtest-calibrated weights: I1=0.1162, I2-I5=0.1085, I6-I9=0.1124 (normalized).
   * Format: number[9], e.g. [0.52, 0.49, 0.49, 0.49, 0.49, 0.50, 0.51, 0.51, 0.51]
   */
  modelInningHomeExp: text("modelInningHomeExp"),
  /**
   * JSON array [I1..I9]: expected away runs per inning from Monte Carlo simulation.
   * Format: number[9]
   */
  modelInningAwayExp: text("modelInningAwayExp"),
  /**
   * JSON array [I1..I9]: expected combined runs per inning (home + away).
   * Format: number[9]
   */
  modelInningTotalExp: text("modelInningTotalExp"),
  /**
   * JSON array [I1..I9]: P(home team scores >= 1 run) per inning.
   * Format: number[9] in [0,1]
   */
  modelInningPHomeScores: text("modelInningPHomeScores"),
  /**
   * JSON array [I1..I9]: P(away team scores >= 1 run) per inning.
   * Format: number[9] in [0,1]
   */
  modelInningPAwayScores: text("modelInningPAwayScores"),
  /**
   * JSON array [I1..I9]: P(neither team scores) per inning — NRFI probability per inning.
   * I1 value is the primary NRFI market probability (consistent with modelPNrfi).
   * Format: number[9] in [0,1]
   */
  modelInningPNeitherScores: text("modelInningPNeitherScores"),

  /**
   * Raw Monte Carlo projection total (proj_away_runs + proj_home_runs) BEFORE snapping to
   * a key number. This is the model's true expected total, distinct from modelTotal which
   * is anchored to the book O/U line for originated-line display.
   * e.g. 8.73 means the model projects 8.73 combined runs before line selection.
   * Precision 6,2 allows values like 8.73, 10.42, 6.08.
   */
  modelProjTotal: decimal("modelProjTotal", { precision: 6, scale: 2 }),

  /**
   * Weather run-factor adjustment applied by the Python engine for this game.
   * 1.0 = neutral (dome or no weather data). >1.0 = run-boosting conditions.
   * Stored for traceability and backtest analysis.
   * Precision 5,4 allows values like 1.0120, 0.9880.
   */
  modelWeatherAdj: decimal("modelWeatherAdj", { precision: 5, scale: 4 }),

  /**
   * Tracks the source of the current primary book columns (awayBookSpread, homeBookSpread,
   * bookTotal, awayML, homeML, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds).
   *
   * 'open' — All 9 primary fields are sourced from the AN Opening line (DK not yet fully posted)
   * 'dk'   — All 3 DK NJ markets complete (spread+odds, total+odds, ML) — using DK for all 9 fields
   * Never null, never partial. Every game always has either DK or Open.
   */
  oddsSource: mysqlEnum("oddsSource", ["open", "dk"]),

  // ─── Outcome Ingestion + Brier Scores (populated by mlbOutcomeIngestor after game final) ──
  /**
   * Actual full-game total runs (awayFinalScore + homeFinalScore).
   * Populated by mlbOutcomeIngestor.ts after gameStatus = 'final'.
   * Used for Brier score computation and rolling f5_share drift detection.
   * Precision 5,1 matches actualAwayScore + actualHomeScore (both int, sum ≤ 99.0).
   */
  actualFgTotal: decimal("actualFgTotal", { precision: 5, scale: 1 }),
  /**
   * Actual F5 total runs (actualF5AwayScore + actualF5HomeScore).
   * Populated by mlbOutcomeIngestor.ts after game is final.
   * Used for rolling f5_share = actualF5Total / actualFgTotal drift detection.
   * Precision 5,1 matches F5 score fields.
   */
  actualF5Total: decimal("actualF5Total", { precision: 5, scale: 1 }),
  /**
   * Actual NRFI result: 1 = no run scored in inning 1, 0 = at least one run scored.
   * Populated by mlbOutcomeIngestor.ts from MLB Stats API linescore.innings[0].
   * Null = game not yet final or linescore unavailable.
   */
  actualNrfiBinary: tinyint("actualNrfiBinary"),
  /**
   * Brier score for FG Total prediction: (p_over - outcome_over)^2
   * p_over = modelFgOverRate / 100 (model probability of over)
   * outcome_over = 1 if actualFgTotal > bookTotal, 0 if under, null if push/no-line
   * Range [0, 1]. Lower = better calibration. Null if bookTotal or scores unavailable.
   */
  brierFgTotal: decimal("brierFgTotal", { precision: 7, scale: 6 }),
  /**
   * Brier score for F5 Total prediction: (p_f5_over - outcome_f5_over)^2
   * p_f5_over = modelF5OverRate / 100
   * outcome_f5_over = 1 if actualF5Total > bookF5Total, 0 if under, null if push/no-line
   * Range [0, 1]. Lower = better calibration. Null if F5 book total or scores unavailable.
   */
  brierF5Total: decimal("brierF5Total", { precision: 7, scale: 6 }),
  /**
   * Brier score for NRFI prediction: (p_nrfi - outcome_nrfi)^2
   * p_nrfi = modelPNrfi / 100
   * outcome_nrfi = actualNrfiBinary (1 = NRFI, 0 = YRFI)
   * Range [0, 1]. Lower = better calibration. Null if modelPNrfi or linescore unavailable.
   */
  brierNrfi: decimal("brierNrfi", { precision: 7, scale: 6 }),
  /**
   * Brier score for FG ML prediction: (p_home_win - outcome_home_win)^2
   * p_home_win = modelHomeWinPct / 100
   * outcome_home_win = 1 if actualHomeScore > actualAwayScore, 0 if home lost, null if tie
   * Range [0, 1]. Null if modelHomeWinPct or final scores unavailable.
   */
  brierFgMl: decimal("brierFgMl", { precision: 7, scale: 6 }),
  /**
   * Brier score for F5 ML prediction: (p_f5_home_win - outcome_f5_home_win)^2
   * p_f5_home_win = modelF5HomeWinPct / 100
   * outcome_f5_home_win = 1 if actualF5HomeScore > actualF5AwayScore, 0 if away led, null if tie
   * Range [0, 1]. Null if modelF5HomeWinPct or F5 scores unavailable.
   */
  brierF5Ml: decimal("brierF5Ml", { precision: 7, scale: 6 }),
  /**
   * UTC ms when mlbOutcomeIngestor last populated this game's outcome fields.
   * Null = not yet ingested. Used to skip re-ingestion of already-complete games.
   * Set on every successful ingestion run (even if scores were already present).
   */
  outcomeIngestedAt: bigint("outcomeIngestedAt", { mode: "number" }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  /** Prevent duplicate rows for the same matchup on the same date */
  uniqMatchup: uniqueIndex("games_matchup_unique").on(t.gameDate, t.awayTeam, t.homeTeam, t.gameNumber),
  /**
   * Composite index for the primary feed query pattern:
   *   WHERE sport = ? AND gameDate >= ? AND gameDate <= ? AND gameStatus != 'postponed'
   * Eliminates the IndexLookUp+TableRowIDScan double-read on the 7,730-row games table.
   * Without this index, every games.list call does a full index scan on games_matchup_unique
   * then a separate TableRowIDScan to filter by sport+gameStatus — ~100ms per query.
   * With this index, TiKV can satisfy the entire WHERE clause from one index range scan.
   */
  idxSportDate: index("idx_games_sport_date_status").on(t.sport, t.gameDate, t.gameStatus),
}));

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

// ─── NBA Teams (seeded from NBA Mapping master sheet) ───────────────────────

export const nbaTeams = mysqlTable("nba_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "boston_celtics" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NBA.com short slug, e.g. "celtics" */
  nbaSlug: varchar("nbaSlug", { length: 64 }).notNull().unique(),
  /** VSiN href slug, e.g. "boston-celtics" */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full team name, e.g. "Boston Celtics" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Celtics" */
  nickname: varchar("nickname", { length: 128 }).notNull(),
  /** City name, e.g. "Boston" */
  city: varchar("city", { length: 128 }).notNull(),
  /** Conference: "East" or "West" */
  conference: varchar("conference", { length: 16 }).notNull(),
  /** Division, e.g. "Atlantic" */
  division: varchar("division", { length: 64 }).notNull(),
  /** NBA.com CDN SVG logo URL */
  logoUrl: text("logoUrl").notNull(),
  /** Standard NBA abbreviation, e.g. "BOS", "LAL", "GSW" */
  abbrev: varchar("abbrev", { length: 8 }),
  /** Primary brand hex color, e.g. "#007A33" */
  primaryColor: varchar("primaryColor", { length: 16 }),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NbaTeamRow = typeof nbaTeams.$inferSelect;
export type InsertNbaTeam = typeof nbaTeams.$inferInsert;

// ─── NCAAM Teams (seeded from NCAAM Mapping master sheet) ───────────────────

export const ncaamTeams = mysqlTable("ncaam_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "arkansas" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NCAA.com seoname slug, e.g. "arkansas" */
  ncaaSlug: varchar("ncaaSlug", { length: 128 }).notNull().unique(),
  /** VSiN href slug, e.g. "arkansas" */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full school name, e.g. "Arkansas" */
  ncaaName: varchar("ncaaName", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Razorbacks" */
  ncaaNickname: varchar("ncaaNickname", { length: 128 }).notNull(),
  /** VSiN display name */
  vsinName: varchar("vsinName", { length: 255 }).notNull(),
  /** Conference, e.g. "SEC" */
  conference: varchar("conference", { length: 128 }).notNull(),
  /** NCAA.com SVG logo URL */
  logoUrl: text("logoUrl").notNull(),
  /** KenPom.com team name for team.php?team= lookups, e.g. "Duke", "VCU", "Prairie View A&M" */
  kenpomSlug: varchar("kenpomSlug", { length: 255 }),
  /** Short abbreviation used by NCAA/VSiN, e.g. "DUKE", "UNC", "GONZ" */
  abbrev: varchar("abbrev", { length: 16 }),
  /** Primary brand hex color, e.g. "#9D2235" */
  primaryColor: varchar("primaryColor", { length: 16 }),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NcaamTeamRow = typeof ncaamTeams.$inferSelect;
export type InsertNcaamTeam = typeof ncaamTeams.$inferInsert;

// ─── NHL Teams (seeded from NHL.com + VSiN mapping) ────────────────────────────

export const nhlTeams = mysqlTable("nhl_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug with hyphens replaced by underscores, e.g. "buffalo_sabres" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** NHL.com URL slug, e.g. "buffalo-sabres" */
  nhlSlug: varchar("nhlSlug", { length: 128 }).notNull().unique(),
  /** VSiN href slug, e.g. "buffalo-sabres" (special: "ny-islanders" for NYI) */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Full team name, e.g. "Buffalo Sabres" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Sabres" */
  nickname: varchar("nickname", { length: 128 }).notNull(),
  /** City name, e.g. "Buffalo" */
  city: varchar("city", { length: 128 }).notNull(),
  /** Conference: "EASTERN" or "WESTERN" */
  conference: mysqlEnum("conference", ["EASTERN", "WESTERN"]).notNull(),
  /** Division: "ATLANTIC", "METROPOLITAN", "CENTRAL", or "PACIFIC" */
  division: mysqlEnum("division", ["ATLANTIC", "METROPOLITAN", "CENTRAL", "PACIFIC"]).notNull(),
  /** NHL.com CDN SVG logo URL, e.g. "https://assets.nhle.com/logos/nhl/svg/BUF_dark.svg" */
  logoUrl: text("logoUrl").notNull(),
  /** Standard NHL abbreviation, e.g. "BUF", "TBL", "VGK" */
  abbrev: varchar("abbrev", { length: 8 }).notNull(),
  /** Primary brand hex color, e.g. "#003087" */
  primaryColor: varchar("primaryColor", { length: 16 }).notNull(),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }).notNull(),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NhlTeamRow = typeof nhlTeams.$inferSelect;
export type InsertNhlTeam = typeof nhlTeams.$inferInsert;

// ─── MLB Teams (seeded from MLB.com + VSiN + Action Network mapping) ─────────────
export const mlbTeams = mysqlTable("mlb_teams", {
  id: int("id").autoincrement().primaryKey(),
  /** DB storage key — vsinSlug (single-word), e.g. "yankees", "redsox", "bluejays" */
  dbSlug: varchar("dbSlug", { length: 128 }).notNull().unique(),
  /** MLB Stats API numeric team ID, e.g. 147 for Yankees */
  mlbId: int("mlbId").notNull().unique(),
  /** MLB.com internal 3-letter team code, e.g. "nya", "lan" */
  mlbCode: varchar("mlbCode", { length: 8 }).notNull().unique(),
  /** Standard MLB abbreviation, e.g. "NYY", "LAD", "CWS" */
  abbrev: varchar("abbrev", { length: 8 }).notNull().unique(),
  /** VSiN href slug (single-word), e.g. "yankees", "redsox", "dbacks" */
  vsinSlug: varchar("vsinSlug", { length: 128 }).notNull().unique(),
  /** Action Network URL slug, e.g. "new-york-yankees" */
  anSlug: varchar("anSlug", { length: 128 }).notNull().unique(),
  /** Action Network logo slug for sprtactn.co CDN, e.g. "nyyd", "ladd", "mia_n" */
  anLogoSlug: varchar("anLogoSlug", { length: 32 }).notNull(),
  /** Baseball Reference team abbreviation — may differ from standard abbrev (e.g. "KCR", "TBD", "FLA", "OAK") */
  brAbbrev: varchar("brAbbrev", { length: 8 }).notNull().unique(),
  /** Full team name, e.g. "New York Yankees" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Team nickname, e.g. "Yankees", "Blue Jays", "D-backs" */
  nickname: varchar("nickname", { length: 128 }).notNull(),
  /** City/region name, e.g. "New York", "Tampa Bay", "Arizona" */
  city: varchar("city", { length: 128 }).notNull(),
  /** League: "AL" or "NL" */
  league: mysqlEnum("league", ["AL", "NL"]).notNull(),
  /** Division: "East", "Central", or "West" */
  division: mysqlEnum("division", ["East", "Central", "West"]).notNull(),
  /** Official MLB.com SVG logo URL, e.g. "https://www.mlbstatic.com/team-logos/147.svg" */
  logoUrl: text("logoUrl").notNull(),
  /** Primary brand hex color, e.g. "#003087" */
  primaryColor: varchar("primaryColor", { length: 16 }),
  /** Secondary brand hex color */
  secondaryColor: varchar("secondaryColor", { length: 16 }),
  /** Tertiary brand hex color */
  tertiaryColor: varchar("tertiaryColor", { length: 16 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MlbTeamRow = typeof mlbTeams.$inferSelect;
export type InsertMlbTeam = typeof mlbTeams.$inferInsert;

// ─── MLB Players (active roster mapped to current teams via Baseball Reference) ──────
export const mlbPlayers = mysqlTable("mlb_players", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * Baseball Reference player ID, e.g. "judgeaa01", "harpebr03".
   * Format: first 5 chars of last name + first 2 chars of first name + 2-digit sequence.
   * URL: https://www.baseball-reference.com/players/{letter}/{brId}.shtml
   */
  brId: varchar("brId", { length: 32 }).notNull().unique(),
  /** MLB Advanced Media (MLBAM) numeric player ID — used for headshot URLs */
  mlbamId: int("mlbamId"),
  /** Full display name, e.g. "Aaron Judge" */
  name: varchar("name", { length: 255 }).notNull(),
  /** Primary position, e.g. "Pitcher", "Catcher", "Outfielder", "Shortstop" */
  position: varchar("position", { length: 64 }),
  /** Bats: "R", "L", or "S" (switch) */
  bats: varchar("bats", { length: 4 }),
  /** Throws: "R" or "L" */
  throws: varchar("throws", { length: 4 }),
  /**
   * Baseball Reference team abbreviation of current team.
   * FK reference to mlb_teams.brAbbrev.
   * e.g. "NYY", "ATL", "KCR", "TBD"
   */
  currentTeamBrAbbrev: varchar("currentTeamBrAbbrev", { length: 8 }),
  /** Whether this player is currently on an active MLB roster */
  isActive: boolean("isActive").notNull().default(true),
  // ── Statcast 2025 season metrics (Baseball Savant leaderboard, min 50 PA) ──
  /** Isolated power (SLG - AVG) — primary per-player HR power indicator */
  iso: double("iso"),
  /** Barrel rate (%) — % of batted balls classified as barrels (EV ≥ 98 mph, LA 26–30°) */
  barrelPct: double("barrelPct"),
  /** Hard-hit rate (%) — % of batted balls with exit velocity ≥ 95 mph */
  hardHitPct: double("hardHitPct"),
  /** Expected slugging percentage based on exit velocity + launch angle */
  xSlg: double("xSlg"),
  /** UTC timestamp (ms) when Statcast data was last fetched from Baseball Savant */
  statcastFetchedAt: bigint("statcastFetchedAt", { mode: "number" }),
  /** UTC timestamp (ms) when this record was last synced from Baseball Reference */
  lastSyncedAt: bigint("lastSyncedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MlbPlayerRow = typeof mlbPlayers.$inferSelect;
export type InsertMlbPlayer = typeof mlbPlayers.$inferInsert;

// ─── Odds History (per-game DK NJ line snapshots from AN API) ───────────────────

export const oddsHistory = mysqlTable("odds_history", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull(),
  /** Sport: NCAAM, NBA, NHL */
  sport: varchar("sport", { length: 16 }).notNull(),
  /**
   * UTC timestamp (ms) when this snapshot was captured.
   * Stored as bigint so it survives timezone conversions cleanly.
   * Display in EST: new Date(scrapedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })
   */
  scrapedAt: bigint("scrapedAt", { mode: "number" }).notNull(),
  /** Source: 'auto' (hourly cron) or 'manual' (Refresh Now button) */
  source: mysqlEnum("source", ["auto", "manual"]).notNull().default("auto"),
  /**
   * Odds line source for this snapshot.
   * 'open' — All lines in this snapshot are from the AN Opening line (DK not yet fully posted)
   * 'dk'   — All lines are from DK NJ current market (all 3 markets complete)
   * Never null, never partial.
   */
  lineSource: mysqlEnum("lineSource", ["open", "dk"]),
  // ── DK NJ Spread snapshot ──
  awaySpread: varchar("awaySpread", { length: 16 }),
  awaySpreadOdds: varchar("awaySpreadOdds", { length: 16 }),
  homeSpread: varchar("homeSpread", { length: 16 }),
  homeSpreadOdds: varchar("homeSpreadOdds", { length: 16 }),
  // ── DK NJ Total snapshot ──
  total: varchar("total", { length: 16 }),
  overOdds: varchar("overOdds", { length: 16 }),
  underOdds: varchar("underOdds", { length: 16 }),
  // ── DK NJ Moneyline snapshot ──
  awayML: varchar("awayML", { length: 16 }),
  homeML: varchar("homeML", { length: 16 }),
  // ── VSIN Betting Splits snapshot (all three sports) ──
  // Spread / Run Line / Puck Line splits
  spreadAwayBetsPct: tinyint("spreadAwayBetsPct"),
  spreadAwayMoneyPct: tinyint("spreadAwayMoneyPct"),
  // Total splits (over side)
  totalOverBetsPct: tinyint("totalOverBetsPct"),
  totalOverMoneyPct: tinyint("totalOverMoneyPct"),
  // Moneyline splits
  mlAwayBetsPct: tinyint("mlAwayBetsPct"),
  mlAwayMoneyPct: tinyint("mlAwayMoneyPct"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OddsHistoryRow = typeof oddsHistory.$inferSelect;
export type InsertOddsHistory = typeof oddsHistory.$inferInsert;

// ─── MLB Lineups (Rotowire daily lineups + weather) ────────────────────────────

/**
 * One row per game per scrape cycle.
 * awayLineup / homeLineup are JSON arrays of LineupPlayer objects:
 *   [{ battingOrder: 1, position: "CF", name: "Aaron Judge", bats: "R", mlbamId: 592450 }, ...]
 * Pitcher fields store the confirmed/probable starter for each side.
 */
export const mlbLineups = mysqlTable("mlb_lineups", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull().unique(),
  /** UTC timestamp (ms) when Rotowire was last scraped for this game */
  scrapedAt: bigint("scrapedAt", { mode: "number" }).notNull(),
  // ── Away pitcher ──
  awayPitcherName: varchar("awayPitcherName", { length: 128 }),
  awayPitcherHand: varchar("awayPitcherHand", { length: 4 }),
  awayPitcherEra: varchar("awayPitcherEra", { length: 32 }),
  /** Rotowire internal player ID (from /baseball/player.php?id=NNNNN) */
  awayPitcherRotowireId: int("awayPitcherRotowireId"),
  /** MLB Stats API MLBAM person ID (for headshot URLs) */
  awayPitcherMlbamId: int("awayPitcherMlbamId"),
  awayPitcherConfirmed: boolean("awayPitcherConfirmed").default(false),
  // ── Home pitcher ──
  homePitcherName: varchar("homePitcherName", { length: 128 }),
  homePitcherHand: varchar("homePitcherHand", { length: 4 }),
  homePitcherEra: varchar("homePitcherEra", { length: 32 }),
  /** Rotowire internal player ID (from /baseball/player.php?id=NNNNN) */
  homePitcherRotowireId: int("homePitcherRotowireId"),
  /** MLB Stats API MLBAM person ID (for headshot URLs) */
  homePitcherMlbamId: int("homePitcherMlbamId"),
  homePitcherConfirmed: boolean("homePitcherConfirmed").default(false),
  // ── Batting lineups (JSON arrays) ──
  /** JSON: LineupPlayer[] for away team, batting order 1-9 */
  awayLineup: text("awayLineup"),
  /** JSON: LineupPlayer[] for home team, batting order 1-9 */
  homeLineup: text("homeLineup"),
  awayLineupConfirmed: boolean("awayLineupConfirmed").default(false),
  homeLineupConfirmed: boolean("homeLineupConfirmed").default(false),
  // ── Weather ──
  weatherIcon: varchar("weatherIcon", { length: 8 }),
  weatherTemp: varchar("weatherTemp", { length: 16 }),
  weatherWind: varchar("weatherWind", { length: 64 }),
  weatherPrecip: int("weatherPrecip"),
  weatherDome: boolean("weatherDome").default(false),
  // ── Umpire ──
  umpire: varchar("umpire", { length: 128 }),
  // ── Lineup change-detection & model-trigger tracking ──────────────────────
  /**
   * SHA-256 fingerprint of the current lineup state:
   *   SHA256(awayPitcherName|homePitcherName|awayLineup_JSON|homeLineup_JSON)
   * Changes whenever any pitcher or batting order slot changes.
   * Used by the LineupWatcher to detect changes without full row comparison.
   * Null = no lineup data yet (no pitchers, no batting orders).
   */
  lineupHash: varchar("lineupHash", { length: 64 }),
  /**
   * Monotonically increasing version counter.
   * Starts at 1 on first insert with lineup data, increments on every detected hash change.
   * Provides an audit trail of how many times the lineup changed before game time.
   */
  lineupVersion: int("lineupVersion").default(0).notNull(),
  /**
   * UTC timestamp (ms) when the model last ran for this lineup via the watcher.
   * Null = model has never been triggered by the watcher for this game.
   */
  lineupModeledAt: bigint("lineupModeledAt", { mode: "number" }),
  /**
   * The lineupVersion that was last passed to the model.
   * When lineupVersion > lineupModeledVersion: watcher triggers a re-model.
   * When lineupVersion === lineupModeledVersion: no re-model needed.
   * Starts at 0 (never modeled).
   */
  lineupModeledVersion: int("lineupModeledVersion").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MlbLineupRow = typeof mlbLineups.$inferSelect;
export type InsertMlbLineup = typeof mlbLineups.$inferInsert;

/** Shape of each player entry stored in awayLineup / homeLineup JSON columns */
export interface LineupPlayer {
  battingOrder: number;
  position: string;
  name: string;
  bats: string; // 'R' | 'L' | 'S'
  /** Rotowire internal player ID (from /baseball/player.php?id=NNNNN) */
  rotowireId: number | null;
  /** MLB Stats API MLBAM person ID (for headshot URLs) — resolved separately */
  mlbamId: number | null;
}

// ─── User Favorite Games ─────────────────────────────────────────────────────
export const userFavoriteGames = mysqlTable(
  "user_favorite_games",
  {
    id: int("id").autoincrement().primaryKey(),
    /** The app_user who favorited the game */
    appUserId: int("appUserId").notNull(),
    /** The game id being favorited */
    gameId: int("gameId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("user_game_uniq").on(t.appUserId, t.gameId),
  })
);
export type UserFavoriteGame = typeof userFavoriteGames.$inferSelect;
export type InsertUserFavoriteGame = typeof userFavoriteGames.$inferInsert;

// ─── MLB Strikeout Props ──────────────────────────────────────────────────────
/**
 * One row per pitcher per game.
 * Stores the StrikeoutModel.py output for each starting pitcher.
 * signalBreakdown and matchupRows are JSON blobs.
 * Completely isolated from the game model projections (games table).
 */
export const mlbStrikeoutProps = mysqlTable("mlb_strikeout_props", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull(),
  /** 'away' | 'home' */
  side: varchar("side", { length: 8 }).notNull(),
  /** Pitcher full name, e.g. "Max Fried" */
  pitcherName: varchar("pitcherName", { length: 128 }).notNull(),
  /** Pitcher hand: 'L' | 'R' */
  pitcherHand: varchar("pitcherHand", { length: 4 }),
  /** Retrosheet ID, e.g. "friem001" */
  retrosheetId: varchar("retrosheetId", { length: 32 }),
  /** MLBAM player ID for headshot */
  mlbamId: int("mlbamId"),
  /** Model projected strikeout total (float, e.g. "4.73") */
  kProj: varchar("kProj", { length: 16 }),
  /** Model recommended line (e.g. "4.5") */
  kLine: varchar("kLine", { length: 16 }),
  /** K per 9 innings */
  kPer9: varchar("kPer9", { length: 16 }),
  /** Median of distribution */
  kMedian: varchar("kMedian", { length: 16 }),
  /** 5th percentile */
  kP5: varchar("kP5", { length: 16 }),
  /** 95th percentile */
  kP95: varchar("kP95", { length: 16 }),
  /** Book line (e.g. "4.5") */
  bookLine: varchar("bookLine", { length: 16 }),
  /** Book over odds (e.g. "-152") */
  bookOverOdds: varchar("bookOverOdds", { length: 16 }),
  /** Book under odds (e.g. "+115") */
  bookUnderOdds: varchar("bookUnderOdds", { length: 16 }),
  /** P(over book line) as decimal string, e.g. "0.499" */
  pOver: varchar("pOver", { length: 16 }),
  /** P(under book line) as decimal string, e.g. "0.501" */
  pUnder: varchar("pUnder", { length: 16 }),
  /** American odds for over implied by model, e.g. "+100" */
  modelOverOdds: varchar("modelOverOdds", { length: 16 }),
  /** American odds for under implied by model, e.g. "-100" */
  modelUnderOdds: varchar("modelUnderOdds", { length: 16 }),
  /** Edge on over (decimal string), e.g. "-0.012" */
  edgeOver: varchar("edgeOver", { length: 16 }),
  /** Edge on under (decimal string), e.g. "+0.012" */
  edgeUnder: varchar("edgeUnder", { length: 16 }),
  /** Best side: 'OVER' | 'UNDER' | 'PASS' */
  verdict: varchar("verdict", { length: 32 }),
  /** Best edge value (decimal string) */
  bestEdge: varchar("bestEdge", { length: 16 }),
  /** Best side label: 'OVER' | 'UNDER' */
  bestSide: varchar("bestSide", { length: 16 }),
  /** Best side ML string, e.g. "+115" */
  bestMlStr: varchar("bestMlStr", { length: 16 }),
  /** JSON: { platoon, ha, tto, whiff, zone, arsenal } signal breakdown */
  signalBreakdown: text("signalBreakdown"),
  /** JSON: array of { spot, name, bats, kRate, adj, expK } for opposing lineup */
  matchupRows: text("matchupRows"),
  /** JSON: { bins: number[], probs: number[] } distribution */
  distribution: text("distribution"),
  /** JSON: { inn: number, expK: number }[] inning breakdown */
  inningBreakdown: text("inningBreakdown"),
  /** UTC timestamp (ms) when model was run */
  modelRunAt: bigint("modelRunAt", { mode: "number" }),
  /** AN no-vig probability for the over (decimal string, e.g. "0.432") */
  anNoVigOverPct: varchar("anNoVigOverPct", { length: 16 }),
  /** AN player ID for this pitcher */
  anPlayerId: int("anPlayerId"),
  /** Actual strikeouts thrown (populated after game completes) */
  actualKs: int("actualKs"),
  /** Backtest result: 'OVER' | 'UNDER' | 'PUSH' | 'PENDING' | 'NO_LINE' */
  backtestResult: varchar("backtestResult", { length: 16 }),
  /** Model error vs actual (actualKs - kProj, decimal string) */
  modelError: varchar("modelError", { length: 16 }),
  /** Whether model prediction matched result: 1=correct, 0=incorrect, null=pending */
  modelCorrect: tinyint("modelCorrect"),
  /** UTC timestamp (ms) when backtest was last run */
  backtestRunAt: bigint("backtestRunAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  /** One row per (game, side) — upsert on this key */
  uqGameSide: uniqueIndex("uq_game_side").on(t.gameId, t.side),
}));
export type MlbStrikeoutPropRow = typeof mlbStrikeoutProps.$inferSelect;
export type InsertMlbStrikeoutProp = typeof mlbStrikeoutProps.$inferInsert;

// ─── MLB Pitcher Season Stats ─────────────────────────────────────────────────
/**
 * One row per pitcher (upserted by mlbamId + teamAbbrev).
 * Populated from MLB Stats API 2025 season stats.
 * Used by mlbModelRunner.ts to feed real stats into the engine.
 */
export const mlbPitcherStats = mysqlTable("mlb_pitcher_stats", {
  id: int("id").autoincrement().primaryKey(),
  /** MLB Stats API player ID */
  mlbamId: int("mlbamId").notNull(),
  /** Full name exactly as returned by MLB Stats API, e.g. "Gerrit Cole" */
  fullName: varchar("fullName", { length: 128 }).notNull(),
  /** Team abbreviation matching mlbModelRunner TEAM_STATS_2025 keys, e.g. "NYY" */
  teamAbbrev: varchar("teamAbbrev", { length: 8 }).notNull(),
  /** ERA (float) */
  era: double("era"),
  /** Strikeouts per 9 innings */
  k9: double("k9"),
  /** Walks per 9 innings */
  bb9: double("bb9"),
  /** Home runs per 9 innings */
  hr9: double("hr9"),
  /** WHIP */
  whip: double("whip"),
  /** Innings pitched (float, e.g. 162.1) */
  ip: double("ip"),
  /** Games started */
  gamesStarted: int("gamesStarted"),
  /** Games played */
  gamesPlayed: int("gamesPlayed"),
  /** xERA proxy (if available, else null) */
  xera: double("xera"),
  /** FIP (Fielding Independent Pitching) from MLB sabermetrics endpoint */
  fip: double("fip"),
  /** xFIP (Expected FIP, normalizes HR/FB rate) from MLB sabermetrics endpoint */
  xfip: double("xfip"),
  /** FIP- (FIP relative to league average, 100=avg, lower=better) */
  fipMinus: double("fipMinus"),
  /** ERA- (ERA relative to league average, 100=avg, lower=better) */
  eraMinus: double("eraMinus"),
  /** Pitcher WAR from MLB sabermetrics endpoint */
  war: double("war"),
  /** Pitcher throwing hand: 'R' = right, 'L' = left, 'S' = switch */
  throwsHand: varchar("throwsHand", { length: 1 }),
  /** UTC timestamp (ms) when stats were last fetched */
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),

  // ─── 3-Year Rolling NRFI Calibration Fields (seeded from 3yr backtest) ──────
  /** Total starts in 3yr NRFI sample (2024+2025+2026) */
  nrfiStarts: int("nrfiStarts"),
  /** Number of starts where inning 1 was scoreless (NRFI) */
  nrfiCount: int("nrfiCount"),
  /** NRFI rate = nrfiCount / nrfiStarts (0.0–1.0, 4 decimal places) */
  nrfiRate: double("nrfiRate"),
  /** Mean F5 runs allowed per start over 3yr sample */
  f5RunsAllowedMean: double("f5RunsAllowedMean"),
  /** Mean full-game runs allowed per start over 3yr sample */
  fgRunsAllowedMean: double("fgRunsAllowedMean"),
  /** Mean innings pitched per start over 3yr sample */
  ipMean3yr: double("ipMean3yr"),
  /** Comma-separated list of seasons included in NRFI sample, e.g. '2024,2025,2026' */
  nrfiSampleSeasons: varchar("nrfiSampleSeasons", { length: 32 }),
  /** Calibration version tag, e.g. '2026-04-14-3yr-v1' */
  nrfiCalibVersion: varchar("nrfiCalibVersion", { length: 32 }),
  /** UTC ms when 3yr NRFI data was last seeded */
  nrfiSeededAt: bigint("nrfiSeededAt", { mode: "number" }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  /** Upsert key: one row per pitcher per team */
  uqPitcherTeam: uniqueIndex("uq_pitcher_team").on(t.mlbamId, t.teamAbbrev),
  /** Name lookup index */
  idxFullName: index("idx_pitcher_full_name").on(t.fullName),
}));
export type MlbPitcherStatRow = typeof mlbPitcherStats.$inferSelect;
export type InsertMlbPitcherStat = typeof mlbPitcherStats.$inferInsert;

// ─── MLB Team Batting Splits (vs LHP / vs RHP) ───────────────────────────────
/**
 * One row per (teamAbbrev, hand) where hand ∈ {'L','R'}.
 * Populated from MLB Stats API statSplits endpoint (sitCodes=vl,vr).
 * Used by mlbModelRunner.ts to adjust expected run scoring based on
 * the opposing starter's throwing hand.
 *
 * Key stats:
 *   avg / obp / slg / ops — slash line vs that pitcher hand
 *   hr9  — home runs per 9 innings (derived: HR / AB * 27)
 *   bb9  — walks per 9 innings
 *   k9   — strikeouts per 9 innings
 *   woba — weighted on-base average (derived from component stats)
 */
export const mlbTeamBattingSplits = mysqlTable("mlb_team_batting_splits", {
  id: int("id").autoincrement().primaryKey(),
  /** Team abbreviation matching TEAM_STATS_2025 keys, e.g. "NYY" */
  teamAbbrev: varchar("teamAbbrev", { length: 8 }).notNull(),
  /** MLB Stats API team ID, e.g. 147 for NYY */
  mlbTeamId: int("mlbTeamId").notNull(),
  /** Pitcher hand faced: 'L' = vs LHP, 'R' = vs RHP */
  hand: varchar("hand", { length: 1 }).notNull(),
  /** Batting average vs this hand */
  avg: double("avg"),
  /** On-base percentage vs this hand */
  obp: double("obp"),
  /** Slugging percentage vs this hand */
  slg: double("slg"),
  /** OPS vs this hand */
  ops: double("ops"),
  /** Home runs hit vs this hand (raw count) */
  homeRuns: int("homeRuns"),
  /** At-bats vs this hand (raw count) */
  atBats: int("atBats"),
  /** Walks vs this hand (raw count) */
  baseOnBalls: int("baseOnBalls"),
  /** Strikeouts vs this hand (raw count) */
  strikeOuts: int("strikeOuts"),
  /** Hits vs this hand (raw count) */
  hits: int("hits"),
  /** Games played vs this hand */
  gamesPlayed: int("gamesPlayed"),
  /** Derived: HR per 9 innings = HR / AB * 27 */
  hr9: double("hr9"),
  /** Derived: BB per 9 innings = BB / AB * 27 */
  bb9: double("bb9"),
  /** Derived: K per 9 innings = K / AB * 27 */
  k9: double("k9"),
  /** Derived: wOBA approximation = (0.69*BB + 0.888*1B + 1.271*2B + 1.616*3B + 2.101*HR) / (AB+BB) */
  woba: double("woba"),
  /** Season runs per game for this team (hand-agnostic, same value for L and R rows).
   *  Computed from MLB Stats API team season stats: R / G.
   *  Replaces the frozen TEAM_STATS_2025.rpg constant. */
  rpg: double("rpg"),
  /** Average innings pitched per game by the starting rotation (hand-agnostic).
   *  Computed from MLB Stats API team pitching stats: IP / G.
   *  Replaces the frozen TEAM_STATS_2025.ip_per_game constant. */
  ipPerGame: double("ipPerGame"),
  /** UTC timestamp (ms) when stats were last fetched */
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  /** Upsert key: one row per team per pitcher hand */
  uqTeamHand: uniqueIndex("uq_team_batting_hand").on(t.teamAbbrev, t.hand),
  /** Index for fast team lookup */
  idxTeamAbbrev: index("idx_batting_splits_team").on(t.teamAbbrev),
}));
export type MlbTeamBattingSplitRow = typeof mlbTeamBattingSplits.$inferSelect;
export type InsertMlbTeamBattingSplit = typeof mlbTeamBattingSplits.$inferInsert;

// ─── MLB Pitcher Rolling Last-5 Starts ───────────────────────────────────────
/**
 * One row per pitcher — rolling stats computed from their last 5 game starts.
 * Populated from MLB Stats API gameLog endpoint, filtered to GS=true.
 * Used by mlbModelRunner.ts to weight recent form (hot/cold starter signal).
 *
 * All per-9-inning rates are computed from the rolling 5-game window:
 *   era5   — earned run average over last 5 starts
 *   k9_5   — strikeouts per 9
 *   bb9_5  — walks per 9
 *   hr9_5  — home runs per 9
 *   whip5  — WHIP over last 5 starts
 *   ip5    — total innings pitched in last 5 starts
 *   fip5   — FIP computed from last 5 starts (3*BB + 13*HR - 2*K) / IP + constant
 */
export const mlbPitcherRolling5 = mysqlTable("mlb_pitcher_rolling5", {
  id: int("id").autoincrement().primaryKey(),
  /** MLB Stats API player ID */
  mlbamId: int("mlbamId").notNull(),
  /** Full name for debugging */
  fullName: varchar("fullName", { length: 128 }).notNull(),
  /** Team abbreviation */
  teamAbbrev: varchar("teamAbbrev", { length: 8 }).notNull(),
  /** Number of starts included in this rolling window (≤5, may be <5 early in season) */
  startsIncluded: int("startsIncluded").notNull(),
  /** Total innings pitched across the window */
  ip5: double("ip5"),
  /** Total earned runs across the window */
  er5: int("er5"),
  /** Total hits across the window */
  h5: int("h5"),
  /** Total walks across the window */
  bb5: int("bb5"),
  /** Total strikeouts across the window */
  k5: int("k5"),
  /** Total home runs across the window */
  hr5: int("hr5"),
  /** Derived: ERA over last 5 starts = ER5 / IP5 * 9 */
  era5: double("era5"),
  /** Derived: K/9 over last 5 starts */
  k9_5: double("k9_5"),
  /** Derived: BB/9 over last 5 starts */
  bb9_5: double("bb9_5"),
  /** Derived: HR/9 over last 5 starts */
  hr9_5: double("hr9_5"),
  /** Derived: WHIP over last 5 starts = (H5 + BB5) / IP5 */
  whip5: double("whip5"),
  /** Derived: FIP over last 5 starts = (13*HR + 3*BB - 2*K) / IP + 3.10 */
  fip5: double("fip5"),
  /** ISO date of the most recent start included, e.g. "2025-09-28" */
  lastStartDate: varchar("lastStartDate", { length: 10 }),
  /** ISO date of the oldest start included in the window */
  firstStartDate: varchar("firstStartDate", { length: 10 }),
  /** UTC timestamp (ms) when this row was last computed */
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  /** Upsert key: one row per pitcher */
  uqPitcherRolling: uniqueIndex("uq_pitcher_rolling5").on(t.mlbamId),
  /** Name lookup */
  idxRollingName: index("idx_rolling5_name").on(t.fullName),
}));
export type MlbPitcherRolling5Row = typeof mlbPitcherRolling5.$inferSelect;
export type InsertMlbPitcherRolling5 = typeof mlbPitcherRolling5.$inferInsert;


// ─────────────────────────────────────────────────────────────────────────────
// MLB PARK FACTORS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * mlbParkFactors — 3-year rolling park run factor per MLB venue (2024/2025/2026).
 *
 * Methodology:
 *   - Fetch all regular-season games per venue for 2024, 2025, 2026
 *     via schedule?hydrate=linescore endpoint
 *   - Sum total runs scored in all completed games at that venue per season
 *   - park_factor_yr = avg_rpg_venue / league_avg_rpg
 *   - 3yr_park_factor = weighted avg (2026*0.50 + 2025*0.30 + 2024*0.20)
 *     Weights normalized to available seasons at seed time.
 */
export const mlbParkFactors = mysqlTable("mlb_park_factors", {
  id: int("id").autoincrement().primaryKey(),
  venueId: int("venueId").notNull(),
  venueName: varchar("venueName", { length: 128 }).notNull(),
  teamAbbrev: varchar("teamAbbrev", { length: 8 }).notNull(),
  runs2024: int("runs2024"),
  games2024: int("games2024"),
  avgRpg2024: double("avgRpg2024"),
  pf2024: double("pf2024"),
  runs2025: int("runs2025"),
  games2025: int("games2025"),
  avgRpg2025: double("avgRpg2025"),
  pf2025: double("pf2025"),
  runs2026: int("runs2026"),
  games2026: int("games2026"),
  avgRpg2026: double("avgRpg2026"),
  pf2026: double("pf2026"),
  parkFactor3yr: double("parkFactor3yr").notNull(),
  /**
   * HR-specific park factor (separate from run-factor).
   * Derived from PARK_FACTORS[team]['hr'] / 100.0 in MLBAIModel.py.
   * e.g. COL=1.28, SF=0.88, CIN=1.15. Neutral=1.00.
   * Used exclusively by the HR Props model (mlbHrPropsModelService.ts).
   */
  hrFactor: double("hrFactor"),
  leagueAvgRpg: double("leagueAvgRpg"),
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uqVenue: uniqueIndex("uq_park_venue").on(t.venueId),
  idxTeam: index("idx_park_team").on(t.teamAbbrev),
}));
export type MlbParkFactorRow = typeof mlbParkFactors.$inferSelect;
export type InsertMlbParkFactor = typeof mlbParkFactors.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// MLB BULLPEN STATS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * mlbBullpenStats — Aggregated relief pitcher stats per MLB team.
 *
 * Methodology:
 *   - Fetch all pitchers per team via stats?group=pitching&season=2025&teamId=X
 *   - Filter: gamesStarted = 0 AND inningsPitched >= 1
 *   - Aggregate ERA, K/9, BB/9, HR/9, WHIP, K/BB, FIP across all relievers
 */
export const mlbBullpenStats = mysqlTable("mlb_bullpen_stats", {
  id: int("id").autoincrement().primaryKey(),
  teamAbbrev: varchar("teamAbbrev", { length: 8 }).notNull(),
  mlbTeamId: int("mlbTeamId").notNull(),
  season: int("season").notNull(),
  relieverCount: int("relieverCount").notNull(),
  totalIp: double("totalIp").notNull(),
  totalEr: int("totalEr"),
  totalK: int("totalK"),
  totalBb: int("totalBb"),
  totalHr: int("totalHr"),
  totalH: int("totalH"),
  eraBullpen: double("eraBullpen"),
  k9Bullpen: double("k9Bullpen"),
  bb9Bullpen: double("bb9Bullpen"),
  hr9Bullpen: double("hr9Bullpen"),
  whipBullpen: double("whipBullpen"),
  kBbRatio: double("kBbRatio"),
  fipBullpen: double("fipBullpen"),
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uqTeamSeason: uniqueIndex("uq_bullpen_team_season").on(t.teamAbbrev, t.season),
  idxTeam: index("idx_bullpen_team").on(t.teamAbbrev),
}));
export type MlbBullpenStatsRow = typeof mlbBullpenStats.$inferSelect;
export type InsertMlbBullpenStats = typeof mlbBullpenStats.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// MLB UMPIRE MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * mlbUmpireModifiers — Per-umpire K and BB rate modifiers from 2023/2024/2025.
 *
 * Methodology:
 *   - For each completed game, fetch boxscore: HP umpire ID + total K + total BB + total H
 *   - Accumulate per umpire across all games in 2023/2024/2025
 *   - k_rate = totalK / (totalK + totalBb + totalH)
 *   - k_modifier = umpire_k_rate / league_avg_k_rate
 *   - Applied in engine: effective_k_pct = pitcher_k_pct * k_modifier
 */
export const mlbUmpireModifiers = mysqlTable("mlb_umpire_modifiers", {
  id: int("id").autoincrement().primaryKey(),
  umpireId: int("umpireId").notNull(),
  umpireName: varchar("umpireName", { length: 128 }).notNull(),
  gamesHp: int("gamesHp").notNull(),
  totalK: int("totalK").notNull(),
  totalBb: int("totalBb").notNull(),
  totalH: int("totalH"),
  totalR: int("totalR"),
  kRate: double("kRate"),
  bbRate: double("bbRate"),
  kModifier: double("kModifier"),
  bbModifier: double("bbModifier"),
  seasonsIncluded: varchar("seasonsIncluded", { length: 32 }),
  lastFetchedAt: bigint("lastFetchedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uqUmpire: uniqueIndex("uq_umpire_id").on(t.umpireId),
  idxName: index("idx_umpire_name").on(t.umpireName),
}));
export type MlbUmpireModifierRow = typeof mlbUmpireModifiers.$inferSelect;
export type InsertMlbUmpireModifier = typeof mlbUmpireModifiers.$inferInsert;

// ─── MLB HR Props (per-batter, from Action Network) ─────────────────────────
/**
 * One row per (game, player) for HR props.
 * Populated from Action Network HR props page (FanDuel NJ as primary book).
 * Backtested after game FINAL.
 */
export const mlbHrProps = mysqlTable("mlb_hr_props", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull(),
  /** 'away' | 'home' */
  side: varchar("side", { length: 8 }).notNull(),
  /** Player full name, e.g. "Aaron Judge" */
  playerName: varchar("playerName", { length: 128 }).notNull(),
  /** MLBAM player ID */
  mlbamId: int("mlbamId"),
  /** Action Network player ID */
  anPlayerId: int("anPlayerId"),
  /** Team abbreviation, e.g. "NYY" */
  teamAbbrev: varchar("teamAbbrev", { length: 8 }),
  /** Book HR prop line (always 0.5 for To Hit A HR) */
  bookLine: decimal("bookLine", { precision: 4, scale: 1 }).default("0.5"),
  /** FanDuel NJ over (hit HR) odds, e.g. "+280" */
  fdOverOdds: varchar("fdOverOdds", { length: 16 }),
  /** FanDuel NJ under (no HR) odds, e.g. "-380" */
  fdUnderOdds: varchar("fdUnderOdds", { length: 16 }),
  /** Consensus over odds across books, e.g. "+270" */
  consensusOverOdds: varchar("consensusOverOdds", { length: 16 }),
  /** Consensus under odds across books, e.g. "-350" */
  consensusUnderOdds: varchar("consensusUnderOdds", { length: 16 }),
  /** Action Network no-vig over probability (decimal, e.g. "0.265") */
  anNoVigOverPct: varchar("anNoVigOverPct", { length: 16 }),
  /** Model P(player hits ≥1 HR) from MLBAIModel.py (decimal, e.g. "0.241") */
  modelPHr: varchar("modelPHr", { length: 16 }),
  /** Model fair value odds for over (hit HR), e.g. "+315" */
  modelOverOdds: varchar("modelOverOdds", { length: 16 }),
  /** Edge on over (model - book no-vig), decimal string, e.g. "+0.023" */
  edgeOver: varchar("edgeOver", { length: 16 }),
  /** EV on over at FD odds: edge * (1/book_p - 1) * 100 */
  evOver: varchar("evOver", { length: 16 }),
  /** Best verdict: 'OVER' | 'UNDER' | 'PASS' */
  verdict: varchar("verdict", { length: 16 }),
  /** Actual result: 1 = hit HR, 0 = no HR, null = pending */
  actualHr: tinyint("actualHr"),
  /** Backtest result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' | 'NO_LINE' */
  backtestResult: varchar("backtestResult", { length: 16 }),
  /** Model prediction correct: 1=yes 0=no null=pending */
  modelCorrect: tinyint("modelCorrect"),
  /** UTC ms when model was run */
  modelRunAt: bigint("modelRunAt", { mode: "number" }),
  /** UTC ms when backtest was last run */
  backtestRunAt: bigint("backtestRunAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  /** One row per (game, player) */
  uqGamePlayer: uniqueIndex("uq_hr_game_player").on(t.gameId, t.playerName),
  idxGame: index("idx_hr_game").on(t.gameId),
  idxMlbam: index("idx_hr_mlbam").on(t.mlbamId),
}));
export type MlbHrPropRow = typeof mlbHrProps.$inferSelect;
export type InsertMlbHrProp = typeof mlbHrProps.$inferInsert;

// ─── MLB Game Backtest Log (per-game, per-market performance tracking) ───────
/**
 * One row per (game, market) — the authoritative backtest performance log.
 * Used by the automated learning layer for drift detection and recalibration.
 * Markets: 'FG_ML' | 'FG_RL' | 'FG_TOTAL' | 'F5_ML' | 'F5_RL' | 'F5_TOTAL' |
 *           'NRFI' | 'K_PROPS' | 'HR_PROPS'
 */
export const mlbGameBacktest = mysqlTable("mlb_game_backtest", {
  id: int("id").autoincrement().primaryKey(),
  /** FK → games.id */
  gameId: int("gameId").notNull(),
  /** Game date string YYYY-MM-DD */
  gameDate: varchar("gameDate", { length: 10 }).notNull(),
  /** Market identifier */
  market: varchar("market", { length: 16 }).notNull(),
  /** Model prediction side: 'AWAY' | 'HOME' | 'OVER' | 'UNDER' | 'NRFI' | 'YRFI' */
  modelSide: varchar("modelSide", { length: 8 }),
  /** Model probability for the predicted side (0-100) */
  modelProb: decimal("modelProb", { precision: 5, scale: 2 }),
  /** Book line used for evaluation, e.g. "1.5" or "8.5" */
  bookLine: varchar("bookLine", { length: 16 }),
  /** Book odds for the model side (American), e.g. "-138" */
  bookOdds: varchar("bookOdds", { length: 16 }),
  /** Book no-vig probability for model side (decimal, e.g. "0.572") */
  bookNoVigProb: decimal("bookNoVigProb", { precision: 5, scale: 4 }),
  /** Edge: model_prob - book_no_vig_prob (decimal, e.g. "0.043") */
  edge: decimal("edge", { precision: 5, scale: 4 }),
  /** Expected value: edge * (1/book_p - 1) * 100 */
  ev: decimal("ev", { precision: 6, scale: 2 }),
  /** Confidence gate passed: 1=yes 0=no */
  confidencePassed: tinyint("confidencePassed"),
  /** Actual outcome: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING' */
  result: varchar("result", { length: 16 }),
  /** Model correct: 1=yes 0=no null=pending */
  correct: tinyint("correct"),
  /** Away team final score (for context) */
  actualAwayScore: int("actualAwayScore"),
  /** Home team final score (for context) */
  actualHomeScore: int("actualHomeScore"),
  /** Away pitcher (for context) */
  awayPitcher: varchar("awayPitcher", { length: 128 }),
  /** Home pitcher (for context) */
  homePitcher: varchar("homePitcher", { length: 128 }),
  /** UTC ms when backtest was run */
  backtestRunAt: bigint("backtestRunAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  /** One row per (game, market) */
  uqGameMarket: uniqueIndex("uq_backtest_game_market").on(t.gameId, t.market),
  idxDate: index("idx_backtest_date").on(t.gameDate),
  idxMarket: index("idx_backtest_market").on(t.market),
  idxResult: index("idx_backtest_result").on(t.result),
}));
export type MlbGameBacktestRow = typeof mlbGameBacktest.$inferSelect;
export type InsertMlbGameBacktest = typeof mlbGameBacktest.$inferInsert;

// ─── MLB Model Learning Log (automated recalibration history) ────────────────
/**
 * One row per recalibration event.
 * Tracks which parameters were adjusted, why, and what the rolling accuracy was.
 */
export const mlbModelLearningLog = mysqlTable("mlb_model_learning_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Market that triggered recalibration */
  market: varchar("market", { length: 16 }).notNull(),
  /** Rolling window size used (e.g. 14 = last 14 days) */
  windowDays: int("windowDays").notNull(),
  /** Rolling accuracy before recalibration (0-1) */
  accuracyBefore: decimal("accuracyBefore", { precision: 5, scale: 4 }),
  /** Rolling accuracy after recalibration (0-1) */
  accuracyAfter: decimal("accuracyAfter", { precision: 5, scale: 4 }),
  /** Mean absolute error before recalibration */
  maeBefore: decimal("maeBefore", { precision: 6, scale: 4 }),
  /** Mean absolute error after recalibration */
  maeAfter: decimal("maeAfter", { precision: 6, scale: 4 }),
  /** JSON: { param: string, oldValue: number, newValue: number }[] */
  paramChanges: text("paramChanges"),
  /** Trigger reason: 'DRIFT_DETECTED' | 'SCHEDULED' | 'MANUAL' */
  triggerReason: varchar("triggerReason", { length: 32 }),
  /** Number of games in the rolling window */
  sampleSize: int("sampleSize"),
  /** UTC ms when recalibration ran */
  runAt: bigint("runAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxMarket: index("idx_learning_market").on(t.market),
  idxRunAt: index("idx_learning_run_at").on(t.runAt),
}));
export type MlbModelLearningLogRow = typeof mlbModelLearningLog.$inferSelect;
export type InsertMlbModelLearningLog = typeof mlbModelLearningLog.$inferInsert;

// ─── MLB Drift State (rolling metric state per market) ───────────────────────
/**
 * Persists the live drift detection state across scheduler runs.
 * One row per market — upserted on every drift check.
 * Markets: 'F5_SHARE' | 'FG_ML' | 'FG_TOTAL' | 'F5_ML' | 'F5_TOTAL' | 'NRFI' | 'K_PROPS' | 'HR_PROPS'
 */
export const mlbDriftState = mysqlTable("mlb_drift_state", {
  id: int("id").autoincrement().primaryKey(),
  /** Market identifier, e.g. 'F5_SHARE', 'FG_ML', 'NRFI' */
  market: varchar("market", { length: 32 }).notNull(),
  /** Rolling window size used (games) */
  windowSize: int("windowSize").notNull().default(50),
  /** Rolling metric value (f5_share, accuracy, etc.) */
  rollingValue: decimal("rollingValue", { precision: 8, scale: 6 }),
  /** Baseline value (calibrated constant) */
  baselineValue: decimal("baselineValue", { precision: 8, scale: 6 }),
  /** Absolute delta: |rolling - baseline| */
  delta: decimal("delta", { precision: 8, scale: 6 }),
  /** Direction of drift: 'HIGH' | 'LOW' | 'STABLE' */
  direction: varchar("direction", { length: 8 }),
  /** Whether drift was detected on last check: 1=yes 0=no */
  driftDetected: tinyint("driftDetected").default(0),
  /** Number of games in the rolling window */
  sampleSize: int("sampleSize"),
  /** UTC ms of last drift check */
  lastCheckedAt: bigint("lastCheckedAt", { mode: "number" }),
  /** UTC ms of last recalibration triggered by this market */
  lastRecalibrationAt: bigint("lastRecalibrationAt", { mode: "number" }),
  /** Number of consecutive drift detections (resets on recalibration) */
  consecutiveDriftCount: int("consecutiveDriftCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  uqMarket: uniqueIndex("uq_drift_market").on(t.market),
}));
export type MlbDriftStateRow = typeof mlbDriftState.$inferSelect;
export type InsertMlbDriftState = typeof mlbDriftState.$inferInsert;

// ─── MLB Calibration Constants (live model parameter store) ──────────────────
/**
 * Persists live calibration constants for each model component.
 * One row per parameter — upserted by the recalibration pipeline.
 * Examples: f5_share, nrfi_rate, k_calibration_factor, hr_base_rate
 */
export const mlbCalibrationConstants = mysqlTable("mlb_calibration_constants", {
  id: int("id").autoincrement().primaryKey(),
  /** Parameter name, e.g. 'f5_share', 'nrfi_rate', 'k_calibration_factor' */
  paramName: varchar("paramName", { length: 64 }).notNull(),
  /** Current live value (decimal string for precision) */
  currentValue: decimal("currentValue", { precision: 12, scale: 8 }).notNull(),
  /** Baseline value at last manual calibration */
  baselineValue: decimal("baselineValue", { precision: 12, scale: 8 }),
  /** Previous value before last recalibration */
  previousValue: decimal("previousValue", { precision: 12, scale: 8 }),
  /** Sample size used to compute current value */
  sampleSize: int("sampleSize"),
  /** Confidence interval lower bound (95%) */
  ciLower: decimal("ciLower", { precision: 12, scale: 8 }),
  /** Confidence interval upper bound (95%) */
  ciUpper: decimal("ciUpper", { precision: 12, scale: 8 }),
  /** Source of last update: 'AUTO_RECAL' | 'MANUAL' | 'INIT' */
  updateSource: varchar("updateSource", { length: 16 }).default("INIT"),
  /** UTC ms of last update */
  lastUpdatedAt: bigint("lastUpdatedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  uqParam: uniqueIndex("uq_cal_param").on(t.paramName),
  idxUpdated: index("idx_cal_updated").on(t.lastUpdatedAt),
}));
export type MlbCalibrationConstantRow = typeof mlbCalibrationConstants.$inferSelect;
export type InsertMlbCalibrationConstant = typeof mlbCalibrationConstants.$inferInsert;

// ─── Security Events (CSRF blocks, auth anomalies) ───────────────────────────
/**
 * One row per security event detected by server-side middleware.
 *
 * Event types:
 *   CSRF_BLOCK   — Origin header mismatch on a tRPC mutation
 *   RATE_LIMIT   — Rate limiter triggered (too many requests from one IP)
 *   AUTH_FAIL    — Authentication failure (invalid token, expired session)
 *
 * Retention: rows older than 90 days can be pruned by a scheduled job.
 * Access: owner-only — no user-facing queries.
 */
export const securityEvents = mysqlTable("security_events", {
  id: int("id").autoincrement().primaryKey(),
  /** Event category: 'CSRF_BLOCK' | 'RATE_LIMIT' | 'AUTH_FAIL' */
  eventType: varchar("eventType", { length: 32 }).notNull(),
  /** Attacker/client IP address (IPv4 or IPv6) */
  ip: varchar("ip", { length: 64 }).notNull(),
  /** Blocked Origin header value (null for non-CSRF events) */
  blockedOrigin: varchar("blockedOrigin", { length: 512 }),
  /** tRPC procedure path that was blocked (e.g. 'appUsers.login') */
  trpcPath: varchar("trpcPath", { length: 256 }),
  /** HTTP method (POST, GET, etc.) */
  httpMethod: varchar("httpMethod", { length: 16 }),
  /** User agent string (truncated to 512 chars) */
  userAgent: varchar("userAgent", { length: 512 }),
  /** Additional context as JSON string (flexible per event type) */
  context: text("context"),
  /** UTC milliseconds timestamp of the event */
  occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxEventType: index("idx_sec_event_type").on(t.eventType),
  idxIp: index("idx_sec_event_ip").on(t.ip),
  idxOccurredAt: index("idx_sec_event_occurred_at").on(t.occurredAt),
}));

export type SecurityEventRow = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;

// ─── User Sessions (DAU / MAU / WAU / avg session duration tracking) ─────────
/**
 * One row per user session. A session starts on login and ends when the user
 * logs out or when the heartbeat stops for > 30 min (SESSION_IDLE_THRESHOLD_MS).
 *
 * Fields:
 *   startedAt     — UTC ms when the session began (login event)
 *   endedAt       — UTC ms when the session ended; NULL = still active
 *   durationMs    — Computed on close: endedAt - startedAt; NULL while active
 *   lastHeartbeat — UTC ms of the most recent client ping (every 5 min)
 *
 * Indexes:
 *   idx_sess_user_id    — fast per-user queries
 *   idx_sess_started_at — fast time-window aggregations (DAU/MAU/WAU)
 *   idx_sess_ended_at   — fast active-session queries (WHERE endedAt IS NULL)
 */
export const userSessions = mysqlTable("user_sessions", {
  id:            int("id").autoincrement().primaryKey(),
  /** app_users.id of the user who owns this session */
  userId:        int("userId").notNull(),
  /** UTC ms when the session started */
  startedAt:     bigint("startedAt", { mode: "number" }).notNull(),
  /** UTC ms when the session ended; NULL = session still active */
  endedAt:       bigint("endedAt",   { mode: "number" }),
  /** Duration in ms (endedAt - startedAt); NULL while active */
  durationMs:    bigint("durationMs", { mode: "number" }),
  /** UTC ms of the most recent heartbeat ping from the client */
  lastHeartbeat: bigint("lastHeartbeat", { mode: "number" }),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxUserId:    index("idx_sess_user_id").on(t.userId),
  idxStartedAt: index("idx_sess_started_at").on(t.startedAt),
  idxEndedAt:   index("idx_sess_ended_at").on(t.endedAt),
}));
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof userSessions.$inferInsert;

// ─── MLB Schedule History (Action Network DK NJ odds + results per game) ─────
/**
 * One row per MLB game, populated from the Action Network v2 API using
 * DraftKings NJ (book_id=68) as the sole odds source.
 *
 * Purpose:
 *   - Powers the "Last 5 Games" panel on each MLB matchup card
 *   - Powers the full Team Schedule page for every MLB team
 *   - Stores pre-game DK NJ run line / total / moneyline odds
 *   - Stores final scores and derived result columns (covered/won/O-U)
 *
 * Result derivation (computed when status='complete'):
 *   awayRunLineCovered  — true if away team covered the run line
 *   homeRunLineCovered  — true if home team covered the run line
 *   totalResult         — 'OVER' | 'UNDER' | 'PUSH' based on final score vs dkTotal
 *   awayWon             — true if away team won outright
 *
 * Deduplication key: anGameId (Action Network internal game ID)
 */
export const mlbScheduleHistory = mysqlTable("mlb_schedule_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Action Network internal game ID — primary deduplication key */
  anGameId: int("anGameId").notNull().unique(),
  /** Game date in YYYY-MM-DD format (EST) */
  gameDate: varchar("gameDate", { length: 10 }).notNull(),
  /** Game start time as ISO 8601 UTC string from AN API */
  startTimeUtc: varchar("startTimeUtc", { length: 32 }).notNull(),
  /** Game status: 'scheduled' | 'inprogress' | 'complete' */
  gameStatus: varchar("gameStatus", { length: 16 }).notNull().default("scheduled"),
  // ─── Away Team ──────────────────────────────────────────────────────────────
  /** Away team Action Network URL slug, e.g. "arizona-diamondbacks" */
  awaySlug: varchar("awaySlug", { length: 128 }).notNull(),
  /** Away team abbreviation from AN, e.g. "ARI" */
  awayAbbr: varchar("awayAbbr", { length: 8 }).notNull(),
  /** Away team full name from AN, e.g. "Arizona Diamondbacks" */
  awayName: varchar("awayName", { length: 128 }).notNull(),
  /** Away team Action Network numeric ID */
  awayTeamId: int("awayTeamId").notNull(),
  /** Away team final score (null = game not yet final) */
  awayScore: int("awayScore"),
  // ─── Home Team ──────────────────────────────────────────────────────────────
  /** Home team Action Network URL slug, e.g. "philadelphia-phillies" */
  homeSlug: varchar("homeSlug", { length: 128 }).notNull(),
  /** Home team abbreviation from AN, e.g. "PHI" */
  homeAbbr: varchar("homeAbbr", { length: 8 }).notNull(),
  /** Home team full name from AN, e.g. "Philadelphia Phillies" */
  homeName: varchar("homeName", { length: 128 }).notNull(),
  /** Home team Action Network numeric ID */
  homeTeamId: int("homeTeamId").notNull(),
  /** Home team final score (null = game not yet final) */
  homeScore: int("homeScore"),
  // ─── DK NJ Pre-Game Odds (book_id=68, is_live=false) ────────────────────────
  /** DK NJ away run line spread, e.g. 1.5 (positive = underdog) */
  dkAwayRunLine: decimal("dkAwayRunLine", { precision: 4, scale: 1 }),
  /** DK NJ away run line juice in American format, e.g. "-144" */
  dkAwayRunLineOdds: varchar("dkAwayRunLineOdds", { length: 16 }),
  /** DK NJ home run line spread, e.g. -1.5 */
  dkHomeRunLine: decimal("dkHomeRunLine", { precision: 4, scale: 1 }),
  /** DK NJ home run line juice in American format, e.g. "+119" */
  dkHomeRunLineOdds: varchar("dkHomeRunLineOdds", { length: 16 }),
  /** DK NJ game total (over line), e.g. 8.5 */
  dkTotal: decimal("dkTotal", { precision: 5, scale: 1 }),
  /** DK NJ over juice in American format, e.g. "-112" */
  dkOverOdds: varchar("dkOverOdds", { length: 16 }),
  /** DK NJ under juice in American format, e.g. "-108" */
  dkUnderOdds: varchar("dkUnderOdds", { length: 16 }),
  /** DK NJ away team moneyline in American format, e.g. "+153" */
  dkAwayML: varchar("dkAwayML", { length: 16 }),
  /** DK NJ home team moneyline in American format, e.g. "-186" */
  dkHomeML: varchar("dkHomeML", { length: 16 }),
  // ─── DK NJ Closing Odds (captured at first pitch / game start) ─────────────────
  /** DK NJ closing away run line spread captured at game start, e.g. -1.5 */
  dkClosingAwayRunLine: decimal("dkClosingAwayRunLine", { precision: 4, scale: 1 }),
  /** DK NJ closing away run line juice in American format, e.g. "-144" */
  dkClosingAwayRunLineOdds: varchar("dkClosingAwayRunLineOdds", { length: 16 }),
  /** DK NJ closing home run line spread captured at game start, e.g. +1.5 */
  dkClosingHomeRunLine: decimal("dkClosingHomeRunLine", { precision: 4, scale: 1 }),
  /** DK NJ closing home run line juice in American format, e.g. "+119" */
  dkClosingHomeRunLineOdds: varchar("dkClosingHomeRunLineOdds", { length: 16 }),
  /** DK NJ closing game total captured at game start, e.g. 8.5 */
  dkClosingTotal: decimal("dkClosingTotal", { precision: 5, scale: 1 }),
  /** DK NJ closing over juice in American format, e.g. "-112" */
  dkClosingOverOdds: varchar("dkClosingOverOdds", { length: 16 }),
  /** DK NJ closing under juice in American format, e.g. "-108" */
  dkClosingUnderOdds: varchar("dkClosingUnderOdds", { length: 16 }),
  /** DK NJ closing away moneyline in American format, e.g. "+153" */
  dkClosingAwayML: varchar("dkClosingAwayML", { length: 16 }),
  /** DK NJ closing home moneyline in American format, e.g. "-186" */
  dkClosingHomeML: varchar("dkClosingHomeML", { length: 16 }),
  /** UTC ms timestamp when closing lines were locked (first pitch detected) */
  closingLineLockedAt: bigint("closingLineLockedAt", { mode: "number" }),
  // ─── Derived Result Columns (populated after game is complete) ───────────────
  /** true = away team covered the run line; false = did not cover; null = game not final or no line */
  awayRunLineCovered: boolean("awayRunLineCovered"),
  /** true = home team covered the run line; false = did not cover; null = game not final or no line */
  homeRunLineCovered: boolean("homeRunLineCovered"),
  /** 'OVER' | 'UNDER' | 'PUSH' — based on final combined score vs dkTotal; null = game not final or no total */
  totalResult: varchar("totalResult", { length: 8 }),
  /** true = away team won outright; false = home team won; null = game not final */
  awayWon: boolean("awayWon"),
  /** UTC ms timestamp of the last data refresh for this row */
  lastRefreshedAt: bigint("lastRefreshedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxAnGameId:   index("idx_msh_an_game_id").on(t.anGameId),
  idxGameDate:   index("idx_msh_game_date").on(t.gameDate),
  idxAwaySlug:   index("idx_msh_away_slug").on(t.awaySlug),
  idxHomeSlug:   index("idx_msh_home_slug").on(t.homeSlug),
  idxGameStatus: index("idx_msh_game_status").on(t.gameStatus),
}));
export type MlbScheduleHistoryRow = typeof mlbScheduleHistory.$inferSelect;
export type InsertMlbScheduleHistory = typeof mlbScheduleHistory.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// NBA SCHEDULE HISTORY
// Stores every NBA game with DK NJ pre-game odds (spread, total, moneyline)
// and derived result columns (covered, O/U, won) for Recent Schedule and
// Situational Results panels. Source: Action Network v2 API, book_id=68.
// ═══════════════════════════════════════════════════════════════════════════════
export const nbaScheduleHistory = mysqlTable("nba_schedule_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Action Network internal game ID — primary deduplication key */
  anGameId: int("anGameId").notNull().unique(),
  /** Game date in YYYY-MM-DD format (EST) */
  gameDate: varchar("gameDate", { length: 10 }).notNull(),
  /** Game start time as ISO 8601 UTC string from AN API */
  startTimeUtc: varchar("startTimeUtc", { length: 32 }).notNull(),
  /** Game status: 'scheduled' | 'inprogress' | 'complete' */
  gameStatus: varchar("gameStatus", { length: 16 }).notNull().default("scheduled"),
  // ─── Away Team ──────────────────────────────────────────────────────────────
  /** Away team Action Network URL slug, e.g. "boston-celtics" */
  awaySlug: varchar("awaySlug", { length: 128 }).notNull(),
  /** Away team abbreviation from AN, e.g. "BOS" */
  awayAbbr: varchar("awayAbbr", { length: 8 }).notNull(),
  /** Away team full name from AN, e.g. "Boston Celtics" */
  awayName: varchar("awayName", { length: 128 }).notNull(),
  /** Away team Action Network numeric ID */
  awayTeamId: int("awayTeamId").notNull(),
  /** Away team final score (null = game not yet final) */
  awayScore: int("awayScore"),
  // ─── Home Team ──────────────────────────────────────────────────────────────
  /** Home team Action Network URL slug, e.g. "los-angeles-lakers" */
  homeSlug: varchar("homeSlug", { length: 128 }).notNull(),
  /** Home team abbreviation from AN, e.g. "LAL" */
  homeAbbr: varchar("homeAbbr", { length: 8 }).notNull(),
  /** Home team full name from AN, e.g. "Los Angeles Lakers" */
  homeName: varchar("homeName", { length: 128 }).notNull(),
  /** Home team Action Network numeric ID */
  homeTeamId: int("homeTeamId").notNull(),
  /** Home team final score (null = game not yet final) */
  homeScore: int("homeScore"),
  // ─── DK NJ Pre-Game Odds (book_id=68, is_live=false) ────────────────────────
  /** DK NJ away spread value, e.g. 11.5 (positive = underdog) */
  dkAwaySpread: decimal("dkAwaySpread", { precision: 5, scale: 1 }),
  /** DK NJ away spread juice in American format, e.g. "-108" */
  dkAwaySpreadOdds: varchar("dkAwaySpreadOdds", { length: 16 }),
  /** DK NJ home spread value, e.g. -11.5 */
  dkHomeSpread: decimal("dkHomeSpread", { precision: 5, scale: 1 }),
  /** DK NJ home spread juice in American format, e.g. "-112" */
  dkHomeSpreadOdds: varchar("dkHomeSpreadOdds", { length: 16 }),
  /** DK NJ game total (over line), e.g. 233.5 */
  dkTotal: decimal("dkTotal", { precision: 6, scale: 1 }),
  /** DK NJ over juice in American format, e.g. "-105" */
  dkOverOdds: varchar("dkOverOdds", { length: 16 }),
  /** DK NJ under juice in American format, e.g. "-115" */
  dkUnderOdds: varchar("dkUnderOdds", { length: 16 }),
  /** DK NJ away team moneyline in American format, e.g. "+360" */
  dkAwayML: varchar("dkAwayML", { length: 16 }),
  /** DK NJ home team moneyline in American format, e.g. "-470" */
  dkHomeML: varchar("dkHomeML", { length: 16 }),
  // ─── Derived Result Columns (populated after game is complete) ───────────────
  /** true = away team covered the spread; false = did not cover; null = not final or no line */
  awaySpreadCovered: boolean("awaySpreadCovered"),
  /** true = home team covered the spread; false = did not cover; null = not final or no line */
  homeSpreadCovered: boolean("homeSpreadCovered"),
  /** 'OVER' | 'UNDER' | 'PUSH' — based on final combined score vs dkTotal */
  totalResult: varchar("totalResult", { length: 8 }),
  /** true = away team won outright; false = home team won; null = not final */
  awayWon: boolean("awayWon"),
  /** UTC ms timestamp of the last data refresh for this row */
  lastRefreshedAt: bigint("lastRefreshedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxAnGameId:   index("idx_nbash_an_game_id").on(t.anGameId),
  idxGameDate:   index("idx_nbash_game_date").on(t.gameDate),
  idxAwaySlug:   index("idx_nbash_away_slug").on(t.awaySlug),
  idxHomeSlug:   index("idx_nbash_home_slug").on(t.homeSlug),
  idxGameStatus: index("idx_nbash_game_status").on(t.gameStatus),
}));
export type NbaScheduleHistoryRow = typeof nbaScheduleHistory.$inferSelect;
export type InsertNbaScheduleHistory = typeof nbaScheduleHistory.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// NHL SCHEDULE HISTORY
// Stores every NHL game with DK NJ pre-game odds (puck line, total, moneyline)
// and derived result columns for Recent Schedule and Situational Results panels.
// Source: Action Network v2 API, book_id=68.
// ═══════════════════════════════════════════════════════════════════════════════
export const nhlScheduleHistory = mysqlTable("nhl_schedule_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Action Network internal game ID — primary deduplication key */
  anGameId: int("anGameId").notNull().unique(),
  /** Game date in YYYY-MM-DD format (EST) */
  gameDate: varchar("gameDate", { length: 10 }).notNull(),
  /** Game start time as ISO 8601 UTC string from AN API */
  startTimeUtc: varchar("startTimeUtc", { length: 32 }).notNull(),
  /** Game status: 'scheduled' | 'inprogress' | 'complete' */
  gameStatus: varchar("gameStatus", { length: 16 }).notNull().default("scheduled"),
  // ─── Away Team ──────────────────────────────────────────────────────────────
  /** Away team Action Network URL slug, e.g. "boston-bruins" */
  awaySlug: varchar("awaySlug", { length: 128 }).notNull(),
  /** Away team abbreviation from AN, e.g. "BOS" */
  awayAbbr: varchar("awayAbbr", { length: 8 }).notNull(),
  /** Away team full name from AN, e.g. "Boston Bruins" */
  awayName: varchar("awayName", { length: 128 }).notNull(),
  /** Away team Action Network numeric ID */
  awayTeamId: int("awayTeamId").notNull(),
  /** Away team final score (null = game not yet final) */
  awayScore: int("awayScore"),
  // ─── Home Team ──────────────────────────────────────────────────────────────
  /** Home team Action Network URL slug, e.g. "toronto-maple-leafs" */
  homeSlug: varchar("homeSlug", { length: 128 }).notNull(),
  /** Home team abbreviation from AN, e.g. "TOR" */
  homeAbbr: varchar("homeAbbr", { length: 8 }).notNull(),
  /** Home team full name from AN, e.g. "Toronto Maple Leafs" */
  homeName: varchar("homeName", { length: 128 }).notNull(),
  /** Home team Action Network numeric ID */
  homeTeamId: int("homeTeamId").notNull(),
  /** Home team final score (null = game not yet final) */
  homeScore: int("homeScore"),
  // ─── DK NJ Pre-Game Odds (book_id=68, is_live=false) ────────────────────────
  /** DK NJ away puck line value, e.g. 1.5 (positive = underdog) */
  dkAwayPuckLine: decimal("dkAwayPuckLine", { precision: 4, scale: 1 }),
  /** DK NJ away puck line juice in American format, e.g. "+150" */
  dkAwayPuckLineOdds: varchar("dkAwayPuckLineOdds", { length: 16 }),
  /** DK NJ home puck line value, e.g. -1.5 */
  dkHomePuckLine: decimal("dkHomePuckLine", { precision: 4, scale: 1 }),
  /** DK NJ home puck line juice in American format, e.g. "-180" */
  dkHomePuckLineOdds: varchar("dkHomePuckLineOdds", { length: 16 }),
  /** DK NJ game total (over line), e.g. 6.5 */
  dkTotal: decimal("dkTotal", { precision: 5, scale: 1 }),
  /** DK NJ over juice in American format, e.g. "-102" */
  dkOverOdds: varchar("dkOverOdds", { length: 16 }),
  /** DK NJ under juice in American format, e.g. "-118" */
  dkUnderOdds: varchar("dkUnderOdds", { length: 16 }),
  /** DK NJ away team moneyline in American format, e.g. "-135" */
  dkAwayML: varchar("dkAwayML", { length: 16 }),
  /** DK NJ home team moneyline in American format, e.g. "+115" */
  dkHomeML: varchar("dkHomeML", { length: 16 }),
  // ─── Derived Result Columns (populated after game is complete) ───────────────
  /** true = away team covered the puck line; false = did not cover; null = not final or no line */
  awayPuckLineCovered: boolean("awayPuckLineCovered"),
  /** true = home team covered the puck line; false = did not cover; null = not final or no line */
  homePuckLineCovered: boolean("homePuckLineCovered"),
  /** 'OVER' | 'UNDER' | 'PUSH' — based on final combined score vs dkTotal */
  totalResult: varchar("totalResult", { length: 8 }),
  /** true = away team won outright; false = home team won; null = not final */
  awayWon: boolean("awayWon"),
  /** UTC ms timestamp of the last data refresh for this row */
  lastRefreshedAt: bigint("lastRefreshedAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  idxAnGameId:   index("idx_nhlsh_an_game_id").on(t.anGameId),
  idxGameDate:   index("idx_nhlsh_game_date").on(t.gameDate),
  idxAwaySlug:   index("idx_nhlsh_away_slug").on(t.awaySlug),
  idxHomeSlug:   index("idx_nhlsh_home_slug").on(t.homeSlug),
  idxGameStatus: index("idx_nhlsh_game_status").on(t.gameStatus),
}));
export type NhlScheduleHistoryRow = typeof nhlScheduleHistory.$inferSelect;
export type InsertNhlScheduleHistory = typeof nhlScheduleHistory.$inferInsert;

// ─── Tracked Bets (Bet Tracker — OWNER/ADMIN/HANDICAPPER only) ───────────────

export const trackedBets = mysqlTable("tracked_bets", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to app_users.id — the user who placed/tracked this bet */
  userId: int("userId").notNull(),
  /** FK to games.id — the game this bet is on (null for manual/future bets) */
  gameId: int("gameId"),
  /** Action Network game id — links to AN scoreboard for slate display */
  anGameId: int("anGameId"),
  /**
   * Doubleheader game number: 1 = G1, 2 = G2.
   * Null/1 for non-doubleheader games or legacy bets created before this field was added.
   * Used to resolve the correct linescore when two games share the same away+home+date.
   * G1/G2 is determined by chronological start time (NOT gamePk order).
   * NOTE: gamePk order does NOT reliably match chronological order
   * (e.g. SF@PHI 2026-04-30: gamePk=823471 starts 21:35Z but gamePk=823472 starts 16:35Z).
   */
  gameNumber: int("gameNumber").default(1),
  /**
   * Timeframe of the bet:
   *   FULL_GAME    = Full game (default)
   *   FIRST_5      = First 5 innings (MLB)
   *   FIRST_INNING = First inning (MLB)
   */
  timeframe: mysqlEnum("timeframe", [
    "FULL_GAME",
    "FIRST_5",
    "FIRST_INNING",
    "NRFI",
    "YRFI",
    "REGULATION",
    "FIRST_PERIOD",
    "FIRST_HALF",
    "FIRST_QUARTER",
  ])
    .notNull()
    .default("FULL_GAME"),
  /**
   * Market of the bet:
   *   ML    = Moneyline
   *   RL    = Run Line / Puck Line / Spread
   *   TOTAL = Total (Over/Under)
   */
  market: mysqlEnum("market", ["ML", "RL", "TOTAL"])
    .notNull()
    .default("ML"),
  /**
   * Pick side:
   *   AWAY = Away team
   *   HOME = Home team
   *   OVER = Over (totals)
   *   UNDER = Under (totals)
   */
  pickSide: mysqlEnum("pickSide", ["AWAY", "HOME", "OVER", "UNDER"]),
  /** Sport: MLB | NBA | NHL | NCAAM | NFL | CUSTOM */
  sport: varchar("sport", { length: 16 }).notNull().default("MLB"),
  /** Game date in YYYY-MM-DD format */
  gameDate: varchar("gameDate", { length: 20 }).notNull(),
  /** Away team abbreviation/name, e.g. "TEX" */
  awayTeam: varchar("awayTeam", { length: 128 }),
  /** Home team abbreviation/name, e.g. "ATH" */
  homeTeam: varchar("homeTeam", { length: 128 }),
  /**
   * Bet type:
   *   ML = Moneyline
   *   RL = Run Line (spread)
   *   OVER = Total Over
   *   UNDER = Total Under
   *   PROP = Player/Game Prop
   *   PARLAY = Parlay
   *   TEASER = Teaser
   *   FUTURE = Futures bet
   *   CUSTOM = Custom/manual entry
   */
  betType: mysqlEnum("betType", ["ML", "RL", "OVER", "UNDER", "PROP", "PARLAY", "TEASER", "FUTURE", "CUSTOM"])
    .notNull()
    .default("ML"),
  /** The pick description, e.g. "TEX -125", "OVER 8.5 -110", "NYY ML +145" */
  pick: varchar("pick", { length: 255 }).notNull(),
  /**
   * The numeric line value for RL/Total bets (e.g. 1.5 for run line, 8.5 for total).
   * NULL for ML bets (not needed for grading).
   */
  line: decimal("line", { precision: 6, scale: 1 }),
  /** American odds, e.g. -125, +145, -110 */
  odds: int("odds").notNull(),
  /** Risk amount in dollars (decimal, 2 decimal places) */
  risk: decimal("risk", { precision: 10, scale: 2 }).notNull(),
  /** To-win amount in dollars (auto-calculated: risk * (100/|odds|) for fav, risk * (odds/100) for dog) */
  toWin: decimal("toWin", { precision: 10, scale: 2 }).notNull(),
  /**
   * Risk amount expressed in units (e.g. 3.0 for a 3U play).
   * Stored at creation time so analytics can bucket correctly regardless of the user's unit size setting.
   */
  riskUnits: decimal("riskUnits", { precision: 8, scale: 2 }),
  /**
   * To-win amount expressed in units (e.g. 5.0 for a 5U to-win play).
   * Stored at creation time for accurate bySize analytics.
   */
  toWinUnits: decimal("toWinUnits", { precision: 8, scale: 2 }),
  /** Sportsbook name, e.g. "DK NJ", "FanDuel NJ", "Caesars NJ" */
  book: varchar("book", { length: 64 }),
  /** Optional free-text notes */
  notes: text("notes"),
  /**
   * Bet result:
   *   PENDING = not yet graded
   *   WIN = bet won
   *   LOSS = bet lost
   *   PUSH = push/tie
   *   VOID = voided/cancelled
   */
  result: mysqlEnum("result", ["PENDING", "WIN", "LOSS", "PUSH", "VOID"])
    .notNull()
    .default("PENDING"),
  /**
   * Final score for the graded timeframe — populated by the auto-grade engine.
   * Stored as varchar to handle decimal scores (e.g. NCAAM) and avoid int precision loss.
   */
  awayScore: varchar("awayScore", { length: 16 }),
  homeScore: varchar("homeScore", { length: 16 }),
  /**
   * Wager type: PREGAME (placed before game starts) or LIVE (in-game live bet).
   * Defaults to PREGAME.
   */
  wagerType: mysqlEnum("wagerType", ["PREGAME", "LIVE"]).notNull().default("PREGAME"),
  /**
   * Custom line value for RL/Total bets — overrides the default 1.5/7.5 hardcoded line.
   * e.g. 8.0 for an Over 8 total, -1.5 for a standard run line.
   * NULL means use the default line for the market.
   */
  customLine: decimal("customLine", { precision: 6, scale: 1 }),
  /** UTC timestamp (ms) when this bet was created */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** UTC timestamp (ms) when this bet was last updated */
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  idxUserId:        index("idx_tb_user_id").on(t.userId),
  idxGameId:        index("idx_tb_game_id").on(t.gameId),
  idxGameDate:      index("idx_tb_game_date").on(t.gameDate),
  idxSport:         index("idx_tb_sport").on(t.sport),
  idxResult:        index("idx_tb_result").on(t.result),
  /** Composite covering index: userId + sport + gameDate
   *  Eliminates full-table scans for list() and getStats() when filtering by sport + date range.
   *  MySQL uses this for: WHERE userId=X AND sport=Y AND gameDate BETWEEN A AND B */
  idxUserSportDate: index("idx_tb_user_sport_date").on(t.userId, t.sport, t.gameDate),
  /** Composite for userId + gameDate range scans (ALL sports, date-filtered queries) */
  idxUserDate:      index("idx_tb_user_date").on(t.userId, t.gameDate),
  /** Composite for userId + result queries (filter by WIN/LOSS/PENDING etc.) */
  idxUserResult:    index("idx_tb_user_result").on(t.userId, t.result),
  /** Composite for userId + result + gameDate — optimal for pending-bet auto-grade queries */
  idxUserResultDate: index("idx_tb_user_result_date").on(t.userId, t.result, t.gameDate),
}));

export type TrackedBet = typeof trackedBets.$inferSelect;
export type InsertTrackedBet = typeof trackedBets.$inferInsert;

// ─── Bet Edit Requests (porter/hank immutable bets — request changes via this table) ──
/**
 * When a handicapper (porter/hank) wants to edit or delete a tracked bet,
 * they submit a request here instead of modifying the bet directly.
 * Owner/Admin reviews and approves/denies the request.
 */
export const betEditRequests = mysqlTable("bet_edit_requests", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to tracked_bets.id — the bet being requested to change */
  betId: int("betId").notNull(),
  /** FK to app_users.id — the handicapper making the request */
  requestedBy: int("requestedBy").notNull(),
  /**
   * Request type:
   *   EDIT   = modify fields on the bet
   *   DELETE = remove the bet from the tracker
   */
  requestType: mysqlEnum("requestType", ["EDIT", "DELETE"]).notNull(),
  /** JSON blob of the proposed changes (for EDIT requests) */
  proposedChanges: text("proposedChanges"),
  /** Free-text reason for the request */
  reason: text("reason"),
  /**
   * Status of the request:
   *   PENDING  = awaiting owner/admin review
   *   APPROVED = approved and applied
   *   DENIED   = denied by owner/admin
   */
  status: mysqlEnum("status", ["PENDING", "APPROVED", "DENIED"]).notNull().default("PENDING"),
  /** FK to app_users.id — the owner/admin who reviewed the request */
  reviewedBy: int("reviewedBy"),
  /** UTC timestamp (ms) when the request was reviewed */
  reviewedAt: timestamp("reviewedAt"),
  /** Optional note from the reviewer */
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  idxBetId:       index("idx_ber_bet_id").on(t.betId),
  idxRequestedBy: index("idx_ber_requested_by").on(t.requestedBy),
  idxStatus:      index("idx_ber_status").on(t.status),
}));
export type BetEditRequest = typeof betEditRequests.$inferSelect;
export type InsertBetEditRequest = typeof betEditRequests.$inferInsert;
