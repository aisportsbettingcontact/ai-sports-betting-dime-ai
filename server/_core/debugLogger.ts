/**
 * debugLogger.ts
 *
 * Redirects background job logging from stdout to the `debug_logs` database
 * table. This prevents Railway's 500 logs/sec rate limit from being triggered
 * by high-frequency background jobs (ANApiOdds, MlbScheduleHistory, RotoScraper,
 * OddsHistory, STATE tracking).
 *
 * ─── Design principles ────────────────────────────────────────────────────────
 *   - Fire-and-forget: never awaited in hot paths — DB insert is async
 *   - Silent on DB errors: logging failures must never crash the app
 *   - ERROR level only goes to stdout: keeps critical issues visible in Railway
 *   - All other levels go to DB only: eliminates stdout noise from background jobs
 *
 * ─── Table schema (MySQL / TiDB) ─────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS debug_logs (
 *     id BIGINT PRIMARY KEY AUTO_INCREMENT,
 *     source VARCHAR(50) NOT NULL,
 *     level VARCHAR(10) NOT NULL,
 *     message TEXT NOT NULL,
 *     context JSON,
 *     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *     INDEX idx_source_created (source, created_at),
 *     INDEX idx_level_created (level, created_at)
 *   );
 */

export type DebugLogLevel = "info" | "warn" | "error" | "debug";

/**
 * Log a message to the debug_logs database table (fire-and-forget).
 *
 * @param source  - Tag identifying the background job, e.g. "ANApiOdds", "MlbScheduleHistory"
 * @param level   - Log level: "info" | "warn" | "error" | "debug"
 * @param message - Human-readable log message
 * @param context - Optional structured data (serialized as JSON in the DB)
 *
 * Behavior:
 *   - ERROR level: also logs to stdout via console.error for Railway visibility
 *   - All levels: inserted into debug_logs table asynchronously
 *   - DB errors: silently caught — logging must never crash the app
 */
export function debugLog(
  source: string,
  level: DebugLogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  // ERROR level always goes to stdout so Railway shows critical failures
  if (level === "error") {
    console.error(`[${source}] ${message}`, context ?? "");
  }

  // Fire-and-forget DB insert — never awaited
  // Lazy import of getDb to avoid circular dependency (db.ts ↔ debugLogger.ts)
  (async () => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return; // DB not available — silently skip

      // Use raw SQL to avoid needing a Drizzle schema definition for this table.
      // The table is created via ensureDebugLogsTable() at server startup.
      await db.execute(
        `INSERT INTO debug_logs (source, level, message, context) VALUES (?, ?, ?, ?)`,
        [
          source.slice(0, 50),
          level.slice(0, 10),
          message,
          context !== undefined ? JSON.stringify(context) : null,
        ]
      );
    } catch {
      // Silently ignore all DB errors — logging failures must never cascade
    }
  })();
}

/**
 * Ensure the debug_logs table exists. Call once at server startup.
 * Idempotent — safe to call multiple times.
 */
export async function ensureDebugLogsTable(): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;

    await db.execute(`
      CREATE TABLE IF NOT EXISTS debug_logs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        source VARCHAR(50) NOT NULL,
        level VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        context JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_source_created (source, created_at),
        INDEX idx_level_created (level, created_at)
      )
    `);
    console.log("[DebugLogger] debug_logs table ready");
  } catch (err) {
    // Non-fatal — app continues without debug logging if table creation fails
    console.warn("[DebugLogger] Failed to create debug_logs table (non-fatal):", err);
  }
}
