/**
 * fangraphsLineupHeartbeat.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat HTTP handler for the 10-minute Fangraphs lineup sync.
 *
 * Endpoint:  POST /api/scheduled/fg-lineups
 * Auth:      Manus Heartbeat platform token (x-heartbeat-token header)
 *
 * This handler is ISOLATED from all RotoGrinders code.
 * It calls syncFangraphsLineupTabs() which:
 *   - Deletes stale lineup tabs (< today PST)
 *   - Fetches today + tomorrow from MLB Stats API
 *   - Writes MM-DD-YYYY LINEUPS tabs with full safeguards
 *
 * Logging format:
 *   [FgHeartbeat] [INPUT]  → request received
 *   [FgHeartbeat] [STEP]   → operation
 *   [FgHeartbeat] [OUTPUT] → result
 *   [FgHeartbeat] [VERIFY] → PASS / FAIL
 */

import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { notifyOwner } from "./_core/notification";
import { syncFangraphsLineupTabs } from "./fangraphsLineupSync";

// ─── Run Lock ─────────────────────────────────────────────────────────────────
// Prevents overlapping Heartbeat invocations if a sync takes > 10 min.

let _isRunning = false;
let _lastRunAt: string | null = null;
let _lastRunResult: { success: boolean; totalRowsWritten: number; elapsedMs: number } | null = null;

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerFgLineupsHeartbeat(app: Express): void {
  app.post("/api/scheduled/fg-lineups", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return; }
    } catch (e) { res.status(401).json({ error: "unauthorized" }); return; }

    const reqAt = new Date().toISOString();
    console.log(`\n[FgHeartbeat] [INPUT] POST /api/scheduled/fg-lineups received at ${reqAt}`);
    console.log(`[FgHeartbeat] [STATE] isRunning=${_isRunning} lastRunAt=${_lastRunAt ?? "never"}`);

    // ── Run lock check ────────────────────────────────────────────────────
    if (_isRunning) {
      console.warn(
        `[FgHeartbeat] [VERIFY] WARN — Sync already in progress (started ${_lastRunAt}). ` +
        `Skipping this invocation to prevent overlap.`
      );
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "sync_in_progress",
        lastRunAt: _lastRunAt,
      });
    }

    _isRunning = true;
    _lastRunAt = reqAt;
    console.log(`[FgHeartbeat] [STEP] Acquired run lock — starting syncFangraphsLineupTabs()`);

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
      const result = await syncFangraphsLineupTabs();
      _lastRunResult = {
        success: result.success,
        totalRowsWritten: result.totalRowsWritten,
        elapsedMs: result.elapsedMs,
      };
      console.log(
        `[FgHeartbeat] [OUTPUT] syncFangraphsLineupTabs complete — ` +
        `success=${result.success} rows=${result.totalRowsWritten} elapsed=${result.elapsedMs}ms`
      );
      console.log(
        `[FgHeartbeat] [VERIFY] ${result.success ? "PASS" : "PARTIAL"} — ` +
        `today="${result.todayTab.tabName}" status=${result.todayTab.status} rows=${result.todayTab.rowsWritten} | ` +
        `tomorrow="${result.tomorrowTab.tabName}" status=${result.tomorrowTab.status} rows=${result.tomorrowTab.rowsWritten}`
      );
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          console.warn(`[FgHeartbeat] [VERIFY] WARN — sync error: ${e}`);
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[FgHeartbeat] [VERIFY] FAIL — syncFangraphsLineupTabs threw: ${msg}`);
      notifyOwner({ title: "[HB] fg-lineups FAIL", content: msg.slice(0, 500) });
      _lastRunResult = { success: false, totalRowsWritten: 0, elapsedMs: 0 };
    } finally {
      _isRunning = false;
      console.log(`[FgHeartbeat] [STEP] Run lock released`);
    }
  });

  console.log(`[FgHeartbeat] [OUTPUT] Registered POST /api/scheduled/fg-lineups`);
}
