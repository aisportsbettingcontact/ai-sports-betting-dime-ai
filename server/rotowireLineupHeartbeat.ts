/**
 * rotowireLineupHeartbeat.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat HTTP handler for the Rotowire lineup sync.
 *
 * Endpoint:  POST /api/scheduled/roto-lineups
 * Auth:      shared secret (CRON_SECRET) via requireCronSecret
 *
 * This handler is ISOLATED from all other sync code.
 * It calls syncRotowireLineupTabs() which:
 *   - Deletes stale lineup tabs (< today PST)
 *   - Scrapes today + tomorrow from Rotowire in parallel
 *   - Writes MM-DD-YYYY LINEUPS tabs with full safeguards:
 *       snapshot → clear → write → read-back → rollback on failure
 *
 * ─── Schema written to each tab ──────────────────────────────────────────────
 *   A: DATE            B: GAME            C: GAME_TIME_ET    D: SIDE
 *   E: TEAM            F: PITCHER         G: PITCHER_HAND    H: PITCHER_ERA
 *   I: LINEUP_STATUS   J: BATTING_ORDER   K: BATTER_NAME     L: BAT_HAND
 *   M: POSITION        N: AWAY_TEAM       O: HOME_TEAM
 *   P: ROTO_AWAY_PITCHER_ID              Q: ROTO_HOME_PITCHER_ID
 *   R: AWAY_CONFIRMED  S: HOME_CONFIRMED  T: ROTO_PLAYER_ID
 *
 * ─── Run lock ────────────────────────────────────────────────────────────────
 *   In-memory lock prevents overlapping invocations.
 *   If a sync is in progress, the handler returns 200 with skipped=true.
 *
 * ─── Logging format ──────────────────────────────────────────────────────────
 *   [RotoHeartbeat] [INPUT]  → request received
 *   [RotoHeartbeat] [STEP]   → operation
 *   [RotoHeartbeat] [OUTPUT] → result
 *   [RotoHeartbeat] [VERIFY] → PASS / FAIL / WARN
 */

import type { Express, Request, Response } from "express";
import { requireCronSecret } from "./cron/cronAuth";
import { notifyOwner } from "./_core/notification";
import { syncRotowireLineupTabs } from "./rotowireLineupSheetSync";
import { debugLog } from "./_core/debugLogger";

// ─── Run Lock ─────────────────────────────────────────────────────────────────

let _isRunning = false;
let _lastRunAt: string | null = null;
let _lastRunResult: {
  success: boolean;
  totalRowsWritten: number;
  elapsedMs: number;
  todayTab: { tabName: string; status: string; rowsWritten: number };
  tomorrowTab: { tabName: string; status: string; rowsWritten: number };
} | null = null;

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerRotoLineupsHeartbeat(app: Express): void {
  app.post("/api/scheduled/roto-lineups", async (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, "roto-lineups")) return;

    const reqAt = new Date().toISOString();
    debugLog("RotoScraper", "info", `[RotoHeartbeat] [INPUT] POST /api/scheduled/roto-lineups received at ${reqAt} | isRunning=${_isRunning} lastRunAt=${_lastRunAt ?? "never"}`);

    // ── Run lock check ────────────────────────────────────────────────────
    if (_isRunning) {
      debugLog("RotoScraper", "warn",
        `[RotoHeartbeat] [VERIFY] WARN — Sync already in progress (started ${_lastRunAt}). ` +
        `Skipping this invocation to prevent overlap.`
      );
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "sync_in_progress",
        lastRunAt: _lastRunAt,
        lastRunResult: _lastRunResult,
      });
    }

    _isRunning = true;
    _lastRunAt = reqAt;
    debugLog("RotoScraper", "info", `[RotoHeartbeat] [STEP] Acquired run lock — starting syncRotowireLineupTabs()`);

    // Respond immediately so Heartbeat platform doesn't time out waiting.
    // The sync continues in the background.
    res.status(200).json({
      ok: true,
      skipped: false,
      startedAt: reqAt,
      lastRunResult: _lastRunResult,
    });

    // ── Background sync ───────────────────────────────────────────────────
    try {
      const result = await syncRotowireLineupTabs();
      _lastRunResult = {
        success: result.success,
        totalRowsWritten: result.totalRowsWritten,
        elapsedMs: result.elapsedMs,
        todayTab: {
          tabName: result.todayTab.tabName,
          status: result.todayTab.status,
          rowsWritten: result.todayTab.rowsWritten,
        },
        tomorrowTab: {
          tabName: result.tomorrowTab.tabName,
          status: result.tomorrowTab.status,
          rowsWritten: result.tomorrowTab.rowsWritten,
        },
      };
      debugLog("RotoScraper", "info",
        `[RotoHeartbeat] [OUTPUT] syncRotowireLineupTabs complete — ` +
        `success=${result.success} rows=${result.totalRowsWritten} elapsed=${result.elapsedMs}ms`
      );
      debugLog("RotoScraper", result.success ? "info" : "warn",
        `[RotoHeartbeat] [VERIFY] ${result.success ? "PASS" : "PARTIAL"} — ` +
        `today="${result.todayTab.tabName}" status=${result.todayTab.status} ` +
        `rows=${result.todayTab.rowsWritten} readBack=${result.todayTab.readBackRowCount} ` +
        `validated=${result.todayTab.readBackValidated} | ` +
        `tomorrow="${result.tomorrowTab.tabName}" status=${result.tomorrowTab.status} ` +
        `rows=${result.tomorrowTab.rowsWritten} readBack=${result.tomorrowTab.readBackRowCount} ` +
        `validated=${result.tomorrowTab.readBackValidated}`
      );
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          debugLog("RotoScraper", "warn", `[RotoHeartbeat] [VERIFY] WARN — sync error: ${e}`);
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[RotoHeartbeat] [VERIFY] FAIL — syncRotowireLineupTabs threw: ${msg}`);
      notifyOwner({ title: "[HB] rotowire-lineups FAIL", content: msg.slice(0, 500) });
      _lastRunResult = {
        success: false,
        totalRowsWritten: 0,
        elapsedMs: 0,
        todayTab: { tabName: "UNKNOWN", status: "error", rowsWritten: 0 },
        tomorrowTab: { tabName: "UNKNOWN", status: "error", rowsWritten: 0 },
      };
    } finally {
      _isRunning = false;
      debugLog("RotoScraper", "info", `[RotoHeartbeat] [STEP] Run lock released`);
    }
  });

  console.log(`[RotoHeartbeat] [OUTPUT] Registered POST /api/scheduled/roto-lineups`);
}
