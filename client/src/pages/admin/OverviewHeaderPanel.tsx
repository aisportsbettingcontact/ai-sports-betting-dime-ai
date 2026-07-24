/**
 * OverviewHeaderPanel — the KPI hero row at the top of the User Activity cockpit:
 * the six numbers an owner (or investor) should absorb in one glance. Fed by the
 * owner-gated analytics.overview proxy; each tile is an apple-design StatTile with
 * honest states (never a fabricated 0 — an unmeasured metric shows its data-state
 * with the exact reason on hover). The lead tile carries an inline mint sparkline
 * and a size-weighted week-over-week delta derived from the real 30-day series.
 *
 * Design: Dime brand law — semantic tokens, mint only as signal (lead tile +
 * sparkline + positive delta), tabular numerals, mono micro-labels.
 */
import { trpc } from "@/lib/trpc";
import StatTile from "@/pages/admin/StatTile";
import SectionHeader from "@/pages/admin/SectionHeader";
import { fmtCompact } from "@/pages/admin/chartTheme";
import { type PointLike } from "@/pages/admin/profilingTypes";

/** Mean of a numeric slice (0 when empty). */
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export default function OverviewHeaderPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const measured = !!data && data.state === "ok";
  const daily = data?.dailyActivity ?? [];
  const activeSeries = daily.map((d) => d.activeUsers);

  // Honest week-over-week delta on active users: mean of the last 7 measured days
  // vs the prior 7. Only when we actually have ≥14 days of series. A zero-day is a
  // measured zero, so this stays truthful.
  let delta: { text: string; tone: "up" | "down" | "flat" } | undefined;
  if (measured && activeSeries.length >= 14) {
    const last7 = mean(activeSeries.slice(-7));
    const prior7 = mean(activeSeries.slice(-14, -7));
    if (prior7 > 0) {
      const pct = Math.round(((last7 - prior7) / prior7) * 100);
      delta = {
        text: `${pct > 0 ? "+" : ""}${pct}% WoW`,
        tone: pct > 0 ? "up" : pct < 0 ? "down" : "flat",
      };
    }
  }

  // Power + Core tier headcount among the ranked users — rendered through the same
  // honest-state path (synthetic MetricPoint) so it degrades to "Not measured" too.
  const topUsers = data?.topUsers ?? [];
  const powerCount = topUsers.filter((u) => u.tier === "power" || u.tier === "core").length;
  const powerPoint: PointLike = {
    state: data?.state ?? "not_measured",
    value: measured ? powerCount : null,
    reason: data?.reason ?? null,
  };

  return (
    <div className="mb-6 space-y-3">
      <SectionHeader title="Platform pulse" meta="last 24h · 7d · 30d" loading={isLoading} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatTile
          label="Daily active"
          sublabel="≥1 value event · 24h"
          point={data?.dau}
          loading={isLoading}
          format={fmtCompact}
          highlight
          series={activeSeries.length >= 2 ? activeSeries : undefined}
          delta={delta}
        />
        <StatTile label="Weekly active" sublabel="≥1 value event · 7d" point={data?.wau} loading={isLoading} format={fmtCompact} />
        <StatTile label="Monthly active" sublabel="≥1 value event · 30d" point={data?.mau} loading={isLoading} format={fmtCompact} />
        <StatTile label="Value events" sublabel="Qualifying · all time" point={data?.valueEventsTotal} loading={isLoading} format={fmtCompact} />
        <StatTile label="Total actions" sublabel="Curated · all time" point={data?.totalActions} loading={isLoading} format={fmtCompact} />
        <StatTile label="Power users" sublabel="Power + Core tier" point={powerPoint} loading={isLoading} format={fmtCompact} />
      </div>
    </div>
  );
}
