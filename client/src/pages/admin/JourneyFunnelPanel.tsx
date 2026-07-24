/**
 * JourneyFunnelPanel — lifecycle-funnel slice of the admin Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. Renders the five
 * lifecycle stages (Discover → Activate → Habituate → Value → Retain, already
 * ordered server-side) as a recharts FunnelChart: mint cools from the strongest
 * (Discover) to the faintest (Retain), so the single-hue narrowing reads as the
 * funnel itself. Below the chart a mono step drop-off table lists each stage
 * transition ("Activate ← Discover: −N users (−X%)", drop measured against the
 * previous stage) alongside every stage's cumulative % of stage 1.
 *
 * Honest states (owner directive): renders a centered "Not measured" card with
 * the exact server reason when the pipeline is disabled or has produced no data
 * yet — never a fabricated 0. A real, measured 0 renders as 0; an unmeasured
 * value never does. firstStage = 0 collapses every percentage to 0 rather than
 * dividing by zero. Owner-only (the query is ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint. The funnel is a single-hue mintRamp (never a categorical rainbow); the
 * chart owns its horizontal scroll region so the page body never scrolls
 * sideways. Motion is gated on prefers-reduced-motion.
 */
import {
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
} from "recharts";
import { trpc } from "@/lib/trpc";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import SectionHeader from "@/pages/admin/SectionHeader";
import {
  type FunnelStage,
  METRIC_STATE_LABEL,
} from "@/pages/admin/profilingTypes";
import {
  CARD_BG,
  mintRamp,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

export default function JourneyFunnelPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const measured = !!data && !notOk;

  const funnel: FunnelStage[] = data?.funnel ?? [];
  const firstStageUsers = funnel[0]?.users ?? 0;

  /** Cumulative share of stage 1 (Discover = 100). 0 when the base is 0. */
  const shareOfFirst = (users: number): number =>
    firstStageUsers > 0 ? (users / firstStageUsers) * 100 : 0;

  // Mint cools down the funnel — Discover strongest, Retain faintest (intuitive
  // narrowing). Single hue only; intensity encodes rank, never a second color.
  const ramp = mintRamp(funnel.length);

  // Config keyed by stage label so the tooltip (nameKey="label") resolves each
  // slice's name/colour; ChartContainer requires a config even when Cells paint.
  const chartConfig: ChartConfig = Object.fromEntries(
    funnel.map((stage, i): [string, ChartConfig[string]] => [
      stage.label,
      { label: stage.label, color: ramp[i] },
    ]),
  );

  const meta =
    measured && funnel.length > 0
      ? `${firstStageUsers.toLocaleString()} discovered`
      : undefined;

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
        <SectionHeader
          title="Journey · lifecycle funnel"
          meta={meta}
          loading={isLoading}
        />

        {notOk ? (
          /* Honest state — never a fabricated 0. Exact server reason. */
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              {METRIC_STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
              {data!.reason ??
                "The lifecycle funnel pipeline has produced no data yet."}
            </div>
          </div>
        ) : funnel.length > 0 ? (
          <>
            {/* READ 1 — the funnel. Own horizontal scroller + min width so labels
                (stage names right, counts left) never clip nor push the page. */}
            <div className="mt-2.5 overflow-x-auto">
              <div className="min-w-[320px]">
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <FunnelChart margin={{ top: 8, right: 76, bottom: 8, left: 56 }}>
                    <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
                    <Funnel
                      dataKey="users"
                      data={funnel}
                      nameKey="label"
                      isAnimationActive={!reduced}
                      animationDuration={reduced ? 0 : 320}
                      lastShapeType="rectangle"
                    >
                      {funnel.map((stage, i) => (
                        <Cell
                          key={stage.key}
                          fill={ramp[i]}
                          stroke={CARD_BG}
                          strokeWidth={1}
                        />
                      ))}
                      <LabelList
                        position="right"
                        dataKey="label"
                        className="fill-foreground"
                        fontSize={11}
                      />
                      <LabelList
                        position="left"
                        dataKey="users"
                        className="fill-muted-foreground"
                        fontSize={11}
                      />
                    </Funnel>
                  </FunnelChart>
                </ChartContainer>
              </div>
            </div>

            {/* READ 2 — step drop-off. One row per stage transition (drop measured
                against the previous stage) + each stage's cumulative % of stage 1. */}
            <div className="mt-3 border-t border-border pt-2.5 overflow-x-auto">
              <div className="min-w-[280px] space-y-1">
                <div className="flex items-baseline gap-2 font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex-1 truncate">Transition</span>
                  <span className="w-28 sm:w-36 text-right shrink-0">Step drop-off</span>
                  <span className="w-14 text-right shrink-0">% of base</span>
                </div>

                {/* Base line — stage 1 is the 100% reference. */}
                <div className="flex items-baseline gap-2 font-mono text-[10px] sm:text-xs text-muted-foreground">
                  <span className="flex-1 truncate">
                    <span className="text-foreground">{funnel[0].label}</span> · base
                  </span>
                  <span className="w-28 sm:w-36 text-right shrink-0 tabular-nums">
                    {firstStageUsers.toLocaleString()} users
                  </span>
                  <span className="w-14 text-right shrink-0 tabular-nums text-foreground">
                    {firstStageUsers > 0 ? "100%" : "0%"}
                  </span>
                </div>

                {funnel.slice(1).map((stage, idx) => {
                  const prev = funnel[idx]; // slice(1) offset: idx → previous stage
                  const dropUsers = prev.users - stage.users;
                  const dropPct = prev.users > 0 ? (dropUsers / prev.users) * 100 : 0;
                  const cumPct = shareOfFirst(stage.users);
                  return (
                    <div
                      key={stage.key}
                      className="flex items-baseline gap-2 font-mono text-[10px] sm:text-xs text-muted-foreground"
                    >
                      <span className="flex-1 truncate">
                        <span className="text-foreground">{stage.label}</span> ← {prev.label}
                      </span>
                      <span className="w-28 sm:w-36 text-right shrink-0 tabular-nums">
                        −{dropUsers.toLocaleString()} users (−{Math.round(dropPct)}%)
                      </span>
                      <span className="w-14 text-right shrink-0 tabular-nums text-foreground">
                        {Math.round(cumPct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stage definitions — how each lifecycle band is qualified. */}
            <div className="mt-3 text-[10px] sm:text-xs text-muted-foreground leading-snug">
              Discover = any session · Activate = ≥1 value event · Habituate = active ≥3
              days · Value = ≥4 value events across ≥2 surfaces · Retain = active ≥12 days.
            </div>
          </>
        ) : measured ? (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              No journey data yet.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
