import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "..", "routers", "analytics.ts"), "utf8");

describe("analytics router derives device server-side", () => {
  it("reads the UA and reconciles device_type", () => {
    expect(src).toMatch(/deriveDeviceFromUA/);
    expect(src).toMatch(/reconcileDeviceType/);
    expect(src).toMatch(/user-agent/);
  });
  it("routes through the shared dispatcher (no inline TiDB write)", () => {
    expect(src).toMatch(/dispatchStoredEvent/);
    expect(src).not.toMatch(/railway\.internal/);
  });
});
