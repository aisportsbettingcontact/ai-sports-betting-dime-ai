import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import "./ThemeSetting.css";

/**
 * ThemeSetting — the ONE shared theme control (directive §theme-control).
 *
 * A segmented Light / Dark control, integrated into settings rather than a
 * bare sun/moon toggle. It reads and writes the app-global theme
 * (ThemeContext), so every place it appears stays in sync — there is never a
 * second, independent theme state. Two modes only (owner directive
 * 2026-07-31; the retired "System" selection migrates to Dark in
 * ThemeContext). Theme changes animate through the context's View
 * Transitions crossfade automatically.
 */

type Mode = "light" | "dark";

const OPTIONS: { mode: Mode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
];

export function ThemeSetting({ className }: { className?: string }) {
  const { theme, mode, setMode, switchable } = useTheme();

  if (!switchable) return null;

  return (
    <div
      className={`theme-setting${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mode === m;
        // the resolved theme also confirms the active surface
        const resolved = active && theme === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-setting__option${active ? " is-active" : ""}`}
            data-resolved={resolved ? "" : undefined}
            onClick={() => setMode?.(m)}
          >
            <Icon size={16} aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
