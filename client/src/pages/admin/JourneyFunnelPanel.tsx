/**
 * JourneyFunnelPanel — the lifecycle funnel of the Customer Profiling Cockpit,
 * fed by the owner-gated analytics.overview proxy. Renders the five stages
 * (Discover → Activate → Habituate → Value → Retain, already ordered server-side)
 * as a horizontal funnel: one full-width row per stage with a centered, cooling
 * mint bar sized to its share of stage 1, the headline count + % of base, and a
 * between-stage conversion note (how many continued, how many dropped).
 *
 * This is deliberately NOT a geometric recharts funnel — that collapses to an
 * unreadable sliver on sparse data (e.g. 10 → 10 → 0 → 0 → 0) and overlaps its
 * labels. Horizontal stage bars stay legible and honest at any density.
 *
 * Honest states (owner directive): a centered "Not measured" card with the exact
 * reason when the pipeline is off; "No journey data yet." when measured but empty.
 * A real measured 0 renders as 0; firstStage = 0 collapses every % to 0 rather
 * than dividing by zero. Owner-only (the query is ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, one-accent mint as a single-hue
 * ramp cooling down the funnel (never a categorical rainbow), Familjen Grotesk for
 * the focal counts, mono micro-labels, motion gated on prefers-reduced-motion.
 */
import { trpc } from "@/lib/trpc";
import SectionHeader from "@/pages/admin/SectionHeader";
import { type FunnelStage, METRIC_STATE_LABEL } from "@/pages/admin/profilingTypes";
import { mintRamp, usePrefersReducedMotion } from "@/pages/admin/chartTheme";

/** Plain-English qualifier per stage — surfaced inline so the funnel self-explains. */
const STAGE_HINT: Record<string, string> = {
  discover: "any session",
  activate: "≥1 value event",
  habituate: "active ≥3 days",
  value: "≥4 value events across ≥2 surfaces",
  retain: "active ≥12 days",
};

export default function JourneyFunnelPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reduced = usePrefersReducedMotion();

  const notOk = !!data && data.state !== "ok";
  const funnel: FunnelStage[] = data?.funnel ?? [];
  const base = funnel[0]?.users ?? 0;

  // Mint cools down the funnel — Discover strongest, Retain faintest. Single hue.
  const ramp = mintRamp(funnel.length);
  const barTransition = reduced ? "" : "transition-[width] duration-[320ms] ease-out";

  const meta = !notOk && funnel.length > 0 ? `${base.toLocaleString()} discovered` : undefined;

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <SectionHeader title="Journey · lifecycle funnel" meta={meta} loading={isLoading} />

        {notOk ? (
          /* Honest state — never a fabricated 0. Exact server reason. */
          <div className="px-4 py-6 text-center">
            <div className="text-base font-semibold text-muted-foreground">
              {METRIC_STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
              {data!.reason ?? "The lifecycle funnel pipeline has produced no data yet."}
            </div>
          </div>
        ) : funnel.length === 0 ? (
          !isLoading && (
            <div className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              No journey data yet.
            </div>
          )
        ) : (
          <div className="mt-4">
            {funnel.map((stage, i) => {
              const pct = base > 0 ? (stage.users / base) * 100 : 0;
              const prev = i > 0 ? funnel[i - 1] : null;
              const contPct = prev && prev.users > 0 ? Math.round((stage.users / prev.users) * 100) : 0;
              const drop = prev ? prev.users - stage.users : 0;

              return (
                <div key={stage.key}>
                  {/* Between-stage conversion note — how many continued vs dropped. */}
                  {prev && (
                    <div className="flex items-center gap-2 py-2 pl-1 text-xs sm:text-sm text-muted-foreground">
                      <span aria-hidden="true" className="text-primary">↓</span>
                      <span className="tabular-nums">
                        {contPct}% continued
                        {drop > 0 && (
                          <span className="text-muted-foreground/80"> · −{drop.toLocaleString()} dropped</span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Stage headline — name + hint, then the count + % of base. */}
                  <div className="flex items-baseline justify-between gap-3 mb-1.5 min-w-0">
                    <span className="min-w-0 truncate">
                      <span className="text-sm sm:text-base font-semibold text-foreground">{stage.label}</span>
                      <span className="ml-2 text-xs sm:text-sm text-muted-foreground font-mono hidden sm:inline">
                        {STAGE_HINT[stage.key] ?? ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`text-xl sm:text-2xl font-bold tabular-nums ${stage.users > 0 ? "text-primary" : "text-muted-foreground"}`}
                        style={{ letterSpacing: "-0.02em" }}
                      >
                        {stage.users.toLocaleString()}
                      </span>
                      <span className="ml-2 text-xs sm:text-sm text-muted-foreground tabular-nums">
                        {Math.round(pct)}% of base
                      </span>
                    </span>
                  </div>

                  {/* Centered mint bar — narrows down the funnel (taper metaphor). */}
                  <div className="h-9 sm:h-10 rounded-lg bg-muted/40 overflow-hidden flex justify-center">
                    <div
                      className={`h-full rounded-lg ${barTransition}`}
                      style={{ width: `${pct}%`, background: ramp[i] }}
                      title={`${stage.label}: ${stage.users.toLocaleString()} users (${Math.round(pct)}% of base)`}
                    />
                  </div>
                </div>
              );
            })}

            <p className="mt-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Each stage counts distinct users who cleared its bar within the 30-day window;
              % of base is against Discover. Bars cool from Discover (brightest) to Retain.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
