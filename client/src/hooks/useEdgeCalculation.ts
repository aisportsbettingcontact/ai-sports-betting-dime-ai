/**
 * useEdgeCalculation.ts
 * Extracted from GameCard.tsx — pure edge math utilities.
 * No React hooks needed; these are pure functions exported for reuse.
 */

/** Convert American odds to implied probability (0–1). */
export function americanToImplied(odds: number): number {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

/**
 * Calculate edge in percentage points.
 * Positive = model likes this bet over book price.
 * Negative = book is more efficient than model here.
 * Returns NaN if either input is NaN (missing data).
 */
export function calculateEdge(bookOdds: number, modelOdds: number): number {
  const bookImplied  = americanToImplied(bookOdds);
  const modelImplied = americanToImplied(modelOdds);
  if (isNaN(bookImplied) || isNaN(modelImplied)) return NaN;
  return (modelImplied - bookImplied) * 100;
}

/** 6-tier verdict from edge pp value. */
export function getVerdict(edge: number): string {
  if (isNaN(edge)) return '—';
  if (edge >= 8)    return 'ELITE';
  if (edge >= 5)    return 'STRONG';
  if (edge >= 2.5)  return 'PLAYABLE';
  if (edge >= 0.5)  return 'SMALL';
  if (edge >= -1)   return 'NEUTRAL';
  return 'FADE';
}

/** Color for a given edge pp value (spec-compliant 6-tier scale). */
export function getEdgeColor(edge: number): string {
  // Three-Color Law: positive edge (ELITE/STRONG/PLAYABLE) = mint signal;
  // everything else = plain white ink (no greys, no red).
  if (isNaN(edge))  return '#FFFFFF';
  if (edge >= 8)    return '#45E0A8';   // ELITE
  if (edge >= 5)    return '#45E0A8';   // STRONG
  if (edge >= 2.5)  return '#45E0A8';   // PLAYABLE
  if (edge >= 0.5)  return '#FFFFFF';   // SMALL
  if (edge >= -1)   return '#FFFFFF';   // NEUTRAL
  return '#FFFFFF';                     // FADE — plain ink, never red
}

/** Spread sign helper — returns "PK" for 0, "—" for NaN, otherwise "+X" or "-X". */
export function spreadSign(n: number): string {
  if (isNaN(n)) return "—";
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

/** Parse a numeric value from string/number/null/undefined. Returns NaN on failure. */
export function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? NaN : n;
}
