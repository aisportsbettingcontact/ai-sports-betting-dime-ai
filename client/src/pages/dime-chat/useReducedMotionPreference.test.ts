import { describe, expect, it } from "vitest";
import {
  REDUCED_MOTION_QUERY,
  resolveReducedMotionPreference,
} from "./useReducedMotionPreference";

// The vitest environment here is "node" (see vitest.config.ts) — no DOM, no
// matchMedia. This suite covers the pure resolver only; the hook's live
// matchMedia + change-listener wiring is exercised at runtime by the drawer
// reduced-motion e2e specs (e2e/drawer-reduced-motion.spec.ts), which
// depend on this same query string.

describe("resolveReducedMotionPreference", () => {
  it("returns true when matches is true", () => {
    expect(resolveReducedMotionPreference({ matches: true })).toBe(true);
  });

  it("returns false when matches is false", () => {
    expect(resolveReducedMotionPreference({ matches: false })).toBe(false);
  });

  it("returns false when no MediaQueryList is available", () => {
    expect(resolveReducedMotionPreference(null)).toBe(false);
    expect(resolveReducedMotionPreference(undefined)).toBe(false);
  });
});

describe("REDUCED_MOTION_QUERY", () => {
  it("targets the standard reduced-motion media feature", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });
});
