/**
 * AdminModelStatus.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner-only admin page showing real-time MLB and NHL model pipeline health.
 *
 * Displays per-game status for today + tomorrow:
 *   - Matchup, game date, game status
 *   - Pitchers / Goalies (with confirmation status)
 *   - Model scores and projected lines
 *   - Modeled (green/red) and Published (green/red) indicators
 *   - modelRunAt timestamp
 *
 * Auto-refreshes every 30 seconds.
 * Route: /admin/model-status
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Numeric DB columns (DECIMAL/odds) can arrive as strings over the wire
// (mysql2 returns DECIMAL as a string), so coerce defensively before any
// numeric formatting — a raw string.toFixed() is what crashed this page.
function fmtOdds(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtScore(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function fmtTs(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  }) + " ET";
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? "border-primary text-primary bg-transparent font-mono text-xs"
          : "border-border text-foreground bg-transparent font-mono text-xs"
      }
    >
      {ok ? "✓" : "✗"} {label}
    </Badge>
  );
}

// ─── MLB Table ───────────────────────────────────────────────────────────────

function MlbStatusTable({ games, dates }: { games: any[]; dates: string[] }) {
  if (games.length === 0) {
    return (
      <div className="text-center text-foreground py-8 text-sm">
        No MLB games found for {dates.join(", ")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-border text-foreground text-left">
            <th className="py-2 px-3 whitespace-nowrap">Date</th>
            <th className="py-2 px-3 whitespace-nowrap">Matchup</th>
            <th className="py-2 px-3 whitespace-nowrap">Away SP</th>
            <th className="py-2 px-3 whitespace-nowrap">Home SP</th>
            <th className="py-2 px-3 whitespace-nowrap">Lineup</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Away</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Home</th>
            <th className="py-2 px-3 whitespace-nowrap">Model ML</th>
            <th className="py-2 px-3 whitespace-nowrap">Model Total</th>
            <th className="py-2 px-3 whitespace-nowrap">Modeled At</th>
            <th className="py-2 px-3 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g: any) => {
            const lu = g.lineup;
            const awayConf = lu?.awayLineupConfirmed;
            const homeConf = lu?.homeLineupConfirmed;
            const lineupStatus =
              awayConf && homeConf
                ? "CONFIRMED"
                : awayConf || homeConf
                ? "PARTIAL"
                : lu
                ? "EXPECTED"
                : "NONE";
            const lineupColor =
              lineupStatus === "CONFIRMED"
                ? "text-primary"
                : lineupStatus === "PARTIAL"
                ? "text-foreground"
                : lineupStatus === "EXPECTED"
                ? "text-foreground"
                : "text-foreground";

            return (
              <tr
                key={g.id}
                className="border-b border-border transition-colors"
              >
                <td className="py-2 px-3 text-foreground whitespace-nowrap">{g.gameDate}</td>
                <td className="py-2 px-3 text-foreground font-semibold whitespace-nowrap">
                  {g.awayTeam} @ {g.homeTeam}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap max-w-[120px] truncate">
                  {lu?.awayPitcherName ?? g.awayStartingPitcher ?? "—"}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap max-w-[120px] truncate">
                  {lu?.homePitcherName ?? g.homeStartingPitcher ?? "—"}
                </td>
                <td className={`py-2 px-3 whitespace-nowrap font-semibold ${lineupColor}`}>
                  {lineupStatus}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap">
                  {fmtScore(g.modelAwayScore)}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap">
                  {fmtScore(g.modelHomeScore)}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap">
                  {fmtOdds(g.modelAwayML)} / {fmtOdds(g.modelHomeML)}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap">
                  {g.modelTotal != null ? `O/U ${g.modelTotal}` : "—"}
                </td>
                <td className="py-2 px-3 text-foreground whitespace-nowrap">
                  {fmtTs(g.modelRunAt)}
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <div className="flex gap-1 flex-wrap">
                    <StatusBadge ok={g.modeled} label="MODELED" />
                    <StatusBadge ok={g.published} label="PUBLISHED" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── NHL Table ───────────────────────────────────────────────────────────────

function NhlStatusTable({ games, dates }: { games: any[]; dates: string[] }) {
  if (games.length === 0) {
    return (
      <div className="text-center text-foreground py-8 text-sm">
        No NHL games found for {dates.join(", ")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-border text-foreground text-left">
            <th className="py-2 px-3 whitespace-nowrap">Date</th>
            <th className="py-2 px-3 whitespace-nowrap">Matchup</th>
            <th className="py-2 px-3 whitespace-nowrap">Away Goalie</th>
            <th className="py-2 px-3 whitespace-nowrap">Home Goalie</th>
            <th className="py-2 px-3 whitespace-nowrap">Goalies</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Away</th>
            <th className="py-2 px-3 whitespace-nowrap">Proj Home</th>
            <th className="py-2 px-3 whitespace-nowrap">Model ML</th>
            <th className="py-2 px-3 whitespace-nowrap">Model Total</th>
            <th className="py-2 px-3 whitespace-nowrap">Modeled At</th>
            <th className="py-2 px-3 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g: any) => (
            <tr
              key={g.id}
              className="border-b border-border transition-colors"
            >
              <td className="py-2 px-3 text-foreground whitespace-nowrap">{g.gameDate}</td>
              <td className="py-2 px-3 text-foreground font-semibold whitespace-nowrap">
                {g.awayTeam} @ {g.homeTeam}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap max-w-[120px] truncate">
                {g.awayGoalie ?? "—"}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap max-w-[120px] truncate">
                {g.homeGoalie ?? "—"}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                <StatusBadge ok={g.bothGoalies} label={g.bothGoalies ? "BOTH" : "MISSING"} />
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap">
                {fmtScore(g.modelAwayScore)}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap">
                {fmtScore(g.modelHomeScore)}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap">
                {fmtOdds(g.modelAwayML)} / {fmtOdds(g.modelHomeML)}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap">
                {g.modelTotal != null ? `O/U ${g.modelTotal}` : "—"}
              </td>
              <td className="py-2 px-3 text-foreground whitespace-nowrap">
                {fmtTs(g.modelRunAt)}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                <div className="flex gap-1 flex-wrap">
                  <StatusBadge ok={g.modeled} label="MODELED" />
                  <StatusBadge ok={g.published} label="PUBLISHED" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Summary Bar ─────────────────────────────────────────────────────────────

function SummaryBar({
  total,
  modeled,
  unmodeled,
  sport,
}: {
  total: number;
  modeled: number;
  unmodeled: number;
  sport: string;
}) {
  const pct = total > 0 ? Math.round((modeled / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4 text-sm mb-3">
      <span className="text-foreground font-mono">
        {sport}: {total} games
      </span>
      <span className="text-primary font-mono font-semibold">
        ✓ {modeled} modeled
      </span>
      {unmodeled > 0 && (
        <span className="text-foreground font-mono font-semibold">
          ✗ {unmodeled} unmodeled
        </span>
      )}
      <div className="flex-1 max-w-[200px] h-2 bg-background rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-foreground font-mono text-xs">{pct}%</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminModelStatus() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading, isOwner } = useAppAuth();
  const [tab, setTab] = useState<"mlb" | "nhl">("mlb");
  const [refreshKey, setRefreshKey] = useState(0);

  // ── All hooks MUST be called unconditionally before any conditional returns ──
  // Calling hooks after a conditional return violates Rules of Hooks and causes
  // a React crash. Auth guard redirect is moved to useEffect.
  const mlbQuery = trpc.adminModelStatus.mlb.useQuery(
    {},
    {
      refetchInterval: 30_000,
      staleTime: 15_000,
      enabled: !authLoading && !!appUser && isOwner,
    }
  );

  const nhlQuery = trpc.adminModelStatus.nhl.useQuery(
    {},
    {
      refetchInterval: 30_000,
      staleTime: 15_000,
      enabled: !authLoading && !!appUser && isOwner,
    }
  );

  // ── Owner-only auth guard — MUST be useEffect, never render body ────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      console.warn(`[AdminModelStatus] Unauthorized: user=${appUser?.username ?? "unauthenticated"} isOwner=${isOwner} → redirecting to /`);
      navigate("/");
    }
  }, [authLoading, appUser, isOwner, navigate]);

  // Show loading/redirecting skeleton
  if (authLoading || (!authLoading && (!appUser || !isOwner))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-border border-t-border rounded-full animate-spin" />
        <span className="text-foreground text-sm">{authLoading ? "Verifying access..." : "Redirecting..."}</span>
      </div>
    );
  }

  const handleRefresh = () => {
    mlbQuery.refetch();
    nhlQuery.refetch();
    setRefreshKey((k) => k + 1);
  };

  const mlbData = mlbQuery.data;
  const nhlData = nhlQuery.data;
  const lastUpdated = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <AdminShell active="model-status">
    <div className="bg-background text-foreground p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Model Pipeline Status
          </h1>
          <p className="text-foreground text-sm mt-1">
            Today + Tomorrow · Auto-refreshes every 30s · Last updated: {lastUpdated} ET
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="border-border text-foreground font-mono text-xs"
        >
          ↻ Refresh Now
        </Button>
      </div>

      {/* Summary bars */}
      <div className="mb-4 space-y-1">
        {mlbData && (
          <SummaryBar
            sport="MLB"
            total={mlbData.total}
            modeled={mlbData.modeled}
            unmodeled={mlbData.unmodeled}
          />
        )}
        {nhlData && (
          <SummaryBar
            sport="NHL"
            total={nhlData.total}
            modeled={nhlData.modeled}
            unmodeled={nhlData.unmodeled}
          />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "mlb" | "nhl")}>
        <TabsList className="bg-background border border-border mb-4">
          <TabsTrigger
            value="mlb"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-foreground font-mono text-xs"
          >
            MLB{" "}
            {mlbData && (
              <span
                className={`ml-2 font-semibold ${
                  mlbData.unmodeled > 0 ? "text-foreground" : "text-primary"
                }`}
              >
                {mlbData.modeled}/{mlbData.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="nhl"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-foreground font-mono text-xs"
          >
            NHL{" "}
            {nhlData && (
              <span
                className={`ml-2 font-semibold ${
                  nhlData.unmodeled > 0 ? "text-foreground" : "text-primary"
                }`}
              >
                {nhlData.modeled}/{nhlData.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mlb">
          <Card className="bg-background border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono text-foreground">
                MLB Games — Today + Tomorrow
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {mlbQuery.isLoading ? (
                <div className="text-center text-foreground py-8 text-sm font-mono">
                  Loading MLB pipeline status…
                </div>
              ) : mlbQuery.isError ? (
                <div className="text-center text-foreground py-8 text-sm font-mono">
                  Error loading MLB status: {mlbQuery.error?.message}
                </div>
              ) : (
                <MlbStatusTable
                  games={(mlbData?.games ?? []) as any[]}
                  dates={mlbData?.dates ?? []}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nhl">
          <Card className="bg-background border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono text-foreground">
                NHL Games — Today + Tomorrow
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {nhlQuery.isLoading ? (
                <div className="text-center text-foreground py-8 text-sm font-mono">
                  Loading NHL pipeline status…
                </div>
              ) : nhlQuery.isError ? (
                <div className="text-center text-foreground py-8 text-sm font-mono">
                  Error loading NHL status: {nhlQuery.error?.message}
                </div>
              ) : (
                <NhlStatusTable
                  games={(nhlData?.games ?? []) as any[]}
                  dates={nhlData?.dates ?? []}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </AdminShell>
  );
}
