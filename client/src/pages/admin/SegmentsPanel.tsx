/**
 * SegmentsPanel — behavioral-segment slice of the admin Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. Two coordinated
 * reads of the same 7 segments (already ordered strongest→weakest server-side):
 * a single-hue mint donut of the users who actually landed in a segment, and a
 * ranked bar list of ALL seven — zeros included — each sized against the largest
 * and annotated with its share of the total. Honest states (owner directive):
 * renders a centered "Not measured" card with the exact reason when the pipeline
 * is disabled or has produced no data yet — never a fabricated 0. A real,
 * measured 0 renders as 0 in the list; an unmeasured value never does, and a
 * fully-zero-but-measured feed shows "No segmented users yet." in the donut
 * instead of an empty ring. Owner-only (the query is ownerProcedure, gated
 * upstream).
 *
 * Design: Dime brand law — semantic tokens only, font-mono tabular numerals,
 * one-accent mint. The donut is a single-hue mintRamp (rank by intensity, never
 * a categorical rainbow); the bars are bg-primary. No gradients, no hover-lift;
 * motion honors prefers-reduced-motion (chartAnim + gated bar transitions).
 */
import { trpc } from "@/lib/trpc";
import {
  type SegmentSlice,
  SEGMENT_LABEL,
  METRIC_STATE_LABEL,
} from "@/pages/admin/profilingTypes";
import SectionHeader from "@/pages/admin/SectionHeader";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PieChart, Pie, Cell } from "recharts";
import {
  MINT,
  CARD_BG,
  mintRamp,
  chartAnim,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

export default function SegmentsPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const measured = !!data && !notOk;

  const segments: SegmentSlice[] = data?.segments ?? [];

  // Resolve each slice's display label once (SEGMENT_LABEL is authoritative).
  const labeled = segments.map((s) => ({
    key: s.key,
    label: SEGMENT_LABEL[s.key] ?? s.label,
    users: s.users,
  }));

  const totalUsers = labeled.reduce((sum, s) => sum + s.users, 0);
  const maxUsers = Math.max(...labeled.map((s) => s.users), 1);

  // Only segments with real users draw a slice; a measured-but-empty feed falls
  // through to the "No segmented users yet." placeholder rather than a bare ring.
  const nonZeroSegments = labeled.filter((s) => s.users > 0);
  const ramp = mintRamp(nonZeroSegments.length);

  const chartConfig: ChartConfig = {};
  for (const s of nonZeroSegments) {
    chartConfig[s.label] = { label: s.label, color: MINT };
  }

  const barMotion = reduced ? "" : "transition-all duration-[160ms]";

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <SectionHeader
          title="Segments · distinct users"
          meta={measured ? `${totalUsers.toLocaleString()} users` : undefined}
          loading={isLoading}
        />

        {notOk ? (
          /* Honest state — never a fabricated 0. Exact server reason. */
          <div className="px-4 py-8 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              {METRIC_STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
              {data!.reason ??
                "The segmentation pipeline has produced no data yet."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {/* 1 — DONUT: single-hue mint ramp, total overlaid at the hole. */}
            {nonZeroSegments.length > 0 ? (
              <div className="relative">
                <ChartContainer
                  config={chartConfig}
                  className="h-[240px] sm:h-[280px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={nonZeroSegments}
                      dataKey="users"
                      nameKey="label"
                      innerRadius={70}
                      outerRadius={104}
                      paddingAngle={1}
                      stroke={CARD_BG}
                      strokeWidth={2}
                      {...chartAnim(reduced)}
                    >
                      {nonZeroSegments.map((s, i) => (
                        <Cell key={s.key} fill={ramp[i]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
                  </PieChart>
                </ChartContainer>
                {/* Center overlay — tabular total (default sans) + mono micro-label. */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className="text-3xl sm:text-4xl font-bold tabular-nums text-foreground leading-none"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {totalUsers.toLocaleString()}
                  </span>
                  <span className="mt-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                    Users
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-[240px] sm:h-[280px] w-full flex items-center justify-center">
                <span className="text-sm font-mono text-muted-foreground">
                  No segmented users yet.
                </span>
              </div>
            )}

            {/* 2 — RANKED LIST: all 7 (zeros honest), share of total. */}
            <div className="flex flex-col justify-center gap-1 w-full min-w-0">
              {labeled.map((s) => {
                const share =
                  totalUsers > 0 ? Math.round((s.users / totalUsers) * 100) : 0;
                const width =
                  s.users > 0 ? Math.max((s.users / maxUsers) * 100, 4) : 0;
                return (
                  <div
                    key={s.key}
                    className="flex items-center gap-2.5 min-w-0 py-1"
                  >
                    <span
                      className="text-sm font-mono w-28 sm:w-36 shrink-0 text-foreground truncate"
                      title={s.label}
                    >
                      {s.label}
                    </span>
                    <div className="flex-1 h-3.5 rounded bg-muted/60 overflow-hidden min-w-0">
                      <div
                        className={`h-full rounded bg-primary ${barMotion}`}
                        style={{ width: `${width}%` }}
                        title={`${s.label}: ${s.users} users (${share}%)`}
                      />
                    </div>
                    <span className="text-sm font-mono w-10 text-right text-foreground shrink-0 tabular-nums">
                      {s.users}
                    </span>
                    <span className="text-sm font-mono w-12 text-right text-muted-foreground shrink-0 tabular-nums">
                      {share}%
                    </span>
                  </div>
                );
              })}
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Share is % of all segmented users, strongest first.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
