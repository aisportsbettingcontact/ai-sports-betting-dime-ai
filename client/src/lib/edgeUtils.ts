/**
 * edgeUtils.ts — Single source of truth for ALL edge calculation logic.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CANONICAL EDGE RULE (Option B — confirmed by user):
 *
 *   An edge exists on a side ONLY when the model's raw implied probability
 *   is STRICTLY GREATER than the book's raw implied probability on that
 *   same side.
 *
 *   modelImplied(side) > bookImplied(side)  →  EDGE
 *   modelImplied(side) ≤ bookImplied(side)  →  NO EDGE
 *
 *   Equivalently: the model must be MORE confident in the outcome than the
 *   book is (before removing vig from either side).
 *
 *   Examples:
 *     u7.5  book=-123 model=-116  → model implied 53.70% < book implied 55.16%  → NO EDGE ✓
 *     u7.5  book=-123 model=-128  → model implied 56.14% > book implied 55.16%  → EDGE ✓
 *     MIL ML book=-149 model=-149 → model implied 59.84% = book implied 59.84%  → NO EDGE ✓
 *     MIL ML book=-149 model=-155 → model implied 60.78% > book implied 59.84%  → EDGE ✓
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROI FORMULA (for display when an edge IS detected):
 *
 *   ROI = (modelImplied / bookNoVigProb − 1) × 100
 *
 *   bookNoVigProb = bookImplied(side) / (bookImplied(side) + bookImplied(opp))
 *
 *   This gives the expected return per dollar bet at the book's fair price.
 *   The model's own vig is NOT removed for the ROI numerator — the model's
 *   raw implied probability is the signal.  Only the book's vig is removed
 *   (denominator) to get the fair price you're paying.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE DETECTION THRESHOLD:
 *
 *   EDGE_THRESHOLD_PP = 1.5 percentage points
 *   (model implied must exceed book implied by ≥ 1.5pp to qualify as an edge)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Convert American odds to implied probability (raw, vig-inclusive).
 * Returns NaN for NaN input.
 *
 * @example americanToImplied(-110) → 0.5238
 * @example americanToImplied(+100) → 0.5000
 * @example americanToImplied(-149) → 0.5984
 */
export function americanToImplied(odds: number): number {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

/**
 * Convert American odds to decimal odds.
 * Returns NaN for NaN input.
 */
export function americanToDecimal(odds: number): number {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return 1 + 100 / (-odds);
  return 1 + odds / 100;
}

/**
 * Calculate edge in percentage points.
 *
 * CANONICAL RULE: edge = (modelImplied − bookImplied) × 100
 * Positive = model is MORE confident than book → edge exists.
 * Negative = model is LESS confident than book → no edge.
 *
 * @param bookOdds  - Book's American ML for this side (e.g. -123)
 * @param modelOdds - Model's American ML for this side (e.g. -128)
 * @returns edge in percentage points (e.g. +1.0 or -1.5), or NaN if invalid.
 */
export function calculateEdge(bookOdds: number, modelOdds: number): number {
  const bookImplied  = americanToImplied(bookOdds);
  const modelImplied = americanToImplied(modelOdds);
  if (isNaN(bookImplied) || isNaN(modelImplied)) return NaN;
  return (modelImplied - bookImplied) * 100;
}

/**
 * Calculate edge from raw probability percentage.
 * bookOdds: American odds from the book.
 * modelPct: Model's win probability as a percentage (e.g. 54.2 for 54.2%).
 * Returns edge in percentage points.
 */
export function calculateEdgeFromPct(bookOdds: number, modelPct: number): number {
  const bookImplied = americanToImplied(bookOdds);
  if (isNaN(bookImplied) || isNaN(modelPct)) return NaN;
  return (modelPct / 100 - bookImplied) * 100;
}

/** 6-tier verdict from edge pp value. */
export function getVerdict(edge: number): string {
  if (isNaN(edge)) return '—';
  if (edge >= 8) return 'ELITE';
  if (edge >= 5) return 'STRONG';
  if (edge >= 2.5) return 'PLAYABLE';
  if (edge >= 0.5) return 'SMALL';
  if (edge >= -1) return 'NEUTRAL';
  return 'FADE';
}

/** Color for a given edge pp value (spec-compliant 6-tier scale). */
export function getEdgeColor(edge: number): string {
  if (isNaN(edge)) return 'rgba(255,255,255,0.30)';
  if (edge >= 8) return '#39FF14';   // ELITE   — full neon green
  if (edge >= 5) return '#7FFF00';   // STRONG  — chartreuse
  if (edge >= 2.5) return '#ADFF2F'; // PLAYABLE — yellow-green
  if (edge >= 0.5) return 'rgba(255,255,255,0.60)'; // SMALL — white/60
  if (edge >= -1) return 'rgba(255,255,255,0.30)';  // NEUTRAL — white/30
  return '#FF2244';                  // FADE    — red
}

/**
 * Remove vig from a two-sided market.
 * Returns [awayFairPct, homeFairPct] as percentages (0–100).
 * Returns null if either ML is missing or invalid.
 */
export function removeVig(
  awayML: string | null | undefined,
  homeML: string | null | undefined
): [number, number] | null {
  if (!awayML || !homeML) return null;
  const a = parseFloat(awayML);
  const h = parseFloat(homeML);
  if (isNaN(a) || isNaN(h)) return null;
  const rawA = americanToImplied(a);
  const rawH = americanToImplied(h);
  const vigTotal = rawA + rawH;
  if (vigTotal <= 0) return null;
  return [(rawA / vigTotal) * 100, (rawH / vigTotal) * 100];
}

/** Minimum edge threshold in percentage points to display as an edge. */
export const EDGE_THRESHOLD_PP = 1.5;

/**
 * Calculate ROI % for display when an edge has been detected.
 *
 * ─── CANONICAL FORMULA ────────────────────────────────────────────────────
 *
 *   ROI = (modelImplied / bookNoVigProb − 1) × 100
 *
 *   Where:
 *     modelImplied = americanToImplied(modelML)          ← raw, vig-inclusive
 *     bookNoVigProb = bookImplied / (bookImplied + bookOppImplied)  ← fair price
 *
 * ─── WHY THIS FORMULA ─────────────────────────────────────────────────────
 *
 *   The model's raw implied probability is the signal — we do NOT remove
 *   the model's own vig because the model is already outputting its true
 *   fair probability (the model has no vig to remove; it IS the fair price).
 *
 *   The book's vig IS removed (denominator) because we need the book's fair
 *   price to compute the return on investment correctly.
 *
 *   EDGE DETECTION (Option B) is a prerequisite: this function should only
 *   be called when modelImplied > bookImplied has already been confirmed.
 *   If called with model ≤ book, ROI will be ≤ 0 (negative or zero).
 *
 * ─── VALIDATION CASES ─────────────────────────────────────────────────────
 *
 *   u7.5 book=-123/+102, model=-116/+116:
 *     modelImplied(-116) = 116/216 = 0.5370
 *     bookImplied(-123)  = 123/223 = 0.5516  ← model < book → NO EDGE (Option B)
 *     ROI = (0.5370 / 0.5270 − 1) × 100 = +1.90%  (but edge not shown — Option B blocks it)
 *
 *   MIL ML book=-149/+124, model=-149/+134:
 *     modelImplied(-149) = 149/249 = 0.5984
 *     bookImplied(-149)  = 149/249 = 0.5984  ← model = book → NO EDGE
 *     ROI = 0.00%  (edge not shown)
 *
 *   MIL RL book=+149/-200, model=+134/-181:
 *     modelImplied(+134) = 100/234 = 0.4274  ← MIL +1.5 away side
 *     bookImplied(+149)  = 100/249 = 0.4016  ← model > book → EDGE ✓
 *     bookNoVig(+149) = 0.4016 / (0.4016 + 0.6667) = 0.3760
 *     ROI = (0.4274 / 0.3760 − 1) × 100 = +13.67%
 *
 * @param modelML   - Model's American ML for this side (e.g. -149)
 * @param bookML    - Book's American ML for this side (e.g. -149)
 * @param bookOppML - Book's American ML for the opposite side (e.g. +124)
 *                    Used to compute the no-vig book probability.
 * @returns ROI as a percentage (e.g. 4.44), or NaN if any input is invalid.
 */
export function calculateRoi(
  modelML: number,
  bookML: number,
  bookOppML: number
): number {
  if (isNaN(modelML) || isNaN(bookML) || isNaN(bookOppML)) return NaN;
  const modelImplied = americanToImplied(modelML);
  const rawBook = americanToImplied(bookML);
  const rawOpp  = americanToImplied(bookOppML);
  const vigTotal = rawBook + rawOpp;
  if (vigTotal <= 0 || isNaN(vigTotal)) return NaN;
  const bookNoVigProb = rawBook / vigTotal;
  if (bookNoVigProb <= 0) return NaN;
  return (modelImplied / bookNoVigProb - 1) * 100;
}

/**
 * Calculate ROI % from model win probability (0–1) vs book odds.
 * Used when the model provides a direct win probability rather than ML.
 *
 * @param modelWinProb - Model's win probability as a decimal (0–1)
 * @param bookML       - Book's American ML for the same side
 * @param bookOppML    - Book's American ML for the opposite side
 * @returns ROI as a percentage (e.g. 4.44), or NaN if any input is invalid.
 */
export function calculateRoiFromProb(
  modelWinProb: number,
  bookML: number,
  bookOppML: number
): number {
  if (isNaN(modelWinProb) || isNaN(bookML) || isNaN(bookOppML)) return NaN;
  if (modelWinProb <= 0 || modelWinProb >= 1) return NaN;
  const rawBook = americanToImplied(bookML);
  const rawOpp  = americanToImplied(bookOppML);
  const vigTotal = rawBook + rawOpp;
  if (vigTotal <= 0 || isNaN(vigTotal)) return NaN;
  const bookNoVigProb = rawBook / vigTotal;
  if (bookNoVigProb <= 0) return NaN;
  return (modelWinProb / bookNoVigProb - 1) * 100;
}

/**
 * Format ROI % for display.
 * e.g. 4.44 → "+4.44% ROI", -2.1 → "-2.10% ROI"
 */
export function formatRoi(roi: number): string {
  if (isNaN(roi)) return '';
  const sign = roi >= 0 ? '+' : '';
  return `${sign}${roi.toFixed(2)}% ROI`;
}
