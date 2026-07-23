/**
 * MetricsPanel — the "Platform Metrics" block for the admin User Activity page.
 *
 * Owner directive 2026-07-23: never render a fabricated zero. The server now
 * returns an explicit data-state per metric ({state, value, reason}); this panel
 * renders `Not measured` / `Incomplete` / `Unknown` (with the exact reason on
 * hover) instead of `0` / `00:00:00` when the underlying instrumentation has
 * produced no valid data. Membership is shown as a reconciled, non-overlapping
 * breakdown (lifetime + recurring + no-access = total; Discord cross-cuts),
 * never as competing totals.
 *
 * Every procedure it calls is ownerProcedure (server/routers/metrics.ts) and it
 * only renders inside the owner-gated UserActivity page. Design: Dime brand law —
 * semantic tokens only, font-mono digits, no hardcoded hex.
 */
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";

/** Formats milliseconds → HH:MM:SS */
function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Structural shape of a server MetricPoint (no cross-boundary import). */
type PointLike = { state: string; value: number | null; reason: string | null };

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
};

/**
 * Renders a metric's value when it is a valid `ok` measurement, otherwise the
 * data-state label (with the exact reason surfaced on hover) — never a
 * fabricated 0. `loading` short-circuits to an em dash.
 */
function MetricValue({
  point,
  loading,
  format = (v: number) => String(v),
  okClass = "text-foreground",
}: {
  point: PointLike | undefined;
  loading: boolean;
  format?: (v: number) => string;
  okClass?: string;
}) {
  if (loading || !point) return <span className="text-muted-foreground">—</span>;
  if (point.state === "ok" && point.value !== null) {
    return <span className={okClass}>{format(point.value)}</span>;
  }
  const label = STATE_LABEL[point.state] ?? "—";
  return (
    <span
      className="text-muted-foreground"
      title={point.reason ?? undefined}
    >
      {label}
    </span>
  );
}

export function MetricsPanel() {
  const { data: sessionData, isLoading: sessLoading } = trpc.metrics.getSessionMetrics.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every 60s
  });
  const { data: memberData, isLoading: membLoading } = trpc.metrics.getMemberMetrics.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: histData, isLoading: histLoading } = trpc.metrics.getDurationHistogram.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const loading = sessLoading || membLoading || histLoading;

  // ── Session KPIs (engagement) — each is a {state,value,reason} point ──────
  const sessionKpis: Array<{
    label: string;
    sublabel: string;
    point: PointLike | undefined;
    format?: (v: number) => string;
    highlight?: boolean;
  }> = [
    { label: "DAILY ACTIVE USERS",   sublabel: "Foreground engagement · last 24h", point: sessionData?.dau, highlight: true },
    { label: "WEEKLY ACTIVE USERS",  sublabel: "Foreground engagement · last 7d",  point: sessionData?.wau },
    { label: "MONTHLY ACTIVE USERS", sublabel: "Foreground engagement · last 30d", point: sessionData?.mau },
    { label: "AVG SESSION DURATION", sublabel: "Avg engaged time · last 30d",      point: sessionData?.avgSessionDurationMs, format: fmtDuration },
  ];

  // ── Membership (reconciled, non-overlapping) ──────────────────────────────
  const total = memberData?.totalMembers ?? null;
  // Membership honesty: a DB outage/query error returns reconcileMembership(0,0,0,0)
  // with state !== "ok". Never print those fabricated zeros — show the data-state.
  const memberOk = memberData?.state === "ok";
  const memberStateLabel = STATE_LABEL[memberData?.state ?? "not_measured"] ?? "—";
  const membershipCards: Array<{ label: string; sublabel: string; value: number | null; highlight?: boolean }> = [
    { label: "TOTAL ACCOUNTS",   sublabel: "All registered accounts", value: total, highlight: true },
    { label: "LIFETIME ACCESS",  sublabel: "Never-expiring access",   value: memberData?.lifetime ?? null },
    { label: "RECURRING PAID",   sublabel: "Time-limited active access", value: memberData?.recurringPaid ?? null },
    { label: "NO ACTIVE ACCESS", sublabel: "Expired or never granted", value: memberData?.noAccess ?? null },
  ];

  return (
    <div className="mb-6 space-y-3">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-foreground uppercase">Platform Metrics</span>
        <div className="flex-1 h-px bg-card" />
        {loading && <RefreshCw className="w-3 h-3 text-foreground animate-spin" />}
      </div>

      {/* Row 1 — Session KPIs (engagement): 2-col mobile, 4-col sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {sessionKpis.map((k) => (
          <div
            key={k.label}
            className={`bg-card border ${k.highlight ? "border-primary" : "border-border"} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}
          >
            <div className="text-base sm:text-xl font-bold font-mono truncate">
              <MetricValue
                point={k.point}
                loading={loading}
                format={k.format}
                okClass={k.highlight ? "text-primary" : "text-foreground"}
              />
            </div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Row 2 — Membership: reconciled, non-overlapping buckets that sum to total */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {membershipCards.map((k) => (
          <div
            key={k.label}
            className={`bg-card border ${k.highlight ? "border-primary" : "border-border"} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}
          >
            <div className={`text-base sm:text-xl font-bold font-mono truncate ${k.highlight ? "text-primary" : "text-foreground"}`}>
              {membLoading ? (
                <span className="text-muted-foreground">—</span>
              ) : !memberOk ? (
                <span className="text-muted-foreground" title={memberData?.reason ?? undefined}>{memberStateLabel}</span>
              ) : (
                k.value ?? <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Discord is CROSS-CUTTING — shown apart from the additive buckets so it
          is never mistaken for a separate slice of the total. */}
      <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base sm:text-lg font-bold font-mono text-foreground">
          {membLoading ? "—" : !memberOk ? memberStateLabel : (memberData?.discordConnected ?? "—")}
        </span>
        <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase">Discord Linked</span>
        <span className="text-[10px] sm:text-xs text-muted-foreground">
          Cross-cuts every bucket — not added to the total. Lifetime + Recurring + No-access = Total accounts.
        </span>
      </div>

      {/* Row 3 — Session Duration Histogram (gated on data-state) */}
      {(() => {
        const state = histData?.state;
        // Honest empty/failure states — never a fabricated all-zero chart.
        if (!histLoading && histData && state !== "ok") {
          return (
            <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-4 text-center">
              <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase leading-tight">
                Session Duration Distribution
              </div>
              <div className="text-sm font-semibold text-muted-foreground mt-1">
                {STATE_LABEL[state ?? "not_measured"] ?? "Not measured"}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
                {histData.reason ?? "No session duration data available yet."}
              </div>
            </div>
          );
        }

        const totalSessions = histData?.total ?? 0;
        // barColor: context buckets use the neutral muted-foreground token (clearly
        // legible on the bg-card container in both themes) at 70% so the mint
        // "Active sessions" focal bar still leads.
        const buckets: Array<{ label: string; count: number; color: string; barColor: string }> = [
          { label: "<5 min",     count: histData?.under5m  ?? 0, color: "text-foreground", barColor: "bg-muted-foreground/70" },
          { label: "5-30 min",   count: histData?.m5to30   ?? 0, color: "text-foreground", barColor: "bg-muted-foreground/70" },
          { label: "30-120 min", count: histData?.m30to120 ?? 0, color: "text-primary",    barColor: "bg-primary" },
          { label: "2-4 h",      count: histData?.h2to4    ?? 0, color: "text-foreground", barColor: "bg-muted-foreground/70" },
        ];
        const maxCount = Math.max(...buckets.map((b) => b.count), 1); // avoid div/0

        return (
          <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase leading-tight">
                  Session Duration Distribution
                </div>
                <div className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                  {histLoading ? "Loading..." : `${totalSessions} closed session${totalSessions !== 1 ? "s" : ""} in last 30 days`}
                </div>
              </div>
              {histLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin flex-shrink-0" />}
            </div>

            <div className="flex items-end gap-2 sm:gap-3 h-16 sm:h-20">
              {buckets.map((b) => {
                const barPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
                const pct = totalSessions > 0 ? Math.round((b.count / totalSessions) * 100) : 0;
                return (
                  <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5 h-full min-w-0">
                    {/* Bar container doubles as a faint full-height track (bg-muted)
                        so every bucket reads as a column; the value fill grows over it. */}
                    <div className="flex-1 w-full flex items-end rounded-t bg-muted/60 overflow-hidden">
                      <div
                        className={`w-full rounded-t transition-all duration-500 ${b.barColor}`}
                        style={{ height: histLoading ? "0%" : `${Math.max(barPct, barPct > 0 ? 4 : 0)}%` }}
                        title={`${b.label}: ${b.count} sessions (${pct}%)`}
                      />
                    </div>
                    <div className={`text-[10px] sm:text-xs font-bold font-mono ${b.color} leading-none`}>
                      {histLoading ? "—" : b.count}
                    </div>
                    <div className="text-[9px] sm:text-[10px] text-foreground leading-none text-center truncate w-full">
                      {b.label}
                    </div>
                    <div className="text-[9px] sm:text-[10px] text-muted-foreground leading-none">
                      {histLoading ? "" : `${pct}%`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default MetricsPanel;
