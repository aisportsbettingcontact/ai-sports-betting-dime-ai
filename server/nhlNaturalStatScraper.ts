/**
 * nhlNaturalStatScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes NHL team stats and goalie stats from NaturalStatTrick.com.
 *
 * Data sources:
 *   Team stats (counts):  teamtable.php?...rate=n  — GF, GA, xGF%, CF%, HDCF%, SCF%
 *   Team stats (per-60):  teamtable.php?...rate=y  — xGF/60, xGA/60, HDCF/60, HDCA/60,
 *                                                     SCF/60, SCA/60, CF/60, CA/60
 *   Goalie stats:         playerteams.php?stdoi=g   — GP, SV%, GSAx, xGA, GA, SA
 *
 * NaturalStatTrick column naming convention:
 *   - rate=n (counts) table: bare names — "xgf", "xga", "hdcf", "hdca", "cf", "ca", "scf", "sca"
 *   - rate=y (per-60) table: suffixed names — "xgf/60", "xga/60", "hdcf/60", "hdca/60",
 *                                              "cf/60", "ca/60", "scf/60", "sca/60"
 *
 * NOTE: Rush/60 and Reb/60 do NOT exist in the NST team table.
 *       The engine uses SCF/60 and SCA/60 (scoring chances per 60) instead.
 *
 * The Sharp Line Origination Engine (nhl_model_engine.py) requires:
 *   - xGF_60, xGA_60       — Expected Goals For/Against per 60
 *   - HDCF_60, HDCA_60     — High-Danger Corsi For/Against per 60
 *   - SCF_60, SCA_60       — Scoring Chances For/Against per 60
 *   - CF_60, CA_60         — Corsi For/Against per 60 (pace proxy)
 *   - xGF_pct, HDCF_pct, SCF_pct, CF_pct — percentage-based stats from count table
 *
 * Outputs:
 *   NhlTeamStats   — keyed by NHL abbreviation (e.g. "BOS", "TOR")
 *   NhlGoalieStats — keyed by goalie full name (e.g. "Jeremy Swayman")
 */

import * as cheerio from "cheerio";
import { NHL_TEAMS } from "../shared/nhlTeams";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlTeamStats {
  abbrev:    string;
  name:      string;
  gp:        number;

  // Percentage-based (from counts table, rate=n)
  xGF_pct:   number;
  xGA_pct:   number;
  CF_pct:    number;
  SCF_pct:   number;
  HDCF_pct:  number;
  SH_pct:    number;
  SV_pct:    number;
  GF:        number;
  GA:        number;

  // Per-60 rate stats (from rate table, rate=y) — used by Sharp Line Engine
  // Offensive
  xGF_60:    number;   // Expected Goals For per 60
  HDCF_60:   number;   // High-Danger Corsi For per 60
  SCF_60:    number;   // Scoring Chances For per 60
  CF_60:     number;   // Corsi For per 60 (pace proxy)
  // Defensive
  xGA_60:    number;   // Expected Goals Against per 60
  HDCA_60:   number;   // High-Danger Corsi Against per 60
  SCA_60:    number;   // Scoring Chances Against per 60
  CA_60:     number;   // Corsi Against per 60 (pace proxy)
}

export interface NhlGoalieStats {
  name:         string;
  team:         string;
  gp:           number;
  sv_pct:       number;
  gsax:         number;   // Goals Saved Above Expected (season total)
  xga:          number;   // Expected Goals Against (season total)
  ga:           number;   // Goals Against (season total)
  shots:        number;   // Shots Faced (season total) — used for goalie_effect = GSAX/shots
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENT_SEASON = "20252026";

// Counts table (rate=n): GF, GA, xGF%, CF%, SCF%, HDCF%, SH%, SV%
// gpf=1 = include all teams with 1+ games played (no minimum game filter)
const TEAM_STATS_COUNT_URL = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=1&gpt=&fd=&td=`;

// Rate table (rate=y): xGF/60, xGA/60, HDCF/60, HDCA/60, SCF/60, SCA/60, CF/60, CA/60
const TEAM_STATS_RATE_URL  = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=y&team=all&loc=B&gpf=1&gpt=&fd=&td=`;

// Goalie stats — uses playerteams.php with stdoi=g (goalie mode), gpfilt=none (no minimum GP filter)
// NOTE: goaliestats.php is a 404; the correct endpoint is playerteams.php?stdoi=g
const GOALIE_STATS_URL = `https://www.naturalstattrick.com/playerteams.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&stdoi=g&rate=n&team=ALL&pos=S&loc=B&toi=0&gpfilt=none&fd=&td=&tgp=410&lines=single&draftteam=ALL`;

// Rotate User-Agents to reduce 403 rate-limiting from NST
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

const FETCH_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer":         "https://www.naturalstattrick.com/",
};

/**
 * Fetch with exponential backoff and User-Agent rotation.
 * On 403/429, waits 2^attempt * 1s before retrying with a different UA.
 * Prevents NST rate-limit errors from propagating as hard failures.
 */
async function fetchWithRetry(url: string, maxAttempts = 3): Promise<Response> {
  let lastErr: Error = new Error("fetchWithRetry: no attempts made");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ua = USER_AGENTS[attempt % USER_AGENTS.length];
    try {
      const resp = await fetch(url, {
        headers: { ...FETCH_HEADERS, "User-Agent": ua },
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.status === 403 || resp.status === 429) {
        const waitMs = Math.pow(2, attempt) * 1000;
        console.warn(`[NSTScraper] HTTP ${resp.status} on attempt ${attempt + 1}/${maxAttempts} — retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        lastErr = new Error(`HTTP ${resp.status}`);
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxAttempts - 1) {
        const waitMs = Math.pow(2, attempt) * 1000;
        console.warn(`[NSTScraper] Fetch error on attempt ${attempt + 1}/${maxAttempts}: ${lastErr.message} — retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

// ─── Team Abbreviation Normalization ─────────────────────────────────────────

// Build a lookup map: full name (uppercase) → 3-letter abbreviation
// e.g. "CHICAGO BLACKHAWKS" → "CHI", "UTAH MAMMOTH" → "UTA"
const NST_NAME_TO_ABBREV: Map<string, string> = new Map(
  NHL_TEAMS.map(t => [t.name.toUpperCase(), t.abbrev])
);

// Additional 3-letter overrides for legacy/variant codes used by NST
const NST_ABBREV_OVERRIDES: Record<string, string> = {
  "VGK": "VGK",
  "NJD": "NJD",
  "SJS": "SJS",
  "LAK": "LAK",
  "TBL": "TBL",
  "CBJ": "CBJ",
  "PHX": "ARI",
  "ARI": "ARI",
  "SEA": "SEA",
  "UTA": "UTA",
  // NST uses "N.J" for New Jersey Devils
  "N.J": "NJD",
  // NST uses "S.J" for San Jose Sharks
  "S.J": "SJS",
  // NST uses "T.B" for Tampa Bay Lightning
  "T.B": "TBL",
  // NST uses "L.A" for Los Angeles Kings
  "L.A": "LAK",
  // NST uses "ST LOUIS BLUES" (no period) for St. Louis Blues
  "ST LOUIS BLUES": "STL",
  // NST uses "UTAH HOCKEY CLUB" for Utah Mammoth (formerly Utah HC)
  "UTAH HOCKEY CLUB": "UTA",
};

/**
 * Normalize a raw team identifier from NaturalStatTrick to a 3-letter abbreviation.
 * Handles both full names ("Chicago Blackhawks") and short codes ("CHI", "N.J", etc.).
 */
function normalizeAbbrev(raw: string): string {
  const trimmed = raw.trim();
  const upper   = trimmed.toUpperCase();

  // 1. Check full-name lookup first (handles "Chicago Blackhawks" → "CHI")
  const byName = NST_NAME_TO_ABBREV.get(upper);
  if (byName) return byName;

  // 2. Check override map (handles "N.J" → "NJD", "PHX" → "ARI", etc.)
  const override = NST_ABBREV_OVERRIDES[upper];
  if (override) return override;

  // 3. Fall back to uppercased raw value (already a valid 3-letter code)
  return upper;
}

// ─── Helper: parse a NaturalStatTrick table ───────────────────────────────────

interface ParsedRow {
  abbrev:  string;
  cells:   string[];
  headers: string[];
}

function parseNstTable(html: string, tableLabel: string): { headers: string[]; rows: ParsedRow[] } {
  const $ = cheerio.load(html);
  const table = $("table#teams, table.tablesorter").first();

  if (!table.length) {
    console.warn(`[NSTScraper] ⚠ [${tableLabel}] Could not find team table — page structure may have changed`);
    return { headers: [], rows: [] };
  }

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   [${tableLabel}] Headers (${headers.length}): ${headers.slice(0, 15).join(", ")}...`);

  const rows: ParsedRow[] = [];
  const idxTeam = headers.indexOf("team");
  table.find("tbody tr").each((rowIdx, tr) => {
    const cells: string[] = [];
    $(tr).find("td").each((_, td) => { cells.push($(td).text().trim()); });
    if (cells.length < 4) return;
    const rawTeam = cells[idxTeam >= 0 ? idxTeam : 0] ?? "";
    const abbrev  = normalizeAbbrev(rawTeam);
    if (!abbrev) return;
    rows.push({ abbrev, cells, headers });
  });
  return { headers, rows };
}

// ─── Team Stats Scraper (counts) ─────────────────────────────────────────────

async function scrapeTeamCountStats(): Promise<Map<string, Partial<NhlTeamStats>>> {
  console.log("[NSTScraper] ► Fetching team COUNT stats (rate=n)...");
  const resp = await fetchWithRetry(TEAM_STATS_COUNT_URL);
  if (!resp.ok) throw new Error(`[NSTScraper] Count stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Count stats: ${html.length} bytes`);

  const { headers, rows } = parseNstTable(html, "COUNT");
  const results = new Map<string, Partial<NhlTeamStats>>();

  // COUNT table column names (rate=n, no /60 suffix):
  // [0]='', [1]='team', [2]='gp', [3]='toi', [4]='w', [5]='l', [6]='otl', [7]='row',
  // [8]='points', [9]='point %', [10]='cf', [11]='ca', [12]='cf%', [13]='ff', [14]='fa',
  // [15]='ff%', [16]='sf', [17]='sa', [18]='sf%', [19]='gf', [20]='ga', [21]='gf%',
  // [22]='xgf', [23]='xga', [24]='xgf%', [25]='scf', [26]='sca', [27]='scf%',
  // [36]='hdcf', [37]='hdca', [38]='hdcf%', [69]='sh%', [70]='sv%'
  const col = (name: string) => headers.indexOf(name);
  const idxGP    = col("gp");
  const idxCF    = headers.findIndex(h => h === "cf%");
  const idxSCF   = headers.findIndex(h => h === "scf%");
  const idxHDCF  = headers.findIndex(h => h === "hdcf%");
  const idxXGF   = headers.findIndex(h => h === "xgf%");
  const idxGF    = col("gf");
  const idxGA    = col("ga");
  const idxSH    = headers.findIndex(h => h === "sh%");
  const idxSV    = headers.findIndex(h => h === "sv%");

  console.log(`[NSTScraper]   COUNT cols — GP:${idxGP} CF%:${idxCF} SCF%:${idxSCF} HDCF%:${idxHDCF} xGF%:${idxXGF} GF:${idxGF} GA:${idxGA} SH%:${idxSH} SV%:${idxSV}`);

  for (const { abbrev, cells } of rows) {
    const g = (i: number) => i >= 0 ? parseFloat(cells[i]) || 0 : 0;
    const gp = g(idxGP);
    if (!abbrev || gp === 0) continue;

    const xGF_pct = g(idxXGF);
    // xGA_pct is derived: 100 - xGF_pct (NST doesn't have a separate xGA% column)
    const xGA_pct = xGF_pct > 0 ? 100 - xGF_pct : 50;

    results.set(abbrev, {
      abbrev,
      name:      abbrev,
      gp,
      xGF_pct,
      xGA_pct,
      CF_pct:    g(idxCF),
      SCF_pct:   g(idxSCF),
      HDCF_pct:  g(idxHDCF),
      SH_pct:    g(idxSH),
      SV_pct:    g(idxSV),
      GF:        g(idxGF),
      GA:        g(idxGA),
    });
  }

  console.log(`[NSTScraper] ✅ COUNT stats: ${results.size} teams`);
  return results;
}

// ─── Team Stats Scraper (per-60 rates) ───────────────────────────────────────

async function scrapeTeamRateStats(): Promise<Map<string, Partial<NhlTeamStats>>> {
  console.log("[NSTScraper] ► Fetching team RATE stats (rate=y, per-60)...");
  const resp = await fetchWithRetry(TEAM_STATS_RATE_URL);
  if (!resp.ok) throw new Error(`[NSTScraper] Rate stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Rate stats: ${html.length} bytes`);

  const { headers, rows } = parseNstTable(html, "RATE");
  const results = new Map<string, Partial<NhlTeamStats>>();

  // RATE table column names (rate=y, with /60 suffix):
  // [0]='', [1]='team', [2]='gp', [3]='toi/gp', [4]='w', [5]='l', [6]='otl', [7]='row',
  // [8]='points', [9]='point %',
  // [10]='cf/60', [11]='ca/60', [12]='cf%',
  // [13]='ff/60', [14]='fa/60', [15]='ff%',
  // [16]='sf/60', [17]='sa/60', [18]='sf%',
  // [19]='gf/60', [20]='ga/60', [21]='gf%',
  // [22]='xgf/60', [23]='xga/60', [24]='xgf%',
  // [25]='scf/60', [26]='sca/60', [27]='scf%',
  // [36]='hdcf/60', [37]='hdca/60', [38]='hdcf%',
  // [69]='sh%', [70]='sv%', [71]='pdo'
  const col = (name: string) => headers.indexOf(name);

  const idxXGF60  = col("xgf/60");   // index 22
  const idxXGA60  = col("xga/60");   // index 23
  const idxHDCF60 = col("hdcf/60");  // index 36
  const idxHDCA60 = col("hdca/60");  // index 37
  const idxSCF60  = col("scf/60");   // index 25
  const idxSCA60  = col("sca/60");   // index 26
  const idxCF60   = col("cf/60");    // index 10
  const idxCA60   = col("ca/60");    // index 11

  console.log(`[NSTScraper]   RATE cols — xGF/60:${idxXGF60} xGA/60:${idxXGA60} HDCF/60:${idxHDCF60} HDCA/60:${idxHDCA60} SCF/60:${idxSCF60} SCA/60:${idxSCA60} CF/60:${idxCF60} CA/60:${idxCA60}`);

  // Validate that we found all required columns
  const missing: string[] = [];
  if (idxXGF60 < 0)  missing.push("xgf/60");
  if (idxXGA60 < 0)  missing.push("xga/60");
  if (idxHDCF60 < 0) missing.push("hdcf/60");
  if (idxHDCA60 < 0) missing.push("hdca/60");
  if (idxSCF60 < 0)  missing.push("scf/60");
  if (idxSCA60 < 0)  missing.push("sca/60");
  if (idxCF60 < 0)   missing.push("cf/60");
  if (idxCA60 < 0)   missing.push("ca/60");

  if (missing.length > 0) {
    throw new Error(`[NSTScraper] RATE table missing required columns: ${missing.join(", ")}. Full headers: ${headers.join(", ")}`);
  }

  for (const { abbrev, cells } of rows) {
    const g = (i: number): number => {
      if (i < 0 || i >= cells.length) throw new Error(`[NSTScraper] Column index ${i} out of range for team ${abbrev}`);
      const v = parseFloat(cells[i]);
      if (isNaN(v)) throw new Error(`[NSTScraper] Non-numeric value "${cells[i]}" at column ${i} for team ${abbrev}`);
      return v;
    };

    results.set(abbrev, {
      xGF_60:  g(idxXGF60),
      xGA_60:  g(idxXGA60),
      HDCF_60: g(idxHDCF60),
      HDCA_60: g(idxHDCA60),
      SCF_60:  g(idxSCF60),
      SCA_60:  g(idxSCA60),
      CF_60:   g(idxCF60),
      CA_60:   g(idxCA60),
    });
  }

  console.log(`[NSTScraper] ✅ RATE stats: ${results.size} teams`);
  return results;
}

// ─── Public: Scrape All Team Stats ───────────────────────────────────────────

/**
 * Scrape both count and rate tables from NaturalStatTrick and merge them.
 * Returns a map keyed by NHL abbreviation with all fields populated.
 * Throws if any required per-60 stat is missing for any team.
 */
export async function scrapeNhlTeamStats(): Promise<Map<string, NhlTeamStats>> {
  console.log("[NSTScraper] ════════════════════════════════════════════════════");
  console.log("[NSTScraper] ► Scraping NaturalStatTrick team stats (count + rate)...");

  const [countStats, rateStats] = await Promise.all([
    scrapeTeamCountStats(),
    scrapeTeamRateStats(),
  ]);

  const merged = new Map<string, NhlTeamStats>();

  for (const [abbrev, count] of Array.from(countStats)) {
    const rate = rateStats.get(abbrev);

    if (!rate) {
      console.warn(`[NSTScraper] ⚠ No rate stats found for team ${abbrev} — skipping`);
      continue;
    }

    // Validate all required per-60 fields are present and non-null
    const requiredRateFields: (keyof typeof rate)[] = [
      "xGF_60", "xGA_60", "HDCF_60", "HDCA_60", "SCF_60", "SCA_60", "CF_60", "CA_60"
    ];
    const missingFields = requiredRateFields.filter(f => rate[f] === undefined || rate[f] === null);
    if (missingFields.length > 0) {
      throw new Error(`[NSTScraper] Team ${abbrev} missing required rate stats: ${missingFields.join(", ")}`);
    }

    const stats: NhlTeamStats = {
      abbrev:    count.abbrev!,
      name:      count.name!,
      gp:        count.gp!,
      xGF_pct:   count.xGF_pct!,
      xGA_pct:   count.xGA_pct!,
      CF_pct:    count.CF_pct!,
      SCF_pct:   count.SCF_pct!,
      HDCF_pct:  count.HDCF_pct!,
      SH_pct:    count.SH_pct!,
      SV_pct:    count.SV_pct!,
      GF:        count.GF!,
      GA:        count.GA!,
      // Per-60 from rate table (required — no nulls allowed)
      xGF_60:    rate.xGF_60!,
      xGA_60:    rate.xGA_60!,
      HDCF_60:   rate.HDCF_60!,
      HDCA_60:   rate.HDCA_60!,
      SCF_60:    rate.SCF_60!,
      SCA_60:    rate.SCA_60!,
      CF_60:     rate.CF_60!,
      CA_60:     rate.CA_60!,
    };
    merged.set(abbrev, stats);
  }

  // Log sample
  const sample = Array.from(merged.entries()).slice(0, 3);
  for (const [abbrev, s] of sample) {
    console.log(`[NSTScraper]   ${abbrev}: xGF%=${s.xGF_pct} xGF/60=${s.xGF_60} HDCF/60=${s.HDCF_60} SCF/60=${s.SCF_60} CF/60=${s.CF_60}`);
  }

  console.log(`[NSTScraper] ✅ Merged team stats: ${merged.size} teams (${Array.from(merged.keys()).join(", ")})`);
  console.log("[NSTScraper] ════════════════════════════════════════════════════");
  return merged;
}

// ─── Goalie Stats Scraper ─────────────────────────────────────────────────────

/**
 * Scrape NaturalStatTrick goalie stats table.
 * Returns a map keyed by goalie full name (both original and lowercase).
 */
export async function scrapeNhlGoalieStats(): Promise<Map<string, NhlGoalieStats>> {
  console.log("[NSTScraper] ► Fetching goalie stats from NaturalStatTrick...");
  console.log(`[NSTScraper]   URL: ${GOALIE_STATS_URL}`);

  const resp = await fetchWithRetry(GOALIE_STATS_URL);
  if (!resp.ok) throw new Error(`[NSTScraper] Goalie stats fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  console.log(`[NSTScraper]   Goalie stats: ${html.length} bytes`);

  const $ = cheerio.load(html);
  const results = new Map<string, NhlGoalieStats>();

  // playerteams.php?stdoi=g uses table#players (not table#goalies)
  const table = $("table#players, table#goalies, table.tablesorter").first();
  if (!table.length) {
    console.warn("[NSTScraper] ⚠ Could not find goalie stats table");
    return results;
  }

  const headers: string[] = [];
  table.find("thead tr th").each((_, th) => {
    headers.push($(th).text().trim().toLowerCase());
  });
  console.log(`[NSTScraper]   Goalie headers: ${headers.join(", ")}`);

  // playerteams.php?stdoi=g column names (lowercased):
  //   "player", "team", "gp", "toi", "shots against", "saves", "goals against",
  //   "sv%", "gaa", "gsaa", "xg against", ...
  // Note: GSAA on this page = Goals Saved Above Average (same concept as GSAx for our purposes)
  const idxName  = headers.findIndex(h => h === "player" || h === "name");
  const idxTeam  = headers.findIndex(h => h === "team");
  const idxGP    = headers.findIndex(h => h === "gp");
  const idxSV    = headers.findIndex(h => h === "sv%");
  const idxGSAX  = headers.findIndex(h => h === "gsaa" || h.includes("gsax") || h.includes("goals saved above"));
  const idxXGA   = headers.findIndex(h => h === "xg against" || h === "xga");
  const idxGA    = headers.findIndex(h => h === "goals against" || h === "ga");
  const idxShots = headers.findIndex(h => h === "shots against" || h === "sa" || h === "shots");

  console.log(`[NSTScraper]   Goalie cols — Name:${idxName} Team:${idxTeam} GP:${idxGP} SV%:${idxSV} GSAx:${idxGSAX} xGA:${idxXGA} GA:${idxGA} SA:${idxShots}`);

  table.find("tbody tr").each((rowIdx, tr) => {
    const cells: string[] = [];
    $(tr).find("td").each((_, td) => { cells.push($(td).text().trim()); });
    if (cells.length < 4) return;

    const g = (i: number) => i >= 0 ? parseFloat(cells[i]) || 0 : 0;
    const name   = cells[idxName >= 0 ? idxName : 0] ?? "";
    const team   = normalizeAbbrev(cells[idxTeam >= 0 ? idxTeam : 1] ?? "");
    const gp     = g(idxGP);
    const sv_pct = g(idxSV);
    const gsax   = g(idxGSAX);
    const xga    = g(idxXGA);
    const ga     = g(idxGA);
    const shots  = g(idxShots);

    if (!name || gp === 0) return;

    const stats: NhlGoalieStats = { name, team, gp, sv_pct, gsax, xga, ga, shots };
    results.set(name.toLowerCase(), stats);
    results.set(name, stats);

    if (rowIdx < 5) {
      console.log(`[NSTScraper]   Goalie ${rowIdx}: ${name} (${team}) GP=${gp} SV%=${sv_pct} GSAx=${gsax} SA=${shots}`);
    }
  });

  console.log(`[NSTScraper] ✅ Goalie stats: ${results.size / 2} goalies`);
  return results;
}

// ─── Default Goalie Stats ─────────────────────────────────────────────────────

/**
 * Returns league-average goalie stats for a goalie not found in NaturalStatTrick.
 * Used when a backup goalie or newly called-up goalie has no NST data.
 * League averages: SV% ≈ 0.900, GSAx ≈ 0.0 (average), ~30 GP, ~850 shots.
 */
export function getDefaultGoalieStats(name: string, team: string): NhlGoalieStats {
  return {
    name,
    team,
    gp:     30,
    sv_pct: 0.900,
    gsax:   0.0,
    xga:    75.0,
    ga:     75.0,
    shots:  850,
  };
}
