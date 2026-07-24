/**
 * StatTile — the signature KPI tile of the Customer Profiling Cockpit. One
 * apple-design "stat block": an IBM Plex Mono micro-label over a bold Familjen
 * Grotesk value, with an optional inline mint sparkline and a delta chip.
 *
 * Honesty (owner directive): a MetricPoint that isn't `ok` renders its data-state
 * label ("Not measured", with the exact reason on hover) — never a fabricated 0.
 * A real measured 0 renders as 0. The sparkline is a static inline SVG (no
 * recharts, no animation) so it's cheap and reduced-motion-safe.
 *
 * Design: Dime brand law — semantic tokens, mint only as signal (highlight tiles
 * + sparkline + positive delta), tabular numerals, no gradients/shadows.
 */
import type { ReactNode } from "react";
import { MINT, mintAlpha } from "@/pages/admin/chartTheme";
import { type PointLike, METRIC_STATE_LABEL } from "@/pages/admin/profilingTypes";

/** Tiny static sparkline — mint line over a faint mint area. Non-scaling stroke. */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 100;
  const h = 28;
  const pad = 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)},${h - pad} L${first[0].toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-6 w-full" aria-hidden="true">
      <path d={area} fill={mintAlpha(0.12)} />
      <path d={line} fill="none" stroke={MINT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface StatTileProps {
  label: string;
  sublabel?: string;
  point?: PointLike;
  loading?: boolean;
  /** Formats an `ok` numeric value. Defaults to a localized integer. */
  format?: (v: number) => string;
  /** Mint border + mint value — reserve for the lead metric of a row. */
  highlight?: boolean;
  /** Optional inline sparkline series (e.g. daily active users). */
  series?: number[];
  /** Optional delta chip. tone drives color: up=mint, down/flat=grey (never red). */
  delta?: { text: string; tone: "up" | "down" | "flat" };
  /** Escape hatch for a non-MetricPoint value (e.g. a plain count). */
  value?: ReactNode;
}

export default function StatTile({
  label,
  sublabel,
  point,
  loading,
  format = (v) => v.toLocaleString(),
  highlight,
  series,
  delta,
  value,
}: StatTileProps) {
  const renderValue = (): ReactNode => {
    if (value !== undefined) return value;
    if (loading || !point) return <span className="text-muted-foreground">—</span>;
    if (point.state === "ok" && point.value !== null) return format(point.value);
    return (
      <span className="text-muted-foreground" title={point.reason ?? undefined}>
        {METRIC_STATE_LABEL[point.state] ?? "—"}
      </span>
    );
  };

  const deltaClass =
    delta?.tone === "up" ? "text-primary" : "text-muted-foreground";

  return (
    <div
      className={`bg-card border rounded-lg px-3 sm:px-4 py-3 min-w-0 overflow-hidden transition-colors duration-150 ${
        highlight ? "border-primary" : "border-border"
      }`}
    >
      {/* micro-label — mono, uppercase, wide tracking (apple: positive tracking at small sizes) */}
      <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground leading-none">
        {label}
      </div>

      {/* value — Familjen Grotesk 700, tabular, tight tracking as it grows */}
      <div
        className={`mt-1.5 text-2xl sm:text-3xl font-bold tabular-nums truncate leading-none ${
          highlight ? "text-primary" : "text-foreground"
        }`}
        style={{ letterSpacing: "-0.02em" }}
      >
        {renderValue()}
      </div>

      <div className="mt-1.5 flex items-center gap-2 min-w-0">
        {sublabel && (
          <div className="text-[11px] text-muted-foreground leading-tight truncate min-w-0">{sublabel}</div>
        )}
        {delta && (
          <span className={`ml-auto shrink-0 text-[11px] font-mono tabular-nums ${deltaClass}`}>
            {delta.text}
          </span>
        )}
      </div>

      {series && series.length >= 2 && <Sparkline data={series} />}
    </div>
  );
}
