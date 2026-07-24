/**
 * IdealCustomerPanel — a live-synthesized Ideal Customer Profile for the Customer
 * Profiling Cockpit, fed by the owner-gated analytics.overview proxy. Turns the
 * raw profiling signals into the one thing an operator (or investor) wants: a
 * plain-English picture of who the best Dime customer is and what pattern to
 * cultivate. Every figure is DERIVED from real data and labelled honestly — the
 * dominant segment, the anchor surface, the typical high-value behaviour of the
 * current top cohort, and the biggest activation leak in the funnel.
 *
 * Honest states (owner directive): "Not measured" with the exact reason when the
 * pipeline is off; a quiet "Not enough signal yet…" when measured but too sparse
 * to characterise — never an invented persona. Averages are labelled with the
 * cohort they come from (Power+Core when it exists, else the top scored cohort).
 *
 * Design: Dime brand law — semantic tokens, mint only as signal, Familjen Grotesk
 * for focal numbers, mono micro-labels; no gradients / red / purple.
 */
import { trpc } from "@/lib/trpc";
import SectionHeader from "@/pages/admin/SectionHeader";
import {
  type UserProfileRow,
  type SegmentSlice,
  type FunnelStage,
  type FeatureScore,
  SEGMENT_LABEL,
  SURFACE_LABEL,
  METRIC_STATE_LABEL,
} from "@/pages/admin/profilingTypes";

const round1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** One derived ICP trait, rendered as a compact stat block. */
function Trait({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-background/60 border border-border rounded-lg px-3.5 py-3 min-w-0">
      <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground leading-none">
        {label}
      </div>
      <div
        className="mt-1.5 text-lg sm:text-xl font-bold tabular-nums text-foreground truncate leading-none"
        style={{ letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground leading-tight truncate">{sub}</div>}
    </div>
  );
}

export default function IdealCustomerPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const segments: SegmentSlice[] = data?.segments ?? [];
  const topUsers: UserProfileRow[] = data?.topUsers ?? [];
  const scorecard: FeatureScore[] = data?.featureScorecard ?? [];
  const funnel: FunnelStage[] = data?.funnel ?? [];

  const totalSegUsers = segments.reduce((s, x) => s + x.users, 0);
  const dominant = [...segments].filter((s) => s.users > 0).sort((a, b) => b.users - a.users)[0];
  const dominantShare = dominant && totalSegUsers > 0 ? Math.round((dominant.users / totalSegUsers) * 100) : 0;

  // Reference cohort: Power+Core if a real one exists, else the top scored cohort.
  const powerCore = topUsers.filter((u) => u.tier === "power" || u.tier === "core");
  const cohort = powerCore.length >= 3 ? powerCore : topUsers;
  const cohortLabel = powerCore.length >= 3 ? "Power + Core" : "Top cohort";
  const avgValue = avg(cohort.map((u) => u.valueEvents));
  const avgDays = avg(cohort.map((u) => u.activeDays));
  const avgSurfaces = avg(cohort.map((u) => u.distinctSurfaces));
  const engagedShare =
    topUsers.length > 0 ? Math.round((powerCore.length / topUsers.length) * 100) : 0;

  // Anchor surface = strongest by composite.
  const anchor = [...scorecard].sort((a, b) => b.composite - a.composite)[0];
  const anchorLabel = anchor ? SURFACE_LABEL[anchor.surface] ?? anchor.surface : null;

  // Biggest activation leak = largest step drop-off between consecutive stages.
  let leak: { from: FunnelStage; to: FunnelStage; pct: number } | null = null;
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const cur = funnel[i];
    const pct = prev.users > 0 ? ((prev.users - cur.users) / prev.users) * 100 : 0;
    if (!leak || pct > leak.pct) leak = { from: prev, to: cur, pct };
  }

  const hasSignal = !notOk && (dominant != null || cohort.length > 0);

  // Plain-English ICP statement, assembled from the derived facts only.
  const statement = ((): string => {
    if (!dominant && cohort.length === 0) return "";
    const seg = dominant ? SEGMENT_LABEL[dominant.key] ?? dominant.label : "engaged";
    const surf = anchorLabel ? `${anchorLabel}-anchored` : "single-surface";
    const behavior =
      cohort.length > 0
        ? `logs ~${round1(avgValue)} value events over ~${round1(avgDays)} active day${avgDays === 1 ? "" : "s"}, touching ~${round1(avgSurfaces)} surface${avgSurfaces === 1 ? "" : "s"}`
        : "has not yet built a repeat pattern";
    const tierNote =
      powerCore.length >= 3
        ? "A real Power/Core tier has formed."
        : "No Power/Core tier has formed yet — this is the pattern to cultivate.";
    return `Your ideal Dime customer today is a ${surf} ${seg} who ${behavior}. ${tierNote}`;
  })();

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <SectionHeader
          title="Ideal Customer Profile"
          meta={hasSignal ? "synthesized live" : undefined}
          loading={isLoading}
        />

        {notOk ? (
          <div className="px-4 py-6 text-center">
            <div className="text-base font-semibold text-muted-foreground">
              {METRIC_STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
              {data!.reason ?? "The profiling pipeline has produced no data yet."}
            </div>
          </div>
        ) : !hasSignal ? (
          !isLoading && (
            <div className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              Not enough signal yet to synthesize an ideal profile.
            </div>
          )
        ) : (
          <div className="mt-3 space-y-4">
            {/* The synthesized statement — the headline read. */}
            <p className="text-base sm:text-lg text-foreground leading-relaxed max-w-3xl">{statement}</p>

            {/* Derived trait tiles. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
              {dominant && (
                <Trait
                  label="Dominant segment"
                  value={SEGMENT_LABEL[dominant.key] ?? dominant.label}
                  sub={`${dominantShare}% of segmented users`}
                />
              )}
              {anchorLabel && (
                <Trait label="Anchor surface" value={anchorLabel} sub={`composite ${anchor!.composite}/100`} />
              )}
              <Trait label="Typical value events" value={round1(avgValue)} sub={`${cohortLabel} avg`} />
              <Trait label="Typical active days" value={round1(avgDays)} sub={`${cohortLabel} avg`} />
              <Trait label="Surfaces touched" value={round1(avgSurfaces)} sub={`${cohortLabel} avg`} />
            </div>

            {/* Activation lever — the biggest leak + engaged share. */}
            <div className="flex flex-col sm:flex-row gap-3">
              {leak && leak.pct > 0 && (
                <div className="flex-1 bg-background/60 border border-border rounded-lg px-3.5 py-3 min-w-0">
                  <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Biggest activation leak
                  </div>
                  <div className="mt-1.5 text-sm sm:text-base text-foreground leading-relaxed">
                    <span className="font-bold text-primary tabular-nums">−{Math.round(leak.pct)}%</span> from{" "}
                    <span className="font-semibold">{leak.from.label}</span> →{" "}
                    <span className="font-semibold">{leak.to.label}</span> — the lever most worth pulling.
                  </div>
                </div>
              )}
              <div className="flex-1 bg-background/60 border border-border rounded-lg px-3.5 py-3 min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Engaged share
                </div>
                <div className="mt-1.5 text-sm sm:text-base text-foreground leading-relaxed">
                  <span className="font-bold text-primary tabular-nums">{engagedShare}%</span> of ranked users are
                  Power or Core tier.
                </div>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Synthesized from live segments, the {cohortLabel.toLowerCase()} cohort's behaviour, feature
              composites, and funnel drop-off. Every figure is measured, never assumed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
