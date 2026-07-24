/**
 * FeatureScorecardPanel — per-surface feature-strength slice of the admin
 * Customer Profiling Cockpit, fed by the owner-gated analytics.overview proxy.
 * Three reads of the same FeatureScore rows: (1) a heat grid (adoption /
 * engagement / stickiness / value-linkage per surface), (2) a KEEP/INVEST/FIX/CUT
 * quadrant drawn as a recharts ScatterChart where position — not color — carries
 * the verdict (Dime rule; reach x=35, retained-value y=45), and (3) a composite
 * ranking row-list. Honest states (owner directive): renders a centered
 * "Not measured" card with the exact reason when the pipeline is disabled or has
 * produced no data yet — never a fabricated 0. Stickiness is P2, so it renders as
 * "—" (heatStyle !measured), never a fake zero. Owner-only (the query is
 * ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, mint is the ONLY accent (heat
 * ramp, scatter dots, composite bars, KEEP chip), font-mono uppercase micro-labels
 * and tabular numerals, 160ms transitions / reduced-motion-gated chart animation,
 * no gradients / red / purple. The quadrant + heat grid own their horizontal
 * scroll; the page body never scrolls sideways.
 */
import { Fragment } from "react";
import {
  CartesianGrid,
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
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
  type FeatureScore,
  SURFACE_LABEL,
  VERDICT_LABEL,
  heatStyle,
} from "@/pages/admin/profilingTypes";
import {
  AXIS_COLOR,
  AXIS_TICK,
  GRID_COLOR,
  SIGNAL_SERIES,
  chartAnim,
  usePrefersReducedMotion,
} from "@/pages/admin/chartTheme";

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

/** The four measured axes, in grid-column order. stickiness is P2 (always null). */
const METRICS: Array<{ key: "adoption" | "engagement" | "stickiness" | "valueLinkage"; head: string }> = [
  { key: "adoption", head: "Adopt" },
  { key: "engagement", head: "Engage" },
  { key: "stickiness", head: "Sticky" },
  { key: "valueLinkage", head: "Value-link" },
];

/** Fixed surface order feed → chat → splits → tracker (server already orders it). */
const SURFACE_ORDER = ["feed", "chat", "splits", "tracker"] as const;

/** Quadrant thresholds — reach (x) and retained value (y), 0–100. */
const REACH_THRESHOLD = 35;
const VALUE_THRESHOLD = 45;

/** Config so the shadcn ChartTooltip resolves readable axis labels. */
const QUADRANT_CONFIG = {
  adoption: { label: "reach", color: SIGNAL_SERIES },
  valueLinkage: { label: "retained value", color: SIGNAL_SERIES },
} satisfies ChartConfig;

/** Verdict chip — mint border only for KEEP; every other verdict stays quiet
 *  (position in the quadrant, not color, carries the full verdict). */
function verdictChipClass(verdict: FeatureScore["verdict"]): string {
  return verdict === "keep" ? "border-primary/40 text-primary" : "border-border text-muted-foreground";
}

function HeatCell({ value }: { value: number | null }) {
  const h = heatStyle(value);
  return (
    <div
      className="h-12 rounded flex items-center justify-center font-mono text-xs sm:text-sm transition-all duration-150"
      style={h.style}
    >
      {h.measured ? (
        <span className={h.darkText ? "" : "text-foreground"} style={h.darkText ? { color: "#04150E" } : undefined}>
          {value}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

export default function FeatureScorecardPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";

  const raw: FeatureScore[] = data?.featureScorecard ?? [];
  // Stable feed → chat → splits → tracker order, tolerant of server ordering.
  const scorecard: FeatureScore[] = SURFACE_ORDER.map((s) => raw.find((r) => r.surface === s)).filter(
    (r): r is FeatureScore => !!r,
  );

  // Composite ranking is strongest-first; the heat grid keeps surface order.
  const ranked: FeatureScore[] = [...scorecard].sort((a, b) => b.composite - a.composite);

  // Quadrant points carry the display label so LabelList + tooltip read cleanly.
  const points = scorecard.map((r) => ({ ...r, surface: SURFACE_LABEL[r.surface] ?? r.surface }));

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
        <SectionHeader title="Feature Scorecard" loading={isLoading} />

        {notOk ? (
          /* Honest state — never a fabricated 0. Exact server reason. */
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              {STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
              {data!.reason ?? "The feature-scorecard pipeline has produced no data yet."}
            </div>
          </div>
        ) : scorecard.length === 0 ? (
          !isLoading && (
            <div className="text-[10px] sm:text-xs text-muted-foreground py-6 text-center">
              No scored surfaces yet.
            </div>
          )
        ) : (
          <>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-2 mb-3 leading-snug">
              Per-surface strength on the measured axes, and the reach × retained-value quadrant.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1) Heat grid — one row per surface, four measured axes. Owns its
                     own horizontal scroller so the page body never scrolls sideways. */}
              <div className="overflow-x-auto">
                <div className="grid gap-1" style={{ gridTemplateColumns: "88px repeat(4,1fr)", minWidth: 380 }}>
                  {/* Header row. */}
                  <div />
                  {METRICS.map((m) => (
                    <div
                      key={m.key}
                      className="flex items-center justify-center text-[9px] font-mono uppercase tracking-wider text-muted-foreground pb-0.5"
                    >
                      {m.head}
                    </div>
                  ))}

                  {/* One row per surface. */}
                  {scorecard.map((row) => (
                    <Fragment key={row.surface}>
                      <div className="h-12 flex items-center min-w-0 pr-2">
                        <span className="text-xs sm:text-sm font-mono text-foreground truncate">
                          {SURFACE_LABEL[row.surface] ?? row.surface}
                        </span>
                      </div>
                      <HeatCell value={row.adoption} />
                      <HeatCell value={row.engagement} />
                      <HeatCell value={row.stickiness} />
                      <HeatCell value={row.valueLinkage} />
                    </Fragment>
                  ))}
                </div>
              </div>

              {/* 2) Quadrant — recharts ScatterChart; corner labels (position, not
                     color) carry the verdict per Dime rule. */}
              <div className="relative min-w-0">
                <ChartContainer config={QUADRANT_CONFIG} className="h-[260px] w-full">
                  <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
                    <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.4} />
                    <XAxis
                      type="number"
                      dataKey="adoption"
                      domain={[0, 100]}
                      name="reach"
                      tick={AXIS_TICK}
                      tickLine={false}
                      stroke={GRID_COLOR}
                      label={{ value: "reach →", position: "insideBottom", offset: -12, fontSize: 9, fill: AXIS_COLOR }}
                    />
                    <YAxis
                      type="number"
                      dataKey="valueLinkage"
                      domain={[0, 100]}
                      name="retained value"
                      tick={AXIS_TICK}
                      tickLine={false}
                      stroke={GRID_COLOR}
                      width={28}
                    />
                    <ReferenceLine x={REACH_THRESHOLD} stroke={GRID_COLOR} strokeDasharray="3 3" />
                    <ReferenceLine y={VALUE_THRESHOLD} stroke={GRID_COLOR} strokeDasharray="3 3" />
                    <ChartTooltip cursor={{ stroke: GRID_COLOR }} content={<ChartTooltipContent nameKey="surface" />} />
                    <Scatter data={points} fill={SIGNAL_SERIES} {...chartAnim(reduced)}>
                      <LabelList dataKey="surface" position="top" fontSize={10} className="fill-foreground" />
                    </Scatter>
                  </ScatterChart>
                </ChartContainer>

                {/* Corner labels — muted mono, verdict by position (Invest top-left /
                    Keep top-right / Cut bottom-left / Fix bottom-right). */}
                <span
                  className="absolute text-[9px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none"
                  style={{ top: 14, left: 40 }}
                >
                  Invest
                </span>
                <span
                  className="absolute text-[9px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none"
                  style={{ top: 14, right: 18 }}
                >
                  Keep
                </span>
                <span
                  className="absolute text-[9px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none"
                  style={{ bottom: 30, left: 40 }}
                >
                  Cut
                </span>
                <span
                  className="absolute text-[9px] font-mono uppercase tracking-wider text-muted-foreground pointer-events-none"
                  style={{ bottom: 30, right: 18 }}
                >
                  Fix
                </span>
              </div>
            </div>

            {/* 3) Composite ranking — strongest first; mint bar, tabular value,
                   quiet verdict chip (mint border only for KEEP). */}
            <div className="mt-4">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Composite ranking
              </div>
              <div className="space-y-1.5">
                {ranked.map((row) => {
                  const width = Math.max(0, Math.min(100, row.composite));
                  return (
                    <div key={row.surface} className="flex items-center gap-2 sm:gap-3">
                      <span className="w-16 shrink-0 text-xs font-mono text-foreground truncate">
                        {SURFACE_LABEL[row.surface] ?? row.surface}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden min-w-0">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-150"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-mono tabular-nums text-foreground">
                        {row.composite}
                      </span>
                      <span
                        className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${verdictChipClass(row.verdict)}`}
                      >
                        {VERDICT_LABEL[row.verdict]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Methodology footnote — honest about what is and isn't measured. */}
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-3 leading-snug">
              Stickiness lands in P2; composite is over the measured axes.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
