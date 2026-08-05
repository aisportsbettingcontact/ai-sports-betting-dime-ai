/**
 * strikeoutModelRunner.ts
 *
 * Server-side runner for StrikeoutModel.py.
 *
 * Responsibilities:
 *   1. Accept game metadata + file paths (plays CSV, statcast JSON, crosswalk CSV)
 *   2. Spawn StrikeoutModel.py as a child process with --json-output flag
 *   3. Parse the JSON output and upsert rows into mlb_strikeout_props table
 *   4. Return structured result for logging / tRPC response
 *
 * Logging conventions:
 *   [StrikeoutRunner] prefix on every line.
 *   ✓ success / ✕ error / ⚠ warning
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { fileURLToPath } from "url";
import { upsertStrikeoutProp } from "./db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);
const TAG = "[StrikeoutRunner]";
const PYTHON = "python3";
const MODEL_SCRIPT = path.join(__dirname, "StrikeoutModel.py");
const TIMEOUT_MS = 120_000; // 2-minute hard timeout

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrikeoutRunnerInput {
  gameId: number;
  gameDate: string; // YYYY-MM-DD
  awayTeam: string; // e.g. "NYY"
  homeTeam: string; // e.g. "SFN"
  awayPitcherRsId: string; // retrosheet ID e.g. "friem001"
  homePitcherRsId: string; // retrosheet ID e.g. "webbl001"
  playsPath: string; // absolute path to Retrosheet plays CSV
  statcastPath: string; // absolute path to statcast JSON
  crosswalkPath: string; // absolute path to crosswalk CSV
  // Optional market lines for the away pitcher
  awayMarketLine?: number;
  awayMarketOverOdds?: string;
  awayMarketUnderOdds?: string;
  // Optional market lines for the home pitcher
  homeMarketLine?: number;
  homeMarketOverOdds?: string;
  homeMarketUnderOdds?: string;
}

export interface StrikeoutRunnerResult {
  success: boolean;
  gameId: number;
  awayPitcherName?: string;
  homePitcherName?: string;
  awayKProj?: number;
  homeKProj?: number;
  error?: string;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runStrikeoutModel(
  input: StrikeoutRunnerInput
): Promise<StrikeoutRunnerResult> {
  const {
    gameId,
    gameDate,
    awayTeam,
    homeTeam,
    awayPitcherRsId,
    homePitcherRsId,
    playsPath,
    statcastPath,
    crosswalkPath,
  } = input;

  console.log(
    `${TAG} Starting model for game ${gameId} (${awayTeam}@${homeTeam} ${gameDate})`
  );
  console.log(`${TAG}   away pitcher: ${awayPitcherRsId}`);
  console.log(`${TAG}   home pitcher: ${homePitcherRsId}`);
  console.log(`${TAG}   plays: ${playsPath}`);
  console.log(`${TAG}   statcast: ${statcastPath}`);
  console.log(`${TAG}   crosswalk: ${crosswalkPath}`);

  // Verify input files exist
  for (const [label, p] of [
    ["plays", playsPath],
    ["statcast", statcastPath],
    ["crosswalk", crosswalkPath],
  ] as [string, string][]) {
    try {
      await fs.access(p);
      console.log(`${TAG}   ✓ ${label} file exists`);
    } catch {
      const msg = `${label} file not found: ${p}`;
      console.error(`${TAG} ✕ ${msg}`);
      return { success: false, gameId, error: msg };
    }
  }

  // Create temp output paths
  const tmpDir = os.tmpdir();
  const slug = `${awayTeam.toLowerCase()}${homeTeam.toLowerCase()}_${gameDate.replace(/-/g, "")}`;
  const htmlOut = path.join(tmpDir, `strikeout_${slug}.html`);
  const jsonOut = path.join(tmpDir, `strikeout_${slug}.json`);

  // Build CLI args
  const args: string[] = [
    MODEL_SCRIPT,
    "--plays",
    playsPath,
    "--statcast",
    statcastPath,
    "--crosswalk",
    crosswalkPath,
    "--game-date",
    gameDate,
    "--away-team",
    awayTeam,
    "--home-team",
    homeTeam,
    "--away-pitcher",
    awayPitcherRsId,
    "--home-pitcher",
    homePitcherRsId,
    "--output",
    htmlOut,
    "--json-output",
    jsonOut,
  ];

  // Add market lines if provided
  if (
    input.awayMarketLine != null &&
    input.awayMarketOverOdds &&
    input.awayMarketUnderOdds
  ) {
    args.push(
      "--away-market",
      String(input.awayMarketLine),
      input.awayMarketOverOdds,
      input.awayMarketUnderOdds
    );
    console.log(
      `${TAG}   away market: ${input.awayMarketLine} ${input.awayMarketOverOdds}/${input.awayMarketUnderOdds}`
    );
  }
  if (
    input.homeMarketLine != null &&
    input.homeMarketOverOdds &&
    input.homeMarketUnderOdds
  ) {
    args.push(
      "--home-market",
      String(input.homeMarketLine),
      input.homeMarketOverOdds,
      input.homeMarketUnderOdds
    );
    console.log(
      `${TAG}   home market: ${input.homeMarketLine} ${input.homeMarketOverOdds}/${input.homeMarketUnderOdds}`
    );
  }

  console.log(`${TAG}   CMD: ${PYTHON} ${args.join(" ")}`);

  // Spawn the Python process
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(PYTHON, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    const errMsg = `Python process failed: ${e.message ?? "unknown error"}`;
    console.error(`${TAG} ✕ ${errMsg}`);
    if (stderr) console.error(`${TAG}   stderr: ${stderr.slice(0, 500)}`);
    return { success: false, gameId, error: errMsg };
  }

  // Log Python stdout
  if (stdout) {
    for (const line of stdout.trim().split("\n")) {
      console.log(`${TAG}   [py] ${line}`);
    }
  }
  if (stderr) {
    for (const line of stderr.trim().split("\n")) {
      console.warn(`${TAG}   [py:err] ${line}`);
    }
  }

  // Read JSON output
  let jsonData: Record<string, unknown>;
  try {
    const raw = await fs.readFile(jsonOut, "utf-8");
    jsonData = JSON.parse(raw);
    console.log(`${TAG}   ✓ JSON output parsed`);
  } catch (err) {
    const msg = `Failed to read JSON output at ${jsonOut}: ${String(err)}`;
    console.error(`${TAG} ✕ ${msg}`);
    return { success: false, gameId, error: msg };
  }

  // Parse and validate the two pitcher projections
  const awayProj = jsonData.away as Record<string, unknown> | undefined;
  const homeProj = jsonData.home as Record<string, unknown> | undefined;

  if (!awayProj || !homeProj) {
    const msg = "JSON output missing 'away' or 'home' projection";
    console.error(`${TAG} ✕ ${msg}`);
    return { success: false, gameId, error: msg };
  }

  // Log key projection values
  console.log(
    `${TAG}   ✓ ${awayProj.pitcherName} (away): kProj=${awayProj.kProj} line=${awayProj.kLine} pOver=${awayProj.pOver} verdict=${awayProj.verdict}`
  );
  console.log(
    `${TAG}   ✓ ${homeProj.pitcherName} (home): kProj=${homeProj.kProj} line=${homeProj.kLine} pOver=${homeProj.pOver} verdict=${homeProj.verdict}`
  );

  // Upsert both rows to DB
  const now = Date.now();
  for (const proj of [awayProj, homeProj]) {
    const row = {
      gameId,
      side: proj.side as string,
      pitcherName: proj.pitcherName as string,
      pitcherHand: proj.pitcherHand as string | undefined,
      retrosheetId: proj.retrosheetId as string | undefined,
      mlbamId: proj.mlbamId as number | undefined,
      kProj: proj.kProj != null ? String(proj.kProj) : undefined,
      kLine: proj.kLine != null ? String(proj.kLine) : undefined,
      kPer9: proj.kPer9 != null ? String(proj.kPer9) : undefined,
      kMedian: proj.kMedian != null ? String(proj.kMedian) : undefined,
      kP5: proj.kP5 != null ? String(proj.kP5) : undefined,
      kP95: proj.kP95 != null ? String(proj.kP95) : undefined,
      bookLine: proj.bookLine != null ? String(proj.bookLine) : undefined,
      bookOverOdds: proj.bookOverOdds as string | undefined,
      bookUnderOdds: proj.bookUnderOdds as string | undefined,
      pOver: proj.pOver != null ? String(proj.pOver) : undefined,
      pUnder: proj.pUnder != null ? String(proj.pUnder) : undefined,
      modelOverOdds: proj.modelOverOdds as string | undefined,
      modelUnderOdds: proj.modelUnderOdds as string | undefined,
      edgeOver: proj.edgeOver != null ? String(proj.edgeOver) : undefined,
      edgeUnder: proj.edgeUnder != null ? String(proj.edgeUnder) : undefined,
      verdict: proj.verdict as string | undefined,
      bestEdge: proj.bestEdge != null ? String(proj.bestEdge) : undefined,
      bestSide: proj.bestSide as string | undefined,
      bestMlStr: proj.bestMlStr as string | undefined,
      signalBreakdown: proj.signalBreakdown
        ? JSON.stringify(proj.signalBreakdown)
        : undefined,
      matchupRows: proj.matchupRows
        ? JSON.stringify(proj.matchupRows)
        : undefined,
      distribution: proj.distribution
        ? JSON.stringify(proj.distribution)
        : undefined,
      inningBreakdown: proj.inningBreakdown
        ? JSON.stringify(proj.inningBreakdown)
        : undefined,
      modelRunAt: now,
    };
    await upsertStrikeoutProp(row);
    console.log(
      `${TAG}   ✓ DB upsert: gameId=${gameId} side=${row.side} pitcher=${row.pitcherName}`
    );
  }

  // Clean up temp files
  try {
    await fs.unlink(htmlOut);
    await fs.unlink(jsonOut);
  } catch {
    // non-fatal
  }

  console.log(`${TAG} ✓ Complete: game ${gameId} (${awayTeam}@${homeTeam})`);

  return {
    success: true,
    gameId,
    awayPitcherName: awayProj.pitcherName as string,
    homePitcherName: homeProj.pitcherName as string,
    awayKProj: awayProj.kProj as number,
    homeKProj: homeProj.kProj as number,
  };
}
