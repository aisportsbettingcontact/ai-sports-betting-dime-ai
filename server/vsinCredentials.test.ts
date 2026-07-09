/**
 * Validates that VSiN credentials are present in the environment.
 * These are required for the Refresh Books scraper to auto-login.
 */
import { describe, it, expect } from "vitest";
import { IS_CI } from "./_core/ciTestGuard";

// Presence-probe — scoped out of CI; validates a real operator environment.
describe.skipIf(IS_CI)("VSiN credentials", () => {
  it("VSIN_EMAIL is set and non-empty", () => {
    expect(process.env.VSIN_EMAIL).toBeTruthy();
    expect(process.env.VSIN_EMAIL?.length).toBeGreaterThan(0);
  });

  it("VSIN_PASSWORD is set and non-empty", () => {
    expect(process.env.VSIN_PASSWORD).toBeTruthy();
    expect(process.env.VSIN_PASSWORD?.length).toBeGreaterThan(0);
  });

  it("VSIN_EMAIL looks like a valid email address", () => {
    const email = process.env.VSIN_EMAIL ?? "";
    expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});
