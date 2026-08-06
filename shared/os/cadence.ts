/**
 * shared/os/cadence.ts — declared cron cadence vs. what actually ran (ISSUE-013, LOOP-002).
 *
 * The arithmetic lives here rather than inline in `scripts/os/observe-crons.mts`
 * because of the defect that cost PR #398: a runner script that reimplements its
 * library's logic produces a second reality, and the number it prints comes from
 * code no test covers. See [[the-script-that-runs-is-not-the-code-thats-tested]].
 * The script does I/O; this module does the reasoning; the tests cover this.
 *
 * WHY EXPECTED RUNS ARE COMPUTED FOR A SPECIFIC DATE. "Runs per day" is not a
 * property of a cron expression — `17 6 1 * *` fires 12 times a year and zero
 * times on almost every day. Evaluating against a real date is exact, and it
 * stops a monthly job from being reported as broken on the 30 days it is
 * correctly silent.
 */

export interface CadenceInput {
  workflow: string;
  /** Runs the declared schedule should have produced on the measured day. */
  expected: number;
  /** Runs GitHub actually recorded. */
  actual: number;
}

export interface CadenceVerdict extends CadenceInput {
  honoured: boolean;
  /** actual/expected, or null when the workflow was not scheduled that day. */
  ratio: number | null;
  note: string | null;
}

/**
 * Below this share of declared runs, a schedule is not being honoured.
 *
 * EXPORTED AND TESTED DELIBERATELY. This single number is the instrument's whole
 * verdict, and nothing pinned it — a one-character edit would silently redefine
 * "honoured" across every report LOOP-002 produces and every decision built on
 * one. The boundary is INCLUSIVE: exactly half the declared runs counts as
 * honoured, so a workflow at 50% is reported "no" rather than flagged.
 */
export const HONOURED_FLOOR = 0.5;

/**
 * Expand one cron field into the concrete values it matches.
 * Supports `*`, `a`, `a-b`, `a,b,c`, `*​/n` and `a-b/n`.
 */
const MONTH_NAMES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DOW_NAMES = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

/**
 * GitHub accepts `MON` and `JAN`. Throwing on them aborted the ENTIRE
 * observation, blinding LOOP-002 to every other workflow — a fail-closed that
 * fails too hard. Names are normalised to their numeric equivalents instead.
 */
function normaliseNames(field: string, min: number, max: number): string {
  const names = max === 12 && min === 1 ? MONTH_NAMES : max === 7 && min === 0 ? DOW_NAMES : null;
  if (!names) return field;
  return field.replace(/[A-Za-z]+/g, (word) => {
    const i = names.indexOf(word.toUpperCase());
    if (i === -1) return word; // leave it; the numeric parse below will reject it
    return String(max === 12 ? i + 1 : i);
  });
}

export function parseCronField(rawField: string, min: number, max: number): number[] {
  const field = normaliseNames(rawField, min, max);
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid cron step in ${JSON.stringify(field)}`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a;
      hi = b;
    } else if (stepPart !== undefined) {
      // `a/n` is "from a, every n, to the end of the range" — GitHub accepts and
      // fires on it. Treating it as the bare value `a` dropped the step and
      // under-counted `0/15` as 24 runs a day instead of 96, a 4x error large
      // enough to flip a verdict from unhonoured to honoured.
      lo = Number(rangePart);
      hi = max;
    } else {
      lo = Number(rangePart);
      hi = Number(rangePart);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error(`invalid cron field ${JSON.stringify(field)}`);
    }
    // Clamping a bad value would quietly turn a typo into a valid schedule.
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron field ${JSON.stringify(field)} out of range ${min}-${max}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * How many times a 5-field cron expression fires on a given UTC calendar date.
 *
 * Walks the day's 1440 minutes rather than deriving a rate, so step boundaries,
 * ranges and day selectors are exact instead of approximated.
 */
export function expectedRunsOnDate(expr: string, isoDate: string): number {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron expression must have five fields: ${JSON.stringify(expr)}`);
  }
  const [minF, hourF, domF, monF, dowF] = fields;
  const minutes = new Set(parseCronField(minF, 0, 59));
  const hours = new Set(parseCronField(hourF, 0, 23));
  const doms = new Set(parseCronField(domF, 1, 31));
  const months = new Set(parseCronField(monF, 1, 12));
  // POSIX allows 7 for Sunday; normalise it to 0 so both spellings match.
  const dows = new Set(parseCronField(dowF, 0, 7).map((d: number) => (d === 7 ? 0 : d)));

  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date ${JSON.stringify(isoDate)}`);
  // `new Date("2026-02-31")` silently becomes March 3. A report for a day that
  // does not exist is worse than an error, so round-trip and compare.
  if (d.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`invalid calendar date ${JSON.stringify(isoDate)}`);
  }
  const dom = d.getUTCDate();
  const mon = d.getUTCMonth() + 1;
  const dow = d.getUTCDay();

  if (!months.has(mon)) return 0;
  // cron's day rule: when BOTH day-of-month and day-of-week are restricted, either
  // may match. When only one is restricted, that one must match.
  const domRestricted = domF !== "*";
  const dowRestricted = dowF !== "*";
  const dayMatches =
    domRestricted && dowRestricted
      ? doms.has(dom) || dows.has(dow)
      : domRestricted
        ? doms.has(dom)
        : dowRestricted
          ? dows.has(dow)
          : true;
  if (!dayMatches) return 0;

  return hours.size * minutes.size;
}

export function cadenceVerdict(input: CadenceInput): CadenceVerdict {
  const { expected, actual } = input;
  if (expected === 0) {
    // Not scheduled today. Judging it would divide by zero, or report a monthly
    // job as broken on the 30 days it is correctly silent.
    return { ...input, honoured: true, ratio: null, note: "not scheduled on the measured day" };
  }
  const ratio = actual / expected;
  return {
    ...input,
    honoured: ratio >= HONOURED_FLOOR,
    ratio,
    note: null,
  };
}

/**
 * The most recent COMPLETE UTC day, relative to `nowIso`.
 *
 * The observer originally defaulted to today. The daily workflow fires at 10:40
 * UTC, so a perfectly-honoured five-minute job could have produced at most 129 of the
 * day's 288 runs by then — 45%, below the 0.5 floor. Every high-frequency
 * workflow would have been reported unhonoured every single day regardless of
 * reality. A permanently red alarm is indistinguishable from no alarm, and it
 * would have discredited the loop's real finding along with it.
 */
export function defaultMeasureDate(nowIso: string): string {
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) throw new Error(`invalid instant ${JSON.stringify(nowIso)}`);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Has `isoDate` finished, as of `nowIso`? A partial day cannot be scored. */
export function isCompleteDay(isoDate: string, nowIso: string): boolean {
  const end = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) throw new Error(`invalid date ${JSON.stringify(isoDate)}`);
  end.setUTCDate(end.getUTCDate() + 1);
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) throw new Error(`invalid instant ${JSON.stringify(nowIso)}`);
  return now.getTime() >= end.getTime();
}

export interface GapStats {
  /** Runs that fell inside the measured UTC day. */
  count: number;
  /** Minutes between consecutive in-window runs. */
  gaps: number[];
  medianMin: number | null;
  maxMin: number | null;
}

/**
 * Gaps between consecutive runs, computed ONLY from runs inside the measured day.
 *
 * The first published figures were produced by hand from `gh run list --limit 20`
 * — the last twenty runs OVERALL, spanning 35.6 hours across three UTC days —
 * and then described in the artifact as "a complete 24-hour window". The true
 * in-window median was 107, not 101, and the published maximum of 202 was a gap
 * that occurred entirely on the following day.
 *
 * It lives here, with the rest of the arithmetic, so the documented Method can
 * actually reproduce the number. A statistic no instrument computes cannot be
 * regression-tested, and a daily check cannot notice it drifting.
 */
export function runGaps(createdAtIso: string[], isoDate: string): GapStats {
  const inWindow = createdAtIso
    .filter((t) => t.slice(0, 10) === isoDate)
    .map((t) => Date.parse(t))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < inWindow.length; i++) {
    gaps.push(Math.round((inWindow[i] - inWindow[i - 1]) / 60000));
  }
  if (gaps.length === 0) {
    return { count: inWindow.length, gaps: [], medianMin: null, maxMin: null };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { count: inWindow.length, gaps, medianMin: median, maxMin: sorted[sorted.length - 1] };
}
