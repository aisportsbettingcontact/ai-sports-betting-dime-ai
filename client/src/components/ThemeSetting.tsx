import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import "./ThemeSetting.css";

/**
 * ThemeSetting — the ONE shared theme control (directive §theme-control).
 *
 * A segmented System / Light / Dark control, integrated into settings rather
 * than a bare sun/moon toggle. It reads and writes the app-global theme
 * (ThemeContext), so every place it appears stays in sync — there is never a
 * second, independent theme state. The selected "System" mode owns the
 * product's fixed neutral-grey palette with dark-contrast ink, while explicit
 * Light and Dark remain white and black. Theme changes animate through the
 * context's View Transitions crossfade automatically.
 */

type Mode = "system" | "light" | "dark";

const OPTIONS: { mode: Mode; label: string; Icon: typeof Monitor }[] = [
  { mode: "system", label: "System", Icon: Monitor },
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
