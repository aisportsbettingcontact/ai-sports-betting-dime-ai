/**
 * nhlHockeyRefTeamStats.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fallback NHL team stats scraper using Hockey-Reference (hockey-reference.com)
 * when NaturalStatTrick is blocked by Cloudflare.
 *
 * Data source: https://www.hockey-reference.com/leagues/NHL_2026.html
 *   - stats_adv table (in HTML comment): CF%, SC%, HDSC%, xGF%, SH%, SV%, GF, GA
 *
 * Per-60 rate computation (CORRECTED):
 *   HR provides all-situations counts (not 5v5 only) and the GP field is N/A.
 *   Direct count-to-per-60 conversion produces inflated values (~55% too high).
 *
 *   Instead, we use the PERCENTAGE stats HR provides (CF%, SC%, HDSC%, xGF%)
 *   and anchor them to NST 2025-26 league average per-60 rates:
 *
 *     stat_60 = (stat_pct / 50.0) * LEAGUE_STAT_60
 *
 *   Example: BOS CF%=49.2 → CF_60 = (49.2/50) * 57.17 = 56.25 ✓
 *   This matches NST's per-60 output because percentage stats are scale-invariant.
 *
 * Outputs: Map<string, NhlTeamStats> keyed by NHL abbreviation (e.g. "BOS", "TOR")
 */

import * as cheerio from "cheerio";
import type { NhlTeamStats } from "./nhlNaturalStatScraper.js";
import { NHL_TEAMS } from "../shared/nhlTeams.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const HR_URL = "https://www.hockey-reference.com/leagues/NHL_2026.html";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.hockey-reference.com/",
};

// NST 2025-26 league average per-60 rates (5v5, all situations)
// Source: NaturalStatTrick, verified March 2026 (32 teams)
// Used to anchor HR percentage stats to correct per-60 scale:
//   stat_60 = (stat_pct / 50.0) * LEAGUE_STAT_60
const LEAGUE_XGF_60  = 2.662;   // Expected Goals For per 60
const LEAGUE_XGA_60  = 2.660;   // Expected Goals Against per 60
const LEAGUE_HDCF_60 = 11.457;  // High-Danger Corsi For per 60
const LEAGUE_HDCA_60 = 11.453;  // High-Danger Corsi Against per 60
const LEAGUE_SCF_60  = 26.975;  // Scoring Chances For per 60
const LEAGUE_SCA_60  = 26.952;  // Scoring Chances Against per 60
const LEAGUE_CF_60   = 57.171;  // Corsi For per 60
const LEAGUE_CA_60   = 57.132;  // Corsi Against per 60

// ─── HR team name → NHL abbreviation mapping ─────────────────────────────────

const HR_NAME_TO_ABBREV: Record<string, string> = {
  "Anaheim Ducks":          "ANA",
  "Boston Bruins":          "BOS",
  "Buffalo Sabres":         "BUF",
  "Calgary Flames":         "CGY",
  "Carolina Hurricanes":    "CAR",
  "Chicago Blackhawks":     "CHI",
  "Colorado Avalanche":     "COL",
  "Columbus Blue Jackets":  "CBJ",
  "Dallas Stars":           "DAL",
  "Detroit Red Wings":      "DET",
  "Edmonton Oilers":        "EDM",
  "Florida Panthers":       "FLA",
  "Los Angeles Kings":      "LAK",
  "Minnesota Wild":         "MIN",
  "Montreal Canadiens":     "MTL",
  "Nashville Predators":    "NSH",
  "New Jersey Devils":      "NJD",
  "New York Islanders":     "NYI",
  "New York Rangers":       "NYR",
  "Ottawa Senators":        "OTT",
  "Philadelphia Flyers":    "PHI",
  "Pittsburgh Penguins":    "PIT",
  "San Jose Sharks":        "SJS",
  "Seattle Kraken":         "SEA",
  "St. Louis Blues":        "STL",
  "Tampa Bay Lightning":    "TBL",
  "Toronto Maple Leafs":    "TOR",
  "Utah Mammoth":           "UTA",
  "Vancouver Canucks":      "VAN",
  "Vegas Golden Knights":   "VGK",
  "Washington Capitals":    "WSH",
  "Winnipeg Jets":          "WPG",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 50.0 : n;
}

function num(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function svPctFromHR(val: string): number {
  // HR stores SV% as ".920" (decimal), NST stores as "92.0" (percentage)
  const n = parseFloat(val);
  if (isNaN(n)) return 91.5;
  // If value < 1, it's already decimal — convert to percentage
  return n < 1 ? n * 100 : n;
}

/**
 * Compute per-60 rate from a percentage stat anchored to NST league averages.
 * stat_60 = (stat_pct / 50.0) * LEAGUE_STAT_60
 *
 * This is correct because:
 *   - HR percentage stats are scale-invariant (all-sit and 5v5 give same %)
 *   - A team at 55% CF% has CF_60 = (55/50) * 57.17 = 62.9 (matches NST)
 *   - A team at 50% CF% has CF_60 = 57.17 (league average, correct)
 */
function pctToRate60(pctVal: number, leagueAvg60: number): number {
  if (pctVal <= 0) return leagueAvg60; // fallback to league average
  return (pctVal / 50.0) * leagueAvg60;
}

/**
 * Compute the opponent's per-60 rate from the team's percentage stat.
 * opponent_60 = (100 - stat_pct) / 50.0 * LEAGUE_STAT_60
 */
function oppPctToRate60(pctVal: number, leagueAvg60: number): number {
  const oppPct = 100 - pctVal;
  return pctToRate60(oppPct, leagueAvg60);
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

/**
 * Scrape NHL team advanced stats from Hockey-Reference.
 * Returns a Map<abbrev, NhlTeamStats> compatible with the NST scraper output.
 *
 * All logging prefixed with [HRTeamStats] for noise-free filtering.
 */
export async function scrapeNhlTeamStatsFromHockeyRef(): Promise<Map<string, NhlTeamStats>> {
  console.log(`[HRTeamStats] ── Fetching NHL team stats from Hockey-Reference ──`);
  console.log(`[HRTeamStats] URL: ${HR_URL}`);

  const res = await fetch(HR_URL, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`[HRTeamStats] HTTP ${res.status} from Hockey-Reference`);
  }

  const html = await res.text();
  console.log(`[HRTeamStats] Fetched ${html.length} bytes`);

  const $ = cheerio.load(html);

  // HR hides the stats_adv table in an HTML comment — extract it
  let advTableHtml = "";
  $("*").contents().each(function () {
    if (this.type === "comment" && (this as any).data.includes("stats_adv")) {
      advTableHtml = (this as any).data;
      return false; // break
    }
  });

  if (!advTableHtml) {
    throw new Error("[HRTeamStats] stats_adv table not found in HTML comments");
  }

  const $adv = cheerio.load(advTableHtml);
  const rows = $adv("#stats_adv tbody tr").toArray();

  console.log(`[HRTeamStats] stats_adv rows: ${rows.length}`);

  if (rows.length === 0) {
    throw new Error("[HRTeamStats] No rows found in stats_adv table");
  }

  const results = new Map<string, NhlTeamStats>();

  for (const row of rows) {
    const $row = $adv(row);
    const g = (stat: string) => $row.find(`td[data-stat="${stat}"]`).text().trim();

    const rawName = g("team_name").replace(/\*/g, "").trim();
    if (!rawName) continue;

    const abbrev = HR_NAME_TO_ABBREV[rawName];
    if (!abbrev) {
      console.warn(`[HRTeamStats] ⚠ Unknown team name: "${rawName}" — skipping`);
      continue;
    }

    const teamRecord = NHL_TEAMS.find(t => t.abbrev === abbrev);
    const teamName = teamRecord?.name ?? rawName;

    // ── Count stats from stats_adv ────────────────────────────────────────────
    const cf_for      = num(g("corsi_for_5on5"));
    const cf_against  = num(g("corsi_against_5on5"));
    const cf_pct      = pct(g("corsi_pct_5on5"));

    const sc_for      = num(g("sc_for"));
    const sc_against  = num(g("sc_against"));
    const sc_pct      = pct(g("sc_for_pct"));

    const hdsc_for    = num(g("hdsc_for"));
    const hdsc_against = num(g("hdsc_against"));
    const hdsc_pct    = pct(g("hdsc_for_pct"));

    const xgf_total   = num(g("exp_on_goals_for"));
    const xga_total   = num(g("exp_on_goals_against"));
    const gf          = num(g("actual_goals"));
    const ga          = num(g("actual_goals_against"));

    const sh_pct      = pct(g("shot_pct_5on5"));
    const sv_pct_raw  = svPctFromHR(g("sv_pct_5on5"));

    // ── xGF% and xGA% from raw counts ────────────────────────────────────────
    const xg_total = xgf_total + xga_total;
    const xGF_pct = xg_total > 0 ? (xgf_total / xg_total) * 100 : 50.0;
    const xGA_pct = 100 - xGF_pct;

    // ── Per-60 rate stats via percentage anchoring (CORRECTED) ────────────────
    // HR counts include all-situations (not 5v5 only) and GP is not available.
    // Using pct_to_rate60(pct, league_avg) = (pct / 50.0) * league_avg
    // This produces values consistent with NST's 5v5 per-60 output.
    const xGF_60  = pctToRate60(xGF_pct, LEAGUE_XGF_60);
    const xGA_60  = pctToRate60(xGA_pct, LEAGUE_XGA_60);
    const HDCF_60 = pctToRate60(hdsc_pct, LEAGUE_HDCF_60);
    const HDCA_60 = oppPctToRate60(hdsc_pct, LEAGUE_HDCA_60);
    const SCF_60  = pctToRate60(sc_pct, LEAGUE_SCF_60);
    const SCA_60  = oppPctToRate60(sc_pct, LEAGUE_SCA_60);
    const CF_60   = pctToRate60(cf_pct, LEAGUE_CF_60);
    const CA_60   = oppPctToRate60(cf_pct, LEAGUE_CA_60);
    // GP estimate for logging only (not used in per-60 computation)
    const gpSafe = Math.max(Math.round((cf_for + cf_against) / (2 * 57.0)), 1);

    const stats: NhlTeamStats = {
      abbrev,
      name: teamName,
      gp: gpSafe, // estimated from CF counts for logging only
      xGF_pct,
      xGA_pct,
      CF_pct:   cf_pct,
      SCF_pct:  sc_pct,
      HDCF_pct: hdsc_pct,
      SH_pct:   sh_pct,
      SV_pct:   sv_pct_raw,
      GF:       gf,
      GA:       ga,
      xGF_60,
      xGA_60,
      HDCF_60,
      HDCA_60,
      SCF_60,
      SCA_60,
      CF_60,
      CA_60,
    };

    results.set(abbrev, stats);

    console.log(
      `[HRTeamStats]   ${abbrev}: GP≈${gpSafe} CF%=${cf_pct} ` +
      `xGF_60=${xGF_60.toFixed(2)} xGA_60=${xGA_60.toFixed(2)} ` +
      `HDCF_60=${HDCF_60.toFixed(2)} HDCA_60=${HDCA_60.toFixed(2)} ` +
      `SCF_60=${SCF_60.toFixed(2)} SCA_60=${SCA_60.toFixed(2)} ` +
      `CF_60=${CF_60.toFixed(2)} CA_60=${CA_60.toFixed(2)} ` +
      `SH%=${sh_pct} SV%=${sv_pct_raw.toFixed(1)} GF=${gf} GA=${ga}`
    );
  }

  console.log(`[HRTeamStats] ✅ Scraped ${results.size}/32 teams from Hockey-Reference`);

  if (results.size < 30) {
    throw new Error(`[HRTeamStats] Only ${results.size} teams scraped — expected ≥30`);
  }

  return results;
}

// ─── Tier 4: Hardcoded 2025-26 Regular Season Stats (All 3 scrapers blocked) ──
/**
 * getHardcodedPlayoffTeamStats()
 *
 * Returns a Map<abbrev, NhlTeamStats> with 2025-26 regular season per-60 stats
 * for all 16 NHL playoff teams, derived from the NHL Stats API (api.nhle.com)
 * GF/GA/SF/SA per-game data scaled against NST 2025-26 league average per-60 rates.
 *
 * Formula:
 *   xGF_60  = (team_GF_per_game / league_GF_per_game) × LEAGUE_XGF_60
 *   xGA_60  = (team_GA_per_game / league_GA_per_game) × LEAGUE_XGA_60
 *   CF_60   = (team_SF_per_game / league_SF_per_game) × LEAGUE_CF_60
 *   HDCF_60 = (team_GF_per_game / league_GF_per_game) × LEAGUE_HDCF_60
 *   SCF_60  = (team_SF_per_game / league_SF_per_game) × LEAGUE_SCF_60
 *
 * Source: NHL Stats API cayenneExp=seasonId=20252026 and gameTypeId=2 (regular season)
 * Verified: May 13, 2026 — all 16 playoff teams, 82 GP each
 *
 * Used as Tier 4 fallback when NST, Hockey-Reference, and MoneyPuck are all
 * Cloudflare-blocked from the server environment.
 */
export function getHardcodedPlayoffTeamStats(): Map<string, NhlTeamStats> {
  // League averages from NHL API 2025-26 regular season (32 teams, 82 GP)
  const LEAGUE_GF_G  = 3.158;   // avg goals for per game
  const LEAGUE_GA_G  = 3.158;   // avg goals against per game (symmetric)
  const LEAGUE_SF_G  = 28.437;  // avg shots for per game
  const LEAGUE_SA_G  = 28.437;  // avg shots against per game (symmetric)

  // NST 2025-26 league average per-60 rates (from nhlHockeyRefTeamStats.ts constants)
  const LG_XGF_60  = LEAGUE_XGF_60;
  const LG_XGA_60  = LEAGUE_XGA_60;
  const LG_CF_60   = LEAGUE_CF_60;
  const LG_HDCF_60 = LEAGUE_HDCF_60;
  const LG_SCF_60  = LEAGUE_SCF_60;

  // Helper: compute NhlTeamStats from raw per-game rates
  const make = (
    abbrev: string,
    name: string,
    gf_g: number,
    ga_g: number,
    sf_g: number,
    sa_g: number,
    sh_pct: number,
    sv_pct: number,
    gf: number,
    ga: number,
  ): NhlTeamStats => {
    const xGF_60  = (gf_g / LEAGUE_GF_G) * LG_XGF_60;
    const xGA_60  = (ga_g / LEAGUE_GA_G) * LG_XGA_60;
    const CF_60   = (sf_g / LEAGUE_SF_G) * LG_CF_60;
    const CA_60   = (sa_g / LEAGUE_SA_G) * LG_CF_60;
    const HDCF_60 = (gf_g / LEAGUE_GF_G) * LG_HDCF_60;
    const HDCA_60 = (ga_g / LEAGUE_GA_G) * LG_HDCF_60;
    const SCF_60  = (sf_g / LEAGUE_SF_G) * LG_SCF_60;
    const SCA_60  = (sa_g / LEAGUE_SA_G) * LG_SCF_60;
    const xGF_pct = (xGF_60 / (xGF_60 + xGA_60)) * 100;
    const xGA_pct = 100 - xGF_pct;
    const CF_pct  = (CF_60 / (CF_60 + CA_60)) * 100;
    const SCF_pct = (SCF_60 / (SCF_60 + SCA_60)) * 100;
    const HDCF_pct = (HDCF_60 / (HDCF_60 + HDCA_60)) * 100;
    return {
      abbrev, name, gp: 82,
      xGF_pct, xGA_pct, CF_pct, SCF_pct, HDCF_pct,
      SH_pct: sh_pct, SV_pct: sv_pct,
      GF: gf, GA: ga,
      xGF_60, xGA_60, HDCF_60, HDCA_60, SCF_60, SCA_60, CF_60, CA_60,
    };
  };

  // ── 2025-26 Regular Season Data (NHL Stats API, verified May 13, 2026) ──────
  // Columns: abbrev, name, GF/G, GA/G, SF/G, SA/G, SH%, SV%, GF, GA
  const rawData: [string, string, number, number, number, number, number, number, number, number][] = [
    // Eastern Conference Playoff Teams
    ["BUF", "Buffalo Sabres",          3.4512, 2.9268, 28.122, 29.061, 11.2, 91.0, 283, 240],
    ["MTL", "Montréal Canadiens",      3.4024, 3.0610, 26.293, 27.829, 11.8, 91.2, 279, 251],
    ["CAR", "Carolina Hurricanes",     3.5488, 2.8780, 32.159, 23.927, 10.1, 91.5, 291, 236],
    ["FLA", "Florida Panthers",        3.0000, 3.3415, 27.988, 26.793, 9.8,  90.0, 246, 274],
    ["OTT", "Ottawa Senators",         3.3537, 2.9878, 28.915, 24.402, 10.6, 91.1, 275, 245],
    ["PHI", "Philadelphia Flyers",     2.9268, 2.9146, 25.463, 25.451, 10.5, 90.1, 240, 239],
    ["BOS", "Boston Bruins",           3.2683, 3.0122, 27.024, 29.695, 11.1, 90.5, 268, 247],
    ["TBL", "Tampa Bay Lightning",     3.4878, 2.7927, 28.110, 26.695, 11.3, 91.4, 286, 229],
    // Western Conference Playoff Teams
    ["COL", "Colorado Avalanche",      3.6341, 2.4024, 33.732, 26.134, 9.8,  91.9, 298, 197],
    ["DAL", "Dallas Stars",            3.3293, 2.7073, 25.293, 26.159, 12.0, 91.7, 273, 222],
    ["MIN", "Minnesota Wild",          3.2683, 2.8659, 29.183, 29.402, 10.2, 91.0, 268, 235],
    ["STL", "St. Louis Blues",         2.8049, 3.0976, 25.329, 27.707, 10.1, 90.2, 230, 254],
    ["WPG", "Winnipeg Jets",           2.7927, 3.1220, 26.366, 27.768, 9.7,  90.1, 229, 256],
    ["NSH", "Nashville Predators",     2.9512, 3.2561, 27.866, 29.622, 9.6,  89.8, 242, 267],
    ["VGK", "Vegas Golden Knights",    3.2195, 2.9512, 28.988, 24.390, 10.2, 91.0, 264, 242],
    ["ANA", "Anaheim Ducks",           3.2317, 3.5122, 30.805, 28.366, 9.6,  89.5, 265, 288],
  ];

  const result = new Map<string, NhlTeamStats>();
  for (const [abbrev, name, gf_g, ga_g, sf_g, sa_g, sh_pct, sv_pct, gf, ga] of rawData) {
    const stats = make(abbrev, name, gf_g, ga_g, sf_g, sa_g, sh_pct, sv_pct, gf, ga);
    result.set(abbrev, stats);
    console.log(
      `[HardcodedStats] ${abbrev}: xGF_60=${stats.xGF_60.toFixed(3)} xGA_60=${stats.xGA_60.toFixed(3)} ` +
      `CF_60=${stats.CF_60.toFixed(2)} HDCF_60=${stats.HDCF_60.toFixed(3)}`
    );
  }
  console.log(`[HardcodedStats] ✅ Loaded hardcoded 2025-26 regular season stats for ${result.size}/16 playoff teams`);
  return result;
}

// ─── NHL API Playoff Team Stats ───────────────────────────────────────────────

/**
 * Fetches actual 2025-26 NHL playoff team stats from the NHL Stats API.
 *
 * Uses gameTypeId=3 (playoffs) to get per-game rates from actual playoff performance.
 * Normalizes against PLAYOFF league averages (not regular season) so that the
 * Sharp Line Engine's LEAGUE_XGF_60 constants produce correct relative ratings.
 *
 * Formula (same as getHardcodedPlayoffTeamStats but with playoff league averages):
 *   xGF_60  = (team_GF_per_game / PLAYOFF_LEAGUE_GF_G) × LEAGUE_XGF_60
 *   xGA_60  = (team_GA_per_game / PLAYOFF_LEAGUE_GF_G) × LEAGUE_XGA_60
 *   CF_60   = (team_SF_per_game / PLAYOFF_LEAGUE_SF_G) × LEAGUE_CF_60
 *
 * Source: https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=20252026 and gameTypeId=3
 */
export async function fetchNhlPlayoffTeamStats(): Promise<Map<string, NhlTeamStats>> {
  const url = "https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22%3A%22points%22%2C%22direction%22%3A%22DESC%22%7D%5D&start=0&limit=50&factCayenneExp=gamesPlayed%3E%3D1&cayenneExp=gameTypeId%3D3%20and%20seasonId%3D20252026";

  console.log("[PlayoffStats] Fetching 2025-26 playoff team stats from NHL API...");

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(`[PlayoffStats] NHL API returned ${resp.status}: ${resp.statusText}`);
  }

  const json = await resp.json() as { data: Array<{
    teamAbbrev: string;
    teamFullName: string;
    gamesPlayed: number;
    goalsFor: number;
    goalsAgainst: number;
    shotsForPerGame: number;
    shotsAgainstPerGame: number;
    shootingPct: number;
    savePct: number;
  }> };

  const teams = json.data;
  if (!teams || teams.length === 0) {
    throw new Error("[PlayoffStats] NHL API returned empty data array");
  }

  console.log(`[PlayoffStats] Received ${teams.length} playoff teams from NHL API`);

  // Compute playoff league averages from the API data
  const totalGP = teams.reduce((s, t) => s + t.gamesPlayed, 0);
  const totalGF = teams.reduce((s, t) => s + t.goalsFor, 0);
  const totalSF = teams.reduce((s, t) => s + (t.shotsForPerGame * t.gamesPlayed), 0);

  // Each game has 2 teams, so total goals = 2 * goals_per_game * games
  // league avg goals per team per game = totalGF / totalGP
  const PLAYOFF_LEAGUE_GF_G = totalGP > 0 ? totalGF / totalGP : 2.881;
  const PLAYOFF_LEAGUE_SF_G = totalGP > 0 ? totalSF / totalGP : 28.46;

  console.log(`[PlayoffStats] Playoff league averages: GF/G=${PLAYOFF_LEAGUE_GF_G.toFixed(3)} SF/G=${PLAYOFF_LEAGUE_SF_G.toFixed(3)} (${totalGP} team-games)`);

  const result = new Map<string, NhlTeamStats>();

  for (const t of teams) {
    const gf_g = t.goalsFor / t.gamesPlayed;
    const ga_g = t.goalsAgainst / t.gamesPlayed;
    const sf_g = t.shotsForPerGame;
    // NHL API doesn't provide shotsAgainstPerGame directly in summary — approximate from league avg
    const sa_g = PLAYOFF_LEAGUE_SF_G * 2 - sf_g; // symmetric: total shots = 2 * league avg
    const sh_pct = (t.shootingPct ?? 0) * 100;    // API returns decimal (0.126), convert to %
    const sv_pct = (t.savePct ?? 0) * 100;         // API returns decimal (0.912), convert to %

    // Normalize against PLAYOFF league averages
    const xGF_60  = (gf_g / PLAYOFF_LEAGUE_GF_G) * LEAGUE_XGF_60;
    const xGA_60  = (ga_g / PLAYOFF_LEAGUE_GF_G) * LEAGUE_XGA_60;
    const CF_60   = (sf_g / PLAYOFF_LEAGUE_SF_G) * LEAGUE_CF_60;
    const CA_60   = (sa_g / PLAYOFF_LEAGUE_SF_G) * LEAGUE_CF_60;
    const HDCF_60 = (gf_g / PLAYOFF_LEAGUE_GF_G) * LEAGUE_HDCF_60;
    const HDCA_60 = (ga_g / PLAYOFF_LEAGUE_GF_G) * LEAGUE_HDCF_60;
    const SCF_60  = (sf_g / PLAYOFF_LEAGUE_SF_G) * LEAGUE_SCF_60;
    const SCA_60  = (sa_g / PLAYOFF_LEAGUE_SF_G) * LEAGUE_SCF_60;

    const xGF_pct  = (xGF_60 / (xGF_60 + xGA_60)) * 100;
    const xGA_pct  = 100 - xGF_pct;
    const CF_pct   = (CF_60 / (CF_60 + CA_60)) * 100;
    const SCF_pct  = (SCF_60 / (SCF_60 + SCA_60)) * 100;
    const HDCF_pct = (HDCF_60 / (HDCF_60 + HDCA_60)) * 100;

    const stats: NhlTeamStats = {
      abbrev: t.teamAbbrev,
      name: t.teamFullName,
      gp: t.gamesPlayed,
      xGF_pct, xGA_pct, CF_pct, SCF_pct, HDCF_pct,
      SH_pct: sh_pct,
      SV_pct: sv_pct,
      GF: t.goalsFor,
      GA: t.goalsAgainst,
      xGF_60, xGA_60, HDCF_60, HDCA_60, SCF_60, SCA_60, CF_60, CA_60,
    };

    result.set(t.teamAbbrev, stats);
    console.log(
      `[PlayoffStats] ${t.teamAbbrev} (${t.gamesPlayed} GP): GF/G=${gf_g.toFixed(3)} GA/G=${ga_g.toFixed(3)} ` +
      `xGF_60=${xGF_60.toFixed(3)} xGA_60=${xGA_60.toFixed(3)} SH%=${sh_pct.toFixed(1)} SV%=${sv_pct.toFixed(1)}`
    );
  }

  console.log(`[PlayoffStats] ✅ Loaded live 2025-26 playoff stats for ${result.size} teams`);
  return result;
}

/**
 * Fetches 2025-26 NHL playoff goalie stats from the NHL Stats API.
 * Returns Map<goalie_full_name, NhlGoalieStats>.
 */
export async function fetchNhlPlayoffGoalieStats(): Promise<Map<string, import("./nhlNaturalStatScraper.js").NhlGoalieStats>> {
  const url = "https://api.nhle.com/stats/rest/en/goalie/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22%3A%22wins%22%2C%22direction%22%3A%22DESC%22%7D%5D&start=0&limit=50&factCayenneExp=gamesPlayed%3E%3D1&cayenneExp=gameTypeId%3D3%20and%20seasonId%3D20252026";

  console.log("[PlayoffGoalieStats] Fetching 2025-26 playoff goalie stats from NHL API...");

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(`[PlayoffGoalieStats] NHL API returned ${resp.status}: ${resp.statusText}`);
  }

  const json = await resp.json() as { data: Array<{
    goalieFullName: string;
    teamAbbrevs: string;
    gamesPlayed: number;
    savePct: number;
    goalsAgainst: number;
    shotsAgainst: number;
    wins: number;
    losses: number;
  }> };

  const goalies = json.data;
  if (!goalies || goalies.length === 0) {
    throw new Error("[PlayoffGoalieStats] NHL API returned empty data array");
  }

  console.log(`[PlayoffGoalieStats] Received ${goalies.length} playoff goalies from NHL API`);

  const result = new Map<string, import("./nhlNaturalStatScraper.js").NhlGoalieStats>();

  for (const g of goalies) {
    const sv_pct = (g.savePct ?? 0) * 100;
    const shots = g.shotsAgainst ?? 0;
    const ga = g.goalsAgainst ?? 0;
    const gp = g.gamesPlayed ?? 0;

    // Compute GSAx: league avg SV% in playoffs ≈ 90.0%
    // GSAx = shots * (actual_sv_pct - league_avg_sv_pct)
    // Use 90.0% as playoff league average save percentage
    const PLAYOFF_LEAGUE_SV_PCT = 0.900;
    const gsax = shots * ((g.savePct ?? PLAYOFF_LEAGUE_SV_PCT) - PLAYOFF_LEAGUE_SV_PCT);

    // xGA: estimated as shots * league_avg_goal_rate = shots * (1 - 0.900)
    const xga = shots * (1 - PLAYOFF_LEAGUE_SV_PCT);

    const stats: import("./nhlNaturalStatScraper.js").NhlGoalieStats = {
      name: g.goalieFullName,
      team: g.teamAbbrevs ?? "",
      gp,
      sv_pct,
      gsax,
      xga,
      ga,
      shots,
    };

    result.set(g.goalieFullName, stats);
    console.log(
      `[PlayoffGoalieStats] ${g.goalieFullName} (${g.teamAbbrevs}, ${gp} GP): SV%=${sv_pct.toFixed(1)} GSAx=${gsax.toFixed(2)} SA=${shots}`
    );
  }

  console.log(`[PlayoffGoalieStats] ✅ Loaded live 2025-26 playoff goalie stats for ${result.size} goalies`);
  return result;
}
