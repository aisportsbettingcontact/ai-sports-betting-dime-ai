/**
 * chartTheme.ts — the single source of truth for how every chart in the Customer
 * Profiling Cockpit is colored and animated, so the whole dashboard reads as one
 * system (Dime brand law + apple-design craft).
 *
 * ONE-ACCENT DISCIPLINE (non-negotiable): mint `--primary` is the only accent. It
 * marks the signal series; every context/reference series is a neutral grey
 * (`--muted-foreground`) and grids/axes are the hairline (`--border`). There is
 * NO categorical rainbow. Ordinal categories (segments, funnel stages) use a
 * single-hue mint-opacity ramp — intensity encodes rank, hue never changes.
 *
 * Colors are CSS-variable strings so recharts SVG inherits the live light/dark
 * theme for free. Mint FILLS stay `#45E0A8` in both themes (brand rule), so the
 * ordinal ramp is expressed as fixed rgba() on the mint triple.
 */
import { useEffect, useState } from "react";
import type { ChartConfig } from "@/components/ui/chart";

/** The one accent. Fills stay this hex in both themes (brand rule). */
export const MINT = "#45E0A8";
export const MINT_RGB = "69, 224, 168";

/** Theme-aware paints (SVG reads the live CSS var). */
export const AXIS_COLOR = "var(--muted-foreground)";
export const GRID_COLOR = "var(--border)";
export const MUTED_SERIES = "var(--muted-foreground)";
export const SIGNAL_SERIES = "var(--primary)";
export const CARD_BG = "var(--card)";

/** Mint at an explicit alpha — for soft area fills and the ordinal ramp. */
export function mintAlpha(a: number): string {
  return `rgba(${MINT_RGB}, ${a})`;
}

/**
 * Descending mint-opacity ramp for `n` ordinal categories (strongest first →
 * faintest last). Single hue — the Dime-compliant substitute for a categorical
 * palette. Floors at 0.16 so the faintest slice stays visible on `--card`.
 */
export function mintRamp(n: number): string[] {
  if (n <= 1) return [mintAlpha(0.92)];
  const top = 0.92;
  const bottom = 0.18;
  return Array.from({ length: n }, (_, i) => mintAlpha(top - (i * (top - bottom)) / (n - 1)));
}

/** Compact integer formatter — 1234 → "1.2k", 2_400_000 → "2.4M". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Shorten an ISO date (YYYY-MM-DD) to a compact axis tick, e.g. "Jul 3". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDayTick(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}`;
}

/** Recharts CartesianAxis tick styling — mono micro-label, hairline axis. */
export const AXIS_TICK = { fontSize: 10, fill: AXIS_COLOR } as const;

/**
 * Respects `prefers-reduced-motion`. Local (not the chat hook) so the lazy
 * cockpit chunk never shares a module with the chat critical path (bundle rule).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** Recharts animation props gated on reduced-motion. Short + subtle (Dime 2/10). */
export function chartAnim(reduced: boolean): { isAnimationActive: boolean; animationDuration: number } {
  return { isAnimationActive: !reduced, animationDuration: reduced ? 0 : 320 };
}

/** A one-series mint ChartConfig for the shadcn ChartContainer. */
export function mintConfig(key: string, label: string): ChartConfig {
  return { [key]: { label, color: SIGNAL_SERIES } };
}
