/**
 * wc2026Heartbeat.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Project-level heartbeat handlers for WC2026 data pipeline.
 *
 * Three registered endpoints:
 *
 * 1. POST /api/heartbeat/wc2026-odds
 *    Cadence: every 30 min (5 min within 90 min of kickoff via is_closing flag)
 *    Action:  Scrape AN soccer odds → wc2026_odds_snapshots
 *             Mark is_closing=true when called within 90 min of any kickoff
 *
 * 2. POST /api/heartbeat/wc2026-splits
 *    Cadence: every 5 min
 *    Action:  Scrape DK Network splits → wc2026_betting_splits
 *
 * 3. POST /api/heartbeat/wc2026-lineups
 *    Cadence: every 10 min
 *    Action:  Scrape Rotowire WOC lineups → wc2026_lineups
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

// ─── Registration ─────────────────────────────────────────────────────────────
export function registerWc2026Heartbeats(app: Express): void {
  // Manus Heartbeat requires /api/scheduled/* paths
  app.post("/api/scheduled/wc2026-odds", handleWc2026Odds);
  app.post("/api/scheduled/wc2026-splits", handleWc2026Splits);
  app.post("/api/scheduled/wc2026-lineups", handleWc2026Lineups);

  console.log(
    "[WC2026HB] Registered: /api/scheduled/wc2026-odds | /api/scheduled/wc2026-splits | /api/scheduled/wc2026-lineups"
  );
}
