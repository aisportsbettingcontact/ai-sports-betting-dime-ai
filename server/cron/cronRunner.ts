/**
 * cronRunner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Run-lock / idempotency state machine shared by every cron endpoint.
 *
 * A cron endpoint responds 200 immediately and does its real work in the
 * background so the HTTP caller (GitHub Actions) never blocks. If Actions fires
 * again before a slow job finishes, we MUST NOT run the work twice concurrently —
 * that would double-write to the DB or hammer an upstream feed. CronJobRunner
 * enforces single-flight execution and records the outcome of the last run.
 *
 * Deliberately has zero Express / DB coupling so it is unit-testable in isolation.
 */

export interface CronRunResult {
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

export interface CronRunnerState {
  isRunning: boolean;
  lastRunAt: string | null;
  lastResult: CronRunResult | null;
}

export interface CronTriggerOutcome {
  started: boolean;
  skipped: boolean;
  lastRunAt: string | null;
  lastResult: CronRunResult | null;
}

interface CronRunnerOpts {
  /** Injectable clock (ISO string). Defaults to wall-clock. */
  now?: () => string;
  /** Injectable monotonic ms source for elapsed timing. Defaults to Date.now. */
  monotonic?: () => number;
  /** Optional structured logger; defaults to console. */
  log?: (line: string) => void;
}

export class CronJobRunner {
  private isRunning = false;
  private lastRunAt: string | null = null;
  private lastResult: CronRunResult | null = null;
  private inFlight: Promise<CronRunResult> | null = null;

  private readonly now: () => string;
  private readonly monotonic: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly name: string,
    private readonly work: () => Promise<unknown>,
    opts: CronRunnerOpts = {}
  ) {
    this.now = opts.now ?? (() => new Date().toISOString());
    this.monotonic = opts.monotonic ?? (() => Date.now());
    this.log = opts.log ?? ((line) => console.log(line));
  }

  get state(): CronRunnerState {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  /**
   * Resolves when the current (or most recent) background run settles. Tests await
   * this to observe the released lock; handlers ignore it (fire-and-forget).
   */
  async lastRun(): Promise<CronRunResult | null> {
    if (this.inFlight) return this.inFlight;
    return this.lastResult;
  }

  /**
   * Attempt to start the job. Synchronous decision; the work runs in the
   * background. Returns whether this call started a fresh run or was skipped
   * because one was already in flight.
   */
  trigger(): CronTriggerOutcome {
    if (this.isRunning) {
      this.log(
        `[Cron:${this.name}] [SKIP] already running since ${this.lastRunAt ?? "?"} — overlap prevented`
      );
      return {
        started: false,
        skipped: true,
        lastRunAt: this.lastRunAt,
        lastResult: this.lastResult,
      };
    }

    const startedAt = this.now();
    const startMs = this.monotonic();
    this.isRunning = true;
    this.lastRunAt = startedAt;
    this.log(`[Cron:${this.name}] [START] run acquired lock at ${startedAt}`);

    this.inFlight = (async (): Promise<CronRunResult> => {
      try {
        await this.work();
        const elapsedMs = this.monotonic() - startMs;
        const result: CronRunResult = { ok: true, elapsedMs };
        this.log(`[Cron:${this.name}] [DONE] ok elapsed=${elapsedMs}ms`);
        return result;
      } catch (err) {
        const elapsedMs = this.monotonic() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        this.log(`[Cron:${this.name}] [FAIL] error="${message}" elapsed=${elapsedMs}ms`);
        return { ok: false, elapsedMs, error: message };
      } finally {
        this.isRunning = false;
      }
    })().then((result) => {
      this.lastResult = result;
      this.inFlight = null;
      return result;
    });

    return {
      started: true,
      skipped: false,
      lastRunAt: startedAt,
      lastResult: this.lastResult,
    };
  }
}
