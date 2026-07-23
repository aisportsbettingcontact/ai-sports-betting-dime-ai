/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║              ESPN SOCCER MATCH SCRAPER — ELITE EDITION                     ║
 * ║                                                                              ║
 * ║  Pulls every data element from ESPN's internal JSON APIs for any gameId.   ║
 * ║  No HTML parsing. No browser. Pure API-layer extraction.                   ║
 * ║                                                                              ║
 * ║  Data extracted:                                                             ║
 * ║    • Match header (score, status, venue, attendance, date)                  ║
 * ║    • Team statistics (30+ metrics per team)                                 ║
 * ║    • Key events (goals, cards, substitutions)                               ║
 * ║    • Full play-by-play commentary                                           ║
 * ║    • Odds (DraftKings / ESPN BET moneyline, spread, O/U)                   ║
 * ║    • Rosters with formation (starters + subs)                               ║
 * ║    • Per-player statistics (offensive, defensive, general, GK)              ║
 * ║    • Competitor-level stat splits (team aggregate)                          ║
 * ║    • Article recap, videos, broadcasts                                      ║
 * ║    • Head-to-head history, last-5-games form, leaders                       ║
 * ║                                                                              ║
 * ║  Anti-blocking strategy:                                                    ║
 * ║    • 8-UA rotation pool (real Chrome/Firefox/Safari/Edge UAs)               ║
 * ║    • Full browser-like headers (sec-ch-ua, sec-fetch-*, DNT)               ║
 * ║    • Exponential backoff retry (3 attempts: 1s / 2s / 4s)                  ║
 * ║    • Per-request jitter (200–800ms)                                         ║
 * ║    • Parallel fetch with concurrency cap (max 4 simultaneous)              ║
 * ║    • HTTPS enforcement (ESPN internal URLs use http://)                     ║
 * ║                                                                              ║
 * ║  Logging: EspnLogger — dual-channel (terminal + .scraper-logs/espn-scraper.log) ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import * as https from "https";
import * as http from "http";
import * as zlib from "zlib";
import { EspnLogger, createEspnLogger } from "./espnLogger";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const ESPN_SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary";
const ESPN_CORE_BASE =
  "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world";
const ESPN_SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_CONCURRENT = 4;
const MIN_JITTER_MS = 200;
const MAX_JITTER_MS = 800;
const REQUEST_TIMEOUT_MS = 30_000;

// ─── USER-AGENT POOL ─────────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
];

let _uaIndex = 0;
function nextUA(): string {
  return USER_AGENTS[_uaIndex++ % USER_AGENTS.length];
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface EspnTeamInfo {
  id: string;
  uid: string;
  displayName: string;
  abbreviation: string;
  shortDisplayName: string;
  color: string;
  alternateColor: string;
  logo: string;
  links: { href: string; text: string }[];
}

export interface EspnMatchHeader {
  gameId: string;
  uid: string;
  date: string;
  status: {
    name: string;
    shortDetail: string;
    displayClock: string;
    period: number;
    completed: boolean;
  };
  venue: { fullName: string; city: string; state: string; country: string };
  attendance: number | null;
  neutralSite: boolean;
  competitors: {
    team: EspnTeamInfo;
    homeAway: "home" | "away";
    score: string;
    winner: boolean;
    linescores: number[];
    records: string[];
  }[];
  broadcasts: { type: string; media: string; lang: string; region: string }[];
  officials: string[];
  seasonYear: number;
  seasonType: number;
  week: number | null;
}

export interface EspnTeamStat {
  name: string;
  displayValue: string;
  value: number | null;
  label: string;
}

export interface EspnTeamStats {
  team: Pick<EspnTeamInfo, "id" | "abbreviation" | "displayName">;
  homeAway: "home" | "away";
  statistics: EspnTeamStat[];
}

export interface EspnKeyEvent {
  type: string;
  clock: string;
  period: number;
  team: string;
  teamId: string;
  text: string;
  scorerName: string;
  assistName: string;
  participants: { type: string; name: string; athleteId: string }[];
  wallClock: string | null;
}

export interface EspnCommentaryEntry {
  clock: string;
  period: number;
  text: string;
  type: string;
  wallClock: string | null;
}

export interface EspnOdds {
  provider: string;
  homeTeamOdds: {
    moneyLine: number | null;
    spreadOdds: number | null;
    favorite: boolean;
    teamId: string;
  } | null;
  awayTeamOdds: {
    moneyLine: number | null;
    spreadOdds: number | null;
    favorite: boolean;
    teamId: string;
  } | null;
  drawOdds: { moneyLine: number | null } | null;
  overUnder: number | null;
  spread: number | null;
  overOdds: number | null;
  underOdds: number | null;
  moneylineWinner: boolean | null;
  spreadWinner: boolean | null;
}

export interface EspnPlayerStatCategory {
  name: string;
  displayName: string;
  stats: Record<string, string>;
}

export interface EspnPlayerEntry {
  playerId: number;
  jersey: number | null;
  starter: boolean;
  active: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  formationPlace: number | null;
  period: number;
  athlete: {
    id: string;
    displayName: string;
    shortName: string;
    jersey: string;
    position: string;
    positionAbbreviation: string;
    headshot: string;
    nationality: string;
    birthDate: string | null;
    height: string | null;
    weight: string | null;
    age: number | null;
    links: { href: string; text: string }[];
  };
  statistics: EspnPlayerStatCategory[];
}

export interface EspnRoster {
  team: Pick<EspnTeamInfo, "id" | "abbreviation" | "displayName">;
  homeAway: "home" | "away";
  formation: string;
  entries: EspnPlayerEntry[];
}

export interface EspnCompetitorStats {
  team: Pick<EspnTeamInfo, "id" | "abbreviation">;
  homeAway: "home" | "away";
  categories: EspnPlayerStatCategory[];
}

export interface EspnMatchData {
  gameId: string;
  scrapedAt: string;
  scrapeDurationMs: number;
  apiCallCount: number;
  retryCount: number;
  bytesTransferred: number;
  errors: string[];
  logFile: string;
  statsFile: string;
  runId: string;
  header: EspnMatchHeader;
  teamStats: EspnTeamStats[];
  keyEvents: EspnKeyEvent[];
  commentary: EspnCommentaryEntry[];
  odds: EspnOdds[];
  rosters: EspnRoster[];
  competitorStats: EspnCompetitorStats[];
  article: {
    headline: string;
    description: string;
    type: string;
    published: string;
    byline: string;
  } | null;
  videos: { id: number; headline: string; duration: number }[];
  broadcasts: { type: string; media: string; lang: string; region: string }[];
  headToHead: {
    teamAbbr: string;
    events: {
      date: string;
      homeTeam: string;
      homeScore: string;
      awayTeam: string;
      awayScore: string;
      status: string;
    }[];
  }[];
  lastFiveGames: {
    teamAbbr: string;
    events: {
      shortName: string;
      status: string;
      homeScore: string;
      awayScore: string;
      winner: string[];
    }[];
  }[];
  leaders: {
    teamAbbr: string;
    categories: {
      name: string;
      leaders: { name: string; value: string | null }[];
    }[];
  }[];
  gameInfo: {
    venue: string;
    city: string;
    country: string;
    attendance: number | null;
    officials: string[];
    capacity: number | null;
  };
  format: { periods: number; periodName: string; clockSeconds: number };
  meta: {
    lastUpdatedAt: string;
    gameState: string;
    firstPlayWallClock: string | null;
    lastPlayWallClock: string | null;
    syncUrl: string;
  };
  // ── 8 Deferred Core API Sections ────────────────────────────────────────────
  shotsDetail: EspnDeferredSection;
  attack: EspnDeferredSection;
  passes: EspnDeferredSection;
  expectedGoalsSplits: EspnDeferredSection;
  goalkeeping: EspnDeferredSection;
  defense: EspnDeferredSection;
  duels: EspnDeferredSection;
  foulsOffsides: EspnDeferredSection;
}

// ─── DEFERRED SECTION TYPE ────────────────────────────────────────────────────

export interface EspnDeferredStatRow {
  name: string;
  displayName: string;
  homeValue: string;
  awayValue: string;
  homeTeamId: string;
  awayTeamId: string;
}

export interface EspnDeferredPlayerRow {
  teamId: string;
  teamAbbr: string;
  homeAway: "home" | "away";
  playerId: string;
  playerName: string;
  jersey: string;
  position: string;
  stats: Record<string, string>;
}

export interface EspnDeferredSection {
  sectionName: string;
  apiUrl: string;
  fetched: boolean;
  teamRows: EspnDeferredStatRow[];
  playerRows: EspnDeferredPlayerRow[];
  rawKeys: string[];
  error: string | null;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(): number {
  return MIN_JITTER_MS + Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS);
}

function forceHttps(url: string): string {
  return url.replace(/^http:\/\//, "https://");
}

// ─── HTTP FETCH ───────────────────────────────────────────────────────────────

function rawFetch(url: string, ua: string): Promise<{ body: Buffer; statusCode: number; contentEncoding: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      "User-Agent": ua,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.espn.com/",
      Origin: "https://www.espn.com",
      "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      Connection: "keep-alive",
      DNT: "1",
    };

    const req = lib.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET", headers, timeout: REQUEST_TIMEOUT_MS },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            statusCode: res.statusCode ?? 0,
            contentEncoding: res.headers["content-encoding"] ?? "",
          })
        );
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`)); });
    req.end();
  });
}

function decompress(buf: Buffer, encoding: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (encoding === "gzip") zlib.gunzip(buf, (e: Error | null, r: Buffer) => (e ? reject(e) : resolve(r)));
    else if (encoding === "br") zlib.brotliDecompress(buf, (e: Error | null, r: Buffer) => (e ? reject(e) : resolve(r)));
    else if (encoding === "deflate") zlib.inflate(buf, (e: Error | null, r: Buffer) => (e ? reject(e) : resolve(r)));
    else resolve(buf);
  });
}

async function fetchWithRetry(url: string, label: string, logger: EspnLogger): Promise<unknown> {
  const safeUrl = forceHttps(url);
  const t0 = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const ua = nextUA();

    if (attempt > 1) {
      const delay = RETRY_DELAYS_MS[attempt - 2] ?? 4000;
      logger.retry(safeUrl, attempt, MAX_RETRIES + 1, delay, `attempt ${attempt - 1} failed`);
      await sleep(delay);
    }

    // Jitter before every request
    const jitterMs = Math.round(jitter());
    await sleep(jitterMs);

    logger.http("REQ", safeUrl, { attempt, userAgent: ua });

    try {
      const { body, statusCode, contentEncoding } = await rawFetch(safeUrl, ua);

      if (statusCode >= 400) {
        const errMsg = `HTTP ${statusCode}`;
        logger.http("RES", safeUrl, { attempt, statusCode, bytes: body.length, durationMs: Date.now() - t0, error: errMsg });
        if (attempt <= MAX_RETRIES) continue;
        throw new Error(`${errMsg} for ${label}`);
      }

      const decompressed = await decompress(body, contentEncoding);
      const text = decompressed.toString("utf-8");
      const elapsed = Date.now() - t0;

      logger.http("RES", safeUrl, { attempt, statusCode, bytes: decompressed.length, durationMs: elapsed });

      try {
        const parsed = JSON.parse(text);
        logger.verify("PASS", `${label} — valid JSON received`, {
          bytes: decompressed.length,
          elapsed_ms: elapsed,
          type: Array.isArray(parsed) ? `array(${parsed.length})` : `object(${Object.keys(parsed as object).length}keys)`,
        });
        return parsed;
      } catch (e) {
        throw new Error(`JSON parse error for ${label}: ${e}`);
      }
    } catch (err) {
      const elapsed = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Fetch failed: ${label} attempt ${attempt}`, err, { elapsed_ms: elapsed, url: safeUrl });
      if (attempt > MAX_RETRIES) {
        logger.verify("FAIL", `${label} — exhausted all ${MAX_RETRIES + 1} attempts`, { error: errMsg });
        throw err;
      }
    }
  }

  throw new Error(`fetchWithRetry: unreachable for ${label}`);
}

// ─── CONCURRENCY LIMITER ─────────────────────────────────────────────────────

async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = MAX_CONCURRENT
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── GAMEID EXTRACTION ────────────────────────────────────────────────────────

export function extractGameId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m1 = trimmed.match(/\/gameId\/(\d+)/);
  if (m1) return m1[1];
  const m2 = trimmed.match(/[?&]event=(\d+)/);
  if (m2) return m2[1];
  throw new Error(`Cannot extract gameId from: ${urlOrId}`);
}

// ─── PARSERS ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseHeader(data: any, gameId: string, logger: EspnLogger): EspnMatchHeader {
  logger.parse("Parsing match header");
  const h = data?.header ?? {};
  const comp = h?.competitions?.[0] ?? {};
  const status = comp?.status ?? {};
  const statusType = status?.type ?? {};
  const venue = comp?.venue ?? {};
  const address = venue?.address ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const competitors = (comp?.competitors ?? []).map((c: any) => {
    const t = c?.team ?? {};
    return {
      team: {
        id: String(t?.id ?? ""),
        uid: String(t?.uid ?? ""),
        displayName: String(t?.displayName ?? ""),
        abbreviation: String(t?.abbreviation ?? ""),
        shortDisplayName: String(t?.shortDisplayName ?? t?.abbreviation ?? ""),
        color: String(t?.color ?? ""),
        alternateColor: String(t?.alternateColor ?? ""),
        logo: String(t?.logo ?? ""),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        links: (t?.links ?? []).map((l: any) => ({ href: l?.href ?? "", text: l?.text ?? "" })),
      } as EspnTeamInfo,
      homeAway: (c?.homeAway ?? "home") as "home" | "away",
      score: String(c?.score ?? "0"),
      winner: Boolean(c?.winner),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linescores: (c?.linescores ?? []).map((ls: any) => Number(ls?.value ?? 0)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      records: (c?.records ?? []).map((r: any) => String(r?.summary ?? "")),
    };
  });

  const header: EspnMatchHeader = {
    gameId,
    uid: String(h?.uid ?? ""),
    date: String(comp?.date ?? ""),
    status: {
      name: String(statusType?.name ?? ""),
      shortDetail: String(statusType?.shortDetail ?? ""),
      displayClock: String(status?.displayClock ?? ""),
      period: Number(status?.period ?? 0),
      completed: Boolean(statusType?.completed),
    },
    venue: {
      fullName: String(venue?.fullName ?? ""),
      city: String(address?.city ?? ""),
      state: String(address?.state ?? ""),
      country: String(address?.country ?? ""),
    },
    attendance: comp?.attendance != null ? Number(comp.attendance) : null,
    neutralSite: Boolean(comp?.neutralSite),
    competitors,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broadcasts: (data?.broadcasts ?? []).map((b: any) => ({
      type: String(b?.type?.shortName ?? ""),
      media: String(b?.media?.shortName ?? ""),
      lang: String(b?.lang ?? ""),
      region: String(b?.region ?? ""),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    officials: (data?.gameInfo?.officials ?? []).map((o: any) => String(o?.fullName ?? o?.displayName ?? "")),
    seasonYear: Number(h?.season?.year ?? 0),
    seasonType: Number(h?.season?.type ?? 0),
    week: h?.week != null ? Number(h.week) : null,
  };

  const home = competitors.find((c: { homeAway: string; team: EspnTeamInfo; score: string; winner: boolean; linescores: number[]; records: string[] }) => c.homeAway === "home");
  const away = competitors.find((c: { homeAway: string; team: EspnTeamInfo; score: string; winner: boolean; linescores: number[]; records: string[] }) => c.homeAway === "away");
  logger.output("Header parsed", {
    match: `${home?.team.abbreviation ?? "?"} ${home?.score ?? "?"} - ${away?.score ?? "?"} ${away?.team.abbreviation ?? "?"}`,
    status: header.status.shortDetail,
    venue: `${header.venue.fullName}, ${header.venue.city}`,
    date: header.date,
    attendance: header.attendance ?? "N/A",
    officials: header.officials.length,
  });
  logger.verify(competitors.length >= 2 ? "PASS" : "FAIL", "header.competitors count >= 2", { count: competitors.length });

  return header;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTeamStats(data: any, logger: EspnLogger): EspnTeamStats[] {
  logger.parse("Parsing team statistics");
  const teams = data?.boxscore?.teams ?? [];
  const result: EspnTeamStats[] = teams.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entry: any) => {
      const t = entry?.team ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statistics: EspnTeamStat[] = (entry?.statistics ?? []).map((s: any) => ({
        name: String(s?.name ?? ""),
        displayValue: String(s?.displayValue ?? ""),
        value: s?.value != null ? Number(s.value) : null,
        label: String(s?.label ?? s?.name ?? ""),
      }));
      return {
        team: { id: String(t?.id ?? ""), abbreviation: String(t?.abbreviation ?? ""), displayName: String(t?.displayName ?? "") },
        homeAway: (entry?.homeAway ?? "home") as "home" | "away",
        statistics,
      };
    }
  );

  for (const t of result) {
    logger.state(`Team stats: ${t.team.abbreviation}`, { statCount: t.statistics.length, homeAway: t.homeAway });
  }
  logger.verify(result.length > 0 ? "PASS" : "WARN", "teamStats populated", { count: result.length });
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseKeyEvents(data: any, logger: EspnLogger): EspnKeyEvent[] {
  logger.parse("Parsing key events");
  const events = data?.keyEvents ?? [];
  const result: EspnKeyEvent[] = events.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participants = (ev?.participants ?? []).map((p: any) => ({
        type: String(p?.type?.text ?? p?.type?.name ?? ""),
        name: String(p?.athlete?.displayName ?? ""),
        athleteId: String(p?.athlete?.id ?? ""),
      }));
      const scorer = participants.find((p: { type: string; name: string; athleteId: string }) =>
        p.type.toLowerCase().includes("scorer")
      );
      const assist = participants.find((p: { type: string; name: string; athleteId: string }) =>
        p.type.toLowerCase().includes("assist")
      );
      return {
        type: String(ev?.type?.text ?? ev?.type?.name ?? ""),
        clock: String(ev?.clock?.displayValue ?? ""),
        period: Number(ev?.period?.number ?? 0),
        team: String(ev?.team?.abbreviation ?? ""),
        teamId: String(ev?.team?.id ?? ""),
        text: String(ev?.text ?? ""),
        scorerName: scorer?.name ?? "",
        assistName: assist?.name ?? "",
        participants,
        wallClock: ev?.wallClock ?? null,
      };
    }
  );

  const goals = result.filter((e) => e.type.toLowerCase().includes("goal"));
  const cards = result.filter((e) => e.type.toLowerCase().includes("card"));
  const subs = result.filter((e) => e.type.toLowerCase().includes("sub"));
  logger.output("Key events parsed", { total: result.length, goals: goals.length, cards: cards.length, subs: subs.length });
  for (const g of goals) {
    logger.state(`GOAL: ${g.clock}' ${g.team} — ${g.scorerName}${g.assistName ? ` (assist: ${g.assistName})` : ""}`, { text: g.text });
  }
  logger.verify("PASS", "keyEvents parsed", { count: result.length });
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCommentary(data: any, logger: EspnLogger): EspnCommentaryEntry[] {
  logger.parse("Parsing commentary");
  const entries = data?.commentary ?? [];
  const result: EspnCommentaryEntry[] = entries.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => ({
      clock: String(c?.clock?.displayValue ?? ""),
      period: Number(c?.period?.number ?? 0),
      text: String(c?.text ?? ""),
      type: String(c?.type?.text ?? c?.type?.name ?? ""),
      wallClock: c?.wallClock ?? null,
    })
  );
  logger.output("Commentary parsed", { count: result.length });
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOdds(data: any, logger: EspnLogger): EspnOdds[] {
  logger.parse("Parsing odds");
  const allOdds = [...(data?.odds ?? []), ...(data?.pickcenter ?? [])];
  const seen = new Set<string>();
  const result: EspnOdds[] = [];

  for (const o of allOdds) {
    const providerName = String(o?.provider?.name ?? "unknown");
    if (seen.has(providerName)) continue;
    seen.add(providerName);

    const homeOdds = o?.homeTeamOdds;
    const awayOdds = o?.awayTeamOdds;
    const drawOdds = o?.drawOdds;

    result.push({
      provider: providerName,
      homeTeamOdds: homeOdds ? {
        moneyLine: homeOdds?.moneyLine != null ? Number(homeOdds.moneyLine) : null,
        spreadOdds: homeOdds?.spreadOdds != null ? Number(homeOdds.spreadOdds) : null,
        favorite: Boolean(homeOdds?.favorite),
        teamId: String(homeOdds?.teamId ?? ""),
      } : null,
      awayTeamOdds: awayOdds ? {
        moneyLine: awayOdds?.moneyLine != null ? Number(awayOdds.moneyLine) : null,
        spreadOdds: awayOdds?.spreadOdds != null ? Number(awayOdds.spreadOdds) : null,
        favorite: Boolean(awayOdds?.favorite),
        teamId: String(awayOdds?.teamId ?? ""),
      } : null,
      drawOdds: drawOdds ? { moneyLine: drawOdds?.moneyLine != null ? Number(drawOdds.moneyLine) : null } : null,
      overUnder: o?.overUnder != null ? Number(o.overUnder) : null,
      spread: o?.spread != null ? Number(o.spread) : null,
      overOdds: o?.overOdds != null ? Number(o.overOdds) : null,
      underOdds: o?.underOdds != null ? Number(o.underOdds) : null,
      moneylineWinner: o?.moneylineWinner != null ? Boolean(o.moneylineWinner) : null,
      spreadWinner: o?.spreadWinner != null ? Boolean(o.spreadWinner) : null,
    });
  }

  logger.output("Odds parsed", { providers: result.map((o) => o.provider).join(", ") || "none" });
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSplitCategories(splits: any): EspnPlayerStatCategory[] {
  if (!splits?.categories) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (splits.categories ?? []).map((cat: any) => ({
    name: String(cat?.name ?? ""),
    displayName: String(cat?.displayName ?? cat?.name ?? ""),
    stats: Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cat?.stats ?? []).map((s: any) => [
        String(s?.name ?? ""),
        String(s?.displayValue ?? s?.value ?? ""),
      ])
    ),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAthleteData(athleteData: any): EspnPlayerEntry["athlete"] {
  return {
    id: String(athleteData?.id ?? ""),
    displayName: String(athleteData?.displayName ?? ""),
    shortName: String(athleteData?.shortName ?? ""),
    jersey: String(athleteData?.jersey ?? ""),
    position: String(athleteData?.position?.name ?? ""),
    positionAbbreviation: String(athleteData?.position?.abbreviation ?? ""),
    headshot: String(athleteData?.headshot?.href ?? ""),
    nationality: String(athleteData?.citizenship ?? athleteData?.nationality ?? ""),
    birthDate: athleteData?.dateOfBirth ?? null,
    height: athleteData?.displayHeight ?? null,
    weight: athleteData?.displayWeight ?? null,
    age: athleteData?.age != null ? Number(athleteData.age) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    links: (athleteData?.links ?? []).map((l: any) => ({ href: l?.href ?? "", text: l?.text ?? "" })),
  };
}

// ─── ROSTER + PLAYER STATS SCRAPER ───────────────────────────────────────────

async function scrapeRoster(
  competitorId: string,
  homeAway: "home" | "away",
  gameId: string,
  logger: EspnLogger,
  errors: string[]
): Promise<EspnRoster> {
  logger.step(`ROSTER:${competitorId}`, `Scraping roster for competitor ${competitorId} (${homeAway})`);

  const rosterUrl = `${ESPN_CORE_BASE}/events/${gameId}/competitions/${gameId}/competitors/${competitorId}/roster?lang=en&region=us`;

  let rosterData: unknown;
  try {
    rosterData = await fetchWithRetry(rosterUrl, `roster:${competitorId}`, logger);
  } catch (err) {
    const msg = `roster fetch failed for competitor ${competitorId}`;
    errors.push(`${msg}: ${err}`);
    logger.error(msg, err);
    return { team: { id: competitorId, abbreviation: competitorId, displayName: "" }, homeAway, formation: "", entries: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rd = rosterData as any;
  const formation = String(rd?.formation?.summary ?? rd?.formation?.name ?? "");
  const rawEntries = rd?.entries ?? [];

  logger.state(`Roster fetched for competitor ${competitorId}`, {
    formation,
    entryCount: rawEntries.length,
    starters: rawEntries.filter((e: { starter?: boolean }) => e?.starter).length,
  });

  // Build entry metadata list
  interface EntryMeta {
    playerId: number;
    jersey: number | null;
    starter: boolean;
    active: boolean;
    subbedIn: boolean;
    subbedOut: boolean;
    formationPlace: number | null;
    period: number;
    athleteRef: string;
    statsRef: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entryMeta: EntryMeta[] = rawEntries.map((entry: any) => ({
    playerId: Number(entry?.playerId ?? 0),
    jersey: entry?.jersey != null ? Number(entry.jersey) : null,
    starter: Boolean(entry?.starter),
    active: Boolean(entry?.active),
    subbedIn: Boolean(entry?.subbedIn?.value ?? entry?.subbedIn),
    subbedOut: Boolean(entry?.subbedOut?.value ?? entry?.subbedOut),
    formationPlace: entry?.formationPlace != null ? Number(entry.formationPlace) : null,
    period: Number(entry?.period ?? 0),
    athleteRef: forceHttps(entry?.athlete?.$ref ?? ""),
    statsRef: forceHttps(entry?.statistics?.$ref ?? ""),
  }));

  logger.state(`Processing ${entryMeta.length} players in parallel (max ${MAX_CONCURRENT} concurrent)`, {
    competitorId,
    homeAway,
    total: entryMeta.length,
  });

  // Parallel fetch all athlete profiles + player stats
  const playerEntries = await concurrentMap(
    entryMeta,
    async (meta, i): Promise<EspnPlayerEntry> => {
      let athleteData: unknown = {};
      let statsData: unknown = {};

      // Fetch athlete profile
      if (meta.athleteRef) {
        try {
          athleteData = await fetchWithRetry(meta.athleteRef, `athlete:${meta.playerId}`, logger);
        } catch (err) {
          errors.push(`athlete fetch failed playerId=${meta.playerId}: ${err}`);
          logger.error(`Athlete fetch failed`, err, { playerId: meta.playerId });
        }
      }

      // Fetch player stats
      if (meta.statsRef) {
        try {
          statsData = await fetchWithRetry(meta.statsRef, `playerStats:${meta.playerId}`, logger);
        } catch (err) {
          errors.push(`stats fetch failed playerId=${meta.playerId}: ${err}`);
          logger.error(`Player stats fetch failed`, err, { playerId: meta.playerId });
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const athlete = parseAthleteData(athleteData as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statistics = parseSplitCategories((statsData as any)?.splits);

      // Count non-zero stats for signal
      const nonZeroStats = statistics.reduce((acc, cat) => {
        return acc + Object.values(cat.stats).filter((v) => v !== "0" && v !== "0.0" && v !== "0.00" && v !== "").length;
      }, 0);

      logger.playerScraped(
        athlete.displayName || `Player#${meta.playerId}`,
        competitorId,
        athlete.positionAbbreviation || "?",
        nonZeroStats,
        i + 1,
        entryMeta.length
      );

      return {
        playerId: meta.playerId,
        jersey: meta.jersey,
        starter: meta.starter,
        active: meta.active,
        subbedIn: meta.subbedIn,
        subbedOut: meta.subbedOut,
        formationPlace: meta.formationPlace,
        period: meta.period,
        athlete,
        statistics,
      };
    },
    MAX_CONCURRENT
  );

  // Fetch team info from roster's team ref
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamRef = forceHttps((rd?.team as any)?.$ref ?? "");
  let teamAbbr = competitorId;
  let teamDisplayName = "";
  let teamId = competitorId;

  if (teamRef) {
    try {
      const teamData = await fetchWithRetry(teamRef, `team:${competitorId}`, logger);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const td = teamData as any;
      teamAbbr = String(td?.abbreviation ?? competitorId);
      teamDisplayName = String(td?.displayName ?? "");
      teamId = String(td?.id ?? competitorId);
      logger.state(`Team info resolved`, { teamId, teamAbbr, teamDisplayName });
    } catch (err) {
      errors.push(`team fetch failed for competitor ${competitorId}: ${err}`);
      logger.error(`Team info fetch failed`, err, { competitorId });
    }
  }

  const starters = playerEntries.filter((p) => p.starter).length;
  const subs = playerEntries.filter((p) => p.subbedIn).length;

  logger.output(`Roster complete: ${teamAbbr}`, {
    formation,
    starters,
    subs,
    total: playerEntries.length,
    homeAway,
  });
  logger.verify(playerEntries.length > 0 ? "PASS" : "WARN", `roster for ${teamAbbr}`, { count: playerEntries.length });

  return {
    team: { id: teamId, abbreviation: teamAbbr, displayName: teamDisplayName },
    homeAway,
    formation,
    entries: playerEntries,
  };
}

// ─── DEFERRED SECTION SCRAPER ───────────────────────────────────────────────

/**
 * Parses a Core API stats response (from /statistics endpoint) into
 * EspnDeferredStatRow[] (team-level) and EspnDeferredPlayerRow[] (player-level).
 * The ESPN Core API stats response has this shape:
 *   { splits: { categories: [ { name, displayName, stats: [ { name, displayValue, value } ] } ] } }
 * For team-level comparison tables the response is:
 *   { teams: [ { team: { id, abbreviation }, homeAway, statistics: [ ... ] } ] }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDeferredSection(data: any, sectionName: string, apiUrl: string): EspnDeferredSection {
  const teamRows: EspnDeferredStatRow[] = [];
  const playerRows: EspnDeferredPlayerRow[] = [];
  const rawKeys: string[] = [];

  if (!data) {
    return { sectionName, apiUrl, fetched: false, teamRows, playerRows, rawKeys, error: "no data" };
  }

  // ── Pattern A: boxscore.teams (team-level comparison) ──────────────────────
  // Shape: { boxscore: { teams: [ { team, homeAway, statistics: [ { name, displayValue } ] } ] } }
  const bxTeams = data?.boxscore?.teams ?? data?.teams ?? [];
  if (bxTeams.length >= 2) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const home = bxTeams.find((t: any) => (t?.homeAway ?? "") === "home") ?? bxTeams[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const away = bxTeams.find((t: any) => (t?.homeAway ?? "") === "away") ?? bxTeams[1];
    const homeId = String(home?.team?.id ?? "");
    const awayId = String(away?.team?.id ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const homeStats: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (home?.statistics ?? []).forEach((s: any) => {
      const k = String(s?.name ?? "");
      if (k) homeStats[k] = String(s?.displayValue ?? s?.value ?? "");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (away?.statistics ?? []).forEach((s: any) => {
      const k = String(s?.name ?? "");
      if (k) {
        if (!rawKeys.includes(k)) rawKeys.push(k);
        teamRows.push({
          name: k,
          displayName: String(s?.label ?? s?.name ?? k),
          homeValue: homeStats[k] ?? "",
          awayValue: String(s?.displayValue ?? s?.value ?? ""),
          homeTeamId: homeId,
          awayTeamId: awayId,
        });
      }
    });
    // Fill in any home-only keys
    for (const [k, v] of Object.entries(homeStats)) {
      if (!rawKeys.includes(k)) {
        rawKeys.push(k);
        teamRows.push({
          name: k,
          displayName: k,
          homeValue: v,
          awayValue: "",
          homeTeamId: homeId,
          awayTeamId: awayId,
        });
      }
    }
  }

  // ── Pattern B: splits.categories (player-level stats) ─────────────────────
  // Shape: { splits: { categories: [ { name, displayName, stats: [ { name, displayValue } ] } ] } }
  const splits = data?.splits ?? data?.statistics?.splits ?? null;
  if (splits?.categories) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (splits.categories ?? []).forEach((cat: any) => {
      const catName = String(cat?.name ?? "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cat?.stats ?? []).forEach((s: any) => {
        const k = `${catName}.${String(s?.name ?? "")}`;
        if (!rawKeys.includes(k)) rawKeys.push(k);
      });
    });
  }

  // ── Pattern C: direct stats array (flat) ──────────────────────────────────
  // Shape: { statistics: [ { name, displayValue } ] }
  const directStats = data?.statistics ?? [];
  if (Array.isArray(directStats) && directStats.length > 0 && teamRows.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    directStats.forEach((s: any) => {
      const k = String(s?.name ?? "");
      if (k && !rawKeys.includes(k)) rawKeys.push(k);
    });
  }

  // ── Pattern D: athletes array (player rows) ────────────────────────────────
  // Shape: { athletes: [ { team, athlete, statistics: [ { name, displayValue } ] } ] }
  const athletes = data?.athletes ?? data?.boxscore?.players ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const teamBlock of athletes) {
    const teamId = String(teamBlock?.team?.id ?? "");
    const teamAbbr = String(teamBlock?.team?.abbreviation ?? "");
    const homeAway = (teamBlock?.homeAway ?? "home") as "home" | "away";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statNames: string[] = (teamBlock?.statistics?.[0]?.names ?? teamBlock?.statistics?.map((s: any) => s?.name) ?? []).map(String);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const athleteEntry of (teamBlock?.athletes ?? [])) {
      const ath = athleteEntry?.athlete ?? athleteEntry;
      const playerId = String(ath?.id ?? "");
      const playerName = String(ath?.displayName ?? ath?.shortName ?? "");
      const jersey = String(ath?.jersey ?? "");
      const position = String(ath?.position?.abbreviation ?? ath?.position?.name ?? "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawStatValues: string[] = (athleteEntry?.stats ?? []).map((v: any) => String(v ?? ""));
      const stats: Record<string, string> = {};
      statNames.forEach((name, i) => {
        stats[name] = rawStatValues[i] ?? "";
      });
      // Also handle object-style stats
      if (rawStatValues.length === 0 && athleteEntry?.statistics) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (athleteEntry.statistics ?? []).forEach((s: any) => {
          stats[String(s?.name ?? "")] = String(s?.displayValue ?? s?.value ?? "");
        });
      }
      playerRows.push({ teamId, teamAbbr, homeAway, playerId, playerName, jersey, position, stats });
    }
  }

  return { sectionName, apiUrl, fetched: true, teamRows, playerRows, rawKeys, error: null };
}

/**
 * Fetches a single deferred Core API section by URL and parses it.
 * Returns an EspnDeferredSection with error=null on success, error=message on failure.
 */
async function scrapeCoreDeferredSection(
  url: string,
  sectionName: string,
  logger: EspnLogger,
  errors: string[]
): Promise<EspnDeferredSection> {
  const safeUrl = forceHttps(url);
  logger.step(`DEFERRED:${sectionName}`, `Fetching deferred section: ${sectionName}`);
  logger.state(`${sectionName} URL`, { url: safeUrl });

  try {
    const data = await fetchWithRetry(safeUrl, `deferred:${sectionName}`, logger);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    const topKeys = Object.keys(d ?? {});
    logger.state(`${sectionName} response top-level keys`, { keys: topKeys.join(", ") });

    const section = parseDeferredSection(d, sectionName, safeUrl);
    logger.output(`${sectionName} parsed`, {
      teamRows: section.teamRows.length,
      playerRows: section.playerRows.length,
      rawKeys: section.rawKeys.slice(0, 15).join(", "),
    });
    logger.verify(
      section.teamRows.length > 0 || section.playerRows.length > 0 || section.rawKeys.length > 0 ? "PASS" : "WARN",
      `${sectionName} has data`,
      { teamRows: section.teamRows.length, playerRows: section.playerRows.length, keys: section.rawKeys.length }
    );
    return section;
  } catch (err) {
    const msg = `${sectionName} fetch failed: ${err}`;
    errors.push(msg);
    logger.error(`Deferred section failed: ${sectionName}`, err);
    logger.verify("FAIL", `${sectionName} — fetch error`, { error: String(err) });
    return {
      sectionName,
      apiUrl: safeUrl,
      fetched: false,
      teamRows: [],
      playerRows: [],
      rawKeys: [],
      error: String(err),
    };
  }
}

// ─── MAIN SCRAPE FUNCTION ─────────────────────────────────────────────────────

export async function scrapeEspnMatch(
  urlOrGameId: string,
  options: {
    includePlayerStats?: boolean;
    includeCommentary?: boolean;
  } = {}
): Promise<EspnMatchData> {
  const { includePlayerStats = true, includeCommentary = true } = options;
  const errors: string[] = [];

  // ── Extract gameId ──────────────────────────────────────────────────────────
  let gameId: string;
  try {
    gameId = extractGameId(urlOrGameId);
  } catch (err) {
    throw new Error(`Invalid input: ${err}`);
  }

  const logger = createEspnLogger(gameId);
  const t0 = Date.now();

  logger.input("scrapeEspnMatch called", {
    urlOrGameId,
    gameId,
    includePlayerStats,
    includeCommentary,
  });

  // ── PHASE 1: Summary API ────────────────────────────────────────────────────
  logger.step("SUMMARY_API", "Fetching ESPN summary API (primary data source)");
  const summaryUrl = `${ESPN_SUMMARY_BASE}?event=${gameId}`;

  let summaryData: unknown;
  try {
    summaryData = await fetchWithRetry(summaryUrl, "summary", logger);
  } catch (err) {
    logger.fatal("Summary API failed — cannot continue", err, { gameId });
    logger.summary("FAILED");
    throw new Error(`Summary API failed for gameId ${gameId}: ${err}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = summaryData as any;
  const topLevelKeys = Object.keys(sd ?? {});
  logger.state("Summary API response received", {
    keys: topLevelKeys.join(", "),
    keyCount: topLevelKeys.length,
  });

  // ── PHASE 2: Competitor list ────────────────────────────────────────────────
  logger.step("COMPETITORS", "Fetching competitor list from sports.core.api");
  const competitorsUrl = `${ESPN_CORE_BASE}/events/${gameId}/competitions/${gameId}/competitors?lang=en&region=us`;

  let competitorsData: unknown;
  try {
    competitorsData = await fetchWithRetry(competitorsUrl, "competitors", logger);
  } catch (err) {
    errors.push(`competitors fetch failed: ${err}`);
    logger.error("Competitors fetch failed — will use summary rosters as fallback", err);
    competitorsData = { items: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const competitorItems: any[] = (competitorsData as any)?.items ?? [];
  logger.state("Competitor items received", {
    count: competitorItems.length,
    refs: competitorItems.map((i) => i?.$ref?.slice(-40) ?? "?").join(" | "),
  });

  // ── PHASE 3: Competitor details + stats ─────────────────────────────────────
  logger.step("COMP_STATS", "Fetching competitor details and team-level statistics");

  interface CompDetail { id: string; homeAway: "home" | "away"; statsRef: string; }
  const competitorDetails: CompDetail[] = [];
  const competitorStatsList: EspnCompetitorStats[] = [];

  for (const item of competitorItems) {
    const ref = forceHttps(item?.$ref ?? "");
    if (!ref) continue;

    try {
      const compData = await fetchWithRetry(ref, `competitor:${ref.slice(-12)}`, logger);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cd = compData as any;
      const compId = String(cd?.id ?? ref.match(/\/competitors\/(\d+)/)?.[1] ?? "");
      const homeAway = (cd?.homeAway ?? "home") as "home" | "away";
      const statsRef = forceHttps(cd?.statistics?.$ref ?? "");
      const score = cd?.score?.value ?? cd?.score ?? "?";
      const winner = cd?.winner;

      logger.state(`Competitor detail: ${compId} (${homeAway})`, {
        score,
        winner,
        statsRef: statsRef ? "present" : "missing",
        rosterRef: cd?.roster?.$ref ? "present" : "missing",
      });

      competitorDetails.push({ id: compId, homeAway, statsRef });

      // Fetch competitor-level stats
      if (statsRef) {
        try {
          const statsData = await fetchWithRetry(statsRef, `compStats:${compId}`, logger);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cats = parseSplitCategories((statsData as any)?.splits);
          competitorStatsList.push({
            team: { id: compId, abbreviation: compId },
            homeAway,
            categories: cats,
          });
          logger.state(`Competitor stats: ${compId}`, {
            categories: cats.map((c) => `${c.name}(${Object.keys(c.stats).length})`).join(", "),
          });
          logger.verify("PASS", `compStats for ${compId}`, { categoryCount: cats.length });
        } catch (err) {
          errors.push(`compStats fetch failed for ${compId}: ${err}`);
          logger.error(`Competitor stats fetch failed`, err, { compId });
        }
      }
    } catch (err) {
      errors.push(`competitor detail fetch failed: ${err}`);
      logger.error("Competitor detail fetch failed", err, { ref: ref.slice(-40) });
    }
  }

  // ── PHASE 4: Parse summary data ─────────────────────────────────────────────
  logger.step("PARSE_SUMMARY", "Parsing all summary data sections");

  const header = parseHeader(sd, gameId, logger);
  const teamStats = parseTeamStats(sd, logger);
  const keyEvents = parseKeyEvents(sd, logger);
  const commentary = includeCommentary ? parseCommentary(sd, logger) : [];
  const odds = parseOdds(sd, logger);

  // Article
  const art = sd?.article;
  const article = art ? {
    headline: String(art?.headline ?? ""),
    description: String(art?.description ?? ""),
    type: String(art?.type ?? ""),
    published: String(art?.published ?? ""),
    byline: String(art?.byline ?? ""),
  } : null;
  logger.parse("Article", { present: !!article, headline: article?.headline?.slice(0, 80) ?? "none" });

  // Videos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videos = (sd?.videos ?? []).map((v: any) => ({
    id: Number(v?.id ?? 0),
    headline: String(v?.headline ?? ""),
    duration: Number(v?.duration ?? 0),
  }));
  logger.parse("Videos", { count: videos.length });

  // Game info
  const gi = sd?.gameInfo ?? {};
  const giVenue = gi?.venue ?? {};
  const giAddress = giVenue?.address ?? {};
  const gameInfo = {
    venue: String(giVenue?.fullName ?? ""),
    city: String(giAddress?.city ?? ""),
    country: String(giAddress?.country ?? ""),
    attendance: gi?.attendance != null ? Number(gi.attendance) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    officials: (gi?.officials ?? []).map((o: any) => String(o?.fullName ?? o?.displayName ?? "")),
    capacity: giVenue?.capacity != null ? Number(giVenue.capacity) : null,
  };
  logger.parse("Game info", { venue: gameInfo.venue, city: gameInfo.city, attendance: gameInfo.attendance ?? "N/A" });

  // Last 5 games
  const lastFiveGames = (sd?.lastFiveGames ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (teamEntry: any) => ({
      teamAbbr: String(teamEntry?.team?.abbreviation ?? ""),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: (teamEntry?.events ?? []).map((ev: any) => {
        const comp = ev?.competitions?.[0] ?? {};
        const competitors = comp?.competitors ?? [];
        const scores: Record<string, string> = {};
        const winners: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        competitors.forEach((c: any) => {
          scores[c?.homeAway ?? "home"] = String(c?.score ?? "");
          if (c?.winner) winners.push(String(c?.team?.abbreviation ?? ""));
        });
        return {
          shortName: String(ev?.shortName ?? ""),
          status: String(comp?.status?.type?.shortDetail ?? ""),
          homeScore: scores["home"] ?? "",
          awayScore: scores["away"] ?? "",
          winner: winners,
        };
      }),
    })
  );
  logger.parse("Last 5 games", { teams: lastFiveGames.map((t: { teamAbbr: string; events: unknown[] }) => `${t.teamAbbr}(${t.events.length})`).join(", ") });

  // Head-to-head
  const headToHead = (sd?.headToHeadGames ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (g: any) => ({
      teamAbbr: String(g?.team?.abbreviation ?? ""),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: (g?.events ?? []).map((ev: any) => {
        const comp = ev?.competitions?.[0] ?? {};
        const competitors = comp?.competitors ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const home = competitors.find((c: { homeAway?: string; team?: Record<string,string>; score?: string }) => c?.homeAway === "home");
        const away = competitors.find((c: { homeAway?: string; team?: Record<string,string>; score?: string }) => c?.homeAway === "away");
        return {
          date: String(comp?.date ?? ""),
          homeTeam: String(home?.team?.abbreviation ?? ""),
          homeScore: String(home?.score ?? ""),
          awayTeam: String(away?.team?.abbreviation ?? ""),
          awayScore: String(away?.score ?? ""),
          status: String(comp?.status?.type?.shortDetail ?? ""),
        };
      }),
    })
  );
  logger.parse("Head-to-head", { groups: headToHead.length });

  // Leaders
  const leaders = (sd?.leaders ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (teamEntry: any) => ({
      teamAbbr: String(teamEntry?.team?.abbreviation ?? ""),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: (teamEntry?.leaders ?? []).map((cat: any) => ({
        name: String(cat?.name ?? ""),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        leaders: (cat?.leaders ?? []).map((l: any) => ({
          name: String(l?.athlete?.displayName ?? ""),
          value: l?.value != null ? String(l.value) : null,
        })),
      })),
    })
  );
  logger.parse("Leaders", { teams: leaders.length });

  // Format + Meta
  const fmt = sd?.format?.regulation ?? {};
  const format = {
    periods: Number(fmt?.periods ?? 2),
    periodName: String(fmt?.displayName ?? "Half"),
    clockSeconds: Number(fmt?.clock ?? 2700),
  };

  const metaRaw = sd?.meta ?? {};
  const meta = {
    lastUpdatedAt: String(metaRaw?.lastUpdatedAt ?? ""),
    gameState: String(metaRaw?.gameState ?? ""),
    firstPlayWallClock: metaRaw?.firstPlayWallClock ?? null,
    lastPlayWallClock: metaRaw?.lastPlayWallClock ?? null,
    syncUrl: String(metaRaw?.syncUrl ?? ""),
  };
  logger.parse("Format + Meta", { periods: format.periods, gameState: meta.gameState, lastUpdated: meta.lastUpdatedAt });

  // Broadcasts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcasts = (sd?.broadcasts ?? []).map((b: any) => ({
    type: String(b?.type?.shortName ?? ""),
    media: String(b?.media?.shortName ?? ""),
    lang: String(b?.lang ?? ""),
    region: String(b?.region ?? ""),
  }));
  logger.parse("Broadcasts", { count: broadcasts.length });

  // ── PHASE 5: Rosters + player stats ─────────────────────────────────────────
  let rosters: EspnRoster[] = [];

  if (includePlayerStats && competitorDetails.length > 0) {
    logger.step("PLAYER_STATS", `Fetching rosters + per-player stats for ${competitorDetails.length} teams`);

    rosters = await Promise.all(
      competitorDetails.map((cd) =>
        scrapeRoster(cd.id, cd.homeAway, gameId, logger, errors)
      )
    );

    const totalPlayers = rosters.reduce((a, r) => a + r.entries.length, 0);
    logger.output("All rosters scraped", {
      teams: rosters.map((r) => `${r.team.abbreviation}(${r.entries.length})`).join(", "),
      totalPlayers,
      formations: rosters.map((r) => `${r.team.abbreviation}:${r.formation}`).join(", "),
    });
    logger.verify(totalPlayers > 0 ? "PASS" : "WARN", "player stats populated", { totalPlayers });
  } else if (includePlayerStats) {
    // Fallback: use summary rosters (no per-player stats)
    logger.state("Fallback: using summary API rosters (no competitor details available)");
    rosters = (sd?.rosters ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (teamEntry: any) => {
        const t = teamEntry?.team ?? {};
        return {
          team: { id: String(t?.id ?? ""), abbreviation: String(t?.abbreviation ?? ""), displayName: String(t?.displayName ?? "") },
          homeAway: (teamEntry?.homeAway ?? "home") as "home" | "away",
          formation: "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          entries: (teamEntry?.roster ?? []).map((entry: any) => {
            const a = entry?.athlete ?? {};
            return {
              playerId: Number(a?.id ?? 0),
              jersey: a?.jersey != null ? Number(a.jersey) : null,
              starter: Boolean(entry?.starter),
              active: Boolean(entry?.active ?? true),
              subbedIn: Boolean(entry?.subbedIn),
              subbedOut: Boolean(entry?.subbedOut),
              formationPlace: null,
              period: 0,
              athlete: {
                id: String(a?.id ?? ""),
                displayName: String(a?.displayName ?? ""),
                shortName: String(a?.shortName ?? ""),
                jersey: String(a?.jersey ?? ""),
                position: String(a?.position?.name ?? ""),
                positionAbbreviation: String(a?.position?.abbreviation ?? ""),
                headshot: String(a?.headshot?.href ?? ""),
                nationality: "",
                birthDate: null,
                height: null,
                weight: null,
                age: null,
                links: [],
              },
              statistics: [],
            } as EspnPlayerEntry;
          }),
        };
      }
    );
    logger.verify("WARN", "Using fallback summary rosters — no per-player stats", { rosterCount: rosters.length });
  }

  // ── PHASE 6: Deferred Core API Sections (8 sections) ──────────────────────────
  // These sections are deferred in the ESPN React app and must be fetched from
  // the Core API separately. Each section maps to a named stats endpoint.
  // URL pattern: /events/{gameId}/competitions/{gameId}/statistics?statGroup=<name>
  logger.step("DEFERRED_SECTIONS", "Fetching 8 deferred Core API sections (shots, attack, passes, xG, GK, defense, duels, fouls)");

  const coreStatsBase = `${ESPN_CORE_BASE}/events/${gameId}/competitions/${gameId}/statistics`;

  const deferredSectionDefs: { key: string; name: string; statGroup: string }[] = [
    { key: "shotsDetail",         name: "Shots Detail",     statGroup: "shots" },
    { key: "attack",              name: "Attack",           statGroup: "attack" },
    { key: "passes",              name: "Passes",           statGroup: "passing" },
    { key: "expectedGoalsSplits", name: "Expected Goals",   statGroup: "expectedGoals" },
    { key: "goalkeeping",         name: "Goalkeeping",      statGroup: "goalkeeping" },
    { key: "defense",             name: "Defense",          statGroup: "defense" },
    { key: "duels",               name: "Duels",            statGroup: "duels" },
    { key: "foulsOffsides",       name: "Fouls & Offsides", statGroup: "foulsAndOffsides" },
  ];

  const deferredResults = await concurrentMap(
    deferredSectionDefs,
    async (def) => {
      const url = `${coreStatsBase}?lang=en&region=us&statGroup=${def.statGroup}`;
      const section = await scrapeCoreDeferredSection(url, def.name, logger, errors);
      // Fallback: try base stats URL if statGroup returned nothing
      if (!section.fetched || (section.teamRows.length === 0 && section.playerRows.length === 0 && section.rawKeys.length === 0)) {
        logger.state(`${def.name}: statGroup returned no data, trying base stats URL`);
        const baseUrl = `${coreStatsBase}?lang=en&region=us`;
        const fallback = await scrapeCoreDeferredSection(baseUrl, `${def.name}(base)`, logger, errors);
        if (fallback.teamRows.length > 0 || fallback.playerRows.length > 0 || fallback.rawKeys.length > 0) {
          return { key: def.key, section: { ...fallback, sectionName: def.name } };
        }
      }
      return { key: def.key, section };
    },
    4
  );

  const deferredMap: Record<string, EspnDeferredSection> = {};
  for (const { key, section } of deferredResults) {
    deferredMap[key] = section;
    logger.verify(
      section.fetched && (section.teamRows.length > 0 || section.playerRows.length > 0 || section.rawKeys.length > 0) ? "PASS" : "WARN",
      `DEFERRED: ${section.sectionName}`,
      { teamRows: section.teamRows.length, playerRows: section.playerRows.length, keys: section.rawKeys.length, error: section.error ?? "none" }
    );
  }

  const emptySection = (name: string): EspnDeferredSection => ({
    sectionName: name, apiUrl: "", fetched: false, teamRows: [], playerRows: [], rawKeys: [], error: "not fetched"
  });

  const shotsDetail         = deferredMap["shotsDetail"]         ?? emptySection("Shots Detail");
  const attack              = deferredMap["attack"]              ?? emptySection("Attack");
  const passes              = deferredMap["passes"]              ?? emptySection("Passes");
  const expectedGoalsSplits = deferredMap["expectedGoalsSplits"] ?? emptySection("Expected Goals");
  const goalkeeping         = deferredMap["goalkeeping"]         ?? emptySection("Goalkeeping");
  const defense             = deferredMap["defense"]             ?? emptySection("Defense");
  const duels               = deferredMap["duels"]              ?? emptySection("Duels");
  const foulsOffsides       = deferredMap["foulsOffsides"]       ?? emptySection("Fouls & Offsides");

  logger.output("All 8 deferred sections fetched", {
    shotsDetail:          `${shotsDetail.teamRows.length}rows/${shotsDetail.rawKeys.length}keys`,
    attack:               `${attack.teamRows.length}rows/${attack.rawKeys.length}keys`,
    passes:               `${passes.teamRows.length}rows/${passes.rawKeys.length}keys`,
    expectedGoalsSplits:  `${expectedGoalsSplits.teamRows.length}rows/${expectedGoalsSplits.rawKeys.length}keys`,
    goalkeeping:          `${goalkeeping.teamRows.length}rows/${goalkeeping.rawKeys.length}keys`,
    defense:              `${defense.teamRows.length}rows/${defense.rawKeys.length}keys`,
    duels:                `${duels.teamRows.length}rows/${duels.rawKeys.length}keys`,
    foulsOffsides:        `${foulsOffsides.teamRows.length}rows/${foulsOffsides.rawKeys.length}keys`,
  });

  // ── PHASE 7: Assemble + validate ─────────────────────────────────────────────
  logger.step("ASSEMBLE", "Assembling final EspnMatchData object");

  const scrapeDurationMs = Date.now() - t0;

  const result: EspnMatchData = {
    gameId,
    scrapedAt: new Date().toISOString(),
    scrapeDurationMs,
    apiCallCount: logger.getApiCallCount(),
    retryCount: logger.getRetryCount(),
    bytesTransferred: logger.getBytesTransferred(),
    errors,
    logFile: logger.getLogFile(),
    statsFile: logger.getStatsFile(),
    runId: logger.getRunId(),
    header,
    teamStats,
    keyEvents,
    commentary,
    odds,
    rosters,
    competitorStats: competitorStatsList,
    article,
    videos,
    broadcasts,
    headToHead,
    lastFiveGames,
    leaders,
    gameInfo,
    format,
    meta,
    // 8 deferred Core API sections
    shotsDetail,
    attack,
    passes,
    expectedGoalsSplits,
    goalkeeping,
    defense,
    duels,
    foulsOffsides,
  };

  // Final validation gates
  logger.verify(result.header.competitors.length >= 2 ? "PASS" : "FAIL", "header has 2 competitors");
  logger.verify(result.teamStats.length > 0 ? "PASS" : "WARN", "teamStats populated", { count: result.teamStats.length });
  logger.verify(result.keyEvents.length > 0 ? "PASS" : "WARN", "keyEvents populated", { count: result.keyEvents.length });
  logger.verify(result.rosters.length > 0 ? "PASS" : "WARN", "rosters populated", { count: result.rosters.length });
  logger.verify(errors.length === 0 ? "PASS" : "WARN", `error count = ${errors.length}`, { errors: errors.slice(0, 3) });
  // Deferred section gates
  logger.verify(result.shotsDetail.fetched ? "PASS" : "WARN", "shotsDetail fetched", { rows: result.shotsDetail.teamRows.length, keys: result.shotsDetail.rawKeys.length });
  logger.verify(result.attack.fetched ? "PASS" : "WARN", "attack fetched", { rows: result.attack.teamRows.length, keys: result.attack.rawKeys.length });
  logger.verify(result.passes.fetched ? "PASS" : "WARN", "passes fetched", { rows: result.passes.teamRows.length, keys: result.passes.rawKeys.length });
  logger.verify(result.expectedGoalsSplits.fetched ? "PASS" : "WARN", "expectedGoalsSplits fetched", { rows: result.expectedGoalsSplits.teamRows.length, keys: result.expectedGoalsSplits.rawKeys.length });
  logger.verify(result.goalkeeping.fetched ? "PASS" : "WARN", "goalkeeping fetched", { rows: result.goalkeeping.teamRows.length, keys: result.goalkeeping.rawKeys.length });
  logger.verify(result.defense.fetched ? "PASS" : "WARN", "defense fetched", { rows: result.defense.teamRows.length, keys: result.defense.rawKeys.length });
  logger.verify(result.duels.fetched ? "PASS" : "WARN", "duels fetched", { rows: result.duels.teamRows.length, keys: result.duels.rawKeys.length });
  logger.verify(result.foulsOffsides.fetched ? "PASS" : "WARN", "foulsOffsides fetched", { rows: result.foulsOffsides.teamRows.length, keys: result.foulsOffsides.rawKeys.length });

  // Run summary
  const outcome =
    logger.getErrorCount() > 8
      ? "FAILED"
      : errors.length > 5
      ? "PARTIAL"
      : "SUCCESS";

  const stats = logger.summary(outcome as "SUCCESS" | "PARTIAL" | "FAILED", {
    gameId,
    status: header.status.shortDetail,
    match: `${header.competitors.find((c) => c.homeAway === "home")?.team.abbreviation ?? "?"} vs ${header.competitors.find((c) => c.homeAway === "away")?.team.abbreviation ?? "?"}`,
    score: `${header.competitors.find((c) => c.homeAway === "home")?.score ?? "?"}-${header.competitors.find((c) => c.homeAway === "away")?.score ?? "?"}`,
    players: rosters.reduce((a, r) => a + r.entries.length, 0),
    commentary: commentary.length,
    logFile: logger.getLogFile(),
  });

  // Attach stats to result
  (result as EspnMatchData & { runStats: typeof stats }).runStats = stats;

  return result;
}

// ─── SCOREBOARD SCRAPER ───────────────────────────────────────────────────────

export interface EspnScoreboardEvent {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status: string;
  statusDetail: string;
  homeTeam: { id: string; abbreviation: string; displayName: string; score: string; logo: string };
  awayTeam: { id: string; abbreviation: string; displayName: string; score: string; logo: string };
  venue: string;
  broadcasts: string[];
  league: string;
}

export async function scrapeEspnScoreboard(dateYYYYMMDD: string): Promise<EspnScoreboardEvent[]> {
  const logger = createEspnLogger(`scoreboard:${dateYYYYMMDD}`);
  logger.input("scrapeEspnScoreboard called", { date: dateYYYYMMDD });
  logger.step("SCOREBOARD_API", `Fetching ESPN scoreboard for ${dateYYYYMMDD}`);

  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateYYYYMMDD}`;
  const data = await fetchWithRetry(url, `scoreboard:${dateYYYYMMDD}`, logger);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;

  logger.parse("Parsing scoreboard events");
  const events: EspnScoreboardEvent[] = (d?.events ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any) => {
      const comp = ev?.competitions?.[0] ?? {};
      const status = comp?.status ?? {};
      const statusType = status?.type ?? {};
      const competitors = comp?.competitors ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const home = competitors.find((c: any) => c?.homeAway === "home");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const away = competitors.find((c: any) => c?.homeAway === "away");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const makeTeam = (c: any) => ({
        id: String(c?.team?.id ?? ""),
        abbreviation: String(c?.team?.abbreviation ?? ""),
        displayName: String(c?.team?.displayName ?? ""),
        score: String(c?.score ?? "0"),
        logo: String(c?.team?.logo ?? ""),
      });

      return {
        id: String(ev?.id ?? ""),
        name: String(ev?.name ?? ""),
        shortName: String(ev?.shortName ?? ""),
        date: String(comp?.date ?? ev?.date ?? ""),
        status: String(statusType?.name ?? ""),
        statusDetail: String(statusType?.shortDetail ?? ""),
        homeTeam: makeTeam(home),
        awayTeam: makeTeam(away),
        venue: String(comp?.venue?.fullName ?? ""),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broadcasts: (comp?.broadcasts ?? []).map((b: any) => String(b?.media?.shortName ?? b?.names?.[0] ?? "")),
        league: String(d?.leagues?.[0]?.abbreviation ?? ""),
      };
    }
  );

  logger.output("Scoreboard scraped", {
    date: dateYYYYMMDD,
    eventCount: events.length,
    events: events.map((e) => `${e.shortName}[${e.statusDetail}]`).join(", "),
  });
  logger.verify(events.length > 0 ? "PASS" : "WARN", "scoreboard has events", { count: events.length });
  logger.summary("SUCCESS", { date: dateYYYYMMDD, events: events.length });

  return events;
}
