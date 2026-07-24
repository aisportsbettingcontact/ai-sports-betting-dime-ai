/**
 * JourneyFunnelPanel — lifecycle-funnel slice of the admin Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. One aligned,
 * full-width bar per lifecycle stage (Discover → Activate → Habituate → Value →
 * Retain, already ordered server-side), every bar sized against the first stage
 * so Discover = 100% and the owner can compare exact widths (not a tapering
 * ribbon). Between stages a muted step drop-off delta shows how many users fell
 * away. Honest states (owner directive): renders a centered "Not measured" card
 * with the exact reason when the pipeline is disabled or has produced no data
 * yet — never a fabricated 0. A real, measured 0 renders as 0; an unmeasured
 * value never does. firstStage = 0 collapses every bar to 0% rather than
 * dividing by zero. Owner-only (the query is ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint on the bar fills and the base count; mirrors SegmentsPanel's treatment.
 */
import { trpc } from "@/lib/trpc";
import { type FunnelStage } from "@/pages/admin/profilingTypes";
import { RefreshCw } from "lucide-react";

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

export default function JourneyFunnelPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const measured = !!data && !notOk;

  const funnel: FunnelStage[] = data?.funnel ?? [];
  const firstStageUsers = funnel[0]?.users ?? 0;

  /** Cumulative share of stage 1 (Discover = 100). 0 when the base is 0. */
  const shareOfFirst = (users: number): number =>
    firstStageUsers > 0 ? (users / firstStageUsers) * 100 : 0;

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
        {/* Header — title + base count (only when measured) + loading spinner. */}
        <div className="flex items-center gap-2 mb-1 min-w-0">
          <span className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-foreground uppercase truncate">
            Journey · lifecycle funnel
          </span>
          {isLoading && (
            <RefreshCw className="w-3 h-3 text-foreground animate-spin shrink-0" />
          )}
          <div className="flex-1" />
          {measured && funnel.length > 0 && (
            <span
              className="text-[11px] sm:text-sm font-mono font-bold text-primary shrink-0"
              title={`${firstStageUsers} users in the first stage (the 100% base)`}
            >
              {firstStageUsers.toLocaleString()}
            </span>
          )}
        </div>

        {notOk ? (
          /* Honest state — never a fabricated 0. Exact server reason. */
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              {STATE_LABEL[data!.state] ?? "Not measured"}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
              {data!.reason ?? "The lifecycle funnel pipeline has produced no data yet."}
            </div>
          </div>
        ) : measured && funnel.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              No journey data yet.
            </div>
          </div>
        ) : (
          <>
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-2.5 leading-snug">
              Discover = any session · Activate = ≥1 value event · Habituate = active ≥3 days ·
              Value = ≥4 value events across ≥2 surfaces · Retain = active ≥12 days in the window.
            </div>
            <div className="space-y-0.5">
              {funnel.map((stage, i) => {
                const pct = shareOfFirst(stage.users);
                const prev = i > 0 ? funnel[i - 1] : null;

                // Step drop-off relative to the previous stage (distinct from the
                // cumulative %-of-stage-1 shown beside each bar).
                const dropUsers = prev ? prev.users - stage.users : 0;
                const dropPct =
                  prev && prev.users > 0 ? (dropUsers / prev.users) * 100 : 0;

                return (
                  <div key={stage.key}>
                    {prev && (
                      <div className="flex items-center gap-2 min-w-0 pl-16 sm:pl-24 py-0.5">
                        <span className="text-[9px] sm:text-[10px] font-mono text-muted-foreground truncate">
                          −{dropUsers.toLocaleString()} users (−{Math.round(dropPct)}%)
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[10px] sm:text-xs font-mono w-16 sm:w-24 shrink-0 text-foreground truncate"
                        title={stage.label}
                      >
                        {stage.label}
                      </span>
                      <div className="flex-1 h-4 sm:h-5 rounded bg-muted/60 overflow-hidden min-w-0">
                        <div
                          className="h-full rounded bg-primary transition-all duration-150"
                          style={{ width: `${pct}%` }}
                          title={`${stage.label}: ${stage.users} users (${Math.round(pct)}% of ${firstStageUsers})`}
                        />
                      </div>
                      <span className="text-[10px] sm:text-xs font-mono w-20 sm:w-24 text-right shrink-0 text-foreground tabular-nums">
                        {stage.users.toLocaleString()}
                        <span className="text-muted-foreground"> ({Math.round(pct)}%)</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
