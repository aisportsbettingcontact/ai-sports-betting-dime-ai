import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

const MAX_CONTEXT_GAMES = 12;
const MAX_CONTEXT_CANDIDATES = 64;
const CONTEXT_LOOKAHEAD_DAYS = 3;
const MAX_QUERY_TERMS = 8;
const STALE_MODEL_AFTER_MS = 24 * 60 * 60 * 1000;
const QUERY_STOP_WORDS = new Set([
  "about",
  "analysis",
  "analyze",
  "break",
  "down",
  "game",
  "matchup",
  "please",
  "tell",
  "versus",
  "what",
  "with",
]);

type DimeContextFreshness = "delayed" | "none";

export interface DimeContextResult {
  freshness: DimeContextFreshness;
  context?: string;
  rowCount: number;
  eventIds: number[];
}

export interface DimeGameContextRow extends RowDataPacket {
  id: number;
  sport: string;
  gameDate: string;
  startTimeEst: string | null;
  awayTeam: string;
  homeTeam: string;
  awayBookSpread: string | null;
  awayModelSpread: string | null;
  homeBookSpread: string | null;
  homeModelSpread: string | null;
  bookTotal: string | null;
  modelTotal: string | null;
  spreadEdge: string | null;
  spreadDiff: string | null;
  totalEdge: string | null;
  totalDiff: string | null;
  awayML: string | null;
  homeML: string | null;
  awaySpreadOdds: string | null;
  homeSpreadOdds: string | null;
  overOdds: string | null;
  underOdds: string | null;
  openAwaySpread: string | null;
  openAwaySpreadOdds: string | null;
  openHomeSpread: string | null;
  openHomeSpreadOdds: string | null;
  openTotal: string | null;
  openOverOdds: string | null;
  openUnderOdds: string | null;
  openAwayML: string | null;
  openHomeML: string | null;
  spreadAwayBetsPct: number | null;
  spreadAwayMoneyPct: number | null;
  totalOverBetsPct: number | null;
  totalOverMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  mlAwayMoneyPct: number | null;
  oddsSource: "open" | "dk" | null;
  modelAwayML: string | null;
  modelHomeML: string | null;
  modelAwayScore: string | null;
  modelHomeScore: string | null;
  modelOverRate: string | null;
  modelUnderRate: string | null;
  modelAwayWinPct: string | null;
  modelHomeWinPct: string | null;
  awayStartingPitcher: string | null;
  homeStartingPitcher: string | null;
  awayPitcherConfirmed: number | boolean | null;
  homePitcherConfirmed: number | boolean | null;
  awayGoalie: string | null;
  homeGoalie: string | null;
  awayGoalieConfirmed: number | boolean | null;
  homeGoalieConfirmed: number | boolean | null;
  modelRunAt: number | null;
}

let pool: Pool | null = null;

function readDatabaseUrl(): string | undefined {
  const value =
    process.env.DIME_CHAT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  return value || undefined;
}

function getPool(): Pool | null {
  const uri = readDatabaseUrl();
  if (!uri) return null;

  if (!pool) {
    pool = mysql.createPool({
      uri,
      connectionLimit: 3,
      waitForConnections: true,
      queueLimit: 10,
      connectTimeout: 15_000,
      idleTimeout: 30_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      compress: true,
    });
  }

  return pool;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yesNo(value: number | boolean | null): string {
  if (value === true || value === 1) return "confirmed";
  if (value === false || value === 0) return "projected";
  return "unknown";
}

function valueOrDash(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function searchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rowQueryScore(game: DimeGameContextRow, query: string): number {
  const normalizedQuery = searchText(query);
  if (!normalizedQuery) return 0;

  const away = searchText(game.awayTeam);
  const home = searchText(game.homeTeam);
  const matchup = `${away} ${home}`;
  const queryTerms = new Set(
    normalizedQuery.split(" ").filter(term => term.length >= 3)
  );
  const teamTerms = new Set(
    matchup.split(" ").filter(term => term.length >= 3)
  );

  let score = 0;
  if (away && normalizedQuery.includes(away)) score += 100;
  if (home && normalizedQuery.includes(home)) score += 100;
  for (const term of Array.from(queryTerms)) {
    if (teamTerms.has(term)) score += 20;
  }
  if (normalizedQuery.includes(game.sport.toLowerCase())) score += 12;
  if (normalizedQuery.includes(game.gameDate)) score += 8;
  return score;
}

function extractQueryTerms(query: string): string[] {
  return Array.from(
    new Set(
      searchText(query)
        .split(" ")
        .filter(
          term =>
            term.length >= 3 &&
            !QUERY_STOP_WORDS.has(term) &&
            !/^\d+$/.test(term)
        )
    )
  ).slice(0, MAX_QUERY_TERMS);
}

export function selectDimeContextRows(
  rows: DimeGameContextRow[],
  query = "",
  limit = MAX_CONTEXT_GAMES
): DimeGameContextRow[] {
  return rows
    .map((row, index) => ({ row, index, score: rowQueryScore(row, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(candidate => candidate.row);
}

function marketQualityFlags(
  game: DimeGameContextRow,
  generatedAt: Date
): string[] {
  const flags: string[] = [];
  const currentMarket = [
    game.awayBookSpread,
    game.homeBookSpread,
    game.bookTotal,
    game.awayML,
    game.homeML,
  ];
  const openingMarket = [
    game.openAwaySpread,
    game.openHomeSpread,
    game.openTotal,
    game.openAwayML,
    game.openHomeML,
  ];
  const splits = [
    game.spreadAwayBetsPct,
    game.spreadAwayMoneyPct,
    game.totalOverBetsPct,
    game.totalOverMoneyPct,
    game.mlAwayBetsPct,
    game.mlAwayMoneyPct,
  ];
  const modelValues = [
    game.awayModelSpread,
    game.homeModelSpread,
    game.modelTotal,
    game.modelAwayML,
    game.modelHomeML,
    game.modelAwayScore,
    game.modelHomeScore,
    game.modelAwayWinPct,
    game.modelHomeWinPct,
  ];

  if (currentMarket.every(value => value === null)) {
    flags.push("current_market_missing");
  } else if (currentMarket.some(value => value === null)) {
    flags.push("current_market_partial");
  }
  if (openingMarket.every(value => value === null)) {
    flags.push("opening_market_missing");
  } else if (openingMarket.some(value => value === null)) {
    flags.push("opening_market_partial");
  }
  if (splits.every(value => value === null)) {
    flags.push("splits_missing");
  } else if (splits.some(value => value === null)) {
    flags.push("splits_partial");
  }
  if (modelValues.every(value => value === null)) {
    flags.push("model_missing");
  } else if (modelValues.some(value => value === null)) {
    flags.push("model_partial");
  }
  if (game.modelRunAt === null) {
    flags.push("model_timestamp_missing");
  } else if (!Number.isFinite(game.modelRunAt)) {
    flags.push("model_timestamp_invalid");
  } else {
    const modelAgeMs = generatedAt.getTime() - game.modelRunAt;
    if (modelAgeMs > STALE_MODEL_AFTER_MS) {
      flags.push("model_stale_gt_24h");
    } else if (modelAgeMs < -5 * 60 * 1000) {
      flags.push("model_timestamp_future");
    }
  }
  return flags;
}

export function formatDimeGameContext(
  rows: DimeGameContextRow[],
  generatedAt = new Date()
): string {
  const lines = rows.map((game, index) => {
    const personnel =
      game.sport === "MLB"
        ? `Pitchers: ${valueOrDash(game.awayStartingPitcher)} (${yesNo(game.awayPitcherConfirmed)}) vs ${valueOrDash(game.homeStartingPitcher)} (${yesNo(game.homePitcherConfirmed)})`
        : game.sport === "NHL"
          ? `Goalies: ${valueOrDash(game.awayGoalie)} (${yesNo(game.awayGoalieConfirmed)}) vs ${valueOrDash(game.homeGoalie)} (${yesNo(game.homeGoalieConfirmed)})`
          : "Personnel: —";

    return [
      `${index + 1}. event_id=${game.id} ${game.sport} ${game.gameDate} ${valueOrDash(game.startTimeEst)} — ${game.awayTeam} at ${game.homeTeam}`,
      `   Current market: spread ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayBookSpread)} (${valueOrDash(game.awaySpreadOdds)}) / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeBookSpread)} (${valueOrDash(game.homeSpreadOdds)}); total ${valueOrDash(game.bookTotal)} over ${valueOrDash(game.overOdds)} / under ${valueOrDash(game.underOdds)}; ML ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayML)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeML)}`,
      `   Opening market: spread ${valueOrDash(game.awayTeam)} ${valueOrDash(game.openAwaySpread)} (${valueOrDash(game.openAwaySpreadOdds)}) / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.openHomeSpread)} (${valueOrDash(game.openHomeSpreadOdds)}); total ${valueOrDash(game.openTotal)} over ${valueOrDash(game.openOverOdds)} / under ${valueOrDash(game.openUnderOdds)}; ML ${valueOrDash(game.awayTeam)} ${valueOrDash(game.openAwayML)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.openHomeML)}`,
      `   Provider-scoped splits: spread away bets=${valueOrDash(game.spreadAwayBetsPct)}% money=${valueOrDash(game.spreadAwayMoneyPct)}%; total over bets=${valueOrDash(game.totalOverBetsPct)}% money=${valueOrDash(game.totalOverMoneyPct)}%; ML away bets=${valueOrDash(game.mlAwayBetsPct)}% money=${valueOrDash(game.mlAwayMoneyPct)}%`,
      `   Model: spread ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayModelSpread)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeModelSpread)}; total ${valueOrDash(game.modelTotal)}; score ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayScore)} - ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeScore)}; ML fair ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayML)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeML)}`,
      `   Edges: spread=${valueOrDash(game.spreadEdge)} diff=${valueOrDash(game.spreadDiff)}; total=${valueOrDash(game.totalEdge)} diff=${valueOrDash(game.totalDiff)}; over=${valueOrDash(game.modelOverRate)}%; under=${valueOrDash(game.modelUnderRate)}%; win ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayWinPct)}% / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeWinPct)}%`,
      `   ${personnel}; oddsSource=${valueOrDash(game.oddsSource)}; marketObservedAt=unavailable; modelRunAt=${valueOrDash(game.modelRunAt)}; qualityFlags=${marketQualityFlags(game, generatedAt).join(",") || "none"}`,
    ].join("\n");
  });

  return [
    `Dime platform context generated_at=${generatedAt.toISOString()}`,
    "This block is query-ranked evidence, not a complete slate. Use only these rows plus explicit user-provided numbers as grounded game/market data.",
    "Opening and current prices are distinct. Splits are provider-scoped samples and do not prove causality. marketObservedAt=unavailable means exact price freshness is unknown.",
    "The interface must label this evidence delayed, not live, until a market observation timestamp is available.",
    "If a requested event, market, timestamp, or user-specific fact is missing, say exactly what is missing instead of inventing it.",
    ...lines,
  ].join("\n");
}

export async function getDimeChatContext(
  now = new Date(),
  query = ""
): Promise<DimeContextResult> {
  const db = getPool();
  if (!db) return { freshness: "none", rowCount: 0, eventIds: [] };

  const start = ymd(now);
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + CONTEXT_LOOKAHEAD_DAYS);
  const end = ymd(endDate);
  const queryTerms = extractQueryTerms(query);
  const queryRankSql =
    queryTerms.length > 0
      ? `CASE WHEN ${queryTerms
          .map(() => "(LOWER(awayTeam) LIKE ? OR LOWER(homeTeam) LIKE ?)")
          .join(" OR ")} THEN 0 ELSE 1 END, `
      : "";
  const queryRankParameters = queryTerms.flatMap(term => [
    `%${term}%`,
    `%${term}%`,
  ]);

  // mysql2 sends JavaScript number bindings as DOUBLE values. MySQL rejects
  // that prepared-statement type in LIMIT, so keep the two dates parameterized
  // and embed only this trusted, compile-time integer cap.
  const [rows] = await db.execute<DimeGameContextRow[]>(
    `SELECT id, sport, gameDate, startTimeEst, awayTeam, homeTeam,
            awayBookSpread, awayModelSpread, homeBookSpread, homeModelSpread,
            bookTotal, modelTotal, spreadEdge, spreadDiff, totalEdge, totalDiff,
            awayML, homeML, modelAwayML, modelHomeML,
            awaySpreadOdds, homeSpreadOdds, overOdds, underOdds,
            openAwaySpread, openAwaySpreadOdds, openHomeSpread, openHomeSpreadOdds,
            openTotal, openOverOdds, openUnderOdds, openAwayML, openHomeML,
            spreadAwayBetsPct, spreadAwayMoneyPct,
            totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct,
            oddsSource,
            modelAwayScore, modelHomeScore, modelOverRate, modelUnderRate,
            modelAwayWinPct, modelHomeWinPct,
            awayStartingPitcher, homeStartingPitcher, awayPitcherConfirmed, homePitcherConfirmed,
            awayGoalie, homeGoalie, awayGoalieConfirmed, homeGoalieConfirmed,
            modelRunAt
       FROM games
      WHERE gameDate >= ?
        AND gameDate <= ?
        AND gameStatus IN ('upcoming', 'live')
        AND (publishedToFeed = 1 OR publishedModel = 1)
      ORDER BY ${queryRankSql}gameDate ASC, sortOrder ASC, startTimeEst ASC
      LIMIT ${MAX_CONTEXT_CANDIDATES}`,
    [start, end, ...queryRankParameters]
  );

  if (rows.length === 0) {
    return { freshness: "none", rowCount: 0, eventIds: [] };
  }

  const selectedRows = selectDimeContextRows(rows, query);

  return {
    freshness: "delayed",
    context: formatDimeGameContext(selectedRows, now),
    rowCount: selectedRows.length,
    eventIds: selectedRows.map(row => row.id),
  };
}
