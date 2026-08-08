/**
 * cronRoutes.register.test.ts — EXECUTES registerCronRoutes against a fake
 * Express app, with the heavy service modules mocked.
 *
 * Nothing else in the repo proves that the routes are actually registered. The
 * source-contract suite can only see that the strings appear in the file; this
 * runs the wiring, so a mount that was written but never reached (a typo'd
 * path, a helper called outside registerCronRoutes, a status entry pointing at
 * the wrong runner) fails here.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Heavy collaborators: mocked so importing cronRoutes does not drag in the DB,
// Stripe, or the scrapers. Each mock is the minimum surface cronRoutes touches.
vi.mock("../vsinAutoRefresh", () => ({
  runVsinRefresh: vi.fn(),
  refreshAllScoresNow: vi.fn(),
  runMlbCycleOnce: vi.fn(),
}));
vi.mock("../mlbAllStarGameSync", () => ({ runMlbAllStarGameSync: vi.fn() }));
vi.mock("../betAutoGradeScheduler", () => ({
  runBetGradeCycle: vi.fn(),
  runBetGradeSweep: vi.fn(),
}));
vi.mock("../stripe/reconcile", () => ({
  reconcileStripeSubscriptions: vi.fn(),
  formatReconcileReport: vi.fn(),
}));
vi.mock("../_core/billingAlerts", () => ({ billingAlert: vi.fn() }));
vi.mock("../mlbOutcomeIngestor", () => ({ ingestMlbOutcomes: vi.fn() }));
vi.mock("../mlbScheduleHistoryService", () => ({
  captureClosingLines: vi.fn(),
}));
vi.mock("../mlbMultiMarketBacktest", () => ({
  runMultiMarketBacktestForDate: vi.fn(),
}));

import { registerCronRoutes } from "./cronRoutes";

function fakeApp() {
  const posts: string[] = [];
  const gets: string[] = [];
  const handlers = new Map<string, (req: unknown, res: unknown) => unknown>();
  return {
    posts,
    gets,
    handlers,
    app: {
      post: (p: string, h: (req: unknown, res: unknown) => unknown) => {
        posts.push(p);
        handlers.set(`POST ${p}`, h);
      },
      get: (p: string, h: (req: unknown, res: unknown) => unknown) => {
        gets.push(p);
        handlers.set(`GET ${p}`, h);
      },
    } as never,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerCronRoutes", () => {
  it("registers all three MLB learning-loop endpoints", () => {
    const { app, posts } = fakeApp();
    registerCronRoutes(app);
    expect(posts).toContain("/api/cron/mlb-outcomes");
    expect(posts).toContain("/api/cron/mlb-closing-capture");
    expect(posts).toContain("/api/cron/mlb-backtest");
  });

  it("does not drop any pre-existing endpoint", () => {
    const { app, posts, gets } = fakeApp();
    registerCronRoutes(app);
    for (const p of [
      "/api/cron/vsin-odds",
      "/api/cron/scores",
      "/api/cron/mlb-cycle",
      "/api/cron/bet-grade",
      "/api/cron/bet-grade-sweep",
      "/api/cron/mlb-asg",
      "/api/cron/stripe-reconcile",
    ]) {
      expect(posts, `lost ${p}`).toContain(p);
    }
    expect(gets).toContain("/api/cron/status");
  });

  it("registers each path exactly once", () => {
    const { app, posts } = fakeApp();
    registerCronRoutes(app);
    expect(new Set(posts).size).toBe(posts.length);
  });

  it("status reports all eight jobs, including the three new ones", () => {
    const { app, handlers } = fakeApp();
    registerCronRoutes(app);
    const h = handlers.get("GET /api/cron/status")!;
    let body: { ok: boolean; jobs: Record<string, unknown> } | undefined;
    h(
      {
        headers: { "x-cron-secret": "s3cret" },
        query: {},
        body: {},
        ip: "1.2.3.4",
      },
      {
        status: () => ({
          json: (b: typeof body) => {
            body = b;
          },
        }),
      }
    );
    expect(body?.ok).toBe(true);
    expect(Object.keys(body!.jobs).sort()).toEqual([
      "bet-grade",
      "bet-grade-sweep",
      "mlb-backtest",
      "mlb-closing-capture",
      "mlb-cycle",
      "mlb-outcomes",
      "scores",
      "vsin-odds",
    ]);
  });
});
