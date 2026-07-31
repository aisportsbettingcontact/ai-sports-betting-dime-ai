import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Selected theme mode. Two modes only — Dark and Light (owner directive
 * 2026-07-31: "get rid of system"). The "system" mode from the 2026-07-22
 * account-popover round is retired; it had already been reduced to an alias
 * of Dark (index.css D-BG-SEAM note), so stored "system" selections migrate
 * to "dark" — visually identical to what those users were seeing.
 * `ThemeMode` is kept as an exported alias so existing type imports compile.
 */
export type ThemeMode = Theme;

/** localStorage key for the persisted mode selection (owner spec, verbatim:
 *  "persists to localStorage['dime-theme']"). */
export const MODE_STORAGE_KEY = "dime-theme";
/** Pre-"system"-era key: held a resolved light|dark value directly. Read once
 *  as a migration fallback so an existing explicit choice survives upgrades
 *  instead of silently resetting. */
export const LEGACY_THEME_KEY = "theme";
/** Older still: the feed's pre-unification private key. */
export const LEGACY_FEED_THEME_KEY = "dime-feed-theme";

/**
 * Resolves a mode's contrast treatment. With the two-mode system this is the
 * identity — kept (and exported) because consumers and tests treat it as the
 * single seam where mode→theme resolution happens.
 * Pure and DOM-free on purpose — the vitest suite runs under
 * `environment: "node"` (vitest.config.ts).
 */
export function resolveTheme(mode: ThemeMode): Theme {
  return mode;
}

/**
 * Decides the initial mode from whatever localStorage.getItem returned for
 * each key, newest-first, falling back to "dark" (the app default —
 * App.tsx mounts ThemeProvider with defaultTheme="dark"). Pure — takes the
 * three raw reads as plain values instead of touching localStorage itself,
 * so it is unit-testable without a DOM.
 *
 * Migration (owner directive 2026-07-31): a stored "system" value — the
 * retired third mode — maps to "dark", which is exactly the appearance
 * System resolved to since the D-BG-SEAM amendment. Explicit light/dark
 * choices under any key are always honored.
 */
export function resolveInitialMode(reads: {
  modeStored: string | null;
  legacyStored: string | null;
  legacyFeedStored: string | null;
}): ThemeMode {
  const { modeStored, legacyStored, legacyFeedStored } = reads;
  if (modeStored === "light" || modeStored === "dark") return modeStored;
  if (modeStored === "system") return "dark";
  if (legacyStored === "light" || legacyStored === "dark") return legacyStored;
  if (legacyFeedStored === "light" || legacyFeedStored === "dark") return legacyFeedStored;
  return "dark";
}

interface ThemeContextType {
  /** Contrast theme — light|dark for every consumer
   *  (index.css `.dark` class, page-level theme branches). */
  theme: Theme;
  /** The user's selection. Identical to `theme` in the two-mode system; kept
   *  as a separate field so existing `mode` consumers (feed data attributes,
   *  settings controls) compile unchanged. */
  mode: ThemeMode;
  setTheme?: (theme: Theme) => void;
  /** Sets mode directly; resolves + persists + animates through the same
   *  View Transitions crossfade as setTheme. */
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
      return "dark";
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
  // correct.
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

  // Narrower alias kept for existing callers.
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
