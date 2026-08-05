/**
 * anKPropsService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live MLB pitcher K-prop lines from Action Network's internal API.
 *
 * Endpoint:
 *   GET https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets
 *       ?bookIds=15,30,1071,1076,1072,1073,1074,1075,1239,1241,1243,2672
 *       &customPickTypes=core_bet_type_37_strikeouts
 *       &date=YYYYMMDD
 *
 * Response structure:
 *   players[]          – pitcher metadata (id, full_name, team_id, abbr)
 *   games[]            – game metadata (id, away_team, home_team, start_time)
 *   markets[book_id]   – { event: { core_bet_type_37_strikeouts: [...] } }
 *     each entry: { player_id, side, value, odds, event_id, is_live }
 *
 * Consensus line: modal value across all books; no-vig probability computed
 * from average over/under odds across all available books.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const AN_API_BASE = "https://api.actionnetwork.com/web/v2/scoreboard/mlb";
const AN_BOOK_IDS = "15,30,1071,1076,1072,1073,1074,1075,1239,1241,1243,2672";
const AN_PROP_TYPE = "core_bet_type_37_strikeouts";
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://www.actionnetwork.com",
  Referer: "https://www.actionnetwork.com/mlb/props/pitching",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ANKPropLine {
  /** AN player ID */
  anPlayerId: number;
  /** Full pitcher name */
  pitcherName: string;
  /** AN team abbreviation (LAD, WSH, etc.) */
  teamAbbr: string;
  /** AN game ID */
  gameId: number;
  /** Consensus K-prop line (modal value across all books) */
  line: number;
  /** Average over odds across all books (American) */
  overOdds: number | null;
  /** Average under odds across all books (American) */
  underOdds: number | null;
  /** No-vig probability of the over (0–1) */
  noVigOverPct: number | null;
  /** Number of books offering this prop */
  bookCount: number;
  /** Whether any book has this as a live prop */
  isLive: boolean;
}

export interface ANKPropsResult {
  date: string; // YYYYMMDD
  fetchedAt: string; // ISO timestamp
  props: ANKPropLine[];
  /** Raw game metadata keyed by AN game ID */
  games: Record<
    number,
    {
      id: number;
      awayAbbr: string;
      homeAbbr: string;
      startTime: string;
      status: string;
    }
  >;
}

interface ANPlayer {
  id: number;
  full_name: string;
  abbr: string;
  team_id: number;
  primary_position: string;
}

interface ANGame {
  id: number;
  status: string;
  start_time: string;
  away_team: { id: number; abbr: string };
  home_team: { id: number; abbr: string };
}

interface ANMarketEntry {
  player_id: number;
  side: "over" | "under";
  value: number;
  odds: number;
  event_id: number;
  is_live: boolean;
  is_alt_market: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function americanToProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function modalValue(values: number[]): number {
  if (values.length === 0) return 0;
  const freq: Record<number, number> = {};
  let maxCount = 0;
  let modal = values[0];
  for (const v of values) {
    freq[v] = (freq[v] ?? 0) + 1;
    if (freq[v] > maxCount) {
      maxCount = freq[v];
      modal = v;
    }
  }
  return modal;
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Main Scraper ──────────────────────────────────────────────────────────────

/**
 * Fetch K-prop lines from Action Network for a given date.
 * @param dateStr  YYYYMMDD format (e.g. "20260403")
 */
export async function fetchANKProps(dateStr: string): Promise<ANKPropsResult> {
  const url = `${AN_API_BASE}/markets?bookIds=${AN_BOOK_IDS}&customPickTypes=${AN_PROP_TYPE}&date=${dateStr}`;

  console.log(`[ANKProps][${dateStr}] [STEP] Fetching from: ${url}`);

  const res = await fetch(url, { headers: AN_HEADERS });

  if (!res.ok) {
    throw new Error(
      `[ANKProps][${dateStr}] [ERROR] HTTP ${res.status} from AN API`
    );
  }

  const data = (await res.json()) as {
    players: ANPlayer[];
    games: ANGame[];
    markets: Record<string, { event?: Record<string, ANMarketEntry[]> }>;
  };

  console.log(
    `[ANKProps][${dateStr}] [STATE] Raw response: ${data.players.length} players, ${data.games.length} games, ${Object.keys(data.markets).length} books`
  );

  // ── Build lookup maps ──────────────────────────────────────────────────────
  const playerMap = new Map<number, ANPlayer>(data.players.map(p => [p.id, p]));
  const teamToGame = new Map<number, ANGame>();
  const gameMap = new Map<number, ANGame>();

  for (const g of data.games) {
    gameMap.set(g.id, g);
    teamToGame.set(g.away_team.id, g);
    teamToGame.set(g.home_team.id, g);
  }

  // ── Aggregate lines across all books ──────────────────────────────────────
  const playerAgg = new Map<
    number,
    {
      values: number[];
      overOdds: number[];
      underOdds: number[];
      eventId: number;
      isLive: boolean;
    }
  >();

  for (const [bookId, bookData] of Object.entries(data.markets)) {
    const kMarkets = bookData.event?.[AN_PROP_TYPE] ?? [];
    for (const m of kMarkets) {
      // Skip alt markets (different line values)
      if (m.is_alt_market) continue;

      if (!playerAgg.has(m.player_id)) {
        playerAgg.set(m.player_id, {
          values: [],
          overOdds: [],
          underOdds: [],
          eventId: m.event_id,
          isLive: false,
        });
      }
      const agg = playerAgg.get(m.player_id)!;
      agg.values.push(m.value);
      if (m.side === "over") agg.overOdds.push(m.odds);
      else agg.underOdds.push(m.odds);
      if (m.is_live) agg.isLive = true;

      console.log(
        `[ANKProps][${dateStr}] [STATE] Book ${bookId} | Player ${m.player_id} | ${m.side} ${m.value} @ ${m.odds > 0 ? "+" : ""}${m.odds}`
      );
    }
  }

  // ── Build output ───────────────────────────────────────────────────────────
  const props: ANKPropLine[] = [];

  for (const [playerId, agg] of Array.from(playerAgg.entries())) {
    const player = playerMap.get(playerId);
    if (!player) {
      console.warn(
        `[ANKProps][${dateStr}] [WARN] Player ID ${playerId} not found in players list`
      );
      continue;
    }

    // Only include starting pitchers
    if (player.primary_position !== "SP" && player.primary_position !== "P") {
      console.log(
        `[ANKProps][${dateStr}] [SKIP] ${player.full_name} (${player.primary_position}) — not SP`
      );
      continue;
    }

    const game = teamToGame.get(player.team_id);
    const line = modalValue(agg.values);
    const overOdds = avg(agg.overOdds);
    const underOdds = avg(agg.underOdds);

    let noVigOverPct: number | null = null;
    if (overOdds !== null && underOdds !== null) {
      const pOver = americanToProb(overOdds);
      const pUnder = americanToProb(underOdds);
      noVigOverPct = pOver / (pOver + pUnder);
    }

    const teamAbbr = game
      ? game.away_team.id === player.team_id
        ? game.away_team.abbr
        : game.home_team.abbr
      : "???";

    const prop: ANKPropLine = {
      anPlayerId: playerId,
      pitcherName: player.full_name,
      teamAbbr,
      gameId: agg.eventId,
      line,
      overOdds: overOdds !== null ? Math.round(overOdds) : null,
      underOdds: underOdds !== null ? Math.round(underOdds) : null,
      noVigOverPct,
      bookCount: Math.max(agg.overOdds.length, agg.underOdds.length),
      isLive: agg.isLive,
    };

    props.push(prop);

    console.log(
      `[ANKProps][${dateStr}] [OUTPUT] ${player.full_name} (${teamAbbr}) | Line: ${line} | Over: ${overOdds !== null ? (overOdds > 0 ? "+" : "") + Math.round(overOdds) : "N/A"} | Under: ${underOdds !== null ? (underOdds > 0 ? "+" : "") + Math.round(underOdds) : "N/A"} | No-Vig Over: ${noVigOverPct !== null ? (noVigOverPct * 100).toFixed(1) + "%" : "N/A"} | Books: ${prop.bookCount}`
    );
  }

  // Sort by game start time, then by team
  props.sort((a, b) => {
    const ga = gameMap.get(a.gameId);
    const gb = gameMap.get(b.gameId);
    const ta = ga?.start_time ?? "";
    const tb = gb?.start_time ?? "";
    return ta.localeCompare(tb) || a.teamAbbr.localeCompare(b.teamAbbr);
  });

  // Build games output
  const gamesOut: ANKPropsResult["games"] = {};
  for (const [id, g] of Array.from(gameMap.entries())) {
    gamesOut[id] = {
      id: g.id,
      awayAbbr: g.away_team.abbr,
      homeAbbr: g.home_team.abbr,
      startTime: g.start_time,
      status: g.status,
    };
  }

  const result: ANKPropsResult = {
    date: dateStr,
    fetchedAt: new Date().toISOString(),
    props,
    games: gamesOut,
  };

  console.log(
    `[ANKProps][${dateStr}] [VERIFY] Fetched ${props.length} K-props across ${data.games.length} games | PASS`
  );

  return result;
}

/**
 * Format a Date as YYYYMMDD for the AN API.
 */
export function formatANDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
