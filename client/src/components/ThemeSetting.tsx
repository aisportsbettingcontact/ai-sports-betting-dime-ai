import { useCallback, useEffect, useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import "./ThemeSetting.css";

/**
 * ThemeSetting — the ONE shared theme control (directive §theme-control).
 *
 * A segmented System / Light / Dark control, integrated into settings rather
 * than a bare sun/moon toggle. It reads and writes the app-global theme
 * (ThemeContext), so every place it appears stays in sync — there is never a
 * second, independent theme state. "System" follows the OS preference live
 * while selected. Theme changes animate through the context's View Transitions
 * crossfade automatically.
 */

type Mode = "system" | "light" | "dark";
const MODE_KEY = "theme-mode";

const OPTIONS: { mode: Mode; label: string; Icon: typeof Monitor }[] = [
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
];

function osTheme(): "light" | "dark" {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "system" || m === "light" || m === "dark") return m;
  } catch {
    /* private mode */
  }
  return "system";
}

export function ThemeSetting({ className }: { className?: string }) {
  const { theme, setTheme, switchable } = useTheme();
  const [mode, setMode] = useState<Mode>(readMode);

  const apply = useCallback(
    (next: Mode) => {
      setMode(next);
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        /* private mode */
      }
      setTheme?.(next === "system" ? osTheme() : next);
    },
    [setTheme],
  );

  // While "System" is selected, follow OS changes live.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme?.(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode, setTheme]);

  if (!switchable) return null;

  return (
    <div
      className={`theme-setting${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mode === m;
        // for light/dark the resolved theme also confirms the active surface
        const resolved = active && (m === "system" ? true : theme === m);
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-setting__option${active ? " is-active" : ""}`}
            data-resolved={resolved ? "" : undefined}
            onClick={() => apply(m)}
          >
            <Icon size={16} aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
