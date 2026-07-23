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

      {/* Device mix — the D2 cut. Renders only when there is measured data. */}
      {!notOk && mix.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3">
          <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase mb-2">
            Device Mix · distinct users
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
                    title={`${m.deviceType}: ${m.users} users, ${m.valueEvents} value events`}
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-mono w-8 text-right text-foreground">
                  {m.users}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
