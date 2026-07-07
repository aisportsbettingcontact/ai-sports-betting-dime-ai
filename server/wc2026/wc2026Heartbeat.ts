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
import { sdk } from "../_core/sdk";
import { notifyOwner } from "../_core/notification";
import { getDb } from "../db";
import { wc2026Matches } from "../../drizzle/wc2026.schema";
import { and, gte, lte, eq } from "drizzle-orm";
import { scrapeWc2026Lineups } from "./wc2026RotowireLineupsScraper";
import { ingestWc2026EspnResults } from "./wc2026Ingester";
import { wc2026LiveSyncHandler } from "./fifaLiveScraper";
import { spawn } from "child_process";
import { join } from "path";

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

// ─── Handler: lineups ─────────────────────────────────────────────────────────
async function handleWc2026Lineups(req: Request, res: Response): Promise<void> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return; }
  } catch (e) { res.status(401).json({ error: "unauthorized" }); return; }

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
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return; }
  } catch (e) { res.status(401).json({ error: "unauthorized" }); return; }

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
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return; }
  } catch (e) { res.status(401).json({ error: "unauthorized" }); return; }

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
                  (s.status === "FT" || s.status === "AET" || s.status === "PEN")
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
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return; }
  } catch (e) { res.status(401).json({ error: "unauthorized" }); return; }

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

  console.log(
    "[WC2026HB] Registered: /api/scheduled/wc2026-lineups | /api/scheduled/wc2026-espn-results | /api/scheduled/wc2026-live-scores | /api/scheduled/wc2026-live-sync | /api/scheduled/wc2026-bracket-sync"
  );
}
