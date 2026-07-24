/**
 * ActivityTrendPanel — the hero "growth trend" panel of the owner-only Customer
 * Profiling Cockpit, fed by the owner-gated analytics.overview proxy. Plots the
 * last 30 days of distinct daily active users (the mint signal series) against
 * qualifying value events (a grey context series) as a recharts AreaChart.
 *
 * Honest states (owner directive): renders "Not measured" with the exact reason
 * when the pipeline is off, and a quiet "No activity yet." when measured but the
 * window is empty — never a fabricated chart. A zero-day is a real measured zero
 * (the pipeline was on), so it is drawn, never invented or dropped.
 *
 * Design: Dime brand law — semantic tokens only, mint is the ONLY accent (active
 * users), value events are neutral grey (never a second color), grids/axes are
 * hairline, mono uppercase micro-labels only, 320ms motion gated on reduced
 * motion (chartAnim). The AreaChart fills the full card width via its responsive
 * container; the page body never scrolls sideways.
 */
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import SectionHeader from "@/pages/admin/SectionHeader";
import type { DailyPoint } from "@/pages/admin/profilingTypes";
import {
  AXIS_TICK,
  GRID_COLOR,
  MUTED_SERIES,
  SIGNAL_SERIES,
  chartAnim,
  fmtCompact,
  fmtDayTick,
  mintAlpha,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

const CHART_CONFIG = {
  activeUsers: { label: "Active users", color: SIGNAL_SERIES },
  valueEvents: { label: "Value events", color: MUTED_SERIES },
} satisfies ChartConfig;

export default function ActivityTrendPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const daily: DailyPoint[] = data?.dailyActivity ?? [];

  const peakActiveUsers = useMemo(
    () => daily.reduce((max, d) => Math.max(max, d.activeUsers), 0),
    [daily],
  );

  const meta =
    daily.length > 0 ? `${fmtCompact(peakActiveUsers)} peak DAU` : undefined;

  return (
    <div className="mb-6 space-y-3">
      <SectionHeader title="Activity · last 30 days" meta={meta} loading={isLoading} />

      {notOk ? (
        <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5 text-center">
          <div className="text-sm font-semibold text-muted-foreground">Not measured</div>
          <div className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
            {data!.reason ?? "The activity pipeline has produced no measured days yet."}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5">
          {daily.length === 0 ? (
            !isLoading && (
              <div className="text-xs sm:text-sm text-muted-foreground py-6 text-center">
                No activity yet.
              </div>
            )
          ) : (
            <>
              <ChartContainer config={CHART_CONFIG} className="h-[300px] sm:h-[340px] w-full">
                <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={fmtDayTick}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    stroke={GRID_COLOR}
                  />
                  <YAxis
                    width={28}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    stroke={GRID_COLOR}
                  />
                  <Area
                    dataKey="activeUsers"
                    type="monotone"
                    stroke={SIGNAL_SERIES}
                    strokeWidth={2}
                    fill={mintAlpha(0.14)}
                    {...chartAnim(reduced)}
                  />
                  <Area
                    dataKey="valueEvents"
                    type="monotone"
                    stroke={MUTED_SERIES}
                    strokeWidth={1.5}
                    fill="transparent"
                    dot={false}
                    {...chartAnim(reduced)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent labelFormatter={(l) => fmtDayTick(String(l))} />
                    }
                    cursor={{ stroke: GRID_COLOR }}
                  />
                  <ChartLegend content={<ChartLegendContent className="text-sm" />} />
                </AreaChart>
              </ChartContainer>

              <p className="mt-3 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Active users (mint) = distinct users with a value event that day; value events
                (grey) = qualifying events. Zero-days are measured zeros — the pipeline was on.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
