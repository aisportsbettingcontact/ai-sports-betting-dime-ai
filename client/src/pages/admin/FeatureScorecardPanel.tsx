/**
 * FeatureScorecardPanel — per-surface feature strength for the Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. Three reads of the
 * same FeatureScore rows: (1) a heat grid (adoption / engagement / stickiness /
 * value-linkage per surface), (2) a KEEP/INVEST/FIX/CUT quadrant BOARD where
 * position carries the verdict (Dime rule; reach x=35, retained-value y=45), and
 * (3) a composite ranking.
 *
 * The quadrant is a custom board, not a recharts scatter: with few surfaces that
 * share coordinates (e.g. three at the origin) a scatter stacks their labels into
 * an unreadable blob. Here, coincident surfaces are fanned apart so every label
 * stays legible, and the board is large and square.
 *
 * Honest states (owner directive): a centered "Not measured" card with the exact
 * reason when off; stickiness is P2 so it renders "—" (never a fake 0). Owner-only.
 *
 * Design: Dime brand law — semantic tokens, mint the ONLY accent (heat ramp,
 * dots, composite bars, KEEP chip), Familjen Grotesk for focal numbers, mono
 * micro-labels, no gradients / red / purple. Verdict is carried by POSITION.
 */
import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import SectionHeader from "@/pages/admin/SectionHeader";
import {
  type FeatureScore,
  SURFACE_LABEL,
  VERDICT_LABEL,
  METRIC_STATE_LABEL,
  heatStyle,
} from "@/pages/admin/profilingTypes";
import { MINT } from "@/pages/admin/chartTheme";

/** The four measured axes, in grid-column order. stickiness is P2 (always null). */
const METRICS: Array<{ key: "adoption" | "engagement" | "stickiness" | "valueLinkage"; head: string }> = [
  { key: "adoption", head: "Adopt" },
  { key: "engagement", head: "Engage" },
  { key: "stickiness", head: "Sticky" },
  { key: "valueLinkage", head: "Value-link" },
];

const SURFACE_ORDER = ["feed", "chat", "splits", "tracker"] as const;
const REACH_THRESHOLD = 35;
const VALUE_THRESHOLD = 45;

function verdictChipClass(verdict: FeatureScore["verdict"]): string {
  return verdict === "keep" ? "border-primary/50 text-primary" : "border-border text-muted-foreground";
}

function HeatCell({ value }: { value: number | null }) {
  const h = heatStyle(value);
  return (
    <div
      className="h-14 rounded-md flex items-center justify-center text-base sm:text-lg font-bold tabular-nums transition-all duration-150"
      style={h.style}
    >
      {h.measured ? (
        <span className={h.darkText ? "" : "text-foreground"} style={h.darkText ? { color: "#04150E" } : undefined}>
          {value}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground font-normal">—</span>
      )}
    </div>
  );
}

/** One plotted surface with a fan offset (px) to de-collide coincident points. */
interface PlacedPoint extends FeatureScore {
  label: string;
  dx: number;
  dy: number;
}

/** Fan coincident surfaces apart so their dots + labels never overlap. */
function placePoints(scorecard: FeatureScore[]): PlacedPoint[] {
  const keyOf = (p: FeatureScore) => `${Math.round(p.adoption / 3)}:${Math.round(p.valueLinkage / 3)}`;
  const counts = new Map<string, number>();
  for (const p of scorecard) counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return scorecard.map((p) => {
    const k = keyOf(p);
    const n = counts.get(k) ?? 1;
    const idx = (seen.get(k) ?? 0);
    seen.set(k, idx + 1);
    let dx = 0;
    let dy = 0;
    if (n > 1) {
      const ang = (idx / n) * Math.PI * 2 - Math.PI / 2;
      const r = 18;
      dx = Math.cos(ang) * r;
      dy = Math.sin(ang) * r;
    }
    return { ...p, label: SURFACE_LABEL[p.surface] ?? p.surface, dx, dy };
  });
}

export default function FeatureScorecardPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const raw: FeatureScore[] = data?.featureScorecard ?? [];
  const scorecard: FeatureScore[] = SURFACE_ORDER.map((s) => raw.find((r) => r.surface === s)).filter(
    (r): r is FeatureScore => !!r,
  );
  const ranked: FeatureScore[] = [...scorecard].sort((a, b) => b.composite - a.composite);
  const placed = placePoints(scorecard);

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <SectionHeader title="Feature Scorecard" loading={isLoading} />

        {notOk ? (
          <div className="px-4 py-6 text-center">
            <div className="text-base font-semibold text-muted-foreground">
              {METRIC_STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
              {data!.reason ?? "The feature-scorecard pipeline has produced no data yet."}
            </div>
          </div>
        ) : scorecard.length === 0 ? (
          !isLoading && (
            <div className="text-xs sm:text-sm text-muted-foreground py-4 text-center">No scored surfaces yet.</div>
          )
        ) : (
          <>
            <div className="text-xs sm:text-sm text-muted-foreground mt-2 mb-4 leading-relaxed">
              Per-surface strength on the measured axes (0–100), and the reach × retained-value quadrant
              that says whether to keep, invest in, fix, or cut each surface.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 1) Heat grid — one row per surface, four measured axes. */}
              <div className="min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  Strength by axis
                </div>
                <div className="overflow-x-auto">
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: "96px repeat(4,1fr)", minWidth: 420 }}>
                    <div />
                    {METRICS.map((m) => (
                      <div
                        key={m.key}
                        className="flex items-center justify-center text-[11px] font-mono uppercase tracking-wider text-muted-foreground pb-1"
                      >
                        {m.head}
                      </div>
                    ))}
                    {scorecard.map((row) => (
                      <Fragment key={row.surface}>
                        <div className="h-14 flex items-center min-w-0 pr-2">
                          <span className="text-sm sm:text-base font-semibold text-foreground truncate">
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
              </div>

              {/* 2) Quadrant board — position carries the verdict; fanned dots. */}
              <div className="min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  Reach × retained value
                </div>
                <div className="flex gap-2">
                  {/* y-axis caption */}
                  <div className="flex items-center shrink-0">
                    <span
                      className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
                      retained value →
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className="relative w-full mx-auto"
                      style={{ maxWidth: 460, aspectRatio: "1 / 1" }}
                    >
                      {/* Plot field — everything shares these coordinates. */}
                      <div className="absolute inset-8 border border-border rounded-md bg-background/40">
                        {/* Threshold lines at the exact verdict cutoffs. */}
                        <div
                          className="absolute top-0 bottom-0 border-l border-dashed border-border"
                          style={{ left: `${REACH_THRESHOLD}%` }}
                        />
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-border"
                          style={{ top: `${100 - VALUE_THRESHOLD}%` }}
                        />

                        {/* Quadrant labels — verdict by position. */}
                        <span className="absolute top-1.5 left-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                          Invest
                        </span>
                        <span className="absolute top-1.5 right-2 text-[11px] font-mono uppercase tracking-wider text-primary">
                          Keep
                        </span>
                        <span className="absolute bottom-1.5 left-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                          Cut
                        </span>
                        <span className="absolute bottom-1.5 right-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                          Fix
                        </span>

                        {/* Surfaces — fanned so coincident dots never overlap. */}
                        {placed.map((p) => {
                          const labelLeft = p.adoption >= 60;
                          return (
                            <div
                              key={p.surface}
                              className="absolute flex items-center gap-1.5"
                              style={{
                                left: `${p.adoption}%`,
                                top: `${100 - p.valueLinkage}%`,
                                transform: `translate(calc(-50% + ${p.dx}px), calc(-50% + ${p.dy}px))`,
                                flexDirection: labelLeft ? "row-reverse" : "row",
                              }}
                              title={`${p.label}: reach ${p.adoption} · retained value ${p.valueLinkage} → ${VERDICT_LABEL[p.verdict]}`}
                            >
                              <span
                                className="block w-3 h-3 rounded-full shrink-0 ring-2 ring-background"
                                style={{ background: MINT }}
                              />
                              <span className="text-xs sm:text-sm font-semibold text-foreground whitespace-nowrap">
                                {p.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* x-axis caption */}
                    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground text-center mt-1">
                      reach →
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3) Composite ranking — strongest first; mint bar + verdict chip. */}
            <div className="mt-6">
              <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-2.5">
                Composite ranking
              </div>
              <div className="space-y-2">
                {ranked.map((row) => {
                  const width = Math.max(0, Math.min(100, row.composite));
                  return (
                    <div key={row.surface} className="flex items-center gap-3 sm:gap-4">
                      <span className="w-16 sm:w-20 shrink-0 text-sm font-semibold text-foreground truncate">
                        {SURFACE_LABEL[row.surface] ?? row.surface}
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-muted/60 overflow-hidden min-w-0">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-150"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-right text-base font-bold tabular-nums text-foreground">
                        {row.composite}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${verdictChipClass(row.verdict)}`}
                      >
                        {VERDICT_LABEL[row.verdict]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-xs sm:text-sm text-muted-foreground mt-4 leading-relaxed">
              Thresholds: reach ≥ {REACH_THRESHOLD}% and retained value ≥ {VALUE_THRESHOLD}% → KEEP.
              Stickiness lands in P2; composite is over the measured axes.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
