import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme?: (theme: Theme) => void;
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
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      try {
        const stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") return stored;
        // Migrate the feed's pre-unification private key so an existing
        // light-mode choice survives the switch to the global theme.
        const legacy = localStorage.getItem("dime-feed-theme");
        if (legacy === "light" || legacy === "dark") return legacy;
      } catch {
        /* private mode */
      }
    }
    return defaultTheme;
  });

  // Keep the <html> class and persistence in sync with state (initial mount,
  // ?theme= query, external changes). User-initiated updates below apply the
  // class synchronously inside a view transition so the swap can animate.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");

    if (switchable) {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* private mode */
      }
    }
  }, [theme, switchable]);

  // A user-initiated theme change: animate the root crossfade, toggling the
  // class synchronously inside the transition so old/new snapshots are correct.
  const updateTheme = useCallback(
    (next: Theme) => {
      runThemeTransition(() => {
        document.documentElement.classList.toggle("dark", next === "dark");
        setTheme(next);
      });
    },
    [],
  );

  const toggleTheme = switchable
    ? () => updateTheme(theme === "light" ? "dark" : "light")
    : undefined;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme: switchable ? updateTheme : undefined,
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
