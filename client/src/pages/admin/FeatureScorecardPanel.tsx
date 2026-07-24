/**
 * FeatureScorecardPanel — per-surface feature-strength slice of the admin
 * Customer Profiling Cockpit, fed by the owner-gated analytics.overview proxy.
 * Two reads of the same FeatureScore rows: a heat grid (adoption / engagement /
 * stickiness / value-linkage per surface) and a KEEP/INVEST/FIX/CUT quadrant
 * where position — not color — carries the verdict (Dime rule). Honest states
 * (owner directive): renders a centered "Not measured" card with the exact
 * reason when the pipeline is disabled or has produced no data yet — never a
 * fabricated 0. Stickiness is P2, so it renders as "—" (heatStyle !measured),
 * never a fake zero. Owner-only (the query is ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint on the heat ramp and quadrant dots, 160ms transitions, no gradients or
 * heavy shadows; mirrors SegmentsPanel / DeviceActivityPanel treatment.
 */
import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import {
  type FeatureScore,
  SURFACE_LABEL,
  VERDICT_LABEL,
  heatStyle,
} from "@/pages/admin/profilingTypes";
import { RefreshCw } from "lucide-react";

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

/** Verdict chip color — mint border only for KEEP; position (not color) carries
 *  the full verdict in the quadrant, so the chip stays deliberately quiet. */
const VERDICT_CHIP: Record<FeatureScore["verdict"], string> = {
  keep: "text-primary border-primary/40",
  invest: "text-foreground border-border",
  fix: "text-muted-foreground border-border",
  cut: "text-muted-foreground border-border",
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

function HeatCell({ value }: { value: number | null }) {
  const h = heatStyle(value);
  return (
    <div
      className="h-12 rounded flex items-center justify-center font-mono text-xs sm:text-sm transition-all duration-150"
      style={h.style}
    >
      {h.measured ? (
        <span className={h.darkText ? "" : "text-foreground"} style={h.darkText ? { color: "#04150E" } : undefined}>{value}</span>
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

  const notOk = !!data && data.state !== "ok";
  const measured = !!data && !notOk;

  const raw: FeatureScore[] = data?.featureScorecard ?? [];
  // Stable feed → chat → splits → tracker order, tolerant of server ordering.
  const scorecard: FeatureScore[] = SURFACE_ORDER.map((s) => raw.find((r) => r.surface === s)).filter(
    (r): r is FeatureScore => !!r,
  );

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
        {/* Header — title + loading spinner. */}
        <div className="flex items-center gap-2 mb-1 min-w-0">
          <span className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-foreground uppercase truncate">
            Feature Scorecard
          </span>
          {isLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin shrink-0" />}
        </div>

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
        ) : (
          <>
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-3 leading-snug">
              Per-surface strength on the measured axes, and the reach × retained-value quadrant.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1) Heat grid — one row per surface, four measured axes. */}
              <div className="overflow-x-auto">
                <div className="grid gap-1" style={{ gridTemplateColumns: "120px repeat(4,1fr)", minWidth: 380 }}>
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
                      <div className="h-12 flex flex-col justify-center gap-0.5 min-w-0 pr-1">
                        <span className="text-xs sm:text-sm font-mono text-foreground truncate">
                          {SURFACE_LABEL[row.surface] ?? row.surface}
                        </span>
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${VERDICT_CHIP[row.verdict]}`}
                          >
                            {VERDICT_LABEL[row.verdict]}
                          </span>
                          <span
                            className="text-[9px] font-mono text-muted-foreground shrink-0"
                            title="Composite over the measured axes"
                          >
                            {row.composite}
                          </span>
                        </div>
                      </div>
                      <HeatCell value={row.adoption} />
                      <HeatCell value={row.engagement} />
                      <HeatCell value={row.stickiness} />
                      <HeatCell value={row.valueLinkage} />
                    </Fragment>
                  ))}
                </div>
              </div>

              {/* 2) Quadrant — position (not color) carries the verdict. */}
              <div className="min-w-0">
                <div className="flex gap-1.5">
                  {/* y-axis caption. */}
                  <div className="flex items-center shrink-0">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                      retained value →
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="relative h-64 border border-border rounded bg-card">
                      {/* Center hairlines. */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                      <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />

                      {/* Corner labels — muted mono, verdict by position. */}
                      <span className="absolute top-1.5 left-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Invest
                      </span>
                      <span className="absolute top-1.5 right-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Keep
                      </span>
                      <span className="absolute bottom-1.5 left-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Cut
                      </span>
                      <span className="absolute bottom-1.5 right-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Fix
                      </span>

                      {/* Plot field — inset so edge dots don't clip; symmetric inset
                          keeps the field center aligned to the hairlines. */}
                      <div className="absolute inset-6">
                        {scorecard.map((row) => (
                          <div
                            key={row.surface}
                            className="absolute flex items-center gap-1 -translate-x-1/2 -translate-y-1/2 transition-all duration-150"
                            style={{ left: `${row.adoption}%`, top: `${100 - row.valueLinkage}%` }}
                            title={`${SURFACE_LABEL[row.surface] ?? row.surface}: reach ${row.adoption}%, retained value ${row.valueLinkage}%`}
                          >
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            <span className="text-[9px] font-mono text-foreground whitespace-nowrap">
                              {SURFACE_LABEL[row.surface] ?? row.surface}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* x-axis caption. */}
                    <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground text-center mt-1">
                      reach →
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Methodology footnote — honest about what is and isn't measured. */}
        {measured && (
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-3 leading-snug">
            Stickiness lands in P2; composite is over the measured axes.
          </div>
        )}
      </div>
    </div>
  );
}
