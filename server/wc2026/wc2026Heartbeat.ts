/**
 * wc2026Heartbeat.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Project-level heartbeat handlers for WC2026 data pipeline.
 *
 * Registered endpoints:
 *
 * 1. POST /api/scheduled/wc2026-odds
 *    Cadence: every 30 min (5 min within 90 min of kickoff via is_closing flag)
 *    Action:  Scrape AN soccer odds → wc2026_odds_snapshots
 *             Mark is_closing=true when called within 90 min of any kickoff
 *
 * 2. POST /api/scheduled/wc2026-splits
 *    Cadence: every 5 min
 *
 * 3. POST /api/scheduled/wc2026-lineups
 *    Cadence: every 10 min
 *    Action:  Scrape Rotowire WOC lineups → wc2026_lineups
 *
 * 4. POST /api/scheduled/wc2026-espn-results
 *    Cadence: daily (post-match)
 *    Action:  Ingest FT match results, stats, events, lineups from ESPN API
 *
 * 5. POST /api/scheduled/wc2026-live-scores
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
import { getDb } from "../db";
import { wc2026Fixtures } from "../../drizzle/wc2026.schema";
import { and, gte, lte, eq } from "drizzle-orm";
import { scrapeWc2026Odds } from "./wc2026OddsScraper";
import { scrapeWc2026DkSplits } from "./wc2026DkSplitsScraper";
import { scrapeWc2026Lineups } from "./wc2026RotowireLineupsScraper";
import { ingestWc2026EspnResults } from "./wc2026EspnResultsIngester";
import { wc2026LiveSyncHandler } from "./fifaLiveScraper";

// ─── Closing line window: 90 minutes before kickoff ──────────────────────────
const CLOSING_WINDOW_MS = 90 * 60 * 1000;

async function isClosingWindow(): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const windowStart = new Date(now.getTime() - CLOSING_WINDOW_MS);
  const windowEnd = new Date(now.getTime() + CLOSING_WINDOW_MS);

  // Check if any fixture has kickoff_utc within ±90 min of now
  const upcoming = await db
    .select({ fixtureId: wc2026Fixtures.fixtureId, kickoffUtc: wc2026Fixtures.kickoffUtc })
    .from(wc2026Fixtures)
    .where(
      and(
        gte(wc2026Fixtures.kickoffUtc, windowStart),
        lte(wc2026Fixtures.kickoffUtc, windowEnd),
        eq(wc2026Fixtures.status, "SCHEDULED")
      )
    )
    .limit(1);

  if (upcoming.length > 0) {
    console.log(
      `[WC2026HB] [STATE] Closing window active — fixture_id=${upcoming[0].fixtureId} kickoff=${upcoming[0].kickoffUtc?.toISOString()}`
    );
    return true;
  }
  return false;
}

// ─── Handler: odds snapshot ───────────────────────────────────────────────────
async function handleWc2026Odds(req: Request, res: Response): Promise<void> {
  const now = new Date();
  console.log(`[WC2026HB] [INPUT] /wc2026-odds triggered at ${now.toISOString()}`);

  try {
    const closing = await isClosingWindow();
    console.log(`[WC2026HB] [STEP] Running AN odds scraper isClosing=${closing}`);

    const result = await scrapeWc2026Odds({ dateUtc: now, isClosing: closing });

    console.log(
      `[WC2026HB] [OUTPUT] odds: snapshotsWritten=${result.snapshotsWritten} gamesProcessed=${result.gamesProcessed} errors=${result.errors.length}`
    );
    console.log(
      `[WC2026HB] [VERIFY] ${result.errors.length === 0 ? "PASS" : "FAIL"} — /wc2026-odds`
    );

    res.json({
      ok: result.errors.length === 0,
      snapshotsWritten: result.snapshotsWritten,
      gamesProcessed: result.gamesProcessed,
      isClosing: closing,
      errors: result.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-odds unhandled: ${String(err)}`);
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: betting splits ──────────────────────────────────────────────────
async function handleWc2026Splits(req: Request, res: Response): Promise<void> {
  const now = new Date();
  console.log(`[WC2026HB] [INPUT] /wc2026-splits triggered at ${now.toISOString()}`);

  try {
    console.log("[WC2026HB] [STEP] Running DK Network splits scraper (every 5 min)");
    const result = await scrapeWc2026DkSplits();

    console.log(
      `[WC2026HB] [OUTPUT] splits: rowsWritten=${result.rowsWritten} gamesProcessed=${result.gamesProcessed} errors=${result.errors.length}`
    );
    console.log(
      `[WC2026HB] [VERIFY] ${result.errors.length === 0 ? "PASS" : "FAIL"} — /wc2026-splits`
    );

    res.json({
      ok: result.errors.length === 0,
      rowsWritten: result.rowsWritten,
      gamesProcessed: result.gamesProcessed,
      errors: result.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-splits unhandled: ${String(err)}`);
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: lineups ─────────────────────────────────────────────────────────
async function handleWc2026Lineups(req: Request, res: Response): Promise<void> {
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
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ─── Handler: ESPN results ingestion ─────────────────────────────────────────
async function handleWc2026EspnResults(req: Request, res: Response): Promise<void> {
  const now = new Date();
  // Default to today and yesterday (to catch late-finishing matches)
  const dateStr = req.body?.dateStr ?? now.toISOString().slice(0, 10).replace(/-/g, "");
  const forceReingest = req.body?.forceReingest ?? false;

  console.log(`[WC2026HB] [INPUT] /wc2026-espn-results triggered at ${now.toISOString()} dateStr=${dateStr} forceReingest=${forceReingest}`);

  try {
    const result = await ingestWc2026EspnResults({ dateStr, forceReingest });

    console.log(
      `[WC2026HB] [OUTPUT] espn-results: fixturesUpdated=${result.fixturesUpdated} statsWritten=${result.statsWritten} eventsWritten=${result.eventsWritten} lineupsWritten=${result.lineupsWritten} errors=${result.errors.length}`
    );

    const pass = result.errors.length === 0;
    console.log(`[WC2026HB] [VERIFY] ${pass ? "PASS" : "PARTIAL"} — /wc2026-espn-results`);

    res.json({
      ok: pass,
      date: dateStr,
      fixturesUpdated: result.fixturesUpdated,
      statsWritten: result.statsWritten,
      eventsWritten: result.eventsWritten,
      lineupsWritten: result.lineupsWritten,
      matchSummaries: result.matchSummaries,
      errors: result.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-espn-results unhandled: ${String(err)}`);
    res.status(500).json({ ok: false, error: String(err) });
  }
}


// ─── Handler: live score refresh (every 5 min during match window) ──────────────────────────────────────────────────────────────────────────────
async function handleWc2026LiveScores(req: Request, res: Response): Promise<void> {
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
          forceReingest: false,    // skip fixtures already marked FT in DB
        })
      )
    );

    // Merge results across all dates
    const merged = results.reduce(
      (acc, r) => ({
        fixturesUpdated: acc.fixturesUpdated + r.fixturesUpdated,
        errors: [...acc.errors, ...r.errors],
        matchSummaries: [...acc.matchSummaries, ...r.matchSummaries],
      }),
      { fixturesUpdated: 0, errors: [] as string[], matchSummaries: [] as typeof results[0]["matchSummaries"] }
    );

    const liveCount = merged.matchSummaries.filter(s => s.status.toLowerCase().includes("in progress")).length;
    const ftCount   = merged.matchSummaries.filter(s => !s.status.toLowerCase().includes("in progress")).length;

    console.log(
      `[WC2026HB] [OUTPUT] live-scores: fixturesUpdated=${merged.fixturesUpdated}` +
      ` live=${liveCount} ft=${ftCount} errors=${merged.errors.length}` +
      ` | dates=${datesToQuery.join(",")}`
    );
    const pass = merged.errors.length === 0;
    console.log(`[WC2026HB] [VERIFY] ${pass ? "PASS" : "PARTIAL"} — /wc2026-live-scores`);

    res.json({
      ok: pass,
      dates: datesToQuery,
      fixturesUpdated: merged.fixturesUpdated,
      liveCount,
      ftCount,
      matchSummaries: merged.matchSummaries,
      errors: merged.errors,
    });
  } catch (err) {
    console.error(`[WC2026HB] [VERIFY] FAIL — /wc2026-live-scores unhandled: ${String(err)}`);
    res.status(500).json({ ok: false, error: String(err) });
  }
}

export function registerWc2026Heartbeats(app: Express): void {
  // Manus Heartbeat requires /api/scheduled/* paths
  app.post("/api/scheduled/wc2026-odds", handleWc2026Odds);
  app.post("/api/scheduled/wc2026-splits", handleWc2026Splits);
  app.post("/api/scheduled/wc2026-lineups", handleWc2026Lineups);
  app.post("/api/scheduled/wc2026-espn-results", handleWc2026EspnResults);
  app.post("/api/scheduled/wc2026-live-scores", handleWc2026LiveScores);
  // POST /api/scheduled/wc2026-live-sync — FIFA HTML scraper for live minute + HT + FT status
  app.post("/api/scheduled/wc2026-live-sync", wc2026LiveSyncHandler);

  console.log(
    "[WC2026HB] Registered: /api/scheduled/wc2026-odds | /api/scheduled/wc2026-splits | /api/scheduled/wc2026-lineups | /api/scheduled/wc2026-espn-results | /api/scheduled/wc2026-live-scores | /api/scheduled/wc2026-live-sync"
  );
}
