import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "DeviceActivityPanel.tsx"), "utf8");

describe("DeviceActivityPanel (source contract)", () => {
  it("reads the owner-gated overview query", () => {
    expect(src).toMatch(/trpc\.analytics\.overview\.useQuery/);
  });
  it("renders honest states and a device mix — never a fabricated zero", () => {
    expect(src).toMatch(/not_measured/);
    expect(src).toMatch(/Not measured/);
    expect(src).toMatch(/deviceMix/);
  });
  it("gates the device-mix chart on measured, non-empty data", () => {
    expect(src).toMatch(/!notOk && mix\.length > 0/);
  });
});
