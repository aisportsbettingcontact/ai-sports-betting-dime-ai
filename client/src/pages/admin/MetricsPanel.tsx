/**
 * MetricsPanel — the "Platform Metrics" block for the Admin Dashboard.
 *
 * Extracted verbatim from UserManagement.tsx (owner directive 2026-07-23:
 * "create a User Activity tab and move Platform Metrics into it"). This is a
 * pure presentational + data-fetching component — it owns NO auth logic. Every
 * procedure it calls (metrics.getSessionMetrics / getMemberMetrics /
 * getDurationHistogram) is bound to server-verified ownerProcedure middleware
 * (server/routers/metrics.ts), and it only ever renders inside an owner-gated
 * page (client/src/pages/UserActivity.tsx, wrapped RequireAuth > RequireOwner).
 *
 * Three rows: session KPIs (DAU/WAU/MAU/avg duration), member KPIs
 * (paying/lifetime/non-paying/discord), and a session-duration histogram.
 * All three queries refetch every 60s. Design: Dime brand law — semantic
 * tokens only (bg-card, border-border, text-primary mint, text-foreground),
 * font-mono for fixed-width digits, no hardcoded hex.
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

  const sessionKpis = [
    {
      label: "DAILY ACTIVE USERS",
      sublabel: "Unique logins in last 24 hours",
      value: loading ? "—" : String(sessionData?.dau ?? 0),
      color: "text-primary",
      border: "border-primary",
    },
    {
      label: "WEEKLY ACTIVE USERS",
      sublabel: "Unique logins in last 7 days",
      value: loading ? "—" : String(sessionData?.wau ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
    {
      label: "MONTHLY ACTIVE USERS",
      sublabel: "Unique logins in last 30 days",
      value: loading ? "—" : String(sessionData?.mau ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
    {
      label: "AVG SESSION DURATION",
      sublabel: "Avg active time per session",
      value: loading ? "—" : fmtDuration(sessionData?.avgSessionDurationMs ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
  ];

  const memberKpis = [
    {
      label: "TOTAL PAYING MEMBERS",
      sublabel: "Active paid access (all tiers)",
      value: loading ? "—" : String(memberData?.totalPaying ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
    {
      label: "LIFETIME MEMBERS",
      sublabel: "Never-expiring access accounts",
      value: loading ? "—" : String(memberData?.lifetimeMembers ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
    {
      label: "NON-PAYING MEMBERS",
      sublabel: "Accounts without active access",
      value: loading ? "—" : String(memberData?.nonPaying ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
    {
      label: "CONNECTED DISCORD USERS",
      sublabel: "Accounts with Discord linked",
      value: loading ? "—" : String(memberData?.discordConnected ?? 0),
      color: "text-foreground",
      border: "border-border",
    },
  ];

  return (
    <div className="mb-6 space-y-3">
      {/* Section label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-foreground uppercase">Platform Metrics</span>
        <div className="flex-1 h-px bg-card" />
        {loading && <RefreshCw className="w-3 h-3 text-foreground animate-spin" />}
      </div>

      {/* Row 1 — Session KPIs: 2-col mobile, 4-col sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {sessionKpis.map((k) => (
          <div key={k.label} className={`bg-card border ${k.border} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}>
            {/* Value: font-mono for fixed-width digits, truncate prevents overflow */}
            <div className={`text-base sm:text-xl font-bold font-mono ${k.color} truncate`}>{k.value}</div>
            {/* Label: fixed xs size — sm:text-xs was backwards (larger on mobile) */}
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-foreground mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>
      {/* Row 2 — Member KPIs: 2-col mobile, 4-col sm+ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {memberKpis.map((k) => (
          <div key={k.label} className={`bg-card border ${k.border} rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden`}>
            <div className={`text-base sm:text-xl font-bold font-mono ${k.color} truncate`}>{k.value}</div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">{k.label}</div>
            <div className="text-[10px] sm:text-xs text-foreground mt-0.5 leading-tight">{k.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Row 3 — Session Duration Histogram */}
      {(() => {
        // [STEP] Build histogram bars from getDurationHistogram data.
        // Buckets: <5min | 5-30min | 30-120min | 2-4h
        // Bar height is proportional to the bucket with the most sessions (max = 100%).
        const total = histData?.total ?? 0;
        // barColor: context buckets use the neutral muted-foreground token (clearly
        // legible on the bg-card container in both themes) at 70% so the mint
        // "Active sessions" focal bar still leads. Previously all three context bars
        // were bg-card on a bg-card container → zero contrast, effectively invisible.
        const buckets: Array<{ label: string; sublabel: string; count: number; color: string; barColor: string }> = [
          { label: "<5 min",    sublabel: "Quick visits",    count: histData?.under5m  ?? 0, color: "text-foreground",    barColor: "bg-muted-foreground/70" },
          { label: "5-30 min",  sublabel: "Short sessions",  count: histData?.m5to30   ?? 0, color: "text-foreground",  barColor: "bg-muted-foreground/70" },
          { label: "30-120 min",sublabel: "Active sessions", count: histData?.m30to120 ?? 0, color: "text-primary",barColor: "bg-primary" },
          { label: "2-4 h",     sublabel: "Deep sessions",   count: histData?.h2to4    ?? 0, color: "text-foreground",   barColor: "bg-muted-foreground/70" },
        ];
        const maxCount = Math.max(...buckets.map((b) => b.count), 1); // avoid div/0

        return (
          <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase leading-tight">
                  Session Duration Distribution
                </div>
                <div className="text-[10px] sm:text-xs text-foreground leading-tight">
                  {histLoading ? "Loading..." : `${total} closed session${total !== 1 ? "s" : ""} in last 30 days`}
                </div>
              </div>
              {histLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin flex-shrink-0" />}
            </div>

            {/* Bar chart */}
            <div className="flex items-end gap-2 sm:gap-3 h-16 sm:h-20">
              {buckets.map((b) => {
                // [STATE] barPct = count / maxCount * 100 (relative to tallest bar)
                const barPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
                // [STATE] pct = count / total * 100 (absolute percentage of all sessions)
                const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
                return (
                  <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5 h-full min-w-0">
                    {/* Bar container doubles as a faint full-height track (bg-muted)
                        so every bucket reads as a column — even a 0-count one — and
                        the value fill grows over it from the bottom. */}
                    <div className="flex-1 w-full flex items-end rounded-t bg-muted/60 overflow-hidden">
                      <div
                        className={`w-full rounded-t transition-all duration-500 ${b.barColor}`}
                        style={{ height: histLoading ? "0%" : `${Math.max(barPct, barPct > 0 ? 4 : 0)}%` }}
                        title={`${b.label}: ${b.count} sessions (${pct}%)`}
                      />
                    </div>
                    {/* Count + percentage */}
                    <div className={`text-[10px] sm:text-xs font-bold font-mono ${b.color} leading-none`}>
                      {histLoading ? "—" : b.count}
                    </div>
                    {/* Bucket label */}
                    <div className="text-[9px] sm:text-[10px] text-foreground leading-none text-center truncate w-full">
                      {b.label}
                    </div>
                    {/* Percentage */}
                    <div className="text-[9px] sm:text-[10px] text-foreground leading-none">
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
