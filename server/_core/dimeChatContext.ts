import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { applyMlbMarketGatesToGame } from "../feedGating";
import {
  anyMarketGated,
  getMlbMarketGateSnapshot,
  mlbMarketGateMode,
} from "../mlbMarketGates";
import {
  collectDimeNumericValues,
  type DimeAnswerEvidence,
  type DimeAnswerRoute,
  type DimeEventResolution,
  planDimeAnswerRoute,
  resolveDimeEvent,
} from "./dimeAnswerRouting";
import {
  dimeContextToolTrace,
  dimeNoToolRequiredTrace,
  type DimeContextMetrics,
  type DimeEvidenceTimestamps,
  type DimeStageLatency,
  type DimeToolCallTrace,
} from "./dimeTraceObservability";
import {
  evaluateDimeIngestionLifecycle,
  dimeIngestionLifecycleNotApplicable,
  dimeIngestionLifecycleUnavailable,
  dimeProviderObservationNotApplicable,
  dimeProviderObservationUnavailable,
  type DimeIngestionLifecycle,
  type DimeProviderObservation,
} from "./dimeEvidenceProvenance";

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
  route: DimeAnswerRoute;
  resolution: DimeEventResolution;
  grounding: DimeAnswerEvidence["grounding"];
  retrievalCandidateCount: number;
  retrievalLatencyMs: number;
  supportedNumericValues: string[];
  observability: {
    toolCall: DimeToolCallTrace;
    timestamps: DimeEvidenceTimestamps;
    providerObservation: DimeProviderObservation;
    ingestionLifecycle: DimeIngestionLifecycle;
    stageLatency: Pick<
      DimeStageLatency,
      "entityResolutionMs" | "retrievalMs" | "toolMs" | "contextConstructionMs"
    >;
    contextMetrics: DimeContextMetrics;
    dynamicEvidenceUsed: boolean;
  };
}

export interface DimeGameContextRow extends RowDataPacket {
  id: number;
  sport: string;
  gameDate: string;
  startTimeEst: string | null;
  gameNumber: number | null;
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
  providerObservedAt: Date | string | null;
  sourceUpdatedAt: Date | string | null;
  ingestionReceivedAt: Date | string | null;
  ingestionNormalizedAt: Date | string | null;
  ingestionPersistedAt: Date | string | null;
  ingestionPipelineRevision: string | null;
  ingestionRunId: string | null;
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

function resolutionContext(
  route: DimeAnswerRoute,
  resolution: DimeEventResolution
): string {
  const selected = resolution.selected.map(
    event =>
      `- event_id=${event.id} ${event.sport} ${event.gameDate} ${valueOrDash(event.startTimeEst)} — ${event.awayTeam} at ${event.homeTeam}${event.gameNumber ? ` game_number=${event.gameNumber}` : ""}`
  );
  return [
    `DIME_EVENT_RESOLUTION version=${route.version} mode=${route.mode} result=${resolution.kind} confidence=${resolution.confidence.toFixed(2)}`,
    `requested_date=${route.requestedDate ?? "none"} requested_game_number=${route.requestedGameNumber ?? "none"} date_source=${route.dateSource} league=${route.league ?? "unresolved"} reason=${resolution.reason}`,
    resolution.kind === "exact"
      ? "The selected event rows below may be used as grounded evidence."
      : "Candidate events below are identity-only. Do not analyze their markets, projections, splits, or edges until the user confirms one exact event.",
    ...(selected.length > 0 ? selected : ["- no eligible event selected"]),
  ].join("\n");
}

function emptyContextResult(
  route: DimeAnswerRoute,
  resolution: DimeEventResolution,
  retrievalLatencyMs: number,
  context?: string,
  options: {
    retrievedAt?: Date;
    databaseConfigured?: boolean;
  } = {}
): DimeContextResult {
  const retrievedAt = options.retrievedAt ?? new Date();
  const contextBytes = context ? Buffer.byteLength(context, "utf8") : 0;
  return {
    freshness: "none",
    ...(context ? { context } : {}),
    rowCount: 0,
    eventIds: [],
    route,
    resolution,
    grounding:
      route.mode === "platform"
        ? "catalog_only"
        : route.mode === "educational"
          ? "none"
          : (resolution.kind === "nearby" || resolution.kind === "ambiguous") &&
              resolution.selected.length > 0
            ? "identity_only"
            : "none",
    retrievalCandidateCount: 0,
    retrievalLatencyMs,
    supportedNumericValues: collectDimeNumericValues([
      route.normalizedQuery,
      context,
    ]),
    observability: {
      toolCall: route.retrievalBypassed
        ? dimeNoToolRequiredTrace()
        : dimeContextToolTrace({
            status: options.databaseConfigured
              ? "empty"
              : "selected_not_invoked",
            normalizedArguments: {
              route: route.productRoute,
              league: route.league ?? null,
              requestedDate: route.requestedDate ?? null,
              retrievalCap: route.retrievalCap,
            },
            startedAt: new Date(retrievedAt.getTime() - retrievalLatencyMs),
            completedAt: options.databaseConfigured ? retrievedAt : undefined,
            recordsReturned: 0,
            freshnessAtRequest: "not_applicable",
            validationResult: options.databaseConfigured ? "passed" : "not_run",
          }),
      timestamps: {
        scheduledEventTime: null,
        providerObservedAt: null,
        sourceUpdatedAt: null,
        databaseIngestedAt: null,
        retrievedAt: retrievedAt.toISOString(),
        responseGeneratedAt: null,
      },
      providerObservation: dimeProviderObservationNotApplicable(),
      ingestionLifecycle: dimeIngestionLifecycleNotApplicable(),
      stageLatency: {
        entityResolutionMs: 0,
        retrievalMs: retrievalLatencyMs,
        toolMs: route.retrievalBypassed ? null : retrievalLatencyMs,
        contextConstructionMs: 0,
      },
      contextMetrics: {
        inputTokens: null,
        retrievedRecords: 0,
        retrievedEvents: 0,
        duplicateContextRate: 0,
        irrelevantContextRate: null,
        contextFreshness: "none",
        contextConstructionMs: 0,
        suppliedContextUsedRate: null,
        contextBytes,
        truncationOccurred: false,
      },
      dynamicEvidenceUsed: false,
    },
  };
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

function isoTimestampOrNull(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const epochMs = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function latestPersistedTimestamp(
  rows: DimeGameContextRow[],
  field: "providerObservedAt" | "sourceUpdatedAt" | "ingestionPersistedAt"
): string | null {
  const timestamps = rows
    .map(row => isoTimestampOrNull(row[field]))
    .filter((value): value is string => value !== null)
    .sort();
  return timestamps.at(-1) ?? null;
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
  query = "",
  plannedRoute?: DimeAnswerRoute
): Promise<DimeContextResult> {
  const retrievalStartedAtDate = new Date();
  const retrievalStartedAt = Date.now();
  const route = plannedRoute ?? planDimeAnswerRoute(query, now);
  const bypassed = resolveDimeEvent([], route);
  if (route.retrievalBypassed) {
    return emptyContextResult(
      route,
      bypassed.resolution,
      Date.now() - retrievalStartedAt,
      undefined,
      { retrievedAt: new Date() }
    );
  }

  const db = getPool();
  if (!db) {
    const resolution =
      route.enabled && (route.mode === "matchup" || route.mode === "slate")
        ? {
            ...bypassed.resolution,
            kind: "missing" as const,
            confidence: 0,
            reason: "database_unavailable",
          }
        : bypassed.resolution;
    return emptyContextResult(
      route,
      resolution,
      Date.now() - retrievalStartedAt,
      route.enabled && (route.mode === "matchup" || route.mode === "slate")
        ? resolutionContext(route, resolution)
        : undefined,
      { retrievedAt: new Date(), databaseConfigured: false }
    );
  }

  const defaultStart = ymd(now);
  const defaultEndDate = new Date(now);
  defaultEndDate.setUTCDate(
    defaultEndDate.getUTCDate() + CONTEXT_LOOKAHEAD_DAYS
  );
  const defaultEnd = ymd(defaultEndDate);
  const start =
    route.enabled && route.mode === "matchup" && route.requestedDate
      ? new Date(
          Date.parse(`${route.requestedDate}T12:00:00.000Z`) -
            24 * 60 * 60 * 1_000
        )
          .toISOString()
          .slice(0, 10)
      : route.enabled && route.mode === "slate" && route.requestedDate
        ? route.requestedDate
        : defaultStart;
  const end =
    route.enabled && route.mode === "matchup" && route.requestedDate
      ? new Date(
          Date.parse(`${route.requestedDate}T12:00:00.000Z`) +
            24 * 60 * 60 * 1_000
        )
          .toISOString()
          .slice(0, 10)
      : route.enabled && route.mode === "slate" && route.requestedDate
        ? route.requestedDate
        : defaultEnd;
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
  const leagueFilterSql = route.enabled && route.league ? " AND sport = ?" : "";
  const leagueParameters = route.enabled && route.league ? [route.league] : [];

  // mysql2 sends JavaScript number bindings as DOUBLE values. MySQL rejects
  // that prepared-statement type in LIMIT, so keep the two dates parameterized
  // and embed only this trusted, compile-time integer cap.
  const [rows] = await db.execute<DimeGameContextRow[]>(
    `SELECT id, sport, gameDate, startTimeEst, gameNumber, awayTeam, homeTeam,
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
            modelRunAt,
            provider_observed_at AS providerObservedAt,
            source_updated_at AS sourceUpdatedAt,
            ingestion_received_at AS ingestionReceivedAt,
            ingestion_normalized_at AS ingestionNormalizedAt,
            ingestion_persisted_at AS ingestionPersistedAt,
            ingestion_pipeline_revision AS ingestionPipelineRevision,
            ingestion_run_id AS ingestionRunId
       FROM games
      WHERE gameDate >= ?
        AND gameDate <= ?
        ${leagueFilterSql}
        AND gameStatus IN ('upcoming', 'live')
        AND (publishedToFeed = 1 OR publishedModel = 1)
      ORDER BY ${queryRankSql}gameDate ASC, sortOrder ASC, startTimeEst ASC
      LIMIT ${MAX_CONTEXT_CANDIDATES}`,
    [start, end, ...leagueParameters, ...queryRankParameters]
  );

  // MLB per-market publication gate. Without this, a market ruled BACKTEST-ONLY
  // would render as "—" on the feed while the assistant still quoted its edge
  // in chat — the same number, gated on one surface and not the other.
  // Inert unless MLB_MARKET_GATE_MODE=on (see server/mlbMarketGates.ts).
  if (mlbMarketGateMode() === "on") {
    const marketGates = await getMlbMarketGateSnapshot();
    if (anyMarketGated(marketGates)) {
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i]?.sport !== "MLB") continue;
        rows[i] = applyMlbMarketGatesToGame(
          rows[i] as unknown as Record<string, unknown>,
          marketGates
        ) as unknown as (typeof rows)[number];
      }
    }
  }

  if (rows.length === 0) {
    const { resolution } = resolveDimeEvent(rows, route);
    return emptyContextResult(
      route,
      resolution,
      Date.now() - retrievalStartedAt,
      route.enabled && (route.mode === "matchup" || route.mode === "slate")
        ? resolutionContext(route, resolution)
        : undefined,
      { retrievedAt: new Date(), databaseConfigured: true }
    );
  }

  const entityResolutionStartedAt = Date.now();
  const { resolution, selectedRows } = resolveDimeEvent(
    route.enabled ? rows : selectDimeContextRows(rows, query),
    route
  );
  const entityResolutionMs = Date.now() - entityResolutionStartedAt;
  const identityOnly =
    resolution.kind === "nearby" || resolution.kind === "ambiguous";
  const contextConstructionStartedAt = Date.now();
  const fullContext =
    resolution.kind === "exact" || !route.enabled
      ? formatDimeGameContext(selectedRows, now)
      : undefined;
  const context =
    route.enabled && (route.mode === "matchup" || route.mode === "slate")
      ? [resolutionContext(route, resolution), fullContext]
          .filter(Boolean)
          .join("\n\n")
      : fullContext;
  const contextConstructionMs = Date.now() - contextConstructionStartedAt;
  const retrievedAt = new Date();
  const retrievalLatencyMs = Date.now() - retrievalStartedAt;
  const providerObservedAt = latestPersistedTimestamp(
    selectedRows,
    "providerObservedAt"
  );
  const sourceUpdatedAt = latestPersistedTimestamp(
    selectedRows,
    "sourceUpdatedAt"
  );
  const databaseIngestedAt = latestPersistedTimestamp(
    selectedRows,
    "ingestionPersistedAt"
  );
  const ingestionLifecycle =
    selectedRows.length === 1
      ? evaluateDimeIngestionLifecycle({
          sourceObservedAt: isoTimestampOrNull(
            selectedRows[0]!.providerObservedAt
          ),
          receivedAt: isoTimestampOrNull(selectedRows[0]!.ingestionReceivedAt),
          normalizedAt: isoTimestampOrNull(
            selectedRows[0]!.ingestionNormalizedAt
          ),
          persistedAt: isoTimestampOrNull(
            selectedRows[0]!.ingestionPersistedAt
          ),
          retrievedAt: retrievedAt.toISOString(),
          responseGeneratedAt: null,
          pipelineRevision: selectedRows[0]!.ingestionPipelineRevision ?? null,
          ingestionRunId: selectedRows[0]!.ingestionRunId ?? null,
        })
      : dimeIngestionLifecycleUnavailable({
          retrievedAt: retrievedAt.toISOString(),
          issue: "multi_event_ingestion_lifecycle_not_representable",
        });
  const uniqueEventCount = new Set(selectedRows.map(row => row.id)).size;
  const duplicateContextRate =
    selectedRows.length === 0
      ? 0
      : (selectedRows.length - uniqueEventCount) / selectedRows.length;

  return {
    freshness: "delayed",
    ...(context ? { context } : {}),
    rowCount: selectedRows.length,
    eventIds: selectedRows.map(row => row.id),
    route,
    resolution,
    grounding:
      resolution.kind === "exact"
        ? "full_event"
        : identityOnly
          ? "identity_only"
          : "none",
    retrievalCandidateCount: rows.length,
    retrievalLatencyMs,
    supportedNumericValues: collectDimeNumericValues([
      route.normalizedQuery,
      context,
    ]),
    observability: {
      toolCall: dimeContextToolTrace({
        status: "stale",
        normalizedArguments: {
          route: route.productRoute,
          league: route.league ?? null,
          requestedDate: route.requestedDate ?? null,
          retrievalCap: route.retrievalCap,
        },
        startedAt: retrievalStartedAtDate,
        completedAt: retrievedAt,
        recordsReturned: selectedRows.length,
        resultText: context ?? "",
        sourceTimestamp: sourceUpdatedAt ?? providerObservedAt,
        freshnessAtRequest: "delayed",
        validationResult: "passed",
      }),
      timestamps: {
        scheduledEventTime: null,
        providerObservedAt,
        sourceUpdatedAt,
        databaseIngestedAt,
        retrievedAt: retrievedAt.toISOString(),
        responseGeneratedAt: null,
      },
      providerObservation: dimeProviderObservationUnavailable(
        "provider_identity_revision_not_persisted"
      ),
      ingestionLifecycle,
      stageLatency: {
        entityResolutionMs,
        retrievalMs: retrievalLatencyMs,
        toolMs: retrievalLatencyMs,
        contextConstructionMs,
      },
      contextMetrics: {
        inputTokens: null,
        retrievedRecords: selectedRows.length,
        retrievedEvents: uniqueEventCount,
        duplicateContextRate,
        irrelevantContextRate: null,
        contextFreshness: "delayed",
        contextConstructionMs,
        suppliedContextUsedRate: null,
        contextBytes: context ? Buffer.byteLength(context, "utf8") : 0,
        truncationOccurred: false,
      },
      dynamicEvidenceUsed: Boolean(context && selectedRows.length > 0),
    },
  };
}
