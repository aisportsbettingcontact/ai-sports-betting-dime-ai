/** Parse "h:mm(am|pm)" → minutes since midnight, or null for TBA/ranges/anything else. */
function parseEtTime(timeEt: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(timeEt.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
}

/** Offset (minutes east of UTC, negative for US) of America/New_York at a given UTC instant. */
function etOffsetMinutes(atUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(atUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - atUtc.getTime()) / 60000);
}

/**
 * Convert a CFB kickoff expressed as an ET wall-clock time on an ET calendar date
 * to its UTC instant. Returns null when the source has no single concrete time
 * (TBA, broadcast windows like "3:30-8:00pm").
 */
export function etKickoffToUtc(dateIso: string, timeEt: string): Date | null {
  const minutes = parseEtTime(timeEt);
  if (minutes === null) return null;
  const [y, mo, d] = dateIso.split("-").map(Number);
  if (!y || !mo || !d) return null;
  // First guess: treat the wall time as if ET == UTC, then correct by the real offset.
  const guess = new Date(Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60));
  const corrected = new Date(guess.getTime() - etOffsetMinutes(guess) * 60000);
  // One refinement pass handles instants that cross a DST boundary between guess and answer.
  return new Date(guess.getTime() - etOffsetMinutes(corrected) * 60000);
}
