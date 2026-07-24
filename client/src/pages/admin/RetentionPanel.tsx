/**
 * RetentionPanel — weekly-cohort retention heatmap for the Customer Profiling
 * Cockpit, fed by the owner-gated analytics.overview proxy. Honest states (owner
 * directive): renders "Not measured" with the exact reason when the pipeline is
 * off, and "No cohorts yet." when measured but empty — never a fabricated grid.
 * Unreachable/future weeks (null) render as a flat "—", never a 0.
 *
 * Design: Dime brand law — semantic tokens only, font-mono tabular numerals, a
 * single-hue mint-opacity heat ramp (heatStyle, never rainbow), hairline cells,
 * 150ms fill transitions, no gradients/heavy shadows.
 */
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";
import { type RetentionCohort, heatStyle } from "@/pages/admin/profilingTypes";

// Windowed to the last 8 weeks: retention index 0 = W0 … 7 = W7.
const WEEKS = [0, 1, 2, 3, 4, 5, 6, 7];
const GRID_COLS = "9rem repeat(8, minmax(0, 1fr))";

/** One retention cell: heat fill for measured values, flat "—" for nulls. */
function Cell({ value }: { value: number | null }) {
  const { style, darkText, measured } = heatStyle(value);
  if (!measured || value == null) {
    return (
      <div className="flex h-9 items-center justify-center rounded border border-border/60 bg-card">
        <span className="font-mono text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div
      className="flex h-9 items-center justify-center rounded border border-border/60 transition-all duration-150 hover:ring-1 hover:ring-primary/40"
      style={style}
      title={`${value.toFixed(1)}% retained`}
    >
      <span
        className={`font-mono text-xs tabular-nums ${darkText ? "" : "text-foreground"}`}
        style={darkText ? { color: "#04150E" } : undefined}
      >
        {Math.round(value)}
        <span className="opacity-50">%</span>
      </span>
    </div>
  );
}

export default function RetentionPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const cohorts: RetentionCohort[] = data?.retention ?? [];

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-foreground uppercase font-mono">
          Retention · weekly cohorts
        </span>
        <div className="flex-1 h-px bg-card" />
        {isLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin" />}
      </div>

      {notOk ? (
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-center">
          <div className="text-sm font-semibold text-muted-foreground">Not measured</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ?? "The retention pipeline has produced no cohorts yet."}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          {cohorts.length === 0 ? (
            <div className="text-[10px] sm:text-xs text-muted-foreground py-6 text-center">
              No cohorts yet.
            </div>
          ) : (
            <>
              {/* Own horizontal scroller — the page body must never scroll sideways. */}
              <div className="overflow-x-auto">
                <div className="space-y-1" style={{ minWidth: 640 }}>
                  {/* Header row: blank gutter, then W0…W7. */}
                  <div className="grid gap-1 items-end" style={{ gridTemplateColumns: GRID_COLS }}>
                    <div className="sticky left-0 z-10 bg-card" />
                    {WEEKS.map((w) => (
                      <div
                        key={w}
                        className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground pb-1"
                      >
                        W{w}
                      </div>
                    ))}
                  </div>

                  {/* One row per cohort, newest first. */}
                  {cohorts.map((c) => {
                    const lowN = c.size < 5;
                    return (
                      <div
                        key={c.cohortWeek}
                        className="grid gap-1 items-center"
                        style={{ gridTemplateColumns: GRID_COLS }}
                      >
                        <div className="sticky left-0 z-10 bg-card pr-2 min-w-0">
                          <div className="text-[11px] sm:text-xs font-mono text-foreground truncate">
                            {c.cohortWeek}
                            {lowN && <span className="text-muted-foreground"> · low n</span>}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground leading-tight">
                            n={c.size}
                          </div>
                        </div>
                        {WEEKS.map((w) => (
                          <Cell key={w} value={c.retention[w] ?? null} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="mt-3 text-[10px] sm:text-xs text-muted-foreground leading-snug">
                W0 = each cohort's first active week; retention = % of that cohort active in later
                weeks (windowed to the last 8 weeks). Blank cells (—) are future or unreachable
                weeks, not zero.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
