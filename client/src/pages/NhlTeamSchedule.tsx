/**
 * NhlTeamSchedule.tsx
 *
 * Full team schedule page for an NHL team.
 * Accessed via /nhl/team/:slug (where slug is the Action Network url_slug).
 *
 * Displays all games for the team with:
 *   - Date, opponent, home/away indicator
 *   - DK NJ Puck Line (spread + juice)
 *   - DK NJ Total (over/under + juice)
 *   - DK NJ Moneyline
 *   - Final score
 *   - Who won (W/L)
 *   - Whether team covered the puck line (COV / NO / —)
 *   - Total result (OVER / UNDER / PUSH / —)
 *
 * Data source: nhl_schedule_history table (Action Network DK NJ API)
 */

import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { NHL_BY_AN_SLUG } from "@shared/nhlTeams";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { ArrowLeft, RefreshCw, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleGame {
  id: number;
  anGameId: number;
  gameDate: string;
  startTimeUtc: string;
  gameStatus: string;
  awaySlug: string;
  awayAbbr: string;
  awayName: string;
  awayTeamId: number;
  awayScore: number | null;
  homeSlug: string;
  homeAbbr: string;
  homeName: string;
  homeTeamId: number;
  homeScore: number | null;
  dkAwayPuckLine: string | null;
  dkAwayPuckLineOdds: string | null;
  dkHomePuckLine: string | null;
  dkHomePuckLineOdds: string | null;
  dkTotal: string | null;
  dkOverOdds: string | null;
  dkUnderOdds: string | null;
  dkAwayML: string | null;
  dkHomeML: string | null;
  awayPuckLineCovered: boolean | null;
  homePuckLineCovered: boolean | null;
  totalResult: string | null;
  awayWon: boolean | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGameDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatStartTime(utcIso: string): string {
  const d = new Date(utcIso);
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtOdds(val: string | null | undefined): string {
  if (!val || val === "null" || val === "undefined") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtLine(val: string | null | undefined): string {
  if (!val || val === "null" || val === "undefined") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtTotal(val: string | null | undefined): string {
  if (!val || val === "null" || val === "undefined") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `${n}`;
}

// ─── Result Chip ──────────────────────────────────────────────────────────────

function ResultChip({ label, variant }: { label: string; variant: "win" | "loss" | "push" | "neutral" }) {
  const colors = {
    win:     "bg-emerald-600/20 text-emerald-400 border border-emerald-600/40",
    loss:    "bg-red-600/20 text-red-400 border border-red-600/40",
    push:    "bg-gray-600/20 text-zinc-200 border border-gray-600/40",
    neutral: "bg-white/5 text-zinc-300 border border-white/10",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold font-mono", colors[variant])}>
      {label}
    </span>
  );
}

// ─── Game Row ─────────────────────────────────────────────────────────────────

function GameRow({
  game,
  teamSlug,
}: {
  game: ScheduleGame;
  teamSlug: string;
}) {
  const isHome = game.homeSlug === teamSlug;
  const opponentSlug = isHome ? game.awaySlug : game.homeSlug;
  const opponentAbbr = isHome ? game.awayAbbr : game.homeAbbr;
  const opponentTeam = NHL_BY_AN_SLUG.get(opponentSlug);

  const teamScore    = isHome ? game.homeScore : game.awayScore;
  const oppScore     = isHome ? game.awayScore : game.homeScore;
  const isCompleted  = game.gameStatus === "complete" || game.gameStatus === "closed";
  const hasScore     = isCompleted && teamScore !== null && oppScore !== null;

  // Determine W/L
  const teamWon = isHome ? game.awayWon === false : game.awayWon === true;
  const resultLabel = !hasScore ? "—" : teamWon ? "W" : "L";
  const resultVariant: "win" | "loss" | "neutral" = !hasScore ? "neutral" : teamWon ? "win" : "loss";

  // Puck line coverage
  const puckLineCovered = isHome ? game.homePuckLineCovered : game.awayPuckLineCovered;
  const spreadLabel = puckLineCovered === null ? "—" : puckLineCovered ? "COV" : "NO";
  const spreadVariant: "win" | "loss" | "neutral" = puckLineCovered === null ? "neutral" : puckLineCovered ? "win" : "loss";

  // Total result
  const totalResult = game.totalResult ?? "—";
  const totalVariant: "win" | "loss" | "push" | "neutral" =
    totalResult === "OVER" ? "win" :
    totalResult === "UNDER" ? "loss" :
    totalResult === "PUSH" ? "push" : "neutral";

  // Team's puck line
  const teamPuckLine = isHome ? game.dkHomePuckLine : game.dkAwayPuckLine;
  const teamPuckLineOdds = isHome ? game.dkHomePuckLineOdds : game.dkAwayPuckLineOdds;
  const teamML = isHome ? game.dkHomeML : game.dkAwayML;

  const isUpcoming = !isCompleted;

  return (
    <tr className={cn(
      "border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors",
      isUpcoming && "opacity-70"
    )}>
      {/* Date */}
      <td className="px-3 py-2.5 text-sm text-zinc-200 font-mono whitespace-nowrap">
        <div>{formatGameDate(game.gameDate)}</div>
        {isUpcoming && (
          <div className="text-xs text-zinc-300">{formatStartTime(game.startTimeUtc)}</div>
        )}
      </td>

      {/* Opponent */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-300 font-mono w-4 flex-shrink-0">
            {isHome ? "vs" : "@"}
          </span>
          {opponentTeam?.logoUrl && (
            <img
              src={opponentTeam.logoUrl}
              alt={opponentAbbr}
              className="w-5 h-5 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-sm text-white font-mono font-bold">{opponentAbbr}</span>
        </div>
      </td>

      {/* Result */}
      <td className="px-3 py-2.5 text-center">
        {hasScore ? (
          <div className="flex flex-col items-center gap-0.5">
            <ResultChip label={resultLabel} variant={resultVariant} />
            <span className="text-xs text-zinc-300 font-mono">
              {teamScore}-{oppScore}
            </span>
          </div>
        ) : (
          <span className="text-xs text-zinc-300 font-mono">—</span>
        )}
      </td>

      {/* Puck Line */}
      <td className="px-3 py-2.5 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-sm text-gray-300 font-mono">
            {fmtLine(teamPuckLine)} <span className="text-zinc-300">{fmtOdds(teamPuckLineOdds)}</span>
          </span>
          {isCompleted && <ResultChip label={spreadLabel} variant={spreadVariant} />}
        </div>
      </td>

      {/* Total */}
      <td className="px-3 py-2.5 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-sm text-gray-300 font-mono">
            {fmtTotal(game.dkTotal)}
          </span>
          <span className="text-xs text-zinc-300 font-mono">
            {fmtOdds(game.dkOverOdds)} / {fmtOdds(game.dkUnderOdds)}
          </span>
          {isCompleted && totalResult !== "—" && (
            <ResultChip label={totalResult} variant={totalVariant} />
          )}
        </div>
      </td>

      {/* ML */}
      <td className="px-3 py-2.5 text-center">
        <span className="text-sm text-gray-300 font-mono">{fmtOdds(teamML)}</span>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NhlTeamSchedule() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();

  // Auth guard: unauthenticated users are redirected to the paywall landing page.
  const { appUser, loading: appAuthLoading } = useAppAuth();
  useEffect(() => {
    if (!appAuthLoading && !appUser) navigate("/");
  }, [appAuthLoading, appUser, navigate]);

  const team = NHL_BY_AN_SLUG.get(slug ?? "");

  const scheduleQuery = trpc.nhlSchedule.getTeamSchedule.useQuery(
    { teamSlug: slug ?? "" },
    { enabled: !!slug, staleTime: 5 * 60 * 1000, retry: 2 }
  );

  const games = (scheduleQuery.data?.games ?? []) as ScheduleGame[];
  const completedGames = games.filter(
    (g) => g.gameStatus === "complete" || g.gameStatus === "closed"
  );
  const upcomingGames = games.filter(
    (g) => g.gameStatus !== "complete" && g.gameStatus !== "closed"
  );

  // Season record
  const wins   = completedGames.filter((g) => {
    const isHome = g.homeSlug === slug;
    return isHome ? g.awayWon === false : g.awayWon === true;
  }).length;
  const losses = completedGames.length - wins;

  // ATS record (puck line)
  const atsWins = completedGames.filter((g) => {
    const isHome = g.homeSlug === slug;
    return isHome ? g.homePuckLineCovered === true : g.awayPuckLineCovered === true;
  }).length;
  const atsLosses = completedGames.filter((g) => {
    const isHome = g.homeSlug === slug;
    return isHome ? g.homePuckLineCovered === false : g.awayPuckLineCovered === false;
  }).length;

  // O/U record
  const overs  = completedGames.filter((g) => g.totalResult === "OVER").length;
  const unders = completedGames.filter((g) => g.totalResult === "UNDER").length;

  if (!slug) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-zinc-300 font-mono text-sm">Invalid team slug.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/[0.06] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="text-zinc-200 hover:text-white p-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          {team?.logoUrl && (
            <img
              src={team.logoUrl}
              alt={team.abbrev}
              className="w-8 h-8 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div>
            <h1 className="text-sm font-bold text-white font-mono">
              {team?.name ?? slug}
            </h1>
            <p className="text-xs text-zinc-300 font-mono">
              NHL · Full Schedule · DK NJ Odds
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {scheduleQuery.isLoading && (
              <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* ── Season Summary ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-white/[0.06] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-3 h-3 text-zinc-300" />
              <span className="text-xs text-zinc-300 font-mono uppercase tracking-widest">Record</span>
            </div>
            <p className="text-lg font-bold text-white font-mono">{wins}-{losses}</p>
            <p className="text-xs text-zinc-300 font-mono">{completedGames.length} games</p>
          </div>
          <div className="bg-card border border-white/[0.06] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Calendar className="w-3 h-3 text-zinc-300" />
              <span className="text-xs text-zinc-300 font-mono uppercase tracking-widest">Puck Line</span>
            </div>
            <p className="text-lg font-bold text-white font-mono">{atsWins}-{atsLosses}</p>
            <p className="text-xs text-zinc-300 font-mono">Puck line coverage</p>
          </div>
          <div className="bg-card border border-white/[0.06] rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Calendar className="w-3 h-3 text-zinc-300" />
              <span className="text-xs text-zinc-300 font-mono uppercase tracking-widest">O/U</span>
            </div>
            <p className="text-lg font-bold text-white font-mono">{overs}-{unders}</p>
            <p className="text-xs text-zinc-300 font-mono">Over-Under</p>
          </div>
        </div>

        {/* ── Schedule Table ─────────────────────────────────────────────────── */}
        {scheduleQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin mr-3" />
            <span className="text-zinc-300 font-mono text-sm">Loading schedule...</span>
          </div>
        ) : scheduleQuery.error ? (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4">
            <p className="text-red-400 font-mono text-sm">Error: {scheduleQuery.error.message}</p>
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-300 font-mono text-sm">No schedule data found for this team.</p>
            <p className="text-zinc-300 font-mono text-sm mt-1">
              Data will populate as games are played and stored from the DK NJ API.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-300 font-mono uppercase tracking-widest">
                Full Schedule — {games.length} games
              </span>
              <Badge variant="outline" className="text-[8px] font-mono text-blue-400 border-blue-600/40">
                DK NJ · AN API
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-3 py-2 text-left text-xs text-zinc-300 font-mono uppercase tracking-widest">Date</th>
                    <th className="px-3 py-2 text-left text-xs text-zinc-300 font-mono uppercase tracking-widest">Opponent</th>
                    <th className="px-3 py-2 text-center text-xs text-zinc-300 font-mono uppercase tracking-widest">Result</th>
                    <th className="px-3 py-2 text-center text-xs text-zinc-300 font-mono uppercase tracking-widest">Puck Line</th>
                    <th className="px-3 py-2 text-center text-xs text-zinc-300 font-mono uppercase tracking-widest">O/U</th>
                    <th className="px-3 py-2 text-center text-xs text-zinc-300 font-mono uppercase tracking-widest">ML</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Upcoming games first */}
                  {upcomingGames.map((g) => (
                    <GameRow key={g.id} game={g} teamSlug={slug ?? ""} />
                  ))}
                  {/* Completed games (most recent first) */}
                  {completedGames.map((g) => (
                    <GameRow key={g.id} game={g} teamSlug={slug ?? ""} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
