/**
 * DeviceActivityPanel — device-aware slice of the admin User Activity page,
 * fed by the dedicated MySQL: Dime AI via the owner-gated analytics.overview
 * proxy. Honest states (owner directive): renders "Not measured" with the exact
 * reason when the pipeline is disabled or no qualifying events exist yet — never
 * a fabricated 0. Ships inert: shows a clear "pipeline not enabled" state until
 * the Railway vars are set. Owner-only (the query is ownerProcedure).
 *
 * Design: Dime brand law — semantic tokens only, font-mono digits, one-accent
 * mint on the value/device-mix focal marks; mirrors MetricsPanel's treatment.
 */
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";

type PointLike = { state: string; value: number | null; reason: string | null };

const STATE_LABEL: Record<string, string> = {
  not_measured: "Not measured",
  incomplete: "Incomplete",
  stale: "Stale",
  unknown: "Unknown",
  error: "Unavailable",
};

const TIER_LABEL: Record<string, string> = {
  power: "Power",
  core: "Core",
  casual: "Casual",
  at_risk: "At-Risk",
  dormant: "Dormant",
};
const TIER_CLASS: Record<string, string> = {
  power: "text-primary",
  core: "text-primary",
  casual: "text-foreground",
  at_risk: "text-muted-foreground",
  dormant: "text-muted-foreground",
};
/** Compact relative age from a ms timestamp. */
function fmtAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Point({ point, loading }: { point: PointLike | undefined; loading: boolean }) {
  if (loading || !point) return <span className="text-muted-foreground">—</span>;
  if (point.state === "ok" && point.value !== null) {
    return <span className="text-primary">{point.value}</span>;
  }
  return (
    <span className="text-muted-foreground" title={point.reason ?? undefined}>
      {STATE_LABEL[point.state] ?? "—"}
    </span>
  );
}

export default function DeviceActivityPanel() {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const kpis: Array<{ label: string; sub: string; point: PointLike | undefined }> = [
    { label: "DAILY VALUE USERS", sub: "≥1 value event · last 24h", point: data?.dau },
    { label: "WEEKLY VALUE USERS", sub: "≥1 value event · last 7d", point: data?.wau },
    { label: "MONTHLY VALUE USERS", sub: "≥1 value event · last 30d", point: data?.mau },
    { label: "VALUE EVENTS", sub: "Qualifying events · all time", point: data?.valueEventsTotal },
  ];

  const notOk = !!data && data.state !== "ok";
  const mix = data?.deviceMix ?? [];
  const maxUsers = Math.max(...mix.map((m) => m.users), 1);
  const topActions = data?.topActions ?? [];
  const maxActionCount = Math.max(...topActions.map((a) => a.count), 1);
  const topUsers = data?.topUsers ?? [];

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-[0.15em] text-foreground uppercase">
          Device-Aware Activity
        </span>
        <div className="flex-1 h-px bg-card" />
        {isLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin" />}
      </div>

      {notOk && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-center">
          <div className="text-sm font-semibold text-muted-foreground">
            {STATE_LABEL[data!.state] ?? "Not measured"}
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ?? "The device-aware analytics pipeline has produced no data yet."}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden"
          >
            <div className="text-base sm:text-xl font-bold font-mono truncate">
              <Point point={k.point} loading={isLoading} />
            </div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">
              {k.label}
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Action volume — the D3 cut. Diagnostic (non-qualifying) counts of the
          curated action_performed events. Honest states via <Point/>. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden">
          <div className="text-base sm:text-xl font-bold font-mono truncate">
            <Point point={data?.totalActions} loading={isLoading} />
          </div>
          <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">
            TOTAL ACTIONS
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">
            Curated actions · all time
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0 overflow-hidden">
          <div className="text-base sm:text-xl font-bold font-mono truncate">
            <Point point={data?.uniqueActions} loading={isLoading} />
          </div>
          <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground mt-0.5 leading-tight">
            UNIQUE ACTIONS
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">
            Distinct action types
          </div>
        </div>
      </div>

      {/* Top actions — most-used curated actions. Renders only with measured data. */}
      {!notOk && topActions.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase mb-2">
            Top Actions · by volume
          </div>
          <div className="space-y-1.5">
            {topActions.map((a) => (
              <div key={a.name} className="flex items-center gap-2">
                <span className="text-[10px] sm:text-xs font-mono w-32 sm:w-40 shrink-0 text-foreground truncate">
                  {a.name}
                </span>
                <div className="flex-1 h-3 rounded bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded bg-primary transition-all duration-500"
                    style={{ width: `${Math.max((a.count / maxActionCount) * 100, a.count > 0 ? 4 : 0)}%` }}
                    title={`${a.name}: ${a.count} actions`}
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-mono w-8 text-right text-foreground">
                  {a.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device mix — the D2 cut, now with the D3 action column. Measured data only. */}
      {!notOk && mix.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase">
              Device Mix · distinct users
            </div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              users · actions
            </div>
          </div>
          <div className="space-y-1.5">
            {mix.map((m) => (
              <div key={m.deviceType} className="flex items-center gap-2">
                <span className="text-[10px] sm:text-xs font-mono w-16 shrink-0 text-foreground capitalize">
                  {m.deviceType}
                </span>
                <div className="flex-1 h-3 rounded bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded bg-primary transition-all duration-500"
                    style={{ width: `${Math.max((m.users / maxUsers) * 100, m.users > 0 ? 4 : 0)}%` }}
                    title={`${m.deviceType}: ${m.users} users, ${m.valueEvents} value events, ${m.actions} actions`}
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-mono w-8 text-right text-foreground">
                  {m.users}
                </span>
                <span className="text-[10px] sm:text-xs font-mono w-10 text-right text-muted-foreground">
                  {m.actions}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Power Users — P0 profiling. Ranked by power score; identity joined at
          read time (owner-only). Renders only with measured data. */}
      {!notOk && topUsers.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase">
              Power Users · by score
            </div>
            <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              tier · score · seen
            </div>
          </div>
          <div className="space-y-1">
            {topUsers.slice(0, 10).map((u, i) => (
              <div key={u.sourceUserId} className="flex items-center gap-2 sm:gap-2.5 py-0.5">
                <span className="text-[10px] sm:text-xs font-mono w-4 text-right text-muted-foreground shrink-0">
                  {i + 1}
                </span>
                <span className="text-[11px] sm:text-xs font-mono truncate flex-1 min-w-0 text-foreground">
                  {u.discordUsername || u.username || `user #${u.sourceUserId}`}
                </span>
                <span
                  className={`text-[9px] sm:text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-border shrink-0 ${TIER_CLASS[u.tier] ?? "text-muted-foreground"}`}
                >
                  {TIER_LABEL[u.tier] ?? u.tier}
                </span>
                <span className="text-[11px] sm:text-xs font-mono font-bold w-7 text-right text-primary shrink-0">
                  {u.score}
                </span>
                <span className="text-[10px] sm:text-xs font-mono w-10 text-right text-muted-foreground shrink-0">
                  {fmtAgo(u.lastActive)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
