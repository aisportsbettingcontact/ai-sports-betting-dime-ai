import { probeAppUsersSchema, type AppUsersSchemaVerdict } from "../db";

/**
 * Phase 1½ — schema/code-agreement health gate.
 *
 * The #370 (2026-08-05) and 2026-07-31 outages had the same shape: code that
 * SELECTs a new app_users column deployed BEFORE the migration added it. Drizzle
 * enumerates every declared column, so every auth read threw ER_BAD_FIELD_ERROR,
 * which the auth layer swallowed to "invalid credentials" — a silent, total auth
 * outage that HTTP-level probes (200/401) could not distinguish from healthy.
 *
 * This gate makes that failure mode LOUD and, crucially, PREVENTABLE: /health
 * reports 503 while the live schema is behind the code, so Railway's deploy
 * healthcheck fails and it keeps the previous (healthy) deploy serving instead
 * of cutting over to the broken one. The migration-before-code law is
 * documented; this makes it ENFORCED.
 *
 * Safety asymmetry: ONLY a genuine schema mismatch fails health. A transient /
 * unavailable DB yields "unknown", which does NOT fail this gate — the existing
 * DB-circuit gate already decides 200/503 for DB-down, and freezing deploys on a
 * DB blip would be worse than the disease. Disable in an emergency with
 * SCHEMA_HEALTHGATE=off.
 */

let verdict: AppUsersSchemaVerdict = "unknown";
let probed = false;

/** True unless explicitly disabled via SCHEMA_HEALTHGATE=off. */
export function schemaGateEnabled(): boolean {
  return (process.env.SCHEMA_HEALTHGATE ?? "").trim().toLowerCase() !== "off";
}

/** The most recent probe verdict (unknown until the first probe resolves). */
export function currentSchemaVerdict(): AppUsersSchemaVerdict {
  return verdict;
}

/** Has any probe completed yet? */
export function hasSchemaProbed(): boolean {
  return probed;
}

/**
 * Should /health report 503 because the live schema is behind the code?
 * Only true for a CONFIRMED mismatch while the gate is enabled — never for
 * "unknown" (transient/unavailable), so a DB blip cannot freeze deploys.
 */
export function shouldFailHealthForSchema(): boolean {
  return schemaGateEnabled() && verdict === "schema_mismatch";
}

/**
 * Run the schema probe and cache the verdict. `probe` is injectable for tests.
 * A confirmed mismatch is logged CRITICAL (loud enough for external alerting).
 */
export async function runSchemaProbe(
  probe: () => Promise<AppUsersSchemaVerdict> = probeAppUsersSchema
): Promise<AppUsersSchemaVerdict> {
  try {
    verdict = await probe();
  } catch {
    // A probe that throws is treated as unknown (never a false mismatch).
    verdict = "unknown";
  }
  probed = true;
  if (verdict === "schema_mismatch") {
    console.error(
      "[schema-gate] CRITICAL: app_users schema is behind the code — /health will " +
        "report 503 so Railway keeps the previous healthy deploy. Run the db-push.yml " +
        "workflow to apply the pending migration, then redeploy."
    );
  }
  return verdict;
}

/**
 * Boot-time probe, bounded so a slow/unreachable DB never blocks startup. Call
 * BEFORE server.listen so the verdict is known before Railway's first health
 * probe (closing the race where a premature 200 lets a broken deploy go live).
 *
 * The budget MUST exceed the pool's connectTimeout (15s, server/db.ts). At boot
 * the pool is cold — the keepalive warm-up runs in onListening, i.e. AFTER
 * listen — so this probe establishes the very first TiDB connection. On a
 * paused/resuming TiDB Serverless (off-peak redeploy) a cold connect can take
 * several seconds; a budget shorter than connectTimeout would let the timer win
 * the race, leave the verdict "unknown", and let Railway cut over to a broken
 * deploy before the real verdict lands — defeating the whole gate on exactly the
 * cold-redeploy path it exists for (Phase 1½ review, 2026-08-05). At 20s a cold
 * connect (≤15s) + the trivial probe query still resolve to a REAL verdict
 * before listen; a warm redeploy resolves in <1s (the race returns on
 * completion, not the ceiling); a genuine DB-down resolves to "unknown" (does
 * not fail health) after the budget. Railway's healthcheckTimeout=300 easily
 * tolerates the extra boot seconds.
 */
export async function runBootSchemaProbe(timeoutMs = 20_000): Promise<void> {
  await Promise.race([
    runSchemaProbe(),
    new Promise<void>(resolve => {
      const t = setTimeout(resolve, timeoutMs);
      if (typeof t.unref === "function") t.unref();
    }),
  ]);
}

/**
 * Re-probe on a slow interval so a mismatch that appears after boot (or a
 * boot probe that timed out) is still caught. Unref'd — never keeps the
 * process alive. Returns the timer so callers/tests can clear it.
 */
export function startSchemaProbeInterval(
  intervalMs = 60_000
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void runSchemaProbe();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

/** Test-only: reset cached state between cases. */
export function __resetSchemaGateForTest(): void {
  verdict = "unknown";
  probed = false;
}
