import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { forwardOverviewRead } from "./readForward";

describe("forwardOverviewRead", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.USER_ACTIVITY_BACKEND_URL;
    delete process.env.ANALYTICS_INGEST_SECRET;
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it("returns not_measured when not configured (no backend URL/secret)", async () => {
    const o = await forwardOverviewRead(async () => new Response("{}", { status: 200 }));
    expect(o.state).toBe("not_measured");
    expect(o.reason).toMatch(/not configured/);
  });

  it("never throws on a network error (degrades to a state)", async () => {
    process.env.USER_ACTIVITY_BACKEND_URL = "http://backend.railway.internal:3000";
    process.env.ANALYTICS_INGEST_SECRET = "s3cret";
    const o = await forwardOverviewRead(async () => {
      throw new Error("boom");
    });
    expect(["not_measured", "error"]).toContain(o.state);
  });
});
