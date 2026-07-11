/**
 * wc2026Heartbeat.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Project-level heartbeat handlers for WC2026 data pipeline.
 *
 * Registered endpoints:
 *
 * 1. POST /api/scheduled/wc2026-lineups
 *    Cadence: every 10 min
 *    Action:  Scrape Rotowire WOC lineups → wc2026_lineups
 *
 * 2. POST /api/scheduled/wc2026-espn-results
 *    Cadence: daily (post-match)
 *    Action:  Ingest FT match results, stats, events, lineups from ESPN API
 *
 * 3. POST /api/scheduled/wc2026-live-scores
 *    Cadence: every 5 min during match window (13:00–10:55 UTC)
 *    Action:  Ingest LIVE + FT scores from ESPN scoreboard (score-only for LIVE,
 *             full ingest for newly-completed FT matches)
 *
 * Logging format:
 *   [WC2026HB] [INPUT]  → endpoint, trigger time
 *   [WC2026HB] [STEP]   → which scraper is running
 *   [WC2026HB] [OUTPUT] → scraper result summary
 *   [WC2026HB] [VERIFY] → PASS / FAIL
 */

import type { Express, Request, Response } from "express";
import { requireCronSecret } from "../cron/cronAuth";
import { notifyOwner } from "../_core/notification";
import { getDb } from "../db";
import { wc2026Matches } from "../../drizzle/wc2026.schema";
import { and, gte, lte, eq } from "drizzle-orm";
import { scrapeWc2026Lineups } from "./wc2026RotowireLineupsScraper";
import { ingestWc2026EspnResults } from "./wc2026Ingester";
import { wc2026LiveSyncHandler } from "./fifaLiveScraper";
import { scrapeAndIngest } from "./espnDbIngester";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// The production server is bundled by esbuild with --format=esm, where the
// CommonJS `__dirname` global does not exist. Deriving it from import.meta.url
// works in both the ESM bundle (resolves next to dist/index.js) and tsx dev
// (resolves to server/wc2026). Without this, every bracket-sync call threw
// `ReferenceError: __dirname is not defined` (HTTP 500), so R16 winners never
// propagated into the QF/SF/Final slots and knockout teams stayed "tbd".
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Bracket sync helper (spawns the MJS scraper as a child process) ─────────
// We spawn instead of import because the bracket scraper is ESM (.mjs) and
// the heartbeat is CJS-compiled TS. Spawn is also safer for memory isolation.
function triggerBracketSync(reason: string): void {
  const scraperPath = join(__dirname, "wc2026BracketScraper.mjs");
  console.log(`[WC2026HB] [STEP] Triggering bracket-sync (reason: ${reason})`);
  const child = spawn("node", [scraperPath], {
    stdio: "inherit",
    env: { ...process.env },
    detached: false,
  });
  child.on("exit", (code) => {
    console.log(`[WC2026HB] [OUTPUT] bracket-sync exited with code=${code} (reason: ${reason})`);
  });
  child.on("error", (err) => {
    console.error(`[WC2026HB] [VERIFY] FAIL — bracket-sync spawn error: ${err.message}`);
  });
}

// ─── Owner-triggered .mjs runner (engine / audit) ────────────────────────────
// Spawns a standalone ESM model/audit script as a child `node` process INSIDE
// this Railway container, so it inherits the app's own valid DATABASE_URL. This
// is the whole point of the "run inside Railway" path: the GitHub-Actions runner
// cannot reach the live TiDB cluster (the DATABASE_URL repo secret is empty and
// the TARGET_DATABASE_URL clone creds are rotated), but the deployed app can.
// Combined stdout+stderr is captured (tail-capped) and returned so the trigger
// workflow sees the result; the child is hard-killed after timeoutMs.
function spawnMjs(
  scriptFile: string,
  extraEnv: Record<string, string>,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean; output: string }> {
  return new Promise((resolve) => {
    const scriptPath = join(__dirname, scriptFile);
    const chunks: string[] = [];
    let bytes = 0;
    const CAP = 200_000; // retain at most ~200KB of tail output in memory
    const append = (b: Buffer) => {
      const s = b.toString();
      bytes += s.length;
      chunks.push(s);
      while (bytes > CAP && chunks.length > 1) {
        bytes -= chunks[0].length;
        chunks.shift();
      }
    };
    const child = spawn("node", [scriptPath], { env: { ...process.env, ...extraEnv } });
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, output: chunks.join("") });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, timedOut, output: `spawn error: ${err.message}` });
    });
  });
}

// ─── Handler: WC2026 model engine (owner-triggered, runs inside Railway) ──────
// POST /api/scheduled/wc2026-engine  { dryRun?: boolean }
// Runs the v24 Jul-11 QF engine (NOR/ENG, ARG/SUI) against the live DB: 500x
// backtest -> recalibration -> model -> write wc2026MatchOdds + wc2026_model_
// projections -> NULL audit. dryRun=true runs the full pipeline but skips every
// Phase-7 DB write.
async function handleWc2026Engine(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-engine")) return;
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === "1";
  console.log(`[WC2026HB] [INPUT] /wc2026-engine triggered dryRun=${dryRun} at ${new Date().toISOString()}`);
  try {
    const result = await spawnMjs("v24_jul11_engine.mjs", { DRY_RUN: dryRun ? "1" : "0" }, 300_000);
    const ok = result.exitCode === 0 && !result.timedOut;
    const tail = result.output.slice(-8000);
    console.log(`[WC2026HB] [OUTPUT] wc2026-engine exit=${result.exitCode} timedOut=${result.timedOut}`);
    console.log(`[WC2026HB] [VERIFY] ${ok ? "PASS" : "FAIL"} — /wc2026-engine`);
    if (!ok) notifyOwner({ title: "[HB] wc2026-engine FAIL", content: tail.slice(-500) });
    res.status(ok ? 200 : 500).json({ ok, dryRun, exitCode: result.exitCode, timedOut: result.timedOut, tail });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-engine unhandled: ${String(err)}`);
    notifyOwner({ title: "[HB] wc2026-engine FAIL", content: String(err).slice(0, 500) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: WC2026 forensic audit (owner-triggered, read-only) ─────────────
// POST /api/scheduled/wc2026-audit
// Runs wc2026AuditEngine.mjs — a read-only forensic auditor of the wc2026_espn_*
// stats tables (no DB writes). Returns the audit tail; exit code 0 = all checks
// passed.
async function handleWc2026Audit(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-audit")) return;
  console.log(`[WC2026HB] [INPUT] /wc2026-audit triggered at ${new Date().toISOString()}`);
  try {
    const result = await spawnMjs("wc2026AuditEngine.mjs", {}, 240_000);
    const ok = result.exitCode === 0 && !result.timedOut;
    const tail = result.output.slice(-8000);
    console.log(`[WC2026HB] [OUTPUT] wc2026-audit exit=${result.exitCode} timedOut=${result.timedOut}`);
    console.log(`[WC2026HB] [VERIFY] ${ok ? "PASS" : "FAIL"} — /wc2026-audit`);
    res.status(200).json({ ok, exitCode: result.exitCode, timedOut: result.timedOut, tail });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-audit unhandled: ${String(err)}`);
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: WC2026 ESPN match-data backfill (owner-triggered) ──────────────
// POST /api/scheduled/wc2026-espn-backfill  { gameIds?: string[], dryRun?: boolean }
// Re-scrapes ESPN match pages (Playwright) and ingests the 8 wc2026_espn_* stats
// tables for every played match. Default target = every wc2026_matches row with
// a real ESPN id that has been played (a score is present) — stats only exist
// for completed/live matches. A full Playwright backfill of ~80 matches far
// exceeds any HTTP timeout, so this responds 202 immediately and streams
// progress to the Railway logs (fire-and-forget). Runs in-process (chromium is
// installed in the image at /usr/bin/chromium; DATABASE_URL is valid here).
async function handleWc2026EspnBackfill(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-espn-backfill")) return;
  const dryRun = req.body?.dryRun === true;
  const explicitIds: string[] | undefined = Array.isArray(req.body?.gameIds)
    ? req.body.gameIds.map(String)
    : undefined;
  console.log(`[WC2026HB] [INPUT] /wc2026-espn-backfill triggered dryRun=${dryRun} explicit=${explicitIds?.length ?? "auto"}`);
  try {
    let gameIds: string[];
    if (explicitIds && explicitIds.length) {
      gameIds = explicitIds;
    } else {
      const db = await getDb();
      const rows = await db
        .select({ espn: wc2026Matches.espnMatchId, homeScore: wc2026Matches.homeScore })
        .from(wc2026Matches);
      // "All matches" = every fixture with a real ESPN id that has been played
      // (a score is present). Unplayed matches carry no stats to scrape.
      gameIds = rows
        .filter((r: { espn: string | null; homeScore: number | null }) => r.espn != null && r.homeScore != null)
        .map((r: { espn: string | null; homeScore: number | null }) => String(r.espn));
    }
    console.log(`[WC2026HB] [STATE] espn-backfill target count=${gameIds.length}`);
    // Respond before the long-running loop starts.
    res.status(202).json({ ok: true, accepted: gameIds.length, dryRun });
    void (async () => {
      let done = 0;
      let failed = 0;
      for (const gid of gameIds) {
        try {
          await scrapeAndIngest(gid, { dryRun });
          done++;
          console.log(`[WC2026HB] [OUTPUT] espn-backfill ${done + failed}/${gameIds.length} gid=${gid} ok`);
        } catch (e) {
          failed++;
          console.error(`[WC2026HB] [OUTPUT] espn-backfill gid=${gid} FAIL: ${String(e).slice(0, 200)}`);
        }
      }
      console.log(`[WC2026HB] [VERIFY] espn-backfill complete: done=${done} failed=${failed} of ${gameIds.length}`);
      notifyOwner({
        title: "[HB] wc2026-espn-backfill complete",
        content: `done=${done} failed=${failed} of ${gameIds.length} (dryRun=${dryRun})`,
      });
    })();
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-espn-backfill unhandled: ${String(err)}`);
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: lineups ─────────────────────────────────────────────────────────
async function handleWc2026Lineups(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-lineups")) return;

  const now = new Date();
  console.log(`[WC2026HB] [INPUT] /wc2026-lineups triggered at ${now.toISOString()}`);

  try {
    console.log("[WC2026HB] [STEP] Running Rotowire lineups scraper");
    const result = await scrapeWc2026Lineups();

    console.log(
      `[WC2026HB] [OUTPUT] lineups: rowsWritten=${result.rowsWritten} gamesProcessed=${result.gamesProcessed} errors=${result.errors.length}`
    );
    console.log(
      `[WC2026HB] [VERIFY] ${result.errors.length === 0 ? "PASS" : "FAIL"} — /wc2026-lineups`
    );

    res.json({
      ok: result.errors.length === 0,
      rowsWritten: result.rowsWritten,
      gamesProcessed: result.gamesProcessed,
      errors: result.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-lineups unhandled: ${String(err)}`);
    notifyOwner({ title: "[HB] wc2026-lineups FAIL", content: String(err).slice(0, 500) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: ESPN results ingestion ─────────────────────────────────────────
async function handleWc2026EspnResults(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-espn-results")) return;

  const now = new Date();
  // Default to today and yesterday (to catch late-finishing matches)
  const dateStr = req.body?.dateStr ?? now.toISOString().slice(0, 10).replace(/-/g, "");
  const forceReingest = req.body?.forceReingest ?? false;

  console.log(`[WC2026HB] [INPUT] /wc2026-espn-results triggered at ${now.toISOString()} dateStr=${dateStr} forceReingest=${forceReingest}`);

  try {
    const result = await ingestWc2026EspnResults({ dateStr, forceReingest });

    console.log(
      `[WC2026HB] [OUTPUT] espn-results: matchesUpdated=${result.matchesUpdated} statsWritten=${result.statsWritten} eventsWritten=${result.eventsWritten} lineupsWritten=${result.lineupsWritten} errors=${result.errors.length}`
    );

    const pass = result.errors.length === 0;
    console.log(`[WC2026HB] [VERIFY] ${pass ? "PASS" : "PARTIAL"} — /wc2026-espn-results`);

    // POST-FT HOOK: If any knockout match went FT, trigger bracket advancement
    const ftKnockoutMatches = (result.matchSummaries ?? []).filter(
      (s: any) => s.matchId?.startsWith("wc26-r32") || s.matchId?.startsWith("wc26-r16") ||
                  s.matchId?.startsWith("wc26-qf") || s.matchId?.startsWith("wc26-sf") ||
                  s.matchId?.startsWith("wc26-final")
    );
    if (ftKnockoutMatches.length > 0) {
      console.log(`[WC2026HB] [STEP] ${ftKnockoutMatches.length} knockout match(es) updated — triggering bracket-sync`);
      triggerBracketSync(`post-FT-hook: ${ftKnockoutMatches.map((m: any) => m.matchId).join(",")}`);
    }

    res.json({
      ok: pass,
      date: dateStr,
      matchesUpdated: result.matchesUpdated,
      statsWritten: result.statsWritten,
      eventsWritten: result.eventsWritten,
      lineupsWritten: result.lineupsWritten,
      matchSummaries: result.matchSummaries,
      bracketSyncTriggered: ftKnockoutMatches.length > 0,
      errors: result.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-espn-results unhandled: ${String(err)}`);
    notifyOwner({ title: "[HB] wc2026-espn-results FAIL", content: String(err).slice(0, 500) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}


// ─── Handler: live score refresh (every 5 min during match window) ──────────────────────────────────────────────────────────────────────────────
async function handleWc2026LiveScores(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-live-scores")) return;

  const now = new Date();

  // [FIX] Query BOTH today UTC and yesterday UTC.
  // Root cause: WC games with kickoff at 02:00 UTC (e.g. 10:00 PM EDT) appear on ESPN's
  // PREVIOUS day scoreboard (June 23 UTC), not the current day (June 24 UTC).
  // Without querying yesterday, any game spanning midnight UTC is silently missed.
  const todayStr    = req.body?.dateStr ?? now.toISOString().slice(0, 10).replace(/-/g, "");
  const yesterday   = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");

  // If caller passes explicit dateStr, only query that date; otherwise query both
  const datesToQuery: string[] = req.body?.dateStr
    ? [req.body.dateStr]
    : [todayStr, yesterdayStr];

  console.log(
    `[WC2026HB] [INPUT] /wc2026-live-scores triggered at ${now.toISOString()}` +
    ` | datesToQuery=${datesToQuery.join(",")}` +
    ` | [VERIFY] Querying both today+yesterday to catch games spanning midnight UTC boundary`
  );

  try {
    // Ingest all queried dates in parallel
    const results = await Promise.all(
      datesToQuery.map(dateStr =>
        ingestWc2026EspnResults({
          dateStr,
          onlyFinalMatches: false, // process both LIVE and FT events
          forceReingest: false,    // skip matches already marked FT in DB
        })
      )
    );

    // Merge results across all dates
    const merged = results.reduce(
      (acc, r) => ({
        matchesUpdated: acc.matchesUpdated + r.matchesUpdated,
        errors: [...acc.errors, ...r.errors],
        matchSummaries: [...acc.matchSummaries, ...r.matchSummaries],
      }),
      { matchesUpdated: 0, errors: [] as string[], matchSummaries: [] as typeof results[0]["matchSummaries"] }
    );

    const liveCount = merged.matchSummaries.filter(s => s.status.toLowerCase().includes("in progress")).length;
    const ftCount   = merged.matchSummaries.filter(s => !s.status.toLowerCase().includes("in progress")).length;

    console.log(
      `[WC2026HB] [OUTPUT] live-scores: matchesUpdated=${merged.matchesUpdated}` +
      ` live=${liveCount} ft=${ftCount} errors=${merged.errors.length}` +
      ` | dates=${datesToQuery.join(",")}`
    );
    const pass = merged.errors.length === 0;
    console.log(`[WC2026HB] [VERIFY] ${pass ? "PASS" : "PARTIAL"} — /wc2026-live-scores`);

    // POST-FT HOOK: If any knockout match went FT during live sync, trigger bracket advancement
    const ftKnockoutMatches = merged.matchSummaries.filter(
      (s: any) => (s.matchId?.startsWith("wc26-r32") || s.matchId?.startsWith("wc26-r16") ||
                   s.matchId?.startsWith("wc26-qf") || s.matchId?.startsWith("wc26-sf") ||
                   s.matchId?.startsWith("wc26-final")) &&
                  (s.status === "FT" || s.status === "FT_PEN" || s.status === "AET" || s.status === "PEN")
    );
    if (ftKnockoutMatches.length > 0) {
      console.log(`[WC2026HB] [STEP] ${ftKnockoutMatches.length} knockout match(es) went FT during live-sync — triggering bracket-sync`);
      triggerBracketSync(`live-sync-FT: ${ftKnockoutMatches.map((m: any) => m.matchId).join(",")}`);
    }

    res.json({
      ok: pass,
      dates: datesToQuery,
      matchesUpdated: merged.matchesUpdated,
      liveCount,
      ftCount,
      matchSummaries: merged.matchSummaries,
      bracketSyncTriggered: ftKnockoutMatches.length > 0,
      errors: merged.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-live-scores unhandled: ${String(err)}`);
    notifyOwner({ title: "[HB] wc2026-live-scores FAIL", content: String(err).slice(0, 500) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: bracket sync (every 30 min during knockout phase) ──────────────
async function handleWc2026BracketSync(req: Request, res: Response): Promise<void> {
  if (!requireCronSecret(req, res, "wc2026-bracket-sync")) return;

  const now = new Date();
  console.log(`[WC2026HB] [INPUT] /wc2026-bracket-sync triggered at ${now.toISOString()}`);

  try {
    // Spawn the bracket scraper as a child process and wait for completion
    const scraperPath = join(__dirname, "wc2026BracketScraper.mjs");
    const result = await new Promise<{ ok: boolean; code: number | null }>((resolve) => {
      const child = spawn("node", [scraperPath], {
        stdio: "pipe",
        env: { ...process.env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => { stdout += d.toString(); });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("exit", (code) => {
        // Log last 20 lines of output
        const lines = stdout.split("\n").filter(Boolean).slice(-20);
        for (const line of lines) console.log(`[WC2026HB] [bracket-sync] ${line}`);
        if (stderr) console.error(`[WC2026HB] [bracket-sync] STDERR: ${stderr.slice(-500)}`);
        resolve({ ok: code === 0, code });
      });
      child.on("error", (err) => {
        console.error(`[WC2026HB] [VERIFY] FAIL — bracket-sync spawn: ${err.message}`);
        resolve({ ok: false, code: null });
      });
    });

    console.log(`[WC2026HB] [OUTPUT] bracket-sync: ok=${result.ok} exitCode=${result.code}`);
    console.log(`[WC2026HB] [VERIFY] ${result.ok ? "PASS" : "PARTIAL"} — /wc2026-bracket-sync`);

    res.json({
      ok: result.ok,
      exitCode: result.code,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-bracket-sync unhandled: ${String(err)}`);
    notifyOwner({ title: "[HB] wc2026-bracket-sync FAIL", content: String(err).slice(0, 500) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}

export function registerWc2026Heartbeats(app: Express): void {
  // Manus Heartbeat requires /api/scheduled/* paths
  app.post("/api/scheduled/wc2026-lineups", handleWc2026Lineups);
  app.post("/api/scheduled/wc2026-espn-results", handleWc2026EspnResults);
  app.post("/api/scheduled/wc2026-live-scores", handleWc2026LiveScores);
  // POST /api/scheduled/wc2026-live-sync — FIFA HTML scraper for live minute + HT + FT status
  app.post("/api/scheduled/wc2026-live-sync", wc2026LiveSyncHandler);
  // POST /api/scheduled/wc2026-bracket-sync — Bracket advancement + opponent mapping + calendar seeding
  app.post("/api/scheduled/wc2026-bracket-sync", handleWc2026BracketSync);
  // POST /api/scheduled/wc2026-engine — owner-triggered v24 QF model run (inside Railway)
  app.post("/api/scheduled/wc2026-engine", handleWc2026Engine);
  // POST /api/scheduled/wc2026-audit — owner-triggered read-only forensic audit
  app.post("/api/scheduled/wc2026-audit", handleWc2026Audit);
  // POST /api/scheduled/wc2026-espn-backfill — owner-triggered ESPN stats backfill (all played matches)
  app.post("/api/scheduled/wc2026-espn-backfill", handleWc2026EspnBackfill);

  console.log(
    "[WC2026HB] Registered: /api/scheduled/wc2026-lineups | /api/scheduled/wc2026-espn-results | /api/scheduled/wc2026-live-scores | /api/scheduled/wc2026-live-sync | /api/scheduled/wc2026-bracket-sync | /api/scheduled/wc2026-engine | /api/scheduled/wc2026-audit | /api/scheduled/wc2026-espn-backfill"
  );
}
