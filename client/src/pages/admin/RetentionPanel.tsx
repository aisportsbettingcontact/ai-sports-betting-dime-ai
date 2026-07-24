/**
 * RetentionPanel — weekly-cohort retention for the Customer Profiling Cockpit,
 * fed by the owner-gated analytics.overview proxy. Two stacked views of the same
 * truth: a size-weighted average decay curve (W0…Wn) on top, and the per-cohort
 * heatmap below. Honest states (owner directive): renders "Not measured" with the
 * exact reason when the pipeline is off, and "No cohorts yet." when measured but
 * empty — never a fabricated grid or curve. Unreachable/future weeks (null) render
 * as a flat "—" in the grid and are dropped from the curve, never treated as 0.
 *
 * Design: Dime brand law — semantic tokens only, mint is the ONLY accent (curve
 * line + single-hue heat ramp, never rainbow), grids/axes hairline, font-mono
 * tabular numerals, mono uppercase micro-labels, motion gated on reduced-motion.
 * The heatmap owns its horizontal scroll region; the page body never scrolls
 * sideways.
 */
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import SectionHeader from "@/pages/admin/SectionHeader";
import { type RetentionCohort, heatStyle } from "@/pages/admin/profilingTypes";
import {
  AXIS_TICK,
  GRID_COLOR,
  SIGNAL_SERIES,
  chartAnim,
  mintConfig,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

// Windowed to the last 8 weeks: retention index 0 = W0 … 7 = W7.
const WEEKS = [0, 1, 2, 3, 4, 5, 6, 7];
const GRID_COLS = "9rem repeat(8, minmax(0, 1fr))";

/** One-series mint config so the curve tooltip reads "Retention". */
const CURVE_CONFIG = mintConfig("retention", "Retention");

/** A single point on the size-weighted decay curve. */
interface CurvePoint {
  week: string;
  retention: number | null;
}

/** One retention cell: heat fill for measured values, flat "—" for nulls. */
function Cell({ value }: { value: number | null }) {
  const { style, darkText, measured } = heatStyle(value);
  if (!measured || value == null) {
    return (
      <div className="flex h-9 items-center justify-center rounded border border-border/60 bg-card">
        <span className="font-mono text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div
      className="flex h-9 items-center justify-center rounded border border-border/60 transition-all duration-150 hover:ring-1 hover:ring-primary/40"
      style={style}
      title={`${value.toFixed(1)}% retained`}
    >
      <span
        className={`font-mono text-xs tabular-nums ${darkText ? "" : "text-foreground"}`}
        style={darkText ? { color: "#04150E" } : undefined}
      >
        {Math.round(value)}
        <span className="opacity-50">%</span>
      </span>
    </div>
  );
}

export default function RetentionPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const cohorts: RetentionCohort[] = data?.retention ?? [];

  // Size-weighted average retention at each week index, nulls ignored. Trailing
  // weeks no cohort can reach yet (denom === 0) are dropped — only measured weeks
  // are plotted, so the curve never dips to a misleading zero at the tail.
  const curve = useMemo<CurvePoint[]>(() => {
    const points: CurvePoint[] = WEEKS.map((w) => {
      let numer = 0;
      let denom = 0;
      for (const c of cohorts) {
        const r = c.retention[w];
        if (r != null) {
          numer += r * c.size;
          denom += c.size;
        }
      }
      return { week: `W${w}`, retention: denom > 0 ? Math.round(numer / denom) : null };
    });
    while (points.length > 0 && points[points.length - 1].retention == null) {
      points.pop();
    }
    return points;
  }, [cohorts]);

  const measuredWeeks = curve.filter((p) => p.retention != null).length;

  return (
    <div className="mb-6 space-y-3">
      <SectionHeader title="Retention · weekly cohorts" loading={isLoading} />

      {notOk ? (
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-center">
          <div className="text-sm font-semibold text-muted-foreground">Not measured</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ?? "The retention pipeline has produced no cohorts yet."}
          </div>
        </div>
      ) : cohorts.length === 0 ? (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="text-[10px] sm:text-xs text-muted-foreground py-6 text-center">
            No cohorts yet.
          </div>
        </div>
      ) : (
        <>
          {/* Decay curve — average retention across all cohorts, W0…Wn. */}
          <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
            {measuredWeeks >= 2 ? (
              <>
                <ChartContainer config={CURVE_CONFIG} className="h-[180px] w-full">
                  <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} />
                    <XAxis
                      dataKey="week"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      stroke={GRID_COLOR}
                    />
                    <YAxis
                      domain={[0, 100]}
                      width={30}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ stroke: GRID_COLOR }} />
                    <Line
                      dataKey="retention"
                      type="monotone"
                      stroke={SIGNAL_SERIES}
                      strokeWidth={2}
                      dot={{ r: 3, fill: SIGNAL_SERIES }}
                      {...chartAnim(reduced)}
                    />
                  </LineChart>
                </ChartContainer>
                <p className="mt-3 text-[10px] sm:text-xs text-muted-foreground leading-snug">
                  Average weekly retention across all cohorts (size-weighted). W0 = each cohort's
                  first active week.
                </p>
              </>
            ) : (
              <div className="text-[10px] sm:text-xs text-muted-foreground py-6 text-center">
                Not enough measured weeks yet to plot a retention curve.
              </div>
            )}
          </div>

          {/* Per-cohort heatmap. */}
          <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
            {/* Own horizontal scroller — the page body must never scroll sideways. */}
            <div className="overflow-x-auto">
              <div className="space-y-1" style={{ minWidth: 640 }}>
                {/* Header row: blank gutter, then W0…W7. */}
                <div className="grid gap-1 items-end" style={{ gridTemplateColumns: GRID_COLS }}>
                  <div className="sticky left-0 z-10 bg-card" />
                  {WEEKS.map((w) => (
                    <div
                      key={w}
                      className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground pb-1"
                    >
                      W{w}
                    </div>
                  ))}
                </div>

                {/* One row per cohort, newest first. */}
                {cohorts.map((c) => {
                  const lowN = c.size < 5;
                  return (
                    <div
                      key={c.cohortWeek}
                      className="grid gap-1 items-center"
                      style={{ gridTemplateColumns: GRID_COLS }}
                    >
                      <div className="sticky left-0 z-10 bg-card pr-2 min-w-0">
                        <div className="text-[11px] sm:text-xs font-mono text-foreground truncate">
                          {c.cohortWeek}
                          {lowN && <span className="text-muted-foreground"> · low n</span>}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground leading-tight">
                          n={c.size}
                        </div>
                      </div>
                      {WEEKS.map((w) => (
                        <Cell key={w} value={c.retention[w] ?? null} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="mt-3 text-[10px] sm:text-xs text-muted-foreground leading-snug">
              W0 = each cohort's first active week; retention = % of that cohort active in later
              weeks (windowed to the last 8 weeks). Blank cells (—) are future or unreachable
              weeks, not zero.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
