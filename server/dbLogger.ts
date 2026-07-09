/**
 * dbLogger.ts
 *
 * Redirects verbose background-job logs from stdout → MySQL `debug_logs` table.
 *
 * Problem: Background jobs ([MlbScheduleHistory], [ANApiOdds], [RotoScraper],
 * [OddsHistory], [STATE]) generate thousands of console.log() calls per minute,
 * pushing Railway past its 500 logs/sec rate limit and causing 502 timeouts.
 *
 * Solution: logToDb() inserts into `debug_logs` instead of writing to stdout.
 * ERROR-level logs still go to console.error() so critical failures remain
 * visible in Railway's log stream.
 *
 * The table is created automatically on first use (CREATE TABLE IF NOT EXISTS).
 * No migration required.
 *
 * Usage:
 *   import { logToDb } from './dbLogger';
 *   await logToDb('MlbScheduleHistory', 'info', `Refresh complete for ${date}`);
 *   await logToDb('ANApiOdds', 'warn', `No DK odds for ${dateStr}`);
 *   // Errors still go to console.error() — do NOT redirect them here
 */

import mysql from 'mysql2/promise';

// ─── Table bootstrap ──────────────────────────────────────────────────────────

let _tableEnsured = false;
let _tableEnsurePromise: Promise<void> | null = null;

/**
 * Creates the debug_logs table if it doesn't exist.
 * Runs once per process lifetime; subsequent calls are no-ops.
 */
async function ensureTable(pool: mysql.Pool): Promise<void> {
  if (_tableEnsured) return;
  if (_tableEnsurePromise) return _tableEnsurePromise;

  _tableEnsurePromise = (async () => {
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS debug_logs (
          id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
          timestamp  BIGINT       NOT NULL,
          source     VARCHAR(64)  NOT NULL,
          level      VARCHAR(16)  NOT NULL DEFAULT 'info',
          message    TEXT         NOT NULL,
          INDEX idx_source (source),
          INDEX idx_timestamp (timestamp)
        )
      `);
      _tableEnsured = true;
    } catch (err) {
      // Non-fatal: if table creation fails, logToDb() will silently skip writes
      // rather than crashing the background job.
      console.error('[dbLogger] Failed to create debug_logs table:', err);
    }
  })();

  return _tableEnsurePromise;
}

// ─── Write queue (fire-and-forget batch) ─────────────────────────────────────
//
// Logs are buffered in memory and flushed every 2 seconds in a single INSERT.
// This prevents per-log DB round-trips from adding latency to background jobs.

interface LogEntry {
  timestamp: number;
  source: string;
  level: string;
  message: string;
}

const _queue: LogEntry[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 500; // safety cap — drop oldest if queue overflows

// ─── Pool reference ───────────────────────────────────────────────────────────
//
// We lazily import the pool from db.ts to avoid circular dependencies.
// The pool is only accessed after the DB module has initialized it.

let _pool: mysql.Pool | null = null;

async function getPool(): Promise<mysql.Pool | null> {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;

  try {
    // Lazy import to avoid circular dependency with db.ts
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return null;

    // Access the underlying pool via the drizzle session
    // db.$client is the mysql2 pool when using drizzle-orm/mysql2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (db as any).$client as mysql.Pool | undefined;
    if (client && typeof client.execute === 'function') {
      _pool = client;
      return _pool;
    }
  } catch {
    // Pool not yet available — will retry on next flush
  }
  return null;
}

async function flush(): Promise<void> {
  if (_queue.length === 0) return;

  const pool = await getPool();
  if (!pool) {
    // DB not available — discard buffered logs silently
    _queue.length = 0;
    return;
  }

  await ensureTable(pool);
  if (!_tableEnsured) {
    _queue.length = 0;
    return;
  }

  // Drain the queue
  const batch = _queue.splice(0, _queue.length);
  if (batch.length === 0) return;

  try {
    // Build a multi-row INSERT for efficiency
    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
    const values: (string | number)[] = [];
    for (const entry of batch) {
      values.push(entry.timestamp, entry.source, entry.level, entry.message);
    }
    await pool.execute(
      `INSERT INTO debug_logs (timestamp, source, level, message) VALUES ${placeholders}`,
      values
    );
  } catch {
    // Silently discard on write failure — logging must never crash background jobs
  }
}

function scheduleFlush(): void {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await flush();
  }, FLUSH_INTERVAL_MS);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a message to the `debug_logs` database table instead of stdout.
 *
 * - 'info' and 'warn' levels are written to DB only (no stdout).
 * - 'error' level is written to DB AND console.error() so critical failures
 *   remain visible in Railway logs.
 *
 * The write is fire-and-forget (buffered + batched every 2s). Callers do not
 * need to await this function — it never throws.
 *
 * @param source  - Log source tag, e.g. "MlbScheduleHistory", "ANApiOdds"
 * @param level   - "info" | "warn" | "error"
 * @param message - The log message string
 */
export function logToDb(
  source: string,
  level: 'info' | 'warn' | 'error',
  message: string
): void {
  // ERROR level: always echo to stderr so Railway captures critical failures
  if (level === 'error') {
    console.error(`[${source}] ${message}`);
  }

  // Overflow protection: drop oldest entries if queue is full
  if (_queue.length >= MAX_QUEUE_SIZE) {
    _queue.shift();
  }

  _queue.push({
    timestamp: Date.now(),
    source,
    level,
    message,
  });

  scheduleFlush();
}
