import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Selected theme mode — "system" added (owner directive 2026-07-22: account
 * popover v2, Round 3 Step 1). Existing consumers only ever cared about the
 * dark-contrast/light value (`theme` below); `mode` is the new, separate field
 * that also carries "system" so a segmented System|Light|Dark control can
 * render its own selection state without breaking anything reading `theme`
 * as light|dark. System is the product's fixed grey appearance, so it uses
 * dark-contrast ink regardless of the OS color-scheme preference.
 */
export type ThemeMode = "system" | Theme;

/** localStorage key for the persisted mode selection (owner spec, verbatim:
 *  "persists to localStorage['dime-theme']"). */
export const MODE_STORAGE_KEY = "dime-theme";
/** Pre-"system" key: used to still hold a resolved light|dark value directly.
 *  Read once as a migration fallback so an existing explicit choice survives
 *  the upgrade instead of silently resetting to "system". */
export const LEGACY_THEME_KEY = "theme";
/** Older still: the feed's pre-unification private key (see the original
 *  migration this amends, just below). */
export const LEGACY_FEED_THEME_KEY = "dime-feed-theme";

/**
 * Resolves the mode's contrast treatment. System has its own neutral-grey
 * palette and therefore always takes dark-contrast ink; it does not borrow
 * Light's black-on-white rules when the OS preference is light.
 * Pure and DOM-free on purpose — this vitest suite runs under
 * `environment: "node"` (vitest.config.ts), so this is what makes "system
 * resolution" directly unit-testable without a jsdom dependency.
 */
export function resolveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? "dark" : mode;
}

/**
 * Decides the initial mode from whatever localStorage.getItem returned for
 * each key, newest-first, falling back to "system" (round3-constraints.md
 * defaults #3). Pure — takes the three raw reads as plain values instead of
 * touching localStorage itself, so it is unit-testable without a DOM too.
 */
export function resolveInitialMode(reads: {
  modeStored: string | null;
  legacyStored: string | null;
  legacyFeedStored: string | null;
}): ThemeMode {
  const { modeStored, legacyStored, legacyFeedStored } = reads;
  if (modeStored === "system" || modeStored === "light" || modeStored === "dark") {
    return modeStored;
  }
  // Migration (owner directive 2026-07-22): pre-"system" installs stored a
  // resolved light|dark value directly under the old keys. Carry that
  // explicit choice forward as the equivalent mode rather than resetting
  // everyone to "system" on upgrade.
  if (legacyStored === "light" || legacyStored === "dark") return legacyStored;
  if (legacyFeedStored === "light" || legacyFeedStored === "dark") return legacyFeedStored;
  return "system";
}

interface ThemeContextType {
  /** Contrast theme — still light|dark for every existing consumer
   *  (index.css `.dark` class, page-level theme branches). System resolves to
   *  dark contrast while `mode` selects its separate grey surfaces. */
  theme: Theme;
  /** The user's selection, INCLUDING "system" — drives the Theme row and the
   *  independent grey System palette. */
  mode: ThemeMode;
  setTheme?: (theme: Theme) => void;
  /** Sets mode directly (including "system"); resolves + persists + animates
   *  through the same View Transitions crossfade as setTheme. */
  setMode?: (mode: ThemeMode) => void;
  toggleTheme?: () => void;
  switchable: boolean;
}

/**
 * Apply a DOM mutation as an animated theme change: a restrained crossfade of the
 * root visual layers via the View Transitions API, with an immediate fallback
 * when the API is unavailable or the user prefers reduced motion. Only the root
 * transitions (see the ::view-transition rules in index.css), so switching theme
 * never repaints every element independently.
 */
function runThemeTransition(apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition === "function" && !prefersReduced) {
    doc.startViewTransition(apply);
  } else {
    apply();
  }
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (!switchable) return defaultTheme;
    try {
      return resolveInitialMode({
        modeStored: localStorage.getItem(MODE_STORAGE_KEY),
        legacyStored: localStorage.getItem(LEGACY_THEME_KEY),
        legacyFeedStored: localStorage.getItem(LEGACY_FEED_THEME_KEY),
      });
    } catch {
      // private mode: no localStorage access at all — same "nothing stored"
      // outcome as resolveInitialMode would give three nulls.
      return "system";
    }
  });

  const theme: Theme = resolveTheme(mode);

  // Keep the <html> class and persistence in sync with state (initial mount,
  // ?theme= query and external changes). User-
  // initiated updates below apply the class synchronously inside a view
  // transition so the swap can animate.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.themeMode = mode;

    if (switchable) {
      try {
        localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch {
        /* private mode */
      }
    }
  }, [theme, mode, switchable]);

  // A user-initiated mode change: animate the root crossfade, toggling the
  // class synchronously inside the transition so old/new snapshots are
  // correct. System always resolves to the dark-contrast grey appearance.
  const updateMode = useCallback(
    (next: ThemeMode) => {
      const nextResolved: Theme = resolveTheme(next);
      runThemeTransition(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", nextResolved === "dark");
        root.dataset.themeMode = next;
        setModeState(next);
      });
    },
    [],
  );

  // Back-compat surface: existing callers only ever pass light|dark, which
  // is a valid ThemeMode, so this is just a narrower view of updateMode.
  const updateTheme = useCallback(
    (next: Theme) => updateMode(next),
    [updateMode],
  );

  const toggleTheme = switchable
    ? () => updateTheme(theme === "light" ? "dark" : "light")
    : undefined;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        mode,
        setTheme: switchable ? updateTheme : undefined,
        setMode: switchable ? updateMode : undefined,
        toggleTheme,
        switchable,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
