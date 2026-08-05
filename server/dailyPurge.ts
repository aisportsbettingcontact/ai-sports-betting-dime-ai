/**
 * dailyPurge.ts
 *
 * DISABLED as of March 25, 2026.
 * The daily game-purge scheduler has been permanently removed.
 * Games are now retained indefinitely — no automatic deletion occurs.
 *
 * The exported startDailyPurgeSchedule() is kept as a no-op so that
 * any existing import in index.ts compiles without modification.
 */

/**
 * No-op. Daily purge has been permanently disabled (March 25, 2026).
 * Games are retained indefinitely; no rows are deleted automatically.
 */
export function startDailyPurgeSchedule(): void {
  console.log(
    "[DailyPurge] DISABLED — daily game purge has been permanently removed (2026-03-25). All game data is retained indefinitely."
  );
}
