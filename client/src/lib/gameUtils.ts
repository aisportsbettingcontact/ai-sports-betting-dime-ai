/**
 * gameUtils.ts — Single source of truth for game data formatting utilities.
 *
 * Previously duplicated in: ModelProjections.tsx, BettingSplitsPage, GameCard.tsx,
 * MlbCheatSheetCard.tsx (as formatTimeV3), MlbLineupCard.tsx, MlbPropsCard.tsx.
 * Now: one canonical implementation. Import from here everywhere.
 */

/**
 * Format a time string to 12-hour ET display.
 * Handles: military time ("19:05"), already-formatted ("7:05 PM ET"), TBD/TBA.
 */
export function formatGameTime(time: string | null | undefined): string {
  if (!time) return "TBD";
  const upper = time.trim().toUpperCase();
  if (upper === "TBD" || upper === "TBA" || upper === "") return "TBD";
  // Already-formatted 12-hour: "7:05 PM ET" or "12:15 PM ET"
  const already12h = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  if (already12h) {
    const h = parseInt(already12h[1], 10);
    const m = already12h[2];
    const ap = already12h[3].toUpperCase();
    return `${h}:${m} ${ap} ET`;
  }
  // Military time: "19:05"
  if (!time.includes(":")) return "TBD";
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} ET`;
}

/** Minutes since midnight for sort purposes. TBD/TBA → 9999. */
export function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 9999;
  const upper = time.toUpperCase();
  if (upper === "TBD" || upper === "TBA") return 9999;
  const already12h = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  if (already12h) {
    let h = parseInt(already12h[1], 10);
    const m = parseInt(already12h[2], 10);
    const ap = already12h[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return 9999;
  return h * 60 + m;
}

/** Format YYYY-MM-DD to "Wednesday, April 30, 2026". */
export function formatDateHeader(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Format YYYY-MM-DD to "Apr 30". */
export function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/** Spread number to display string. 0 → "PK", positive → "+N", negative → "−N". */
export function spreadSign(n: number): string {
  if (isNaN(n)) return "—";
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

/** Parse string or number to float. Returns NaN for null/undefined/empty. */
export function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(v);
}
