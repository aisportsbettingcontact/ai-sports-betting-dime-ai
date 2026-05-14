/**
 * nhlModelEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript wrapper that spawns the Python NHL model engine for a single game.
 *
 * Execution flow:
 *   1. Receives NhlModelEngineInput with team stats + goalie stats + market lines
 *   2. Spawns `python3.11 server/nhl_model_engine.py` as a child process
 *   3. Writes the input as JSON to the process's stdin
 *   4. Reads the result JSON from stdout (last line)
 *   5. Returns a typed NhlModelResult
 *
 * Stats used by the Sharp Line Engine (all from NaturalStatTrick):
 *   Per-60 (from rate=y table):
 *     xGF_60, xGA_60     — Expected Goals For/Against per 60
 *     HDCF_60, HDCA_60   — High-Danger Corsi For/Against per 60
 *     SCF_60, SCA_60     — Scoring Chances For/Against per 60
 *     CF_60, CA_60       — Corsi For/Against per 60 (pace proxy)
 *   Percentage-based (from rate=n table):
 *     xGF_pct, HDCF_pct, SCF_pct, CF_pct
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { NhlTeamStats } from "./nhlNaturalStatScraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlModelEngineInput {
  away_team:         string;   // Full team name or abbreviation
  home_team:         string;
  away_abbrev:       string;   // NHL abbreviation
  home_abbrev:       string;
  away_goalie:       string | null;
  home_goalie:       string | null;
  away_goalie_gp:    number;
  home_goalie_gp:    number;
  away_goalie_gsax:  number;
  home_goalie_gsax:  number;
  mkt_puck_line:     number;   // Always -1.5 (home) / +1.5 (away)
  mkt_away_spread:   number | null;  // Book's signed spread for away team: +1.5 if home is -1.5 fav, -1.5 if away is -1.5 fav
  mkt_away_pl_odds:  number | null;
  mkt_home_pl_odds:  number | null;
  mkt_total:         number | null;
  mkt_over_odds:     number | null;
  mkt_under_odds:    number | null;
  mkt_away_ml:       number | null;
  mkt_home_ml:       number | null;
  away_goalie_shots_faced?: number;   // shots faced this season (for goalie_effect)
  home_goalie_shots_faced?: number;
  away_rest_days?:  number;           // days since last game (fatigue)
  home_rest_days?:  number;
  /** When true, the Python engine uses playoff league averages (LEAGUE_GOAL_RATE=2.83, GOALIE_REGRESSION_K=200) */
  playoff_mode?:    boolean;
  team_stats: Record<string, {
    // Percentage-based (from count table)
    xGF_pct: number; xGA_pct: number;
    CF_pct: number; SCF_pct: number; HDCF_pct: number;
    SH_pct: number; SV_pct: number; GF: number; GA: number;
    // Per-60 rate stats (from rate table) — ALL REQUIRED, no nulls
    xGF_60: number; xGA_60: number;
    HDCF_60: number; HDCA_60: number;
    SCF_60: number; SCA_60: number;
    CF_60: number; CA_60: number;
  }>;
}

export interface NhlModelEdge {
  type:           "PUCK_LINE" | "TOTAL" | "ML";
  side:           string;
  model_prob:     number;   // Model probability at market threshold (0–100)
  mkt_prob:       number;   // Vig-free market probability (0–100)
  mkt_prob_raw:   number;   // Raw implied probability before vig removal (0–100)
  edge_vs_be:     number;   // Probability edge in percentage points
  ev:             number;   // Expected value per $100 wagered
  fair_odds:      number;   // Model fair price in American odds
  price_edge:     number;   // fair_odds − market_odds (positive = favorable)
  classification: "ELITE EDGE" | "STRONG EDGE" | "PLAYABLE EDGE" | "SMALL EDGE" | "NO EDGE";
  conf:           "HIGH" | "MOD" | "LOW";
}

export interface NhlModelResult {
  ok:                  boolean;
  game:                string;
  away_name:           string;
  home_name:           string;
  away_abbrev:         string;
  home_abbrev:         string;
  away_goalie:         string | null;
  home_goalie:         string | null;
  // Projected goals
  proj_away_goals:     number;
  proj_home_goals:     number;
  // Puck line (±1.5 or ±2.5 based on win probability distribution)
  away_puck_line:      string;
  away_puck_line_odds: number;
  home_puck_line:      string;
  home_puck_line_odds: number;
  // Moneylines
  away_ml:             number;
  home_ml:             number;
  // Total (model's own derived line)
  total_line:          number;
  over_odds:           number;
  under_odds:          number;
  // Model fair odds AT the BOOK's lines (for side-by-side display)
  // These are the key fields for edge detection: same line, different odds
  mkt_pl_away_odds:        number;   // model fair odds at book's away puck line
  mkt_pl_home_odds:        number;   // model fair odds at book's home puck line
  mkt_pl_away_cover_pct:   number;   // P(away covers book's away spread) — matches mkt_pl_away_odds
  mkt_pl_home_cover_pct:   number;   // P(home covers book's home spread) — matches mkt_pl_home_odds
  mkt_total_over_odds:     number;   // model fair odds at book's total line (over)
  mkt_total_under_odds:    number;   // model fair odds at book's total line (under)
  // Probabilities (model's own origination line)
  away_win_pct:            number;
  home_win_pct:            number;
  away_pl_cover_pct:       number;   // P(away covers model's own PL line)
  home_pl_cover_pct:       number;   // P(home covers model's own PL line)
  over_pct:            number;
  under_pct:           number;
  // Edges
  edges:               NhlModelEdge[];
  error:               string | null;
}

// ─── Engine Runner ────────────────────────────────────────────────────────────

const PYTHON_TIMEOUT_MS = 60_000;  // 60 seconds max

export async function runNhlModelForGame(input: NhlModelEngineInput): Promise<NhlModelResult> {
  const enginePath = path.join(__dirname, "nhl_model_engine.py");
  const inputJson  = JSON.stringify(input);

  console.log(`[NhlModelEngine] ► Spawning Python engine for: ${input.away_team} @ ${input.home_team}`);
  console.log(`[NhlModelEngine]   Away goalie: ${input.away_goalie ?? "TBD"} (GSAx=${input.away_goalie_gsax.toFixed(2)} GP=${input.away_goalie_gp})`);
  console.log(`[NhlModelEngine]   Home goalie: ${input.home_goalie ?? "TBD"} (GSAx=${input.home_goalie_gsax.toFixed(2)} GP=${input.home_goalie_gp})`);
  console.log(`[NhlModelEngine]   Market: PL_odds=${input.mkt_away_pl_odds}/${input.mkt_home_pl_odds} Total=${input.mkt_total} ML=${input.mkt_away_ml}/${input.mkt_home_ml}`);

  return new Promise<NhlModelResult>((resolve) => {
    // Clear PYTHONHOME and PYTHONPATH to prevent conflicts with the server's
    // uv-managed Python 3.13 environment (which sets PYTHONHOME to 3.13 stdlib).
    // python3.11 must use its own /usr/lib/python3.11 standard library.
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYTHONHOME;
    delete cleanEnv.PYTHONPATH;

    const proc = spawn("/usr/bin/python3.11", [enginePath], {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      // Forward Python stderr to Node console for debugging
      process.stdout.write(`[NhlModelEngine][py] ${line}`);
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        ok: false,
        game: `${input.away_team} @ ${input.home_team}`,
        away_name: input.away_team,
        home_name: input.home_team,
        away_abbrev: input.away_abbrev,
        home_abbrev: input.home_abbrev,
        away_goalie: input.away_goalie,
        home_goalie: input.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `Python engine timeout after ${PYTHON_TIMEOUT_MS}ms`,
      });
    }, PYTHON_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        console.error(`[NhlModelEngine] ✗ Python exited with code ${code}`);
        console.error(`[NhlModelEngine]   stderr: ${stderr.slice(-500)}`);
        resolve({
          ok: false,
          game: `${input.away_team} @ ${input.home_team}`,
          away_name: input.away_team,
          home_name: input.home_team,
          away_abbrev: input.away_abbrev,
          home_abbrev: input.home_abbrev,
          away_goalie: input.away_goalie,
          home_goalie: input.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `Python exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Extract last non-empty line as the JSON result
      const lines = stdout.trim().split("\n").filter(l => l.trim());
      const lastLine = lines[lines.length - 1] ?? "";

      try {
        const result = JSON.parse(lastLine) as NhlModelResult;
        if (result.ok) {
          console.log(
            `[NhlModelEngine] ✅ ${input.away_team} @ ${input.home_team} | ` +
            `Goals: ${result.proj_away_goals}/${result.proj_home_goals} | ` +
            `PL: ${result.away_puck_line_odds}/${result.home_puck_line_odds} | ` +
            `ML: ${result.away_ml}/${result.home_ml} | ` +
            `Total: ${result.total_line} (${result.over_odds}/${result.under_odds}) | ` +
            `Edges: ${result.edges.length}`
          );
        } else {
          console.error(`[NhlModelEngine] ✗ Model error: ${result.error}`);
        }
        resolve(result);
      } catch (parseErr) {
        console.error(`[NhlModelEngine] ✗ JSON parse error: ${parseErr}`);
        console.error(`[NhlModelEngine]   stdout: ${stdout.slice(-500)}`);
        resolve({
          ok: false,
          game: `${input.away_team} @ ${input.home_team}`,
          away_name: input.away_team,
          home_name: input.home_team,
          away_abbrev: input.away_abbrev,
          home_abbrev: input.home_abbrev,
          away_goalie: input.away_goalie,
          home_goalie: input.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `JSON parse error: ${parseErr}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[NhlModelEngine] ✗ Process spawn error: ${err.message}`);
      resolve({
        ok: false,
        game: `${input.away_team} @ ${input.home_team}`,
        away_name: input.away_team,
        home_name: input.home_team,
        away_abbrev: input.away_abbrev,
        home_abbrev: input.home_abbrev,
        away_goalie: input.away_goalie,
        home_goalie: input.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0,
        total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0,
        edges: [],
        error: `Process spawn error: ${err.message}`,
      });
    });

    // Write input to stdin
    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

/**
 * Batch runner — spawns ONE Python process for all games.
 * Eliminates per-game process spawn overhead (~50–100ms per spawn).
 * Returns results in the same order as inputs.
 */
export async function runNhlModelBatch(inputs: NhlModelEngineInput[]): Promise<NhlModelResult[]> {
  if (inputs.length === 0) return [];
  if (inputs.length === 1) {
    const r = await runNhlModelForGame(inputs[0]);
    return [r];
  }

  const enginePath = path.join(__dirname, "nhl_model_engine.py");
  const inputJson  = JSON.stringify(inputs);

  console.log(`[NhlModelEngine] ► Batch spawning Python engine for ${inputs.length} game(s)`);

  return new Promise<NhlModelResult[]>((resolve) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYTHONHOME;
    delete cleanEnv.PYTHONPATH;

    const proc = spawn("/usr/bin/python3.11", [enginePath], {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      process.stdout.write(`[NhlModelEngine][py] ${line}`);
    });

    const batchTimeout = inputs.length * PYTHON_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve(inputs.map(inp => ({
        ok: false,
        game: `${inp.away_team} @ ${inp.home_team}`,
        away_name: inp.away_team, home_name: inp.home_team,
        away_abbrev: inp.away_abbrev, home_abbrev: inp.home_abbrev,
        away_goalie: inp.away_goalie, home_goalie: inp.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0, total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0, edges: [],
        error: `Batch timeout after ${batchTimeout}ms`,
      } as NhlModelResult)));
    }, batchTimeout);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.error(`[NhlModelEngine] ✗ Batch Python exited with code ${code}`);
        resolve(inputs.map(inp => ({
          ok: false, game: `${inp.away_team} @ ${inp.home_team}`,
          away_name: inp.away_team, home_name: inp.home_team,
          away_abbrev: inp.away_abbrev, home_abbrev: inp.home_abbrev,
          away_goalie: inp.away_goalie, home_goalie: inp.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
          away_puck_line: "+1.5", away_puck_line_odds: 0,
          home_puck_line: "-1.5", home_puck_line_odds: 0,
          away_ml: 0, home_ml: 0, total_line: 0, over_odds: 0, under_odds: 0,
          mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
          mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
          mkt_total_over_odds: 0, mkt_total_under_odds: 0,
          away_win_pct: 0, home_win_pct: 0,
          away_pl_cover_pct: 0, home_pl_cover_pct: 0,
          over_pct: 0, under_pct: 0, edges: [],
          error: `Python exited with code ${code}: ${stderr.slice(-200)}`,
        } as NhlModelResult)));
        return;
      }
      const lines = stdout.trim().split("\n").filter(l => l.trim());
      const lastLine = lines[lines.length - 1] ?? "";
      try {
        const results = JSON.parse(lastLine) as NhlModelResult[];
        console.log(`[NhlModelEngine] ✅ Batch complete: ${results.filter(r => r.ok).length}/${results.length} games succeeded`);
        resolve(results);
      } catch (parseErr) {
        console.error(`[NhlModelEngine] ✗ Batch JSON parse error: ${parseErr}`);
        resolve(inputs.map(inp => ({
          ok: false, game: `${inp.away_team} @ ${inp.home_team}`,
          away_name: inp.away_team, home_name: inp.home_team,
          away_abbrev: inp.away_abbrev, home_abbrev: inp.home_abbrev,
          away_goalie: inp.away_goalie, home_goalie: inp.home_goalie,
          proj_away_goals: 0, proj_home_goals: 0,
          away_puck_line: "+1.5", away_puck_line_odds: 0,
          home_puck_line: "-1.5", home_puck_line_odds: 0,
          away_ml: 0, home_ml: 0, total_line: 0, over_odds: 0, under_odds: 0,
          mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
          mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
          mkt_total_over_odds: 0, mkt_total_under_odds: 0,
          away_win_pct: 0, home_win_pct: 0,
          away_pl_cover_pct: 0, home_pl_cover_pct: 0,
          over_pct: 0, under_pct: 0, edges: [],
          error: `Batch JSON parse error: ${parseErr}`,
        } as NhlModelResult)));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve(inputs.map(inp => ({
        ok: false, game: `${inp.away_team} @ ${inp.home_team}`,
        away_name: inp.away_team, home_name: inp.home_team,
        away_abbrev: inp.away_abbrev, home_abbrev: inp.home_abbrev,
        away_goalie: inp.away_goalie, home_goalie: inp.home_goalie,
        proj_away_goals: 0, proj_home_goals: 0,
        away_puck_line: "+1.5", away_puck_line_odds: 0,
        home_puck_line: "-1.5", home_puck_line_odds: 0,
        away_ml: 0, home_ml: 0, total_line: 0, over_odds: 0, under_odds: 0,
        mkt_pl_away_odds: 0, mkt_pl_home_odds: 0,
        mkt_pl_away_cover_pct: 0, mkt_pl_home_cover_pct: 0,
        mkt_total_over_odds: 0, mkt_total_under_odds: 0,
        away_win_pct: 0, home_win_pct: 0,
        away_pl_cover_pct: 0, home_pl_cover_pct: 0,
        over_pct: 0, under_pct: 0, edges: [],
        error: `Process spawn error: ${err.message}`,
      } as NhlModelResult)));
    });

    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format ML as string with sign (e.g. "+135", "-155") */
export function formatNhlML(ml: number): string {
  return ml > 0 ? `+${ml}` : String(ml);
}

/**
 * Build team_stats dict for Python engine from NhlTeamStats map.
 * All per-60 stats are required — no nulls, no defaults.
 * Throws if any team is missing from the map.
 */
export function buildTeamStatsDict(
  awayAbbrev: string,
  homeAbbrev: string,
  teamStatsMap: Map<string, NhlTeamStats>
): Record<string, {
  xGF_pct: number; xGA_pct: number;
  CF_pct: number; SCF_pct: number; HDCF_pct: number;
  SH_pct: number; SV_pct: number; GF: number; GA: number;
  xGF_60: number; xGA_60: number;
  HDCF_60: number; HDCA_60: number;
  SCF_60: number; SCA_60: number;
  CF_60: number; CA_60: number;
}> {
  const result: Record<string, {
    xGF_pct: number; xGA_pct: number;
    CF_pct: number; SCF_pct: number; HDCF_pct: number;
    SH_pct: number; SV_pct: number; GF: number; GA: number;
    xGF_60: number; xGA_60: number;
    HDCF_60: number; HDCA_60: number;
    SCF_60: number; SCA_60: number;
    CF_60: number; CA_60: number;
  }> = {};

  for (const abbrev of [awayAbbrev, homeAbbrev]) {
    const stats = teamStatsMap.get(abbrev);
    if (!stats) {
      throw new Error(`[NhlModelEngine] No stats found for team ${abbrev} — cannot run model without complete data`);
    }

    result[abbrev] = {
      // Percentage-based
      xGF_pct:  stats.xGF_pct,
      xGA_pct:  stats.xGA_pct,
      CF_pct:   stats.CF_pct,
      SCF_pct:  stats.SCF_pct,
      HDCF_pct: stats.HDCF_pct,
      SH_pct:   stats.SH_pct,
      SV_pct:   stats.SV_pct,
      GF:       stats.GF,
      GA:       stats.GA,
      // Per-60 rate stats (all required)
      xGF_60:   stats.xGF_60,
      xGA_60:   stats.xGA_60,
      HDCF_60:  stats.HDCF_60,
      HDCA_60:  stats.HDCA_60,
      SCF_60:   stats.SCF_60,
      SCA_60:   stats.SCA_60,
      CF_60:    stats.CF_60,
      CA_60:    stats.CA_60,
    };
  }

  return result;
}
