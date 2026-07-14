/**
 * mlbAllStarGame.ts — the MLB All-Star Game (American League vs National League)
 * on the "AI Model Projections" MLB feed.
 *
 * Why this is bespoke: the ASG is an AL-vs-NL exhibition. The Monte-Carlo engine
 * and the auto AN-odds refresh both key off the 30 clubs, so neither can model
 * or resolve AL/NL. The AL/NL squads are registered as pseudo-teams in
 * shared/mlbTeams.ts (so the game passes isValidGame and resolves logos), the
 * BOOK odds are scraped live from Action Network via the existing
 * fetchActionNetworkOdds scraper (server/actionNetworkScraper.ts) — NOT a static
 * snapshot — and the MODEL is owner-provided (the engine can't compute AL/NL).
 *
 * The model run line and total are LADDERS. Because the feed card pins each
 * market to the *live* book line, we store the model's odds at every plausible
 * line and display the rung that matches the current book, so book and model
 * always sit on the same line/direction. As the market moves the rung re-selects.
 *
 * All values verified from the Action Network API (event 291776, 2026-07-14).
 * This file's pure exports (config + compute*) have NO database dependency, so
 * they are safe to import from a CI preview script that runs without a DB.
 */
import type { AnGameOdds } from "./actionNetworkScraper";

export const MLB_ASG = {
  gameDate: "2026-07-14", // ET/PT kickoff day (first pitch ~8:00 PM ET)
  anGameId: 291776, // Action Network event id (verified)
  awayAbbr: "AL",
  homeAbbr: "NL",
  awaySlug: "american-league", // AN url_slug (away, team_id 249)
  homeSlug: "national-league", // AN url_slug (home, team_id 250)
  startTimeEst: "8:00 PM",
} as const;

/**
 * Owner-provided MODEL. The engine can't compute AL/NL, so these are fixed.
 * Run line + total are ladders (odds per line); ML is a single pair.
 * The model favors the American League (contrarian to the current market, which
 * favors the NL) — this is intentional and fully specified across both run-line
 * directions so it renders cleanly whichever side the live book is on.
 */
const MODEL = {
  awayML: "-104", // AL
  homeML: "+104", // NL
  /** Run-line ladder, keyed by the AWAY (AL) spread the book is currently showing. */
  runLine: {
    "-1.5": { away: "+226", home: "-226" }, // AL -1.5 / NL +1.5
    "+1.5": { away: "-262", home: "+262" }, // AL +1.5 / NL -1.5
  } as Record<string, { away: string; home: string }>,
  /** Total ladder, keyed by the book's current total line. */
  total: {
    "7": { over: "-169", under: "+169" },
    "7.5": { over: "-115", under: "+115" },
    "8": { over: "+103", under: "-103" },
    "8.5": { over: "+121", under: "-121" },
  } as Record<string, { over: string; under: string }>,
};

/** American odds → implied probability (0-100), 2dp. Owner pairs are already no-vig. */
export function impliedProb(odds: string | number): number {
  const n = typeof odds === "number" ? odds : parseFloat(odds);
  if (isNaN(n)) return NaN;
  const p = n < 0 ? -n / (-n + 100) : 100 / (n + 100);
  return +(p * 100).toFixed(2);
}

/** Nearest ladder key for a numeric line (clamps outside the ladder's range). */
function nearestKey(line: number, keys: string[]): string {
  let best = keys[0];
  let bestD = Infinity;
  for (const k of keys) {
    const d = Math.abs(parseFloat(k) - line);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

const fmtSpread = (v: number | null | undefined): string | null =>
  v == null ? null : v > 0 ? `+${v}` : `${v}`;

/** Book snapshot for the ASG (one book, DK-if-complete-else-Open). */
export interface AsgBook {
  awayML: string | null;
  homeML: string | null;
  awaySpread: string | null;
  awaySpreadOdds: string | null;
  homeSpread: string | null;
  homeSpreadOdds: string | null;
  total: string | null;
  overOdds: string | null;
  underOdds: string | null;
  source: "dk" | "open" | "none";
}

/**
 * Normalize an Action Network game to a book snapshot using DK-NJ-if-complete-
 * else-Open, mirroring vsinAutoRefresh.updateAnOdds' atomic source switch so the
 * preview book matches what the live refresh would write.
 */
export function bookFromAnGame(g: AnGameOdds): AsgBook {
  const dkComplete =
    g.dkAwaySpread != null && g.dkAwaySpreadOdds != null &&
    g.dkHomeSpread != null && g.dkHomeSpreadOdds != null &&
    g.dkTotal != null && g.dkOverOdds != null && g.dkUnderOdds != null &&
    g.dkAwayML != null && g.dkHomeML != null;

  if (dkComplete) {
    return {
      awayML: g.dkAwayML,
      homeML: g.dkHomeML,
      awaySpread: fmtSpread(g.dkAwaySpread),
      awaySpreadOdds: g.dkAwaySpreadOdds,
      homeSpread: fmtSpread(g.dkHomeSpread),
      homeSpreadOdds: g.dkHomeSpreadOdds,
      total: g.dkTotal != null ? `${g.dkTotal}` : null,
      overOdds: g.dkOverOdds,
      underOdds: g.dkUnderOdds,
      source: "dk",
    };
  }
  return {
    awayML: g.openAwayML,
    homeML: g.openHomeML,
    awaySpread: fmtSpread(g.openAwaySpread),
    awaySpreadOdds: g.openAwaySpreadOdds,
    homeSpread: fmtSpread(g.openHomeSpread),
    homeSpreadOdds: g.openHomeSpreadOdds,
    total: g.openTotal != null ? `${g.openTotal}` : null,
    overOdds: g.openOverOdds,
    underOdds: g.openUnderOdds,
    source: g.openAwayML != null ? "open" : "none",
  };
}

/** Model fields written to the games row (all as feed/DB-ready strings). */
export interface AsgModel {
  modelAwayML: string;
  modelHomeML: string;
  modelAwayWinPct: string;
  modelHomeWinPct: string;
  awayModelSpread: string;
  homeModelSpread: string;
  modelAwaySpreadOdds: string;
  modelHomeSpreadOdds: string;
  modelAwayPLCoverPct: string;
  modelHomePLCoverPct: string;
  modelTotal: string;
  modelOverOdds: string;
  modelUnderOdds: string;
  modelOverRate: string;
  modelUnderRate: string;
  runLineRung: string;
  totalRung: string;
}

/**
 * Select the run-line + total rungs matching the live book line and compute the
 * model fields. Book and model therefore always share the same line/direction.
 */
export function computeAsgModel(book: AsgBook): AsgModel {
  // Run line — pick the rung by the book's away (AL) spread direction.
  const awaySpreadNum = book.awaySpread != null ? parseFloat(book.awaySpread) : 1.5;
  const rlKey = awaySpreadNum < 0 ? "-1.5" : "+1.5";
  const rl = MODEL.runLine[rlKey];
  const awayModelSpread = rlKey;
  const homeModelSpread = rlKey === "+1.5" ? "-1.5" : "+1.5";

  // Total — pick the rung by the book's total line (nearest ladder key).
  const totalNum = book.total != null ? parseFloat(book.total) : 8;
  const tKey = MODEL.total[String(totalNum)] ? String(totalNum) : nearestKey(totalNum, Object.keys(MODEL.total));
  const tot = MODEL.total[tKey];
  const modelTotal = book.total ?? tKey;

  return {
    modelAwayML: MODEL.awayML,
    modelHomeML: MODEL.homeML,
    modelAwayWinPct: impliedProb(MODEL.awayML).toFixed(2),
    modelHomeWinPct: impliedProb(MODEL.homeML).toFixed(2),
    awayModelSpread,
    homeModelSpread,
    modelAwaySpreadOdds: rl.away,
    modelHomeSpreadOdds: rl.home,
    modelAwayPLCoverPct: impliedProb(rl.away).toFixed(2),
    modelHomePLCoverPct: impliedProb(rl.home).toFixed(2),
    modelTotal,
    modelOverOdds: tot.over,
    modelUnderOdds: tot.under,
    modelOverRate: impliedProb(tot.over).toFixed(2),
    modelUnderRate: impliedProb(tot.under).toFixed(2),
    runLineRung: rlKey,
    totalRung: tKey,
  };
}

/** Locate the ASG in an AN MLB slate (by AN event id, then by AL/NL slug pair). */
export function findAsgInSlate(anGames: AnGameOdds[]): AnGameOdds | undefined {
  return (
    anGames.find((g) => g.gameId === MLB_ASG.anGameId) ??
    anGames.find((g) => g.awayUrlSlug === MLB_ASG.awaySlug && g.homeUrlSlug === MLB_ASG.homeSlug)
  );
}
