import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_FEED_THEME_KEY,
  LEGACY_THEME_KEY,
  MODE_STORAGE_KEY,
  resolveInitialMode,
  resolveTheme,
  type ThemeMode,
} from "./ThemeContext";

/**
 * ThemeContext — "system" mode (Round 3 Step 1, owner directive 2026-07-22).
 *
 * `resolveTheme`/`resolveInitialMode` are exported, pure, and DOM-free
 * specifically so they're unit-testable with real execution: this suite
 * runs under `environment: "node"` (vitest.config.ts) — no jsdom, no
 * `window`/`document`/`localStorage` — the same reason every other
 * ThemeProvider-adjacent behavior in this repo (and the sibling
 * comingSoonGate.test.ts source-contract tests) is verified this way.
 * The remaining stateful wiring (matchMedia change listener, persistence
 * write, <html>.dark toggle, View Transitions crossfade) is checked as a
 * source contract below, the same pattern comingSoonGate.test.ts already
 * uses for effect/handler wiring in this codebase.
 */

describe("resolveTheme — system resolution", () => {
  it("resolves system to dark when the OS prefers dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("resolves system to light when the OS prefers light", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("passes explicit light/dark through untouched, ignoring the OS reading", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("resolveInitialMode — persistence + migration precedence", () => {
  it("defaults to \"system\" when nothing is stored anywhere (round3-constraints.md defaults #3)", () => {
    expect(
      resolveInitialMode({
        modeStored: null,
        legacyStored: null,
        legacyFeedStored: null,
      })
    ).toBe("system");
  });

  it("prefers the new dime-theme key, including an explicit \"system\" value", () => {
    expect(
      resolveInitialMode({
        modeStored: "system",
        legacyStored: "dark",
        legacyFeedStored: "light",
      })
    ).toBe("system");
    expect(
      resolveInitialMode({
        modeStored: "light",
        legacyStored: "dark",
        legacyFeedStored: "dark",
      })
    ).toBe("light");
    expect(
      resolveInitialMode({
        modeStored: "dark",
        legacyStored: null,
        legacyFeedStored: null,
      })
    ).toBe("dark");
  });

  it("migrates an existing explicit theme choice instead of resetting it to system", () => {
    expect(
      resolveInitialMode({
        modeStored: null,
        legacyStored: "dark",
        legacyFeedStored: null,
      })
    ).toBe("dark");
    expect(
      resolveInitialMode({
        modeStored: null,
        legacyStored: "light",
        legacyFeedStored: "dark",
      })
    ).toBe("light");
  });

  it("falls back to the older feed-private key when neither newer key is set", () => {
    expect(
      resolveInitialMode({
        modeStored: null,
        legacyStored: null,
        legacyFeedStored: "dark",
      })
    ).toBe("dark");
  });

  it("ignores garbage/corrupted stored values at every tier and falls back to system", () => {
    expect(
      resolveInitialMode({
        modeStored: "purple",
        legacyStored: "purple",
        legacyFeedStored: "purple",
      })
    ).toBe("system");
  });
});

describe("storage keys — owner spec verbatim", () => {
  it("persists mode to localStorage['dime-theme']", () => {
    expect(MODE_STORAGE_KEY).toBe("dime-theme");
  });

  it("keeps the pre-\"system\" legacy keys for migration, unchanged", () => {
    expect(LEGACY_THEME_KEY).toBe("theme");
    expect(LEGACY_FEED_THEME_KEY).toBe("dime-feed-theme");
  });
});

describe("ThemeMode — includes system alongside the existing resolved values", () => {
  it("type-checks system/light/dark as valid modes", () => {
    const modes: ThemeMode[] = ["system", "light", "dark"];
    expect(modes).toHaveLength(3);
  });
});

const contextSource = fs.readFileSync(
  path.join(import.meta.dirname, "ThemeContext.tsx"),
  "utf8"
);

describe("ThemeProvider wiring — source contract (no jsdom in this suite)", () => {
  it("reads the OS preference live via a matchMedia change listener", () => {
    expect(contextSource).toMatch(
      /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/
    );
    expect(contextSource).toMatch(
      /mql\.addEventListener\("change", onChange\)/
    );
    expect(contextSource).toMatch(
      /mql\.removeEventListener\("change", onChange\)/
    );
  });

  it("persists the mode (not the resolved theme) under MODE_STORAGE_KEY, gated on switchable", () => {
    expect(contextSource).toMatch(
      /if \(switchable\) \{\s*try \{\s*localStorage\.setItem\(MODE_STORAGE_KEY, mode\);/
    );
  });

  it("existing consumers keep reading `theme` as light|dark — resolveTheme is the only place \"system\" can leak from", () => {
    expect(contextSource).toMatch(
      /\/\*\* RESOLVED theme[\s\S]{0,200}theme: Theme;/
    );
    expect(contextSource).toMatch(
      /const theme: Theme = resolveTheme\(mode, systemPrefersDark\);/
    );
  });

  it("exposes mode + setMode separately from the resolved theme + setTheme", () => {
    expect(contextSource).toMatch(/mode: ThemeMode;/);
    expect(contextSource).toMatch(/setMode\?: \(mode: ThemeMode\) => void;/);
    expect(contextSource).toMatch(/setTheme\?: \(theme: Theme\) => void;/);
  });

  it("setMode resolves through the same View Transitions crossfade as setTheme", () => {
    const updateModeIdx = contextSource.indexOf("const updateMode = useCallback(");
    const runTransitionIdx = contextSource.indexOf(
      "runThemeTransition(",
      updateModeIdx
    );
    expect(updateModeIdx).toBeGreaterThan(-1);
    expect(runTransitionIdx).toBeGreaterThan(updateModeIdx);
    expect(contextSource).toMatch(
      /setMode: switchable \? updateMode : undefined,/
    );
  });
});
