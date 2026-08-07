/**
 * mlbLoopJobs.ts — the MLB learning-loop job logic (audit M-208), extracted
 * from cronRoutes.ts so it is executable in a unit test.
 *
 * cronRoutes.ts wires Express to live DB services, so anything defined inline
 * there can only be asserted as source TEXT — which pins what the code says,
 * never what it does. Everything below takes its collaborators as parameters,
 * so the windowing, the aggregation and the fail-loud rules are tested by
 * running them.
 */

/** Result of one learning-loop job run, returned into the run-lock's lastResult. */
export interface LoopJobResult {
  dates: string[];
  errors: string[];
}

export interface OutcomesJobResult extends LoopJobResult {
  written: number;
  skipped: number;
  rowErrors: number;
}

export interface BacktestJobResult extends LoopJobResult {
  processed: number;
  enrollErrors: number;
}

/**
 * The most recent N calendar dates as YYYY-MM-DD in `timeZone`, oldest first.
 *
 * Why a timezone matters: games.gameDate is a calendar date in a specific zone,
 * not a UTC instant, so "yesterday" is a zone-relative question. A late West
 * Coast final lands on the PT date even though UTC has already rolled over.
 *
 * DST-safe at this granularity: subtracting fixed 86_400_000 ms windows and then
 * formatting IN the zone cannot skip or repeat a date across a 2-3 day lookback.
 * Do not extend N materially without re-deriving that.
 *
 * `now` is injectable so the test is deterministic.
 */
export function lastNDates(
  n: number,
  timeZone: string,
  now: number = Date.now()
): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(
      new Date(now - i * 86_400_000).toLocaleDateString("en-CA", { timeZone })
    );
  }
  return out;
}

/**
 * Validate an optional `?date=` parameter.
 *
 * A malformed date must be REJECTED, not silently replaced by the default
 * window: a typo'd date that quietly backfills "today" is the kind of thing you
 * only notice later, in the data.
 */
export function parseCronDateParam(
  raw: unknown
): { ok: true; date: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, date: null };
  const s = String(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, date: s } : { ok: false };
}

/** Minimal shape of ingestMlbOutcomes' return that this job actually reads. */
export interface OutcomeSummaryLike {
  written: number;
  skippedAlreadyIngested: number;
  skippedNotFinal: number;
  skippedNoGamePk: number;
  skippedNoApiMatch: number;
  errors: number;
}

/**
 * Ingest outcomes across a window, tolerating a single bad date but failing
 * loudly when EVERY date failed — a total failure must record ok:false rather
 * than a silently-green background run (the OBS-0002 class).
 */
export async function runOutcomesJob(
  dates: string[],
  ingest: (date: string) => Promise<OutcomeSummaryLike>
): Promise<OutcomesJobResult> {
  let written = 0;
  let skipped = 0;
  let rowErrors = 0;
  const errors: string[] = [];

  for (const d of dates) {
    try {
      const s = await ingest(d);
      written += s.written;
      skipped +=
        s.skippedAlreadyIngested +
        s.skippedNotFinal +
        s.skippedNoGamePk +
        s.skippedNoApiMatch;
      rowErrors += s.errors;
    } catch (err) {
      errors.push(`${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (dates.length > 0 && errors.length === dates.length) {
    throw new Error(
      `all ${dates.length} outcome ingests failed: ${errors.join(" | ")}`
    );
  }
  return { dates, written, skipped, rowErrors, errors };
}

/**
 * Enroll FINAL games that have no backtest rows yet, across a window.
 *
 * Fails loud only when work was attempted and ALL of it failed. Zero unenrolled
 * games is the normal steady state of a self-heal job and must NOT be an error.
 */
export async function runBacktestJob(
  dates: string[],
  runForDate: (date: string) => Promise<{ processed: number; errors: number }>
): Promise<BacktestJobResult> {
  let processed = 0;
  let enrollErrors = 0;
  const errors: string[] = [];

  for (const d of dates) {
    try {
      const r = await runForDate(d);
      processed += r.processed;
      enrollErrors += r.errors;
    } catch (err) {
      errors.push(`${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (processed === 0 && enrollErrors > 0) {
    throw new Error(`all ${enrollErrors} backtest enrollments failed`);
  }
  if (dates.length > 0 && errors.length === dates.length) {
    throw new Error(
      `all ${dates.length} backtest dates threw: ${errors.join(" | ")}`
    );
  }
  return { dates, processed, enrollErrors, errors };
}

// ─── Runner work factories ────────────────────────────────────────────────────
//
// The CronJobRunner bodies live here rather than inline in cronRoutes.ts for the
// same reason as everything above: inline they can only be asserted as text.
// Each returns the async work function the runner will invoke, with its
// collaborators already bound.

/** Work fn for the mlb-outcomes runner. `getDate` reads the ?date= stash. */
export function makeOutcomesWork(
  getDate: () => string | null,
  ingest: (date: string) => Promise<OutcomeSummaryLike>,
  log: (msg: string) => void = console.log,
  now: () => number = Date.now
): () => Promise<OutcomesJobResult> {
  return async () => {
    const stashed = getDate();
    const dates = stashed
      ? [stashed]
      : lastNDates(2, "America/Los_Angeles", now());
    const r = await runOutcomesJob(dates, ingest);
    log(
      `[Cron:mlb-outcomes] [OUTPUT] dates=[${r.dates.join(",")}] written=${r.written} ` +
        `skipped=${r.skipped} rowErrors=${r.rowErrors} dateFailures=${r.errors.length}`
    );
    return r;
  };
}

/** Work fn for the mlb-backtest runner. */
export function makeBacktestWork(
  getDate: () => string | null,
  runForDate: (date: string) => Promise<{ processed: number; errors: number }>,
  log: (msg: string) => void = console.log,
  now: () => number = Date.now
): () => Promise<BacktestJobResult> {
  return async () => {
    const stashed = getDate();
    const dates = stashed
      ? [stashed]
      : lastNDates(3, "America/New_York", now());
    const r = await runBacktestJob(dates, runForDate);
    log(
      `[Cron:mlb-backtest] [OUTPUT] dates=[${r.dates.join(",")}] processed=${r.processed} ` +
        `enrollErrors=${r.enrollErrors} dateFailures=${r.errors.length}`
    );
    return r;
  };
}

/**
 * The `?date=`-aware half of mountDateJob, extracted so the REJECTION path is
 * executable in a test. Returns what the route should do; the caller performs
 * the Express side effects.
 */
export function resolveDateJobRequest(
  raw: unknown
):
  | {
      action: "reject";
      status: 400;
      body: { ok: false; error: string; expected: string };
    }
  | { action: "run"; date: string | null } {
  const parsed = parseCronDateParam(raw);
  if (!parsed.ok) {
    return {
      action: "reject",
      status: 400,
      body: { ok: false, error: "invalid-date", expected: "YYYY-MM-DD" },
    };
  }
  return { action: "run", date: parsed.date };
}

/** Work fn for the mlb-closing-capture runner. Takes no date: it only ever
 *  scrapes the current slate. */
export function makeClosingCaptureWork<
  T extends {
    scanned: number;
    locked: number;
    alreadyLocked: number;
    noOdds: number;
    errors: unknown[];
  },
>(
  capture: () => Promise<T>,
  log: (msg: string) => void = console.log
): () => Promise<T> {
  return async () => {
    const r = await capture();
    log(
      `[Cron:mlb-closing-capture] [OUTPUT] scanned=${r.scanned} locked=${r.locked} ` +
        `alreadyLocked=${r.alreadyLocked} noOdds=${r.noOdds} errors=${r.errors.length}`
    );
    return r;
  };
}
