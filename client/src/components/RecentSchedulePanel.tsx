/**
 * RecentSchedulePanel.tsx
 *
 * Unified "Recent Schedule" panel for MLB, NBA, and NHL matchup cards.
 * Matches the Action Network reference design:
 *   - Team tab selector: [AWAY] [Head-to-Head] [HOME]
 *   - Game rows: DATE | H/A | OPP logo+abbr | RESULT | ATS | O/U
 *   - Clicking team logo navigates to the full team schedule page
 *
 * Data source: DraftKings NJ via Action Network API (book_id=68)
 *   MLB  → trpc.mlbSchedule.getLast5ForMatchup
 *   NBA  → trpc.nbaSchedule.getLast5ForMatchup
 *   NHL  → trpc.nhlSchedule.getLast5ForMatchup
 *
 * Logging: [RecentSchedulePanel][STEP] fully traceable
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { NBA_BY_AN_SLUG } from "@shared/nbaTeams";
import { NHL_BY_AN_SLUG } from "@shared/nhlTeams";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sport = "MLB" | "NBA" | "NHL";
type TabView = "away" | "h2h" | "home";

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
  // MLB-specific
  dkAwayRunLine?: string | null;
  dkAwayRunLineOdds?: string | null;
  dkHomeRunLine?: string | null;
  dkHomeRunLineOdds?: string | null;
  // NBA-specific
  dkAwaySpread?: string | null;
  dkAwaySpreadOdds?: string | null;
  dkHomeSpread?: string | null;
  dkHomeSpreadOdds?: string | null;
  // NHL-specific
  dkAwayPuckLine?: string | null;
  dkAwayPuckLineOdds?: string | null;
  dkHomePuckLine?: string | null;
  dkHomePuckLineOdds?: string | null;
  // Shared
  dkTotal: string | null;
  dkOverOdds: string | null;
  dkUnderOdds: string | null;
  dkAwayML: string | null;
  dkHomeML: string | null;
  // Results
  awayRunLineCovered?: boolean | null;
  homeRunLineCovered?: boolean | null;
  awaySpreadCovered?: boolean | null;
  homeSpreadCovered?: boolean | null;
  awayPuckLineCovered?: boolean | null;
  homePuckLineCovered?: boolean | null;
  totalResult: string | null;
  awayWon: boolean | null;
}

export interface RecentSchedulePanelProps {
  sport: Sport;
  awaySlug: string;
  homeSlug: string;
  awayAbbr: string;
  homeAbbr: string;
  awayName: string;
  homeName: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  borderColor?: string;
  /** When true, the panel starts collapsed. Defaults to false (expanded). */
  defaultCollapsed?: boolean;
  /** IntersectionObserver gate — only fetch data when card is in viewport */
  enabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function fmtSpread(value: string | null | undefined): string {
  if (!value) return "—";
  const v = parseFloat(value);
  return (v >= 0 ? "+" : "") + v;
}

function fmtTotal(total: string | null): string {
  if (!total) return "—";
  return String(parseFloat(total));
}

/** Resolve logo URL for a team slug based on sport */
function resolveLogoUrl(slug: string, sport: Sport, teamId?: number): string | undefined {
  if (sport === "MLB") {
    const t = MLB_BY_AN_SLUG.get(slug);
    if (t?.logoUrl) return t.logoUrl;
    if (teamId) return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
  }
  if (sport === "NBA") {
    const t = NBA_BY_AN_SLUG.get(slug);
    if (t?.logoUrl) return t.logoUrl;
  }
  if (sport === "NHL") {
    const t = NHL_BY_AN_SLUG.get(slug);
    if (t?.logoUrl) return t.logoUrl;
  }
  return undefined;
}

/** Get the spread label for the sport */
function spreadLabel(sport: Sport): string {
  if (sport === "MLB") return "RUN LINE";
  if (sport === "NHL") return "PUCK LINE";
  return "SPREAD";
}

/** Get the spread value for a game from the perspective of a team */
function getMySpread(game: ScheduleGame, isAway: boolean, sport: Sport): string | null | undefined {
  if (sport === "MLB") return isAway ? game.dkAwayRunLine : game.dkHomeRunLine;
  if (sport === "NBA") return isAway ? game.dkAwaySpread : game.dkHomeSpread;
  if (sport === "NHL") return isAway ? game.dkAwayPuckLine : game.dkHomePuckLine;
  return null;
}

/** Get whether the team covered the spread */
function getMyCovered(game: ScheduleGame, isAway: boolean, sport: Sport): boolean | null | undefined {
  if (sport === "MLB") return isAway ? game.awayRunLineCovered : game.homeRunLineCovered;
  if (sport === "NBA") return isAway ? game.awaySpreadCovered : game.homeSpreadCovered;
  if (sport === "NHL") return isAway ? game.awayPuckLineCovered : game.homePuckLineCovered;
  return null;
}

// ─── Result Chip ──────────────────────────────────────────────────────────────

function ResultBadge({
  label,
  variant,
  size = "sm",
}: {
  label: string;
  variant: "win" | "loss" | "push" | "neutral";
  size?: "sm" | "xs";
}) {
  const cls = {
    win:     "bg-[#45E0A8] text-black",
    loss:    "bg-white text-black",
    push:    "bg-white text-black",
    neutral: "bg-black text-white",
  }[variant];

  const sizeClass = size === "xs"
    ? "w-5 h-5 text-[9px]"
    : "w-6 h-6 text-[10px]";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold font-mono leading-none flex-shrink-0",
        sizeClass,
        cls
      )}
    >
      {label}
    </span>
  );
}

// ─── ATS Badge ────────────────────────────────────────────────────────────────

function AtsBadge({
  spread,
  covered,
}: {
  spread: string | null | undefined;
  covered: boolean | null | undefined;
}) {
  const spreadStr = fmtSpread(spread);
  const covVariant: "win" | "loss" | "neutral" =
    covered === true ? "win" : covered === false ? "loss" : "neutral";

  return (
    <div className="flex items-center gap-1">
      <ResultBadge
        label={covered === true ? "W" : covered === false ? "L" : "—"}
        variant={covVariant}
        size="xs"
      />
      <span className="text-[10px] font-mono text-white">{spreadStr}</span>
    </div>
  );
}

// ─── O/U Badge ────────────────────────────────────────────────────────────────

function OuBadge({
  total,
  result,
}: {
  total: string | null;
  result: string | null;
}) {
  const ouVariant: "win" | "loss" | "push" | "neutral" =
    result === "OVER" ? "win"
    : result === "UNDER" ? "loss"
    : result === "PUSH" ? "push"
    : "neutral";

  const label = result === "OVER" ? "O" : result === "UNDER" ? "U" : "—";

  return (
    <div className="flex items-center gap-1">
      <ResultBadge label={label} variant={ouVariant} size="xs" />
      <span className="text-[10px] font-mono text-white">{fmtTotal(total)}</span>
    </div>
  );
}

// ─── Single Game Row ──────────────────────────────────────────────────────────

function GameRow({
  game,
  teamSlug,
  sport,
}: {
  game: ScheduleGame;
  teamSlug: string;
  sport: Sport;
}) {
  const isAway = game.awaySlug === teamSlug;

  // Opponent info
  const oppSlug   = isAway ? game.homeSlug   : game.awaySlug;
  const oppAbbr   = isAway ? game.homeAbbr   : game.awayAbbr;
  const oppTeamId = isAway ? game.homeTeamId : game.awayTeamId;
  const oppLogo   = resolveLogoUrl(oppSlug, sport, oppTeamId);

  // Scores
  const myScore  = isAway ? game.awayScore : game.homeScore;
  const oppScore = isAway ? game.homeScore : game.awayScore;

  // W/L
  const myWon = game.awayWon != null
    ? (isAway ? game.awayWon : !game.awayWon)
    : null;

  const wlVariant: "win" | "loss" | "neutral" =
    myWon === true ? "win" : myWon === false ? "loss" : "neutral";

  // Score string: "W 9-1" or "L 3-7"
  const scoreStr =
    myScore != null && oppScore != null
      ? `${myScore}-${oppScore}`
      : "—";

  // Spread
  const mySpread  = getMySpread(game, isAway, sport);
  const myCovered = getMyCovered(game, isAway, sport);

  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      {/* Date */}
      <td className="px-3 py-2 text-[11px] text-white font-mono whitespace-nowrap">
        {fmtDate(game.gameDate)}
      </td>

      {/* H/A + Opponent */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white font-mono">
            {isAway ? "@" : "vs"}
          </span>
          {oppLogo ? (
            <img
              src={oppLogo}
              alt={oppAbbr}
              className="w-5 h-5 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-black flex-shrink-0" />
          )}
          <span className="text-[11px] font-mono font-semibold text-white">
            {oppAbbr}
          </span>
        </div>
      </td>

      {/* Result: W/L badge + score */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <ResultBadge
            label={myWon === true ? "W" : myWon === false ? "L" : "—"}
            variant={wlVariant}
          />
          <span
            className={cn(
              "text-[11px] font-mono font-bold",
              myWon === true ? "text-[#45E0A8]"
              : myWon === false ? "text-white"
              : "text-white"
            )}
          >
            {scoreStr}
          </span>
        </div>
      </td>

      {/* ATS */}
      <td className="px-2 py-2">
        <AtsBadge spread={mySpread} covered={myCovered} />
      </td>

      {/* O/U */}
      <td className="px-2 py-2">
        <OuBadge total={game.dkTotal} result={game.totalResult} />
      </td>
    </tr>
  );
}

// ─── Team Schedule Table ──────────────────────────────────────────────────────

function TeamScheduleTable({
  games,
  teamSlug,
  sport,
  spreadLabel: spreadLbl,
}: {
  games: ScheduleGame[];
  teamSlug: string;
  sport: Sport;
  spreadLabel: string;
}) {
  if (games.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[11px] text-white font-mono">No completed games found.</p>
        <p className="text-[10px] text-white font-mono mt-1">
          Data populates automatically each day via the DK NJ schedule refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px]">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="px-3 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">GAME</th>
            <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">OPP</th>
            <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">RESULT</th>
            <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">ATS</th>
            <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">O/U</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <GameRow key={g.anGameId} game={g} teamSlug={teamSlug} sport={sport} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Head-to-Head Row ─────────────────────────────────────────────────────────
//
// Unlike GameRow (single-team perspective), H2HRow shows BOTH teams in the game.
// The winner is determined from awayWon, and ATS is shown from the AWAY team's
// perspective (the team that was actually away in that specific game — which may
// be either awaySlug or homeSlug depending on who hosted that game).

function H2HRow({
  game,
  sport,
}: {
  game: ScheduleGame;
  sport: Sport;
}) {
  // Resolve logos for the actual away/home teams in this specific game
  const awayLogo = resolveLogoUrl(game.awaySlug, sport, game.awayTeamId);
  const homeLogo = resolveLogoUrl(game.homeSlug, sport, game.homeTeamId);

  // Winner determination
  const awayWon = game.awayWon;
  const awayVariant: "win" | "loss" | "neutral" =
    awayWon === true ? "win" : awayWon === false ? "loss" : "neutral";
  const homeVariant: "win" | "loss" | "neutral" =
    awayWon === false ? "win" : awayWon === true ? "loss" : "neutral";

  // Score string: "AWAY_SCORE – HOME_SCORE"
  const scoreStr =
    game.awayScore != null && game.homeScore != null
      ? `${game.awayScore}–${game.homeScore}`
      : "—";

  // ATS — shown from the actual away team's perspective for this game
  const awaySpread  = getMySpread(game, true, sport);
  const awayCovered = getMyCovered(game, true, sport);

  // O/U
  const ouVariant: "win" | "loss" | "push" | "neutral" =
    game.totalResult === "OVER" ? "win"
    : game.totalResult === "UNDER" ? "loss"
    : game.totalResult === "PUSH" ? "push"
    : "neutral";
  const ouLabel = game.totalResult === "OVER" ? "O"
    : game.totalResult === "UNDER" ? "U"
    : "—";

  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      {/* Date */}
      <td className="px-3 py-2 text-[11px] text-white font-mono whitespace-nowrap">
        {fmtDate(game.gameDate)}
      </td>

      {/* Matchup: AWAY @ HOME with logos and W/L badges */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Away team */}
          <div className="flex items-center gap-1">
            <ResultBadge
              label={awayWon === true ? "W" : awayWon === false ? "L" : "—"}
              variant={awayVariant}
              size="xs"
            />
            {awayLogo ? (
              <img
                src={awayLogo}
                alt={game.awayAbbr}
                className="w-4 h-4 object-contain flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : null}
            <span className="text-[10px] font-mono font-semibold text-white">{game.awayAbbr}</span>
          </div>

          {/* @ separator */}
          <span className="text-[9px] text-white font-mono">@</span>

          {/* Home team */}
          <div className="flex items-center gap-1">
            {homeLogo ? (
              <img
                src={homeLogo}
                alt={game.homeAbbr}
                className="w-4 h-4 object-contain flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : null}
            <span className="text-[10px] font-mono font-semibold text-white">{game.homeAbbr}</span>
            <ResultBadge
              label={awayWon === false ? "W" : awayWon === true ? "L" : "—"}
              variant={homeVariant}
              size="xs"
            />
          </div>
        </div>
      </td>

      {/* Score */}
      <td className="px-2 py-2">
        <span
          className="text-[11px] font-mono font-bold text-white"
        >
          {scoreStr}
        </span>
      </td>

      {/* ATS — from actual away team's perspective */}
      <td className="px-2 py-2">
        <AtsBadge spread={awaySpread} covered={awayCovered} />
      </td>

      {/* O/U */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <ResultBadge label={ouLabel} variant={ouVariant} size="xs" />
          <span className="text-[10px] font-mono text-white">{fmtTotal(game.dkTotal)}</span>
        </div>
      </td>
    </tr>
  );
}

// ─── Head-to-Head Section ────────────────────────────────────────────────────

function H2HSection({
  games,
  awaySlug,
  homeSlug,
  sport,
  spreadLabel: spreadLbl,
  isLoading,
  error,
}: {
  games: ScheduleGame[];
  awaySlug: string;
  homeSlug: string;
  sport: Sport;
  spreadLabel: string;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 text-white animate-spin mr-2" />
        <span className="text-[10px] text-white font-mono">Loading H2H history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3">
        <p className="text-[10px] text-white font-mono">Failed to load H2H history.</p>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[11px] text-white font-mono">
          No head-to-head history found in the database.
        </p>
        <p className="text-[10px] text-white font-mono mt-1">
          H2H data populates automatically as the season progresses.
        </p>
      </div>
    );
  }

  // Compute H2H summary: wins for each team
  const awayTeamWins = games.filter((g) =>
    (g.awaySlug === awaySlug && g.awayWon === true) ||
    (g.homeSlug === awaySlug && g.awayWon === false)
  ).length;
  const homeTeamWins = games.filter((g) =>
    (g.awaySlug === homeSlug && g.awayWon === true) ||
    (g.homeSlug === homeSlug && g.awayWon === false)
  ).length;

  return (
    <div>
      {/* H2H summary header */}
      <div className="flex items-center justify-center gap-3 px-3 py-1.5 border-b border-white bg-black">
        <span className="text-[10px] font-mono font-bold text-[#45E0A8]">{awayTeamWins}W</span>
        <span className="text-[9px] font-mono text-white">LAST {games.length}</span>
        <span className="text-[10px] font-mono font-bold text-[#45E0A8]">{homeTeamWins}W</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="px-3 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">DATE</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">MATCHUP</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">SCORE</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">ATS</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold text-white font-mono tracking-widest">O/U</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <H2HRow key={g.anGameId} game={g} sport={sport} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function RecentSchedulePanel({
  sport,
  awaySlug,
  homeSlug,
  awayAbbr,
  homeAbbr,
  awayName,
  homeName,
  awayLogoUrl,
  homeLogoUrl,
  borderColor = "hsl(var(--border))",
  defaultCollapsed = false,
  enabled = true,
}: RecentSchedulePanelProps) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabView>("away");
  // defaultCollapsed=true → starts collapsed; false → starts expanded (legacy default)
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const isDataEnabled = (enabled ?? true) && !!awaySlug && !!homeSlug;

  // ── MLB query ────────────────────────────────────────────────────────────────────
  const mlbQuery = trpc.mlbSchedule.getLast5ForMatchup.useQuery(
    { awaySlug, homeSlug },
    { enabled: isDataEnabled && sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // ── MLB H2H query ───────────────────────────────────────────────────────────────
  // H2H: last 5 games between these two teams (2023+ lookback floor)
  const mlbH2HQuery = trpc.mlbSchedule.getH2HGames.useQuery(
    { slugA: awaySlug, slugB: homeSlug, limit: 5 },
    { enabled: isDataEnabled && sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // ── NBA query ────────────────────────────────────────────────────────────────────
  const nbaQuery = trpc.nbaSchedule.getLast5ForMatchup.useQuery(
    { awaySlug, homeSlug },
    { enabled: isDataEnabled && sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // ── NHL query ────────────────────────────────────────────────────────────────────
  const nhlQuery = trpc.nhlSchedule.getLast5ForMatchup.useQuery(
    { awaySlug, homeSlug },
    { enabled: isDataEnabled && sport === "NHL", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  const activeQuery =
    sport === "MLB" ? mlbQuery
    : sport === "NBA" ? nbaQuery
    : nhlQuery;

  const awayLast5 = (activeQuery.data?.awayLast5 ?? []) as ScheduleGame[];
  const homeLast5 = (activeQuery.data?.homeLast5 ?? []) as ScheduleGame[];

  // H2H games — MLB only for now (NBA/NHL H2H procedures to be added later)
  const h2hGames = sport === "MLB"
    ? ((mlbH2HQuery.data?.games ?? []) as ScheduleGame[])
    : [];
  const h2hLoading = sport === "MLB" ? mlbH2HQuery.isLoading : false;
  const h2hError = sport === "MLB" ? mlbH2HQuery.error : null;

  const isLoading = activeQuery.isLoading;
  const isFetching = activeQuery.isFetching || (sport === "MLB" && mlbH2HQuery.isFetching);
  const error = activeQuery.error;

  const sportRoutePrefix = sport === "MLB" ? "mlb" : sport === "NBA" ? "nba" : "nhl";

  const handleAwayLogoClick = () => navigate(`/${sportRoutePrefix}/team/${awaySlug}`);
  const handleHomeLogoClick = () => navigate(`/${sportRoutePrefix}/team/${homeSlug}`);

  const sLabel = spreadLabel(sport);

  const awayLogo = awayLogoUrl ?? resolveLogoUrl(awaySlug, sport);
  const homeLogo = homeLogoUrl ?? resolveLogoUrl(homeSlug, sport);

  return (
    <div
      className="w-full"
      style={{
        background: "hsl(var(--card))",
        borderLeft: `3px solid ${borderColor}`,
        borderBottom: "1px solid hsl(var(--border))",
      }}
    >
      {/* ── Collapsible Header ─────────────────────────────────────────────── */}
      <button type="button" onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white font-mono tracking-widest uppercase">
            Last 5 Games
          </span>

        </div>
        <div className="flex items-center gap-2">
          {isFetching && <RefreshCw className="w-3 h-3 text-white animate-spin" />}
          {isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-white" />
            : <ChevronDown className="w-3.5 h-3.5 text-white" />
          }
        </div>
      </button>

      {/* ── Collapsible Body ───────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-white/[0.06]">
          {/* ── Team Tab Selector ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.06]">
            {/* Away tab */}
            <button type="button" onClick={() => setTab("away")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono transition-all flex-1 justify-center",
                tab === "away"
                  ? "bg-[#45E0A8] text-black"
                  : "text-white hover:text-white"
              )}
            >
              {awayLogo && (
                <img
                  src={awayLogo}
                  alt={awayAbbr}
                  className="w-4 h-4 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              {awayName}
            </button>

            {/* H2H tab */}
            <button type="button" onClick={() => setTab("h2h")}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-bold font-mono transition-all flex-1 justify-center",
                tab === "h2h"
                  ? "bg-[#45E0A8] text-black"
                  : "text-white hover:text-white"
              )}
            >
              Head-to-Head
            </button>

            {/* Home tab */}
            <button type="button" onClick={() => setTab("home")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono transition-all flex-1 justify-center",
                tab === "home"
                  ? "bg-[#45E0A8] text-black"
                  : "text-white hover:text-white"
              )}
            >
              {homeLogo && (
                <img
                  src={homeLogo}
                  alt={homeAbbr}
                  className="w-4 h-4 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              {homeName}
            </button>
          </div>

          {/* ── Loading ───────────────────────────────────────────────────── */}
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="w-4 h-4 text-white animate-spin mr-2" />
              <span className="text-[10px] text-white font-mono">Loading schedule...</span>
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && !isLoading && (
            <div className="px-3 py-3">
              <p className="text-[10px] text-white font-mono">Error: {error.message}</p>
              <button type="button" onClick={() => activeQuery.refetch()}
                className="text-[9px] text-white font-mono mt-1 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Content ───────────────────────────────────────────────────── */}
          {!isLoading && !error && (
            <>
              {tab === "away" && (
                <TeamScheduleTable
                  games={awayLast5}
                  teamSlug={awaySlug}
                  sport={sport}
                  spreadLabel={sLabel}
                />
              )}
              {tab === "h2h" && (
                <H2HSection
                  games={h2hGames}
                  awaySlug={awaySlug}
                  homeSlug={homeSlug}
                  sport={sport}
                  spreadLabel={sLabel}
                  isLoading={h2hLoading}
                  error={h2hError}
                />
              )}
              {tab === "home" && (
                <TeamScheduleTable
                  games={homeLast5}
                  teamSlug={homeSlug}
                  sport={sport}
                  spreadLabel={sLabel}
                />
              )}
            </>
          )}

          {/* ── Team logo click-through links ─────────────────────────────── */}
          {!isLoading && !error && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.04]">
              <button type="button" onClick={handleAwayLogoClick}
                className="flex items-center gap-1.5 text-[9px] text-white font-mono hover:underline"
              >
                {awayLogo && (
                  <img src={awayLogo} alt={awayAbbr} className="w-4 h-4 object-contain" />
                )}
                View {awayAbbr} full schedule →
              </button>
              <button type="button" onClick={handleHomeLogoClick}
                className="flex items-center gap-1.5 text-[9px] text-white font-mono hover:underline"
              >
                View {homeAbbr} full schedule →
                {homeLogo && (
                  <img src={homeLogo} alt={homeAbbr} className="w-4 h-4 object-contain" />
                )}
              </button>
            </div>
          )}


        </div>
      )}
    </div>
  );
}
