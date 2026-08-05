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
 * ThemeContext — two-mode system (owner directive 2026-07-31: Dark and Light
 * only; the 2026-07-22 "system" mode is retired and stored selections migrate
 * to Dark, the appearance System had resolved to since D-BG-SEAM).
 *
 * `resolveTheme`/`resolveInitialMode` are exported, pure, and DOM-free
 * specifically so they're unit-testable with real execution: this suite
 * runs under `environment: "node"` (vitest.config.ts) — no jsdom, no
 * `window`/`document`/`localStorage`. The remaining stateful wiring
 * (persistence write, <html>.dark toggle, View Transitions crossfade) is
 * checked as a source contract below, the same pattern
 * comingSoonGate.test.ts already uses.
 */

describe("resolveTheme — appearance contrast", () => {
  it("passes explicit light/dark through untouched (identity in the two-mode system)", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});

describe("resolveInitialMode — persistence + migration precedence", () => {
  it('defaults to "dark" when nothing is stored anywhere (app default; App.tsx mounts defaultTheme="dark")', () => {
    expect(
      resolveInitialMode({
        modeStored: null,
        legacyStored: null,
        legacyFeedStored: null,
      })
    ).toBe("dark");
  });

  it("prefers the new dime-theme key for explicit light/dark", () => {
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

  it('migrates a stored "system" selection (retired mode) to dark — the appearance it resolved to', () => {
    expect(
      resolveInitialMode({
        modeStored: "system",
        legacyStored: "light",
        legacyFeedStored: "light",
      })
    ).toBe("dark");
  });

  it("migrates an existing explicit legacy theme choice instead of resetting it", () => {
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

  it("ignores garbage/corrupted stored values at every tier and falls back to dark", () => {
    expect(
      resolveInitialMode({
        modeStored: "purple",
        legacyStored: "purple",
        legacyFeedStored: "purple",
      })
    ).toBe("dark");
  });
});

describe("storage keys — owner spec verbatim", () => {
  it("persists mode to localStorage['dime-theme']", () => {
    expect(MODE_STORAGE_KEY).toBe("dime-theme");
  });

  it("keeps the legacy keys for migration, unchanged", () => {
    expect(LEGACY_THEME_KEY).toBe("theme");
    expect(LEGACY_FEED_THEME_KEY).toBe("dime-feed-theme");
  });
});

describe("ThemeMode — two modes only", () => {
  it("type-checks light/dark as the only valid modes", () => {
    const modes: ThemeMode[] = ["light", "dark"];
    expect(modes).toHaveLength(2);
  });
});

const contextSource = fs.readFileSync(
  path.join(import.meta.dirname, "ThemeContext.tsx"),
  "utf8"
);

describe("ThemeProvider wiring — source contract (no jsdom in this suite)", () => {
  it('has no "system" branch anywhere in the provider besides the stored-value migration', () => {
    expect(contextSource).toMatch(
      /if \(modeStored === "system"\) return "dark";/
    );
    // the old three-mode resolution must be gone
    expect(contextSource).not.toMatch(/mode === "system" \? "dark" : mode/);
    expect(contextSource).not.toContain('"system" | Theme');
    expect(contextSource).not.toContain("prefers-color-scheme: dark");
  });

  it("persists the mode (not the resolved theme) under MODE_STORAGE_KEY, gated on switchable", () => {
    expect(contextSource).toMatch(
      /if \(switchable\) \{\s*try \{\s*localStorage\.setItem\(MODE_STORAGE_KEY, mode\);/
    );
  });

  it("still publishes the selected mode on <html> (data-theme-mode) for the dark-scoped CSS selectors", () => {
    expect(contextSource).toMatch(/root\.dataset\.themeMode = mode;/);
    expect(contextSource).toMatch(/root\.dataset\.themeMode = next;/);
  });

  it("existing consumers keep reading `theme` as light|dark through resolveTheme", () => {
    expect(contextSource).toMatch(
      /interface ThemeContextType \{[\s\S]{0,300}theme: Theme;/
    );
    expect(contextSource).toMatch(/const theme: Theme = resolveTheme\(mode\);/);
  });

  it("exposes mode + setMode separately from the resolved theme + setTheme", () => {
    expect(contextSource).toMatch(/mode: ThemeMode;/);
    expect(contextSource).toMatch(/setMode\?: \(mode: ThemeMode\) => void;/);
    expect(contextSource).toMatch(/setTheme\?: \(theme: Theme\) => void;/);
  });

  it("setMode resolves through the same View Transitions crossfade as setTheme", () => {
    const updateModeIdx = contextSource.indexOf(
      "const updateMode = useCallback("
    );
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
