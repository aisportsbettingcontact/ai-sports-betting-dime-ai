import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitServerEvent } from "./emitServer";

describe("emitServerEvent", () => {
  const OLD = { ...process.env };
  beforeEach(() => { delete process.env.ANALYTICS_ROLE; delete process.env.USER_ACTIVITY_BACKEND_URL; });
  afterEach(() => { process.env = { ...OLD }; });

  it("resolves (no-op) when the pipeline is disabled and never throws", async () => {
    await expect(emitServerEvent({
      eventName: "login", userId: 42,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/604.1",
    })).resolves.toBeUndefined();
  });
  it("swallows a bad userId without throwing", async () => {
    await expect(emitServerEvent({ eventName: "login", userId: NaN })).resolves.toBeUndefined();
  });
});
