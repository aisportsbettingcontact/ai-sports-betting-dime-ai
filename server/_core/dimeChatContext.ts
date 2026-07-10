import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

const MAX_CONTEXT_GAMES = 12;
const CONTEXT_LOOKAHEAD_DAYS = 3;

type DimeContextFreshness = "live" | "none";

interface DimeContextResult {
  freshness: DimeContextFreshness;
  context?: string;
  rowCount: number;
}

interface DimeGameContextRow extends RowDataPacket {
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
  const value = process.env.DIME_CHAT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
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
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function formatDimeGameContext(rows: DimeGameContextRow[], generatedAt = new Date()): string {
  const lines = rows.map((game, index) => {
    const personnel =
      game.sport === "MLB"
        ? `Pitchers: ${valueOrDash(game.awayStartingPitcher)} (${yesNo(game.awayPitcherConfirmed)}) vs ${valueOrDash(game.homeStartingPitcher)} (${yesNo(game.homePitcherConfirmed)})`
        : game.sport === "NHL"
          ? `Goalies: ${valueOrDash(game.awayGoalie)} (${yesNo(game.awayGoalieConfirmed)}) vs ${valueOrDash(game.homeGoalie)} (${yesNo(game.homeGoalieConfirmed)})`
          : "Personnel: —";

    return [
      `${index + 1}. ${game.sport} ${game.gameDate} ${valueOrDash(game.startTimeEst)} — ${game.awayTeam} at ${game.homeTeam}`,
      `   Market: spread ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayBookSpread)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeBookSpread)}; total ${valueOrDash(game.bookTotal)}; ML ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayML)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeML)}`,
      `   Model: spread ${valueOrDash(game.awayTeam)} ${valueOrDash(game.awayModelSpread)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.homeModelSpread)}; total ${valueOrDash(game.modelTotal)}; score ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayScore)} - ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeScore)}; ML fair ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayML)} / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeML)}`,
      `   Edges: spread=${valueOrDash(game.spreadEdge)} diff=${valueOrDash(game.spreadDiff)}; total=${valueOrDash(game.totalEdge)} diff=${valueOrDash(game.totalDiff)}; over=${valueOrDash(game.modelOverRate)}%; under=${valueOrDash(game.modelUnderRate)}%; win ${valueOrDash(game.awayTeam)} ${valueOrDash(game.modelAwayWinPct)}% / ${valueOrDash(game.homeTeam)} ${valueOrDash(game.modelHomeWinPct)}%`,
      `   ${personnel}; modelRunAt=${valueOrDash(game.modelRunAt)}`,
    ].join("\n");
  });

  return [
    `Dime platform context generated_at=${generatedAt.toISOString()}`,
    "Use only these platform rows plus explicit user-provided numbers as grounded data. If a requested market/team is missing below, say what is missing instead of inventing it.",
    ...lines,
  ].join("\n");
}

export async function getDimeChatContext(now = new Date()): Promise<DimeContextResult> {
  const db = getPool();
  if (!db) return { freshness: "none", rowCount: 0 };

  const start = ymd(now);
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + CONTEXT_LOOKAHEAD_DAYS);
  const end = ymd(endDate);

  const [rows] = await db.execute<DimeGameContextRow[]>(
    `SELECT sport, gameDate, startTimeEst, awayTeam, homeTeam,
            awayBookSpread, awayModelSpread, homeBookSpread, homeModelSpread,
            bookTotal, modelTotal, spreadEdge, spreadDiff, totalEdge, totalDiff,
            awayML, homeML, modelAwayML, modelHomeML,
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
      ORDER BY gameDate ASC, sortOrder ASC, startTimeEst ASC
      LIMIT ?`,
    [start, end, MAX_CONTEXT_GAMES],
  );

  if (rows.length === 0) return { freshness: "none", rowCount: 0 };

  return {
    freshness: "live",
    context: formatDimeGameContext(rows, now),
    rowCount: rows.length,
  };
}
