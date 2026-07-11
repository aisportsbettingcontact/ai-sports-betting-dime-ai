"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeName = "dark" | "light" | "mint";
export type OddsFormat = "american" | "decimal";

const STORAGE_KEY = "dimeai-prefs";

type Prefs = { theme: ThemeName; oddsFormat: OddsFormat };

const DEFAULT_PREFS: Prefs = { theme: "dark", oddsFormat: "american" };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === "light" || parsed.theme === "mint" || parsed.theme === "dark"
        ? parsed.theme
        : DEFAULT_PREFS.theme,
      oddsFormat: parsed.oddsFormat === "decimal" ? "decimal" : "american",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Inline script injected before paint so the correct theme applies with no flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY
)});var theme='dark';if(raw){var p=JSON.parse(raw);if(p&&(p.theme==='light'||p.theme==='mint'||p.theme==='dark'))theme=p.theme;}document.documentElement.setAttribute('data-theme',theme);}catch(e){}})();`;

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  oddsFormat: OddsFormat;
  setOddsFormat: (f: OddsFormat) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    // Reads localStorage on mount only (after the no-FOUC inline script has
    // already applied the correct theme to the DOM) to avoid an SSR/client
    // hydration mismatch — the one intentional extra render this causes is
    // the standard fix for syncing from browser-only storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(readPrefs());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const setTheme = useCallback((theme: ThemeName) => {
    setPrefs((p) => ({ ...p, theme }));
  }, []);

  const setOddsFormat = useCallback((oddsFormat: OddsFormat) => {
    setPrefs((p) => ({ ...p, oddsFormat }));
  }, []);

  const value = useMemo(
    () => ({ theme: prefs.theme, setTheme, oddsFormat: prefs.oddsFormat, setOddsFormat }),
    [prefs, setTheme, setOddsFormat]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
