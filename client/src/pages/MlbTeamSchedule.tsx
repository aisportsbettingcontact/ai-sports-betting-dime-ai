/**
 * MlbTeamSchedule.tsx — 2026 MLB Team Schedule Page
 *
 * Display changes (2026-04-11 rev-4):
 *   1. All W-L-P stat values are white font
 *   2. GAMES chip removed — user can infer from W-L
 *   3. Upcoming row renders in one line (time inline, no wrap)
 *   4. Count labels (1) / (13) removed from section headers
 *   5. Stats chips are larger and bolder for immediate readability
 *   6. O/U badge values: OVER→O, UNDER→U, PUSH→P
 *   7. Table: table-fixed, all columns centered, optimized colgroup widths
 *      — no horizontal scroll, fits every viewport
 *   8. Smart polling: 60s interval when in-progress games exist, disabled otherwise
 *   9. Stale-data indicator: shows "stale" badge when data > 5 min old
 *  10. Error state: retry button, never silent — always surfaces failure
 *  11. Dead isNeutralSite field removed (not in DB schema)
 *
 * Status partitioning:
 *   - "complete"   → Completed Games section
 *   - "scheduled" / "inprogress" → Upcoming / Live section
 *   - "postponed"  → HIDDEN (no score, no valid time, no result)
 *
 * Logging: [MlbTeamSchedule][TAG] structured console logs throughout.
 * Data source: mlb_schedule_history via Action Network DK NJ API
 * Season filter: 2026-03-26 → present (enforced in backend service)
 */

import React, { useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { ArrowLeft, RefreshCw, Calendar, TrendingUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleGame {
  id: number;
  anGameId: number;
  gameDate: string;         // "YYYY-MM-DD"
  startTimeUtc: string;    // ISO-8601 UTC
  gameStatus: string;      // "complete" | "scheduled" | "inprogress" | "postponed"
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
  dkAwayRunLine: string | null;
  dkAwayRunLineOdds: string | null;
  dkHomeRunLine: string | null;
  dkHomeRunLineOdds: string | null;
  dkTotal: string | null;
  dkOverOdds: string | null;
  dkUnderOdds: string | null;
  dkAwayML: string | null;
  dkHomeML: string | null;
  awayRunLineCovered: boolean | null;
  homeRunLineCovered: boolean | null;
  totalResult: string | null;   // "OVER" | "UNDER" | "PUSH" | null
  awayWon: boolean | null;
  lastRefreshedAt: number | null;
  // NOTE: isNeutralSite is NOT in the DB schema — field intentionally omitted
}

// ─── Status constants ─────────────────────────────────────────────────────────

const STATUS_COMPLETE  = "complete";
const STATUS_POSTPONED = "postponed";

const isCompleteGame = (g: ScheduleGame) => g.gameStatus === STATUS_COMPLETE;
const isUpcomingGame = (g: ScheduleGame) =>
  g.gameStatus !== STATUS_COMPLETE && g.gameStatus !== STATUS_POSTPONED;

// ─── Date formatter: MM/DD, single-digit month ────────────────────────────────
// 2026-03-31 → "3/31"  |  2026-10-04 → "10/4"
function fmtDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

// ─── Start time formatter (ET, inline) ───────────────────────────────────────
// Returns "2:20 PM ET" — single line, no wrapping
function fmtTime(utcIso: string): string {
  const d = new Date(utcIso);
  return (
    d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET"
  );
}

// ─── Run line formatter ───────────────────────────────────────────────────────
// "+1.5 (-194)" | "-1.5 (+153)" | "—"
function fmtRunLine(value: string | null, odds: string | null): string {
  if (!value) return "—";
  const v = parseFloat(value);
  const sign = v >= 0 ? "+" : "";
  const line = `${sign}${v}`;
  return odds ? `${line} (${odds})` : line;
}

// ─── Total formatter ──────────────────────────────────────────────────────────
// "8.5 (-115/-105)" | "—"
function fmtTotal(
  total: string | null,
  overOdds: string | null,
  underOdds: string | null
): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (!overOdds && !underOdds) return String(t);
  return `${t} (${overOdds ?? "—"}/${underOdds ?? "—"})`;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = "win" | "loss" | "push" | "neutral";

const BADGE_CLS: Record<BadgeVariant, string> = {
  win:     "bg-black text-[#45E0A8] border-[#45E0A8]",
  loss:    "bg-black text-white border-white",
  push:    "bg-black text-white border-white",
  neutral: "bg-black text-white border-white",
};

function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-mono font-bold",
        "tracking-wide whitespace-nowrap",
        "text-[8px] sm:text-xs px-[3px] sm:px-1 py-[1px]",
        BADGE_CLS[variant]
      )}
    >
      {label}
    </span>
  );
}

// ─── Schedule Row ─────────────────────────────────────────────────────────────

function ScheduleRow({
  game,
  teamSlug,
  isUpcoming,
}: {
  game: ScheduleGame;
  teamSlug: string;
  isUpcoming: boolean;
}) {
  // ── Perspective ────────────────────────────────────────────────────────────
  const isAway = game.awaySlug === teamSlug;

  // ── Opponent ───────────────────────────────────────────────────────────────
  const oppSlug   = isAway ? game.homeSlug   : game.awaySlug;
  const oppTeamId = isAway ? game.homeTeamId : game.awayTeamId;
  const oppAbbr   = isAway ? game.homeAbbr   : game.awayAbbr;
  const oppTeam   = MLB_BY_AN_SLUG.get(oppSlug);
  const oppLogo   = oppTeam?.logoUrl ?? `https://www.mlbstatic.com/team-logos/${oppTeamId}.svg`;

  // ── Scores ─────────────────────────────────────────────────────────────────
  const myScore  = isAway ? game.awayScore : game.homeScore;
  const oppScore = isAway ? game.homeScore : game.awayScore;

  // ── Odds ───────────────────────────────────────────────────────────────────
  const myRunLine     = isAway ? game.dkAwayRunLine     : game.dkHomeRunLine;
  const myRunLineOdds = isAway ? game.dkAwayRunLineOdds : game.dkHomeRunLineOdds;
  const myML          = isAway ? game.dkAwayML          : game.dkHomeML;
  const myCovered     = isAway ? game.awayRunLineCovered : game.homeRunLineCovered;

  // ── W/L ────────────────────────────────────────────────────────────────────
  const myWon = game.awayWon != null
    ? (isAway ? game.awayWon : !game.awayWon)
    : null;

  // ── Location ───────────────────────────────────────────────────────────────
  // NOTE: isNeutralSite not in DB schema — future: add neutral_site column when AN API provides it
  const location  = isAway ? "Away" : "Home";
  const locStyle  = isAway ? "bg-black text-white" : "bg-black text-white";

  // ── Score / Time ───────────────────────────────────────────────────────────
  const isComplete  = game.gameStatus === STATUS_COMPLETE;
  const isScheduled = game.gameStatus === "scheduled";

  const scoreDisplay =
    isComplete && myScore != null && oppScore != null
      ? `${myScore}–${oppScore}`
      : isScheduled
      ? fmtTime(game.startTimeUtc)
      : "Live";

  // ── W/L badge ─────────────────────────────────────────────────────────────
  const wlVariant: BadgeVariant = myWon === true ? "win" : myWon === false ? "loss" : "neutral";
  const wlLabel = myWon === true ? "W" : myWon === false ? "L" : "—";

  // ── COVER badge: Y | N | — ────────────────────────────────────────────────
  const covVariant: BadgeVariant =
    myCovered === true ? "win" : myCovered === false ? "loss" : "neutral";
  const covLabel = myCovered === true ? "Y" : myCovered === false ? "N" : "—";

  // ── O/U badge: O | U | P | — ─────────────────────────────────────────────
  // OVER→O, UNDER→U, PUSH→P (single character saves column space)
  const ouVariant: BadgeVariant =
    game.totalResult === "OVER"  ? "win"
    : game.totalResult === "UNDER" ? "loss"
    : game.totalResult === "PUSH"  ? "push"
    : "neutral";
  const ouLabel =
    game.totalResult === "OVER"  ? "O"
    : game.totalResult === "UNDER" ? "U"
    : game.totalResult === "PUSH"  ? "P"
    : "—";

  // ── Cell classes ───────────────────────────────────────────────────────────
  const cell = "px-[2px] sm:px-1 py-1.5 align-middle";
  const mono = "font-mono text-[8px] sm:text-xs";
  const dash = <span className={cn(mono, "text-white")}>—</span>;

  return (
    <tr className="border-b border-white transition-colors">

      {/* DATE */}
      <td className={cn(cell, mono, "text-white text-center whitespace-nowrap")}>
        {fmtDate(game.gameDate)}
      </td>

      {/* LOCATION */}
      <td className={cn(cell, "text-center")}>
        <span className={cn(
          "inline-block rounded font-mono font-bold whitespace-nowrap",
          "text-[7px] sm:text-[8px] px-[2px] sm:px-1 py-[1px]",
          locStyle
        )}>
          {location}
        </span>
      </td>

      {/* OPP — logo only */}
      <td className={cn(cell, "text-center")}>
        <img
          src={oppLogo}
          alt={oppAbbr}
          className="w-5 h-5 sm:w-6 sm:h-6 object-contain mx-auto"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </td>

      {/* SCORE / TIME — single line, no wrap */}
      <td className={cn(cell, "text-center")}>
        <span className={cn(
          mono, "font-bold whitespace-nowrap",
          isComplete
            ? myWon ? "text-[#45E0A8]" : "text-white"
            : "text-white"
        )}>
          {scoreDisplay}
        </span>
      </td>

      {/* W/L */}
      <td className={cn(cell, "text-center")}>
        {isUpcoming ? dash : <Badge label={wlLabel} variant={wlVariant} />}
      </td>

      {/* RUN LINE */}
      <td className={cn(cell, "text-center")}>
        <span className={cn(mono, "text-white whitespace-nowrap")}>
          {fmtRunLine(myRunLine, myRunLineOdds)}
        </span>
      </td>

      {/* COVER */}
      <td className={cn(cell, "text-center")}>
        {isUpcoming ? dash : <Badge label={covLabel} variant={covVariant} />}
      </td>

      {/* TOTAL */}
      <td className={cn(cell, "text-center")}>
        <span className={cn(mono, "text-white whitespace-nowrap")}>
          {fmtTotal(game.dkTotal, game.dkOverOdds, game.dkUnderOdds)}
        </span>
      </td>

      {/* O/U — single char: O | U | P */}
      <td className={cn(cell, "text-center")}>
        {isUpcoming ? dash : <Badge label={ouLabel} variant={ouVariant} />}
      </td>

      {/* ML — always white */}
      <td className={cn(cell, "text-center")}>
        <span className={cn(mono, "font-bold text-white whitespace-nowrap")}>
          {myML ?? "—"}
        </span>
      </td>

    </tr>
  );
}

// ─── Stats Summary ────────────────────────────────────────────────────────────
// Three chips: RECORD · RL COVER · O/U
// All number values are white.
// GAMES chip removed — user can infer from W-L.

function StatsSummary({
  games,
  teamSlug,
}: {
  games: ScheduleGame[];
  teamSlug: string;
}) {
  const completed = games.filter(isCompleteGame);
  if (!completed.length) return null;

  // W/L
  const wins = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    return ia ? g.awayWon === true : g.awayWon === false;
  }).length;
  const losses = completed.length - wins;

  // RL Cover — MLB standard 1.5 run line NEVER pushes (binary W/N only).
  // covered = games where team explicitly covered (true).
  // notCovered = all other completed games with a line (false or null-no-line).
  // null means no line was available — excluded from both counts for accuracy.
  const covered = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    return ia ? g.awayRunLineCovered === true : g.homeRunLineCovered === true;
  }).length;
  const notCovered = completed.filter((g) => {
    const ia = g.awaySlug === teamSlug;
    // Only count explicit false (did not cover) — null means no line, excluded
    return ia ? g.awayRunLineCovered === false : g.homeRunLineCovered === false;
  }).length;

  // O/U
  const overs  = completed.filter((g) => g.totalResult === "OVER").length;
  const unders = completed.filter((g) => g.totalResult === "UNDER").length;
  const ouPush = completed.filter((g) => g.totalResult === "PUSH").length;

  console.log(
    `[MlbTeamSchedule][StatsSummary] [OUTPUT]` +
    ` team="${teamSlug}"` +
    ` | record=${wins}-${losses}` +
    ` | rlCover=${covered}-${notCovered}` +
    ` | ou=${overs}-${unders}-${ouPush}` +
    ` | completedGames=${completed.length}`
  );

  return (
    // Three chips, single row, no scroll — flex-nowrap, chips shrink if needed
    <div className="flex items-stretch gap-2 sm:gap-3 mb-4 sm:mb-5">

      {/* RECORD */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black rounded-xl px-3 py-2.5 sm:py-3 min-w-0">
        <span className="text-[8px] sm:text-xs text-white font-mono tracking-widest mb-1">
          RECORD
        </span>
        <span className="font-mono text-sm sm:text-base font-bold text-white leading-none">
          {wins}–{losses}
        </span>
      </div>

      {/* RL COVER */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black rounded-xl px-3 py-2.5 sm:py-3 min-w-0">
        <span className="text-[8px] sm:text-xs text-white font-mono tracking-widest mb-1">
          RL COVER
        </span>
        <span className="font-mono text-sm sm:text-base font-bold text-white leading-none">
          {covered}–{notCovered}
        </span>
      </div>

      {/* O/U */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black rounded-xl px-3 py-2.5 sm:py-3 min-w-0">
        <span className="text-[8px] sm:text-xs text-white font-mono tracking-widest mb-1">
          O/U
        </span>
        <span className="font-mono text-sm sm:text-base font-bold text-white leading-none">
          {overs}–{unders}{ouPush > 0 ? `–${ouPush}` : ""}
        </span>
      </div>

    </div>
  );
}

// ─── Schedule Table ───────────────────────────────────────────────────────────
// table-fixed + colgroup percentages = no horizontal scroll on any viewport.
// All columns centered. Header and value cells vertically aligned to middle.

function ScheduleTable({
  games,
  teamSlug,
  isUpcoming,
}: {
  games: ScheduleGame[];
  teamSlug: string;
  isUpcoming: boolean;
}) {
  const th = cn(
    "px-[2px] sm:px-1 py-1.5 text-[7px] sm:text-[8px] font-bold",
    "text-white font-mono tracking-widest text-center whitespace-nowrap align-middle"
  );

  return (
    <div className="rounded-lg border border-white w-full overflow-hidden">
      <table className="w-full table-fixed text-left border-collapse">
        <colgroup>
          {/* DATE     */} <col style={{ width: "8%" }} />
          {/* LOCATION */} <col style={{ width: "12%" }} />
          {/* OPP      */} <col style={{ width: "7%" }} />
          {/* SCORE    */} <col style={{ width: "10%" }} />
          {/* W/L      */} <col style={{ width: "5%" }} />
          {/* RUN LINE */} <col style={{ width: "18%" }} />
          {/* COVER    */} <col style={{ width: "7%" }} />
          {/* TOTAL    */} <col style={{ width: "20%" }} />
          {/* O/U      */} <col style={{ width: "5%" }} />
          {/* ML       */} <col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-white bg-black">
            <th className={th}>DATE</th>
            <th className={th}>LOCATION</th>
            <th className={th}>OPP</th>
            <th className={th}>{isUpcoming ? "TIME" : "SCORE"}</th>
            <th className={th}>W/L</th>
            <th className={th}>RUN LINE</th>
            <th className={th}>COVER</th>
            <th className={th}>TOTAL</th>
            <th className={th}>O/U</th>
            <th className={th}>ML</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <ScheduleRow
              key={game.anGameId}
              game={game}
              teamSlug={teamSlug}
              isUpcoming={isUpcoming}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MlbTeamSchedule() {
  const params = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const teamSlug = params.slug ?? "";

  // Auth guard: unauthenticated users are redirected to the paywall landing page.
  const { appUser, loading: appAuthLoading } = useAppAuth();
  useEffect(() => {
    if (!appAuthLoading && !appUser) navigate("/");
  }, [appAuthLoading, appUser, navigate]);

  const teamInfo = MLB_BY_AN_SLUG.get(teamSlug);

  // ── Smart polling strategy ───────────────────────────────────────────────────
  // - refetchInterval: 60s when ANY game is in-progress (live game window)
  // - refetchInterval: false when all games are complete or scheduled (no live games)
  // - staleTime: 90s — prevents redundant fetches on tab focus
  // - retry: 3 attempts with exponential backoff before surfacing error
  // - onError: NEVER silent — always logged to console with full context
  // SECURITY: only fire when appUser is confirmed — prevents unauthenticated API calls
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } =
    trpc.mlbSchedule.getTeamSchedule.useQuery(
      { teamSlug },
      {
        enabled: !!teamSlug && !appAuthLoading && Boolean(appUser),
        staleTime: 90 * 1000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
        refetchInterval: (query) => {
          const games = (query.state.data?.games ?? []) as ScheduleGame[];
          const hasLive = games.some((g) => g.gameStatus === "inprogress");
          if (hasLive) {
            console.log(
              `[MlbTeamSchedule][POLL] In-progress game detected — polling every 60s` +
              ` | team="${teamSlug}" liveGames=${games.filter((g) => g.gameStatus === "inprogress").length}`
            );
            return 60_000;
          }
          return false; // No live games — stop polling
        },
      }
    );

  const games = (data?.games ?? []) as ScheduleGame[];

  // ── Stale-data detection ─────────────────────────────────────────────────────
  // Show a stale indicator if data is > 5 minutes old and there are upcoming/live games.
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const isStale = dataUpdatedAt > 0 && (Date.now() - dataUpdatedAt) > STALE_THRESHOLD_MS;

  // ── Error logging — never silent ─────────────────────────────────────────────
  const errorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error) {
      const msg = error.message ?? String(error);
      if (errorRef.current !== msg) {
        errorRef.current = msg;
        console.error(
          `[MlbTeamSchedule][ERROR] getTeamSchedule FAILED` +
          ` | team="${teamSlug}"` +
          ` | message="${msg}"` +
          ` | timestamp=${new Date().toISOString()}`
        );
      }
    } else {
      errorRef.current = null;
    }
  }, [error, teamSlug]);

  // ── Status partitioning ──────────────────────────────────────────────────────
  // CRITICAL: postponed games hidden from both sections — no score, no time, no result.
  const completedGames  = games.filter(isCompleteGame);
  const upcomingGames   = games.filter(isUpcomingGame);
  const inProgressGames = games.filter((g) => g.gameStatus === "inprogress");
  const postponedCount  = games.filter((g) => g.gameStatus === STATUS_POSTPONED).length;

  console.log(
    `[MlbTeamSchedule] [STATE] team="${teamSlug}"` +
    ` | total=${games.length}` +
    ` | complete=${completedGames.length}` +
    ` | upcoming=${upcomingGames.length}` +
    ` | inprogress=${inProgressGames.length}` +
    ` | postponed=${postponedCount} (hidden)` +
    ` | polling=${inProgressGames.length > 0 ? "60s" : "off"}` +
    ` | stale=${isStale}` +
    ` | dataAge=${dataUpdatedAt > 0 ? Math.round((Date.now() - dataUpdatedAt) / 1000) + "s" : "no-data"}`
  );

  if (!teamSlug) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center">
        <p className="text-white font-mono text-sm">No team specified.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#000000] text-white">

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#000000] backdrop-blur-sm border-b border-white">
        <div className="w-full px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2">

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/feed/model/mlb")}
            className="text-white hover:text-white gap-1 -ml-1 px-2 flex-shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-sm font-mono">BACK</span>
          </Button>

          {teamInfo && (
            <img
              src={teamInfo.logoUrl}
              alt={teamInfo.abbrev}
              className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}

          <div className="flex-1 min-w-0">
            <h1 className="text-sm sm:text-sm font-bold text-white font-mono tracking-wide truncate leading-tight">
              {teamInfo?.name ?? teamSlug.replace(/-/g, " ").toUpperCase()}
            </h1>
            <p className="text-[8px] sm:text-sm text-white font-mono leading-tight">
              2026 MLB SCHEDULE
            </p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Stale indicator — shown when data > 5 min old and page has live/upcoming games */}
            {isStale && !isFetching && upcomingGames.length > 0 && (
              <span className="text-[7px] font-mono text-white bg-black border border-white rounded px-1 py-0.5">
                STALE
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                console.log(`[MlbTeamSchedule][STEP] Manual refresh triggered | team="${teamSlug}"`);
                refetch();
              }}
              disabled={isFetching}
              className="text-white hover:text-white px-2"
            >
              <RefreshCw className={cn("w-3 h-3 sm:w-3.5 sm:h-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="w-full px-2 sm:px-4 py-3 sm:py-5">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <RefreshCw className="w-5 h-5 text-white animate-spin mx-auto mb-3" />
              <p className="text-white font-mono text-xs">Loading schedule...</p>
            </div>
          </div>
        )}

        {/* Error — never silent: shows message + retry button */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-red-400 font-mono text-sm font-bold mb-1">
                SCHEDULE LOAD FAILED
              </p>
              <p className="text-red-300/70 font-mono text-xs break-all mb-2">
                {error.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  console.log(`[MlbTeamSchedule][STEP] Manual retry triggered | team="${teamSlug}"`);
                  refetch();
                }}
                disabled={isFetching}
                className="text-xs font-mono h-6 px-2 border-red-500/40 text-red-400 hover:text-white"
              >
                <RefreshCw className={cn("w-3 h-3 mr-1", isFetching && "animate-spin")} />
                RETRY
              </Button>
            </div>
          </div>
        )}

        {/* No data */}
        {!isLoading && !error && games.length === 0 && (
          <div className="text-center py-16">
            <Calendar className="w-7 h-7 text-white mx-auto mb-3" />
            <p className="text-white font-mono text-xs">No 2026 schedule data available.</p>
            <p className="text-white font-mono text-sm mt-1">
              Run a backfill from the admin panel to populate data.
            </p>
          </div>
        )}

        {/* Stats summary — 3 chips, all white values */}
        {!isLoading && completedGames.length > 0 && (
          <StatsSummary games={games} teamSlug={teamSlug} />
        )}

        {/* Upcoming / Live — no count label */}
        {!isLoading && upcomingGames.length > 0 && (
          <div className="mb-4 sm:mb-5">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-white flex-shrink-0" />
              <h2 className="text-xs sm:text-sm font-bold text-white font-mono tracking-widest uppercase">
                Upcoming / Live
              </h2>
            </div>
            <ScheduleTable
              games={upcomingGames}
              teamSlug={teamSlug}
              isUpcoming={true}
            />
          </div>
        )}

        {/* Completed Games — no count label */}
        {!isLoading && completedGames.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar className="w-3.5 h-3.5 text-white flex-shrink-0" />
              <h2 className="text-xs sm:text-sm font-bold text-white font-mono tracking-widest uppercase">
                Completed Games
              </h2>
            </div>
            <ScheduleTable
              games={completedGames}
              teamSlug={teamSlug}
              isUpcoming={false}
            />
          </div>
        )}

      </div>
    </div>
  );
}
