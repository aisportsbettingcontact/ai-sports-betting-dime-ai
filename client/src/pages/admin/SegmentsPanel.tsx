/**
 * SegmentsPanel — behavioral-segment slice of the admin Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. One horizontal bar
 * per segment (strongest→weakest engagement, already ordered server-side),
 * sized against the largest segment. Honest states (owner directive): renders a
 * centered "Not measured" card with the exact reason when the pipeline is
 * disabled or has produced no data yet — never a fabricated 0. A real, measured
 * 0 renders as 0; an unmeasured value never does. Owner-only (the query is
 * ownerProcedure, gated upstream).
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint on the bar fills and the total; mirrors DeviceActivityPanel's treatment.
 */
import { trpc } from "@/lib/trpc";
import { type SegmentSlice, SEGMENT_LABEL } from "@/pages/admin/profilingTypes";
import { RefreshCw } from "lucide-react";

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

export default function SegmentsPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const measured = !!data && !notOk;

  const segments: SegmentSlice[] = data?.segments ?? [];
  const totalUsers = segments.reduce((sum, s) => sum + s.users, 0);
  const maxUsers = Math.max(...segments.map((s) => s.users), 1);

  return (
    <div className="mb-6">
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
        {/* Header — title + total (only when measured) + loading spinner. */}
        <div className="flex items-center gap-2 mb-1 min-w-0">
          <span className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-foreground uppercase truncate">
            Segments · distinct users
          </span>
          {isLoading && (
            <RefreshCw className="w-3 h-3 text-foreground animate-spin shrink-0" />
          )}
          <div className="flex-1" />
          {measured && (
            <span className="text-[11px] sm:text-sm font-mono font-bold text-primary shrink-0">
              {totalUsers.toLocaleString()}
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
              {data!.reason ?? "The segmentation pipeline has produced no data yet."}
            </div>
          </div>
        ) : (
          <>
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-2 leading-snug">
              Segments computed live from behavioral signals.
            </div>
            <div className="space-y-1.5">
              {segments.map((s) => {
                const label = SEGMENT_LABEL[s.key] ?? s.label;
                return (
                  <div key={s.key} className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[10px] sm:text-xs font-mono w-28 sm:w-36 shrink-0 text-foreground truncate"
                      title={label}
                    >
                      {label}
                    </span>
                    <div className="flex-1 h-3 rounded bg-muted/60 overflow-hidden min-w-0">
                      <div
                        className="h-full rounded bg-primary transition-all duration-150"
                        style={{
                          width: `${Math.max((s.users / maxUsers) * 100, s.users > 0 ? 4 : 0)}%`,
                        }}
                        title={`${label}: ${s.users} users`}
                      />
                    </div>
                    <span className="text-[10px] sm:text-xs font-mono w-8 text-right text-foreground shrink-0">
                      {s.users}
                    </span>
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
