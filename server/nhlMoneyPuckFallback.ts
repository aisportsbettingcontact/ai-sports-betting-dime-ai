/**
 * nhlMoneyPuckFallback.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Third-tier fallback NHL stats scraper using MoneyPuck CSV data.
 * Used when NaturalStatTrick (primary) AND Hockey-Reference (secondary) are
 * both blocked by bot protection (HTTP 403) from the sandbox/server IP.
 *
 * Data source: https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/
 *   - teams.csv   → 5v5 situation team stats
 *   - goalies.csv → all-situation goalie stats
 *
 * Per-60 conversion:
 *   MoneyPuck provides raw counts + iceTime (in seconds).
 *   We convert: stat_per60 = (raw_count / (iceTime_sec / 60)) * 60
 *
 *   Percentage stats (xGF_pct, CF_pct, etc.) are derived from For/(For+Against).
 *
 * NST league-average anchoring (same constants as nhlHockeyRefTeamStats.ts):
 *   Used for SH% and SV% which MoneyPuck doesn't provide in the teams CSV.
 *   These are filled with league averages (non-critical for model accuracy).
 *
 * Outputs:
 *   - scrapeNhlTeamStatsFromMoneyPuck()  → Map<string, NhlTeamStats>
 *   - scrapeNhlGoalieStatsFromMoneyPuck() → Map<string, NhlGoalieStats>
 */

import type { NhlTeamStats, NhlGoalieStats } from "./nhlNaturalStatScraper.js";
import { NHL_TEAMS } from "../shared/nhlTeams.js";

// ─── Constants ───────────────────────────────────────────────────────────────
const MP_TEAMS_URL   = "https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/teams.csv";
const MP_GOALIES_URL = "https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/goalies.csv";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/csv,text/plain,*/*",
  "Referer": "https://moneypuck.com/",
};

// NST 2025-26 league average per-60 rates (5v5)
// Used to fill SH% and SV% which MoneyPuck doesn't expose in teams CSV
const LEAGUE_SH_PCT = 2.55;   // League average shooting %
const LEAGUE_SV_PCT = 97.45;  // League average save %

// MoneyPuck team abbreviation → NHL standard abbreviation mapping
// MoneyPuck uses mostly standard abbreviations but has a few differences
const MP_ABBREV_MAP: Record<string, string> = {
  "ANA": "ANA",
  "ARI": "UTA",  // Arizona → Utah Mammoth (relocated)
  "UTA": "UTA",  // Utah Mammoth
  "BOS": "BOS",
  "BUF": "BUF",
  "CAR": "CAR",
  "CBJ": "CBJ",
  "CGY": "CGY",
  "CHI": "CHI",
  "COL": "COL",
  "DAL": "DAL",
  "DET": "DET",
  "EDM": "EDM",
  "FLA": "FLA",
  "LAK": "LAK",
  "MIN": "MIN",
  "MTL": "MTL",
  "NJD": "NJD",
  "NSH": "NSH",
  "NYI": "NYI",
  "NYR": "NYR",
  "OTT": "OTT",
  "PHI": "PHI",
  "PIT": "PIT",
  "SEA": "SEA",
  "SJS": "SJS",
  "STL": "STL",
  "TBL": "TBL",
  "TOR": "TOR",
  "VAN": "VAN",
  "VGK": "VGK",
  "WPG": "WPG",
  "WSH": "WSH",
};

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function safeFloat(val: string | undefined, fallback = 0): number {
  const n = parseFloat(val ?? "");
  return isNaN(n) ? fallback : n;
}

// ─── Team stats scraper ───────────────────────────────────────────────────────
export async function scrapeNhlTeamStatsFromMoneyPuck(): Promise<Map<string, NhlTeamStats>> {
  console.log("[MPFallback] Fetching MoneyPuck team stats CSV...");
  const resp = await fetch(MP_TEAMS_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`[MPFallback] Teams CSV fetch failed: HTTP ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);

  // Filter to 5v5 situation
  const fv5 = rows.filter(r => r["situation"] === "5on5");
  console.log(`[MPFallback]   5v5 rows: ${fv5.length}`);

  const statsMap = new Map<string, NhlTeamStats>();

  for (const row of fv5) {
    const mpAbbrev = row["team"] ?? "";
    const abbrev = MP_ABBREV_MAP[mpAbbrev] ?? mpAbbrev;
    if (!abbrev) continue;

    // Ice time in seconds → convert to minutes for per-60
    const iceTimeSec = safeFloat(row["iceTime"]);
    const iceTimeMin = iceTimeSec / 60.0;
    if (iceTimeMin < 1) {
      console.warn(`[MPFallback]   Skipping ${abbrev}: near-zero icetime (${iceTimeMin.toFixed(1)} min)`);
      continue;
    }

    // Raw counts
    const xGF  = safeFloat(row["xGoalsFor"]);
    const xGA  = safeFloat(row["xGoalsAgainst"]);
    const HDCF = safeFloat(row["highDangerShotsFor"]);   // high danger shots for ≈ HDCF
    const HDCA = safeFloat(row["highDangerShotsAgainst"]);
    const medSF = safeFloat(row["mediumDangerShotsFor"]);
    const medSA = safeFloat(row["mediumDangerShotsAgainst"]);
    const SCF  = medSF + HDCF;  // medium + high danger = scoring chances
    const SCA  = medSA + HDCA;
    const CF   = safeFloat(row["shotAttemptsFor"]);
    const CA   = safeFloat(row["shotAttemptsAgainst"]);
    const GF   = safeFloat(row["goalsFor"]);
    const GA   = safeFloat(row["goalsAgainst"]);
    const gp   = safeFloat(row["games_played"]);

    // Per-60 rates
    const xGF_60  = (xGF  / iceTimeMin) * 60;
    const xGA_60  = (xGA  / iceTimeMin) * 60;
    const HDCF_60 = (HDCF / iceTimeMin) * 60;
    const HDCA_60 = (HDCA / iceTimeMin) * 60;
    const SCF_60  = (SCF  / iceTimeMin) * 60;
    const SCA_60  = (SCA  / iceTimeMin) * 60;
    const CF_60   = (CF   / iceTimeMin) * 60;
    const CA_60   = (CA   / iceTimeMin) * 60;

    // Percentage stats (derived from For/(For+Against))
    const xGF_pct  = xGF  + xGA  > 0 ? (xGF  / (xGF  + xGA))  * 100 : 50;
    const xGA_pct  = 100 - xGF_pct;
    const CF_pct   = CF   + CA   > 0 ? (CF   / (CF   + CA))   * 100 : 50;
    const SCF_pct  = SCF  + SCA  > 0 ? (SCF  / (SCF  + SCA))  * 100 : 50;
    const HDCF_pct = HDCF + HDCA > 0 ? (HDCF / (HDCF + HDCA)) * 100 : 50;

    // SH% and SV% — use league average (MoneyPuck teams CSV doesn't expose these)
    const SH_pct = LEAGUE_SH_PCT;
    const SV_pct = LEAGUE_SV_PCT;

    // Find team name from NHL_TEAMS registry
    const teamEntry = NHL_TEAMS.find(t => t.abbrev === abbrev);
    const name = teamEntry?.name ?? abbrev;

    const stats: NhlTeamStats = {
      abbrev,
      name,
      gp: Math.round(gp),
      xGF_pct:  parseFloat(xGF_pct.toFixed(2)),
      xGA_pct:  parseFloat(xGA_pct.toFixed(2)),
      CF_pct:   parseFloat(CF_pct.toFixed(2)),
      SCF_pct:  parseFloat(SCF_pct.toFixed(2)),
      HDCF_pct: parseFloat(HDCF_pct.toFixed(2)),
      SH_pct,
      SV_pct,
      GF:  Math.round(GF),
      GA:  Math.round(GA),
      xGF_60:  parseFloat(xGF_60.toFixed(4)),
      HDCF_60: parseFloat(HDCF_60.toFixed(4)),
      SCF_60:  parseFloat(SCF_60.toFixed(4)),
      CF_60:   parseFloat(CF_60.toFixed(4)),
      xGA_60:  parseFloat(xGA_60.toFixed(4)),
      HDCA_60: parseFloat(HDCA_60.toFixed(4)),
      SCA_60:  parseFloat(SCA_60.toFixed(4)),
      CA_60:   parseFloat(CA_60.toFixed(4)),
    };

    statsMap.set(abbrev, stats);
  }

  console.log(`[MPFallback]   ✅ Team stats computed for ${statsMap.size} teams`);

  // Validate: log any teams with suspiciously low xGF_60 (< 1.5 or > 5.0)
  for (const [abbrev, s] of Array.from(statsMap.entries())) {
    if (s.xGF_60 < 1.5 || s.xGF_60 > 5.0) {
      console.warn(`[MPFallback]   ⚠ ${abbrev}: xGF_60=${s.xGF_60} (out of expected 1.5–5.0 range)`);
    }
  }

  return statsMap;
}

// ─── Goalie stats scraper ─────────────────────────────────────────────────────
export async function scrapeNhlGoalieStatsFromMoneyPuck(): Promise<Map<string, NhlGoalieStats>> {
  console.log("[MPFallback] Fetching MoneyPuck goalie stats CSV...");
  const resp = await fetch(MP_GOALIES_URL, { headers: FETCH_HEADERS });
  if (!resp.ok) throw new Error(`[MPFallback] Goalies CSV fetch failed: HTTP ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);

  // Filter to 'all' situation (all-situation stats for goalies)
  const allSit = rows.filter(r => r["situation"] === "all");
  console.log(`[MPFallback]   Goalie rows (all-situation): ${allSit.length}`);

  const goalieMap = new Map<string, NhlGoalieStats>();

  for (const row of allSit) {
    const name = (row["name"] ?? "").trim();
    if (!name) continue;

    const mpAbbrev = row["team"] ?? "";
    const team = MP_ABBREV_MAP[mpAbbrev] ?? mpAbbrev;
    const gp    = safeFloat(row["games_played"]);
    const shots = safeFloat(row["ongoal"]);   // shots on goal faced
    const GA    = safeFloat(row["goals"]);    // goals against
    const xGA   = safeFloat(row["xGoals"]);   // expected goals against

    // GSAx = xGA - GA (positive = above average, saved more than expected)
    const gsax  = xGA > 0 ? xGA - GA : 0;
    const sv_pct = shots > 0 ? (shots - GA) / shots : 0.910;

    const stats: NhlGoalieStats = {
      name,
      team,
      gp:    Math.round(gp),
      sv_pct: parseFloat(sv_pct.toFixed(4)),
      gsax:   parseFloat(gsax.toFixed(2)),
      xga:    parseFloat(xGA.toFixed(2)),
      ga:     Math.round(GA),
      shots:  Math.round(shots),
    };

    goalieMap.set(name, stats);
  }

  console.log(`[MPFallback]   ✅ Goalie stats loaded for ${goalieMap.size} goalies`);
  return goalieMap;
}
