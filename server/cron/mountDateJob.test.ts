import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mountDateJob, sanitizeForLog } from "./mountDateJob";

/**
 * Executes the mount helper against a fake Express app, so the auth guard, the
 * 400-rejection path and the stash-before-trigger ordering are all RUN rather
 * than pattern-matched in the source.
 */

const OLD = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  if (OLD === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = OLD;
  vi.restoreAllMocks();
});

/** Capture the handler mountDateJob registers. */
function mount(runner: unknown, setDate: (d: string | null) => void) {
  let handler!: (req: unknown, res: unknown) => void;
  const app = {
    post: (_p: string, h: (req: unknown, res: unknown) => void) => {
      handler = h;
    },
  };
  mountDateJob(
    app as never,
    "/api/cron/test",
    "test",
    runner as never,
    setDate
  );
  return handler;
}

const res = () => {
  const r = {
    statusCode: 0,
    body: undefined as unknown,
    status(c: number) {
      r.statusCode = c;
      return r;
    },
    json(b: unknown) {
      r.body = b;
      return r;
    },
  };
  return r;
};

const req = (date?: string) => ({
  query: date === undefined ? {} : { date },
  body: {},
  headers: { "x-cron-secret": "s3cret" },
  get: () => undefined,
  ip: "127.0.0.1",
});

const runner = () => ({
  trigger: vi.fn().mockReturnValue({
    started: true,
    skipped: false,
    lastRunAt: null,
    lastResult: null,
  }),
});

describe("mountDateJob", () => {
  it("rejects a malformed date with 400 and NEVER triggers the runner", () => {
    const r = runner();
    const setDate = vi.fn();
    const h = mount(r, setDate);
    const response = res();
    h(req("08-07-2026"), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      error: "invalid-date",
      expected: "YYYY-MM-DD",
    });
    // The important half: a bad date must not start a run against the default
    // window, and must not leave a stale stash behind.
    expect(r.trigger).not.toHaveBeenCalled();
    expect(setDate).not.toHaveBeenCalled();
  });

  it("accepts a well-formed date, stashes it, and triggers", () => {
    const r = runner();
    const setDate = vi.fn();
    const h = mount(r, setDate);
    const response = res();
    h(req("2026-08-07"), response);

    expect(response.statusCode).toBe(200);
    expect(setDate).toHaveBeenCalledWith("2026-08-07");
    expect(r.trigger).toHaveBeenCalledOnce();
  });

  it("stashes BEFORE triggering — the runner reads the stash at run time", () => {
    const order: string[] = [];
    const r = {
      trigger: vi.fn(() => {
        order.push("trigger");
        return {
          started: true,
          skipped: false,
          lastRunAt: null,
          lastResult: null,
        };
      }),
    };
    const h = mount(r, () => order.push("setDate"));
    h(req("2026-08-07"), res());
    expect(order).toEqual(["setDate", "trigger"]);
  });

  it("no date means the default window, not a rejection", () => {
    const r = runner();
    const setDate = vi.fn();
    const h = mount(r, setDate);
    const response = res();
    h(req(), response);

    expect(response.statusCode).toBe(200);
    expect(setDate).toHaveBeenCalledWith(null);
    expect((response.body as { date: string | null }).date).toBeNull();
  });

  it("refuses an unauthenticated request", () => {
    const r = runner();
    const h = mount(r, vi.fn());
    const response = res();
    h({ ...req("2026-08-07"), headers: {} }, response);
    expect(r.trigger).not.toHaveBeenCalled();
    expect(response.statusCode).not.toBe(200);
  });
});

describe("sanitizeForLog", () => {
  it("strips CR/LF so a caller cannot forge a log line", () => {
    expect(sanitizeForLog("ok\r\n[Cron] FAKE")).toBe("ok[Cron] FAKE");
  });
});
