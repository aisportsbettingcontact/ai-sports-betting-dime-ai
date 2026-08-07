/**
 * mountDateJob.ts — the `?date=`-aware cron mount helper (audit M-208).
 *
 * Lives in its own module, not inline in cronRoutes.ts, so it can be imported
 * and EXECUTED in a unit test. cronRoutes.ts pulls in the live DB services, so
 * anything defined there can only be asserted as source text — and text
 * matching proves what code says, never what it does. This helper carries the
 * 400-rejection path, which is worth actually running.
 */
import type { Express, Request, Response } from "express";
import { requireCronSecret } from "./cronAuth";
import { resolveClientIdentity } from "../_core/clientIdentity";
import type { CronJobRunner } from "./cronRunner";
import { resolveDateJobRequest } from "./mlbLoopJobs";

/** Strip CR/LF so a caller-supplied value cannot forge log lines. */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * Wire a POST endpoint that auth-guards, accepts an optional `?date=`
 * (or `body.date`), stashes it via `setDate` BEFORE triggering the runner, and
 * responds 200.
 *
 * A malformed date is rejected with 400 rather than silently falling back to
 * the default window: a typo'd date that quietly backfills "today" is the kind
 * of thing you only notice later, in the data.
 *
 * The stash must be written before trigger() — the runner reads it at run time,
 * so setting it afterwards would run the previous request's window.
 */
export function mountDateJob(
  app: Express,
  path: string,
  label: string,
  runner: CronJobRunner,
  setDate: (d: string | null) => void
): void {
  app.post(path, (req: Request, res: Response) => {
    if (!requireCronSecret(req, res, label)) return;

    const raw = (req.query?.date ?? req.body?.date) as string | undefined;
    const decision = resolveDateJobRequest(raw);
    if (decision.action === "reject") {
      console.log(
        `[Cron:${label}] [INPUT] REJECTED invalid date=${sanitizeForLog(String(raw))}`
      );
      res.status(decision.status).json(decision.body);
      return;
    }
    setDate(decision.date);

    const reqAt = new Date().toISOString();
    const clientIpForLog = sanitizeForLog(resolveClientIdentity(req) || "?");
    console.log(
      `[Cron:${label}] [INPUT] POST ${path} date=${raw ?? "default-window"} at ${reqAt} ip=${clientIpForLog}`
    );

    const outcome = runner.trigger();

    console.log(
      `[Cron:${label}] [OUTPUT] started=${outcome.started} skipped=${outcome.skipped} ` +
        `lastRunAt=${outcome.lastRunAt ?? "never"}`
    );

    res.status(200).json({
      ok: true,
      job: label,
      date: raw ?? null,
      startedAt: reqAt,
      started: outcome.started,
      skipped: outcome.skipped,
      lastResult: outcome.lastResult,
    });
  });
  console.log(`[Cron] [OUTPUT] Registered POST ${path} (job=${label})`);
}
