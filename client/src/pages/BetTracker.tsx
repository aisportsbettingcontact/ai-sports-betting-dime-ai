/*
 * BetTracker.tsx — Handicapper Bet Tracker v8
 *
 * Changes in v8:
 *   - Default handicapper selector = logged-in user (not "All Handicappers")
 *   - All-Time toggle ON by default
 *   - PREGAME / LIVE wager type toggle in the add-bet form
 *   - Custom line field for RL and TOTAL bets (editable, overrides API value)
 *   - TO WIN is now a fully editable/typable field (not auto-read-only)
 *   - LOGS tab: owner/admin/sippi can view all bets created + all edit requests
 *   - Porter/Hank bets are IMMUTABLE: edit/delete shows "Submit Request" modal
 *   - bySize analytics: exact 10U/5U/4U/3U/2U/1U buckets with plus/minus money logic
 *   - wagerType badge on BetCard (PREGAME / LIVE)
 *   - customLine displayed on BetCard for RL/TOTAL bets
 *
 * Access: OWNER | ADMIN | HANDICAPPER only.
 *   - OWNER / ADMIN: can view any handicapper's bets via selector
 *   - HANDICAPPER: sees only their own bets
 */

import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import {
  Clock, TrendingUp, Minus, AlertCircle,
  ChevronLeft, Plus, Pencil, Trash2, CheckCircle2,
  DollarSign, Hash, ChevronDown, Zap, BarChart2,
  FileText, Radio, Lock,
} from "lucide-react";
import type { TrackedBet } from "@shared/types";
import { EquityChart, BreakdownGrid, HandicapperSelector } from "@/components/BetTrackerAnalytics";
import type { StatsData } from "@/components/BetTrackerAnalytics";
const IS_DEV = process.env.NODE_ENV === "development";


// ─── Types ────────────────────────────────────────────────────────────────────

/** TrackedBet enriched with SlateGame data from the list procedure */
type EnrichedBet = TrackedBet & {
  awayLogo:     string | null;
  homeLogo:     string | null;
  awayFull:     string | null;
  homeFull:     string | null;
  awayNickname: string | null;
  homeNickname: string | null;
  awayColor:    string | null;
  homeColor:    string | null;
  gameTime:     string | null;
  startUtc:     string | null;
  gameStatus:   string | null;
};

/** Per-inning linescore entry returned by getLinescores */
type LinescoreEntry = {
  gamePk:        number;
  gameDate:      string;
  awayAbbrev:    string;
  homeAbbrev:    string;
  /**
   * Doubleheader game number: 1 = G1, 2 = G2.
   * Assigned by the server (getLinescores) by chronological startTime order.
   *
   * CRITICAL: This field MUST be present in this type for linescoreByGameNum to work.
   * If this field is missing, ls.gameNumber is undefined at runtime, causing the
   * linescoreByGameNum map to key as "...:undefined" for ALL games — both DH games
   * share the same broken key, the lookup always misses, and the fallback
   * linescoreByTeams (which is ambiguous for DH) returns G1 for both bets.
   *
   * Bug confirmed: 2026-04-30 HOU@BAL G2 showed HOU 3-10 (G1 score) instead of HOU 11-5.
   * Fix: add this field so linescoreByGameNum keys resolve to "...:1" and "...:2" correctly.
   */
  gameNumber:    1 | 2;
  innings:       { num: number; awayRuns: number | null; homeRuns: number | null }[];
  awayR:         number | null;
  awayH:         number | null;
  awayE:         number | null;
  homeR:         number | null;
  homeH:         number | null;
  homeE:         number | null;
  currentInning: number | null;
  inningState:   string | null;
  status:        string;
};

const SPORTS = ["MLB", "NHL", "NBA", "NCAAM"] as const;
type Sport = typeof SPORTS[number];
type SportOrAll = Sport | "ALL";

type Timeframe = "FULL_GAME" | "FIRST_5" | "FIRST_INNING" | "NRFI" | "YRFI" | "REGULATION" | "FIRST_PERIOD" | "FIRST_HALF" | "FIRST_QUARTER";
type Market    = "ML" | "RL" | "TOTAL";
type PickSide  = "AWAY" | "HOME" | "OVER" | "UNDER";
type Result    = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
type StakeMode = "$" | "U";
type WagerType = "PREGAME" | "LIVE";
type ActiveTab = "BETS" | "LOGS";

interface OddsEntry { odds: number; value: number; }
interface GameOdds {
  awayMl: OddsEntry | null; homeMl: OddsEntry | null;
  awayRl: OddsEntry | null; homeRl: OddsEntry | null;
  over:   OddsEntry | null; under:  OddsEntry | null;
  bookId: number;
}
interface SlateGame {
  id:           number;
  awayTeam:     string;
  homeTeam:     string;
  awayFull:     string;
  homeFull:     string;
  awayNickname: string;
  homeNickname: string;
  awayLogo:     string;
  homeLogo:     string;
  awayColor:    string;
  homeColor:    string;
  gameTime:     string;
  sport:        string;
  gameDate:     string;
  status:       string;
  odds:         GameOdds;
  /** 1 for single games and G1 of a doubleheader; 2 for G2 */
  gameNumber:   1 | 2;
}

// ─── Sport-aware timeframe options ───────────────────────────────────────────

const TIMEFRAMES_BY_SPORT: Record<Sport, { value: Timeframe; label: string }[]> = {
  MLB:   [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_5",      label: "First 5 Innings (F5)" },
    { value: "FIRST_INNING", label: "First Inning" },
    { value: "NRFI",         label: "NRFI (No Run First Inning)" },
    { value: "YRFI",         label: "YRFI (Yes Run First Inning)" },
  ],
  NHL:   [
    { value: "FULL_GAME",    label: "Full Game (incl. OT/SO)" },
    { value: "REGULATION",   label: "Regulation" },
    { value: "FIRST_PERIOD", label: "1st Period" },
  ],
  NBA:   [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_HALF",   label: "1st Half" },
    { value: "FIRST_QUARTER", label: "1st Quarter" },
  ],
  NCAAM: [
    { value: "FULL_GAME",    label: "Full Game" },
    { value: "FIRST_HALF",   label: "1st Half" },
  ],
};

const MARKET_LABELS: Record<Sport, Record<Market, string>> = {
  MLB:   { ML: "Moneyline", RL: "Run Line",   TOTAL: "Total (Runs)" },
  NHL:   { ML: "Moneyline", RL: "Puck Line",  TOTAL: "Total (Goals)" },
  NBA:   { ML: "Moneyline", RL: "Spread",     TOTAL: "Total (Points)" },
  NCAAM: { ML: "Moneyline", RL: "Spread",     TOTAL: "Total (Points)" },
};

const RESULTS = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayEst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
/** Today in UTC-8 (Pacific Time) as YYYY-MM-DD */
function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
/** Subtract N days from a YYYY-MM-DD string, return YYYY-MM-DD */
function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function calcToWin(odds: number, risk: number): number {
  if (!odds || !risk || risk <= 0) return 0;
  if (odds >= 100) return parseFloat((risk * (odds / 100)).toFixed(4));
  return parseFloat((risk * (100 / Math.abs(odds))).toFixed(4));
}

function fmtOdds(o: number): string {
  return o >= 0 ? `+${o}` : `${o}`;
}

function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${str}` : `$${str}`;
}

function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toFixed(2);
  return n < 0 ? `-${str}u` : `${str}u`;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function resultColor(r: Result): string {
  switch (r) {
    case "WIN":     return "text-green-400";
    case "LOSS":    return "text-red-400";
    case "PUSH":    return "text-yellow-400";
    case "PENDING": return "text-zinc-200";
    case "VOID":    return "text-zinc-300";
  }
}

function resultBg(r: Result): string {
  switch (r) {
    case "WIN":     return "bg-green-500/10 border-green-500/30 text-green-400";
    case "LOSS":    return "bg-red-500/10 border-red-500/30 text-red-400";
    case "PUSH":    return "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";
    case "PENDING": return "bg-zinc-800 border-zinc-700 text-zinc-200";
    case "VOID":    return "bg-zinc-900 border-zinc-800 text-zinc-300";
  }
}

function timeframeShort(tf: string): string {
  switch (tf) {
    case "FIRST_5":       return "F5";
    case "FIRST_INNING":  return "F1";
    case "NRFI":          return "NRFI";
    case "YRFI":          return "YRFI";
    case "REGULATION":    return "REG";
    case "FIRST_PERIOD":  return "1P";
    case "FIRST_HALF":    return "1H";
    case "FIRST_QUARTER": return "1Q";
    default:              return "";
  }
}

// ─── Team nickname fallback map ──────────────────────────────────────────────
// Used when awayFull/homeFull are null (Action Network API returns 403 for
// historical dates). Maps DB abbreviations → display nicknames.
const MLB_TEAM_NICKNAMES: Record<string, string> = {
  // American League East
  BAL:  "Orioles",
  BOS:  "Red Sox",
  NYY:  "Yankees",
  TB:   "Rays",
  TOR:  "Blue Jays",
  // American League Central
  CWS:  "White Sox",
  CLE:  "Guardians",
  DET:  "Tigers",
  KC:   "Royals",
  MIN:  "Twins",
  // American League West
  ATH:  "Athletics",
  HOU:  "Astros",
  LAA:  "Angels",
  SEA:  "Mariners",
  TEX:  "Rangers",
  // National League East
  ATL:  "Braves",
  MIA:  "Marlins",
  NYM:  "Mets",
  PHI:  "Phillies",
  WSH:  "Nationals",
  // National League Central
  CHC:  "Cubs",
  CIN:  "Reds",
  MIL:  "Brewers",
  PIT:  "Pirates",
  STL:  "Cardinals",
  // National League West
  ARI:  "Diamondbacks",
  AZ:   "Diamondbacks",  // MLB Stats API alias
  COL:  "Rockies",
  LAD:  "Dodgers",
  SD:   "Padres",
  SF:   "Giants",
};

/**
 * Resolve team nickname for display (e.g. "BLUE JAYS", "WHITE SOX", "MARINERS").
 *
 * Priority:
 *   (1) MLB_TEAM_NICKNAMES[abbrev]  — authoritative map covering all 30 MLB teams.
 *       Multi-word nicknames ("Blue Jays", "White Sox", "Red Sox") are preserved in full.
 *   (2) storedNickname              — nickname stored on the bet row from the slate API.
 *   (3) raw abbreviation            — last resort.
 *
 * IMPORTANT: We do NOT use last-word splitting of fullName because multi-word
 * nicknames would be truncated ("Toronto Blue Jays" → "Jays", "Chicago White Sox" → "Sox").
 */
function resolveNickname(
  storedNickname: string | null | undefined,
  abbrev: string,
): string {
  // (1) Authoritative abbreviation map — always preferred
  const mapped = MLB_TEAM_NICKNAMES[abbrev];
  if (mapped) return mapped.toUpperCase();
  // (2) Stored nickname from the slate (e.g. "Blue Jays" from mlbTeams.ts)
  if (storedNickname && storedNickname.trim()) return storedNickname.trim().toUpperCase();
  // (3) Raw abbreviation fallback
  return abbrev.toUpperCase();
}

function getPickOdds(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "ML":    return pickSide === "AWAY" ? odds.awayMl?.odds ?? null : odds.homeMl?.odds ?? null;
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.odds ?? null : odds.homeRl?.odds ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.odds  ?? null : odds.under?.odds  ?? null;
  }
}

function getPickLine(odds: GameOdds | null, market: Market, pickSide: PickSide): number | null {
  if (!odds) return null;
  switch (market) {
    case "RL":    return pickSide === "AWAY" ? odds.awayRl?.value ?? null : odds.homeRl?.value ?? null;
    case "TOTAL": return pickSide === "OVER" ? odds.over?.value   ?? null : odds.under?.value  ?? null;
    default:      return null;
  }
}

/** Format a local start time from a UTC ISO string */
function fmtStartTime(utcStr: string | null, gameTime: string | null): string {
  if (utcStr) {
    try {
      const d = new Date(utcStr);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch { /* fall through */ }
  }
  if (gameTime) return `${gameTime} ET`;
  return "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── BreakdownsSidebar ──────────────────────────────────────────────────────────────────────────────
/**
 * BreakdownsSidebar — Breakdowns panel visible on ALL screen sizes.
 * - Desktop (lg+): always expanded, vertical stack in left column
 * - Mobile/tablet (<lg): collapsible toggle, defaults to collapsed
 * Shows dollar P&L when unitSize > 0.
 */
function BreakdownsSidebar({ stats, unitSize }: { stats: StatsData; unitSize: number }) {
  // Default: expanded on desktop (lg+), collapsed on mobile/tablet
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== "undefined") return window.innerWidth >= 1024;
    return true;
  });
  const showDollar = unitSize > 0;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Header — always visible, acts as toggle on mobile/tablet */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors lg:cursor-default"
        aria-expanded={expanded}
        aria-label="Toggle Breakdowns panel"
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={13} className="text-emerald-400" />
          <span className="text-sm font-bold tracking-widest text-zinc-200 uppercase">Breakdowns</span>
          {showDollar && (
            <span className="text-xs text-zinc-400 font-mono">(1u = ${unitSize.toLocaleString()})</span>
          )}
        </div>
        {/* Chevron — hidden on desktop since it’s always expanded */}
        <ChevronDown
          size={14}
          className={`text-zinc-400 transition-transform lg:hidden ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Content — collapsible on mobile/tablet, always shown on desktop */}
      <div
        className={`transition-all duration-200 ${
          expanded ? "block" : "hidden"
        } lg:block`}
      >
        <div className="p-4 space-y-3">
          <BreakdownGrid stats={stats} vertical showDollar={showDollar} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white/4 border border-white/8 rounded-xl px-4 py-3 flex flex-col justify-center gap-0.5 min-w-0 min-h-[76px] h-auto overflow-visible">
      <div className={`text-lg sm:text-xl lg:text-2xl font-bold leading-tight whitespace-nowrap ${color ?? "text-white"}`}>{value}</div>
      <div className="text-sm text-zinc-300 tracking-widest uppercase leading-tight">{label}</div>
      {sub && <div className="text-xs text-zinc-300 leading-tight mt-0.5">{sub}</div>}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, placeholder, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 pr-8 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 pointer-events-none" />
      </div>
    </div>
  );
}

function PickButton({
  selected, onClick, logo, teamAbbr, teamNickname, odds, line, side, disabled, customLine,
}: {
  selected:     boolean;
  onClick:      () => void;
  logo?:        string;
  teamAbbr?:    string;
  teamNickname?: string;
  odds:         number | null;
  line?:        number | null;
  side:         "AWAY" | "HOME" | "OVER" | "UNDER";
  disabled?:    boolean;
  customLine?:  string; // when set, override the API line display
}) {
  const isTotal = side === "OVER" || side === "UNDER";
  const sideLabel = isTotal ? (side === "OVER" ? "OVER" : "UNDER") : (side === "AWAY" ? "AWAY" : "HOME");

  return (
    <button type="button" onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all
        min-w-0 relative
        ${selected
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800"
        }
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {selected && (
        <div className="absolute top-1.5 right-1.5">
          <CheckCircle2 size={12} className="text-emerald-400" />
        </div>
      )}
      {!isTotal && logo ? (
        <img src={logo} alt={teamAbbr} className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className={`text-lg font-black ${isTotal ? (side === "OVER" ? "text-emerald-400" : "text-blue-400") : "text-zinc-200"}`}>
          {side === "OVER" ? "O" : side === "UNDER" ? "U" : ""}
        </div>
      )}
      <div className="text-center">
        {!isTotal ? (
          <>
            <div className="text-sm font-black text-white tracking-wider leading-tight">{teamAbbr}</div>
            {teamNickname && <div className="text-xs text-zinc-300 leading-tight truncate max-w-[64px]">{teamNickname}</div>}
          </>
        ) : (
          <div className="text-sm font-black text-zinc-300 tracking-wider">{sideLabel}</div>
        )}
      </div>
      {/* Line display: prefer customLine over API line; TOTAL shows bare number, RL shows signed */}
      {(customLine !== undefined && customLine !== "" && customLine !== null) ? (
        <div className="text-sm font-bold text-emerald-400">
          {isTotal
            ? `${parseFloat(customLine)}`
            : (parseFloat(customLine) > 0 ? `+${parseFloat(customLine)}` : `${parseFloat(customLine)}`)}
        </div>
      ) : (line !== null && line !== undefined) ? (
        <div className="text-sm font-bold text-zinc-200">
          {isTotal ? `${line}` : (line > 0 ? `+${line}` : `${line}`)}
        </div>
      ) : null}
      <div className={`text-sm font-bold font-mono ${odds !== null ? (odds >= 0 ? "text-emerald-400" : "text-zinc-300") : "text-zinc-300"}`}>
        {odds !== null ? fmtOdds(odds) : "—"}
      </div>
    </button>
  );
}

function GameSelector({
   games, selectedId, onSelect, loading, sport, formDate, linescoreByTeams, linescoreByPk, linescoreByGameNum,
}: {
  games:             SlateGame[];
  selectedId:        number | null;
  onSelect:          (game: SlateGame) => void;
  loading:           boolean;
  sport:             string;
  formDate:          string;
  linescoreByTeams?:  Map<string, LinescoreEntry>;
  linescoreByPk?:     Map<number, LinescoreEntry>;
  /**
   * linescoreByGameNum — keyed by "gameDate:away:home:gameNumber" (THE correct DH-safe map).
   * AN game IDs ≠ MLB gamePks, so linescoreByPk.get(g.id) always misses for MLB.
   * This map uses gameNumber (1 or 2) which is assigned identically by both AN and MLB
   * systems based on chronological start time.
   */
  linescoreByGameNum?: Map<string, LinescoreEntry>;
}) {
  /**
   * getLs — resolve linescore for a SlateGame.
   *
   * Resolution order (most precise first):
   *   1. linescoreByGameNum[gameDate:away:home:gameNumber]  — DH-safe, works for all sports
   *   2. linescoreByTeams[gameDate:away:home]               — fallback for non-DH games only
   *
   * WHY NOT linescoreByPk?
   *   Action Network game IDs (stored as anGameId / SlateGame.id) are a DIFFERENT number
   *   space from MLB Stats API gamePk values. e.g. AN=287818 vs MLB=824848 for the same game.
   *   linescoreByPk.get(g.id) will ALWAYS miss for MLB games fetched via the AN primary path.
   *
   * Logging:
   *   [getLs][HIT_GAMENUM] — resolved via gameDate:away:home:gameNumber (correct)
   *   [getLs][HIT_TEAM]    — resolved via team-name key (non-DH fallback)
   *   [getLs][MISS]        — no match found
   */
  function getLs(g: SlateGame): LinescoreEntry | undefined {
    // Primary: gameDate:away:home:gameNumber lookup (O(1), DH-safe, correct for all sports)
    if (linescoreByGameNum) {
      const key = `${g.gameDate}:${g.awayTeam}:${g.homeTeam}:${g.gameNumber}`;
      const byGN = linescoreByGameNum.get(key);
      if (byGN) {
        if (IS_DEV) console.log(`[getLs][HIT_GAMENUM] key=${key} gameId=${g.id} → gamePk=${byGN.gamePk} status=${byGN.status} R=${byGN.awayR}-${byGN.homeR}`);
        return byGN;
      }
    }
    // Fallback: team-name key (ambiguous for DH, but safe for non-DH games)
    if (linescoreByTeams) {
      const byTeam = linescoreByTeams.get(`${g.gameDate}:${g.awayTeam}:${g.homeTeam}`);
      if (byTeam) {
        if (IS_DEV) console.log(`[getLs][HIT_TEAM] gameId=${g.id} ${g.awayTeam}@${g.homeTeam} → gamePk=${byTeam.gamePk} status=${byTeam.status} R=${byTeam.awayR}-${byTeam.homeR}`);
        return byTeam;
      }
    }
    if (IS_DEV) console.log(`[getLs][MISS] gameId=${g.id} ${g.awayTeam}@${g.homeTeam} G${g.gameNumber} — no linescore found`);
    return undefined;
  }

  /** Detect which matchups appear more than once on this slate (doubleheaders) */
  const dhMatchups = useMemo(() => {
    const seen = new Set<string>();
    const dh = new Set<string>();
    for (const g of games) {
      const key = `${g.gameDate}:${g.awayTeam}:${g.homeTeam}`;
      if (seen.has(key)) dh.add(key);
      seen.add(key);
    }
    return dh;
  }, [games]);

  /** Returns true if this game is part of a doubleheader */
  function isDH(g: SlateGame): boolean {
    return dhMatchups.has(`${g.gameDate}:${g.awayTeam}:${g.homeTeam}`);
  }
  /** Render inline score/status for a game */
  function GameStatus({ g, compact }: { g: SlateGame; compact?: boolean }) {
    const ls = getLs(g);
    const isComplete = g.status === "complete" || ls?.status === "Final";
    const isLive = !isComplete && (g.status === "in_progress" || ls?.status === "Live");
    if (isComplete) {
      const awayR = ls?.awayR ?? null;
      const homeR = ls?.homeR ?? null;
      if (awayR !== null && homeR !== null) {
        return (
          <span className="flex items-center gap-1 shrink-0">
            <span className="text-sm font-bold font-mono text-zinc-300">{awayR}–{homeR}</span>
            <span className="text-xs font-bold text-yellow-400 uppercase">FINAL</span>
          </span>
        );
      }
      return <span className="text-xs font-bold text-yellow-400 uppercase">FINAL</span>;
    }
    if (isLive) {
      const awayR = ls?.awayR ?? null;
      const homeR = ls?.homeR ?? null;
      const inn = ls?.currentInning;
      const state = ls?.inningState;
      const innLabel = inn ? `${state === "Top" ? "▲" : state === "Bottom" ? "▼" : ""}${inn}` : "";
      return (
        <span className="flex items-center gap-1 shrink-0">
          {awayR !== null && homeR !== null && (
            <span className="text-sm font-bold font-mono text-white">{awayR}–{homeR}</span>
          )}
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400 uppercase">
              {innLabel ? `${innLabel}${compact ? "" : " INN"}` : "LIVE"}
            </span>
          </span>
        </span>
      );
    }
    // Not started — show start time in EST
    return <span className="text-zinc-300 text-xs">{g.gameTime} ET</span>;
  }
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = games.find(g => g.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5">
        <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-zinc-300 text-sm">Loading slate…</span>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-300 text-sm">
        No {sport} games on {fmtDate(formDate)}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors text-left"
      >
        {selected ? (() => {
          const selLs = getLs(selected);
          const selComplete = selected.status === "complete" || selLs?.status === "Final";
          const selLive = !selComplete && (selected.status === "in_progress" || selLs?.status === "Live");
          const selHasScore = selLs?.awayR !== null && selLs?.awayR !== undefined && selLs?.homeR !== null && selLs?.homeR !== undefined;
          const selAwayWins = selHasScore && selComplete && (selLs!.awayR! > selLs!.homeR!);
          const selHomeWins = selHasScore && selComplete && (selLs!.homeR! > selLs!.awayR!);
          return (
            <>
              <img src={selected.awayLogo} alt={selected.awayTeam} className="w-5 h-5 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className={`font-bold text-sm ${
                selAwayWins ? "text-white" : selComplete ? "text-zinc-400" : "text-white"
              }`}>{selected.awayTeam}</span>
              {/* Score inline — shown when game has started */}
              {(selComplete || selLive) && selHasScore ? (
                <span className="flex items-center gap-1 mx-1">
                  <span className={`font-black font-mono tabular-nums text-sm ${
                    selAwayWins ? "text-white" : selComplete ? "text-zinc-400" : "text-zinc-200"
                  }`}>{selLs!.awayR}</span>
                  <span className="text-zinc-500 text-xs">–</span>
                  <span className={`font-black font-mono tabular-nums text-sm ${
                    selHomeWins ? "text-white" : selComplete ? "text-zinc-400" : "text-zinc-200"
                  }`}>{selLs!.homeR}</span>
                </span>
              ) : (
                <span className="text-zinc-500 text-xs mx-1">@</span>
              )}
              <span className={`font-bold text-sm ${
                selHomeWins ? "text-white" : selComplete ? "text-zinc-400" : "text-white"
              }`}>{selected.homeTeam}</span>
              <img src={selected.homeLogo} alt={selected.homeTeam} className="w-5 h-5 object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              {/* DH badge */}
              {isDH(selected) && (
                <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-amber-500/25 text-amber-400 border border-amber-500/50 shrink-0">
                  G{selected.gameNumber}
                </span>
              )}
              {/* Status badge */}
              {selComplete && (
                <span className="ml-1 text-xs font-bold text-yellow-400 uppercase shrink-0">FINAL</span>
              )}
              {selLive && (() => {
                const inn = selLs?.currentInning;
                const state = selLs?.inningState;
                const innLabel = inn ? `${state === "Top" ? "▲" : state === "Bottom" ? "▼" : ""}${inn}` : "";
                return (
                  <span className="flex items-center gap-0.5 ml-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-400">{innLabel || "LIVE"}</span>
                  </span>
                );
              })()}
              {!selComplete && !selLive && (
                <span className="ml-1 text-xs text-zinc-400 shrink-0">{selected.gameTime} ET</span>
              )}
            </>
          );
        })() : (
          <span className="text-zinc-300">Select game…</span>
        )}
        <ChevronDown size={14} className={`ml-auto text-zinc-300 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {games.map(g => {
            const ls = getLs(g);
            const isComplete = g.status === "complete" || ls?.status === "Final";
            const isLive = !isComplete && (g.status === "in_progress" || ls?.status === "Live");
            const hasScore = ls?.awayR !== null && ls?.awayR !== undefined && ls?.homeR !== null && ls?.homeR !== undefined;
            const awayWins = hasScore && isComplete && (ls!.awayR! > ls!.homeR!);
            const homeWins = hasScore && isComplete && (ls!.homeR! > ls!.awayR!);

            return (
              <button type="button" key={g.id}
                onClick={() => { onSelect(g); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left border-b border-zinc-800/50 last:border-0 ${
                  g.id === selectedId ? "bg-emerald-500/10" : ""
                }`}
              >
                {/* ── Away team ── */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <img src={g.awayLogo} alt={g.awayTeam} className="w-6 h-6 object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className={`font-bold text-sm w-8 shrink-0 ${
                    awayWins ? "text-white" : isComplete ? "text-zinc-400" : "text-white"
                  }`}>{g.awayTeam}</span>
                </div>

                {/* ── Score / Status center block ── */}
                <div className="flex-1 flex items-center justify-center gap-2">
                  {(isComplete || isLive) && hasScore ? (
                    // Score display — prominent, DH-differentiating
                    <div className="flex items-center gap-1.5">
                      <span className={`text-base font-black font-mono tabular-nums ${
                        awayWins ? "text-white" : isComplete ? "text-zinc-400" : "text-zinc-200"
                      }`}>{ls!.awayR}</span>
                      <span className="text-zinc-500 text-sm font-bold">–</span>
                      <span className={`text-base font-black font-mono tabular-nums ${
                        homeWins ? "text-white" : isComplete ? "text-zinc-400" : "text-zinc-200"
                      }`}>{ls!.homeR}</span>
                      {/* Status badge inline with score */}
                      {isComplete && (
                        <span className="text-xs font-bold text-yellow-400 uppercase ml-1">FINAL</span>
                      )}
                      {isLive && (() => {
                        const inn = ls?.currentInning;
                        const state = ls?.inningState;
                        const innLabel = inn ? `${state === "Top" ? "▲" : state === "Bottom" ? "▼" : ""}${inn}` : "";
                        return (
                          <span className="flex items-center gap-0.5 ml-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs font-bold text-emerald-400">{innLabel || "LIVE"}</span>
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    // Scheduled — show start time
                    <span className="text-zinc-400 text-xs">{g.gameTime} ET</span>
                  )}
                </div>

                {/* ── Home team ── */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`font-bold text-sm w-8 text-right shrink-0 ${
                    homeWins ? "text-white" : isComplete ? "text-zinc-400" : "text-white"
                  }`}>{g.homeTeam}</span>
                  <img src={g.homeLogo} alt={g.homeTeam} className="w-6 h-6 object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>

                {/* ── Right side: DH badge + ML odds for scheduled ── */}
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  {isDH(g) && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-black bg-amber-500/25 text-amber-400 border border-amber-500/50">
                      G{g.gameNumber}
                    </span>
                  )}
                  {/* ML odds for scheduled games */}
                  {!isComplete && !isLive && g.odds?.awayMl && (
                    <span className="text-xs text-zinc-400 font-mono">
                      {fmtOdds(g.odds.awayMl.odds)}/{g.odds.homeMl ? fmtOdds(g.odds.homeMl.odds) : "—"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LinescoreGrid ────────────────────────────────────────────────────────────

function LinescoreGrid({
  ls, awayAbbrev, homeAbbrev,
}: {
  ls:          LinescoreEntry;
  awayAbbrev:  string;
  homeAbbrev:  string;
}) {
  const cols = Array.from({ length: 9 }, (_, i) => {
    const inn = ls.innings.find(x => x.num === i + 1);
    return inn ?? { num: i + 1, awayRuns: null, homeRuns: null };
  });

  const isLive  = ls.status === "Live";
  const isFinal = ls.status === "Final";

  function cellCls(runs: number | null, isCurrentInning: boolean): string {
    if (runs === null) return "text-zinc-700";
    if (isCurrentInning && isLive) return "text-emerald-300 font-bold";
    return "text-zinc-300";
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="text-xs text-zinc-300 font-medium text-left pr-2 pb-1 w-8" />
            {cols.map(c => (
              <th key={c.num} className={`text-xs font-bold pb-1 w-6 ${
                isLive && ls.currentInning === c.num ? "text-emerald-400" : "text-zinc-300"
              }`}>
                {c.num}
              </th>
            ))}
            <th className="text-xs font-bold text-zinc-200 pb-1 px-1">R</th>
            <th className="text-xs font-bold text-zinc-300 pb-1 px-1">H</th>
            <th className="text-xs font-bold text-zinc-300 pb-1 px-1">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-xs font-bold text-zinc-200 text-left pr-2">{awayAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-sm font-mono ${cellCls(c.awayRuns, isLive && ls.currentInning === c.num)}`}>
                {c.awayRuns !== null ? c.awayRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-sm font-bold font-mono text-white px-1">{ls.awayR !== null ? ls.awayR : "—"}</td>
            <td className="text-sm font-mono text-zinc-300 px-1">{ls.awayH !== null ? ls.awayH : "—"}</td>
            <td className="text-sm font-mono text-zinc-300 px-1">{ls.awayE !== null ? ls.awayE : "—"}</td>
          </tr>
          <tr>
            <td className="text-xs font-bold text-zinc-200 text-left pr-2">{homeAbbrev}</td>
            {cols.map(c => (
              <td key={c.num} className={`text-sm font-mono ${cellCls(c.homeRuns, isLive && ls.currentInning === c.num)}`}>
                {c.homeRuns !== null ? c.homeRuns : (isFinal ? "0" : "·")}
              </td>
            ))}
            <td className="text-sm font-bold font-mono text-white px-1">{ls.homeR !== null ? ls.homeR : "—"}</td>
            <td className="text-sm font-mono text-zinc-300 px-1">{ls.homeH !== null ? ls.homeH : "—"}</td>
            <td className="text-sm font-mono text-zinc-300 px-1">{ls.homeE !== null ? ls.homeE : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── BetCard ──────────────────────────────────────────────────────────────────
// memo: prevents re-render when parent state changes (e.g. addBetOpen, expandedDates)
// unless the specific bet's props actually change.
const BetCard = memo(function BetCard({
  bet, stakeMode, unitSize, onResult, onDelete, onEdit, linescore, canDirectEdit,
}: {
  bet:           EnrichedBet;
  stakeMode:     StakeMode;
  unitSize:      number;
  onResult:      (id: number, result: Result) => void;
  onDelete:      (id: number) => void;
  onEdit:        (bet: TrackedBet) => void;
  linescore?:    LinescoreEntry;
  canDirectEdit: boolean; // false for porter/hank viewing own bets
}) {
  const risk  = parseFloat(bet.risk);
  const toWin = parseFloat(bet.toWin);

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  const tfShort = timeframeShort(bet.timeframe ?? "FULL_GAME");
  const result  = bet.result as Result;

  const isGraded   = bet.result !== "PENDING" && bet.result !== "VOID";
  const lsStatus   = linescore?.status ?? null;
  const anStatus   = bet.gameStatus ?? null;

  const isFinal    = isGraded || lsStatus === "Final" || anStatus === "complete";
  const isLive     = !isFinal && (lsStatus === "Live" || anStatus === "in_progress");

  const dbAwayScore = bet.awayScore !== null && bet.awayScore !== undefined
    ? parseFloat(String(bet.awayScore)) : null;
  const dbHomeScore = bet.homeScore !== null && bet.homeScore !== undefined
    ? parseFloat(String(bet.homeScore)) : null;

  const awayR = isGraded ? dbAwayScore : (linescore?.awayR ?? dbAwayScore);
  const homeR = isGraded ? dbHomeScore : (linescore?.homeR ?? dbHomeScore);
  const hasScore = awayR !== null && homeR !== null;

  const currentInning = linescore?.currentInning ?? null;
  const inningState   = linescore?.inningState ?? null;
  const inningLabel   = currentInning
    ? `${inningState === "Top" ? "▲" : inningState === "Bottom" ? "▼" : ""}${currentInning}`
    : null;

  const pickIsAway = bet.pickSide === "AWAY";
  const pickIsHome = bet.pickSide === "HOME";

  const mktLabel = bet.market === "ML" ? "ML"
    : bet.market === "RL" ? (bet.sport === "NHL" ? "PL" : "RL")
    : "TOT";

  // Custom line display (for RL/TOTAL bets) — must be computed BEFORE getFullPickLabel
  // Priority: (1) customLine (user-entered override), (2) bet.line (API value from DB)
  const customLine = (bet as any).customLine;
  const betLine    = (bet as any).line;
  const lineDisplay = (customLine !== null && customLine !== undefined)
    ? parseFloat(String(customLine))
    : (betLine !== null && betLine !== undefined ? parseFloat(String(betLine)) : null);
  // [PERF] Removed per-BetCard console.log — was firing on every card render (114+ times on All-Time load)

  // Stored nickname fields from the slate (e.g. "Blue Jays", "White Sox", "Mariners")
  // These are populated from mlbTeams.ts nickname field via the AN/Stats API slate.
  const awayNicknameStored = (bet as any).awayNickname as string | null | undefined;
  const homeNicknameStored = (bet as any).homeNickname as string | null | undefined;
  // Build display pick: MLB_TEAM_NICKNAMES map is the primary source (multi-word safe)
  function getFullPickLabel(): string {
    const side = bet.pickSide;
    if (side === "OVER") {
      const line = lineDisplay !== null ? ` ${lineDisplay}` : "";
      return `OVER${line}`;
    }
    if (side === "UNDER") {
      const line = lineDisplay !== null ? ` ${lineDisplay}` : "";
      return `UNDER${line}`;
    }
    const storedNickname = side === "AWAY" ? awayNicknameStored : homeNicknameStored;
    const abbrev         = (side === "AWAY" ? bet.awayTeam : bet.homeTeam) ?? "?";
    const nickname       = resolveNickname(storedNickname, abbrev);
    const mkt = bet.market === "ML" ? "ML"
      : bet.market === "RL" ? (bet.sport === "NHL" ? "PL" : "RL")
      : "TOT";
    if (bet.market === "RL" && lineDisplay !== null) {
      // lineDisplay is already the correct signed value for the PICKED team.
      // e.g. HOME favorite stored as -1.5 → display "-1.5"
      //      AWAY underdog stored as +1.5 → display "+1.5"
      // DO NOT negate — the stored value IS the pick's line, not the opponent's.
      const rlStr = lineDisplay > 0 ? `+${lineDisplay}` : `${lineDisplay}`;
      return `${nickname} ${rlStr}`;
    }
    return `${nickname} ${mkt}`;
  }
  const fullPickLabel = getFullPickLabel();

  const awayAbbrev = linescore?.awayAbbrev || bet.awayTeam || "AWY";
  const homeAbbrev = linescore?.homeAbbrev || bet.homeTeam || "HME";

  // Wager type badge
  const wagerType = (bet as any).wagerType as WagerType | undefined;

  return (
    <div className={`relative bg-zinc-900/90 border rounded-xl overflow-hidden transition-all ${
      result === "WIN"  ? "border-green-500/30" :
      result === "LOSS" ? "border-red-500/25" :
      result === "PUSH" ? "border-yellow-500/25" :
      "border-zinc-800"
    }`}>
      {/* Result accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        result === "WIN"  ? "bg-green-500" :
        result === "LOSS" ? "bg-red-500" :
        result === "PUSH" ? "bg-yellow-500" :
        result === "PENDING" ? "bg-zinc-700" :
        "bg-zinc-800"
      }`} />

      <div className="pl-4 pr-3 pt-3 pb-3 space-y-3">

          {/* ── Row 1: Matchup header with large logos ── */}
        <div className="flex items-center gap-3">
          {/* Away team */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            {bet.awayLogo ? (
              <img src={bet.awayLogo} alt={bet.awayTeam ?? ""} className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                <span className="text-xs font-bold text-zinc-300">{(bet.awayTeam ?? "?").slice(0, 3)}</span>
              </div>
            )}
            <span className="text-xs font-bold text-zinc-200 tracking-wider">{bet.awayTeam ?? "?"}</span>
          </div>

          {/* Center: score / status / time */}
          <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            <div className="flex items-center gap-1.5">
              {/* League logo */}
              {bet.sport === "MLB" && (
                <img src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg" alt="MLB" className="w-4 h-4 object-contain shrink-0" />
              )}
              {bet.sport === "NHL" && (
                <img src="https://assets.nhle.com/logos/nhl/svg/NHL_light.svg" alt="NHL" className="w-4 h-4 object-contain shrink-0" />
              )}
              {bet.sport === "NBA" && (
                <img src="https://cdn.nba.com/logos/leagues/logo-nba.svg" alt="NBA" className="w-4 h-4 object-contain shrink-0" />
              )}
              <span className="text-sm font-bold tracking-widest text-white uppercase">{bet.sport}</span>
              <span className="text-zinc-300 text-sm">·</span>
              <span className="text-sm font-semibold text-white">{fmtDate(bet.gameDate)}</span>
              {/* Wager type badge */}
              {wagerType === "LIVE" && (
                <span className="flex items-center gap-0.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
                  <Radio size={8} />LIVE
                </span>
              )}
{/* PRE badge removed — only LIVE badge shown */}
            </div>

            {isFinal && hasScore ? (
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-black font-mono ${
                    pickIsAway ? (result === "WIN" ? "text-green-400" : result === "LOSS" ? "text-red-400" : "text-white") : "text-zinc-300"
                  }`}>{awayR}</span>
                  <span className="text-zinc-300 text-sm font-bold">-</span>
                  <span className={`text-xl font-black font-mono ${
                    pickIsHome ? (result === "WIN" ? "text-green-400" : result === "LOSS" ? "text-red-400" : "text-white") : "text-zinc-300"
                  }`}>{homeR}</span>
                </div>
                <span className="text-xs font-bold text-zinc-300 tracking-widest uppercase">
                  {bet.timeframe === "FIRST_5" ? "F5" :
                   bet.timeframe === "FIRST_INNING" ? "INN 1" :
                   bet.timeframe === "NRFI" ? "NRFI" :
                   bet.timeframe === "YRFI" ? "YRFI" :
                   bet.timeframe === "FIRST_PERIOD" ? "P1" :
                   bet.timeframe === "FIRST_HALF" ? "1H" :
                   bet.timeframe === "FIRST_QUARTER" ? "Q1" :
                   bet.timeframe === "REGULATION" ? "REG" :
                   "Final"}
                </span>
              </div>
            ) : isLive && hasScore ? (
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black font-mono text-white">{awayR}</span>
                  <span className="text-zinc-300 text-sm font-bold">-</span>
                  <span className="text-xl font-black font-mono text-white">{homeR}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">
                    {inningLabel ? `${inningLabel} INN` : "LIVE"}
                  </span>
                </div>
              </div>
            ) : isLive ? (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">
                  {inningLabel ? `${inningLabel} INN` : "LIVE"}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm font-bold text-zinc-200">
                  {fmtStartTime(bet.startUtc, bet.gameTime) || "—"}
                </span>
                <span className="text-xs text-zinc-300 tracking-widest uppercase">Start Time</span>
              </div>
            )}
          </div>

          {/* Home team */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            {bet.homeLogo ? (
              <img src={bet.homeLogo} alt={bet.homeTeam ?? ""} className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                <span className="text-xs font-bold text-zinc-300">{(bet.homeTeam ?? "?").slice(0, 3)}</span>
              </div>
            )}
            <span className="text-xs font-bold text-zinc-200 tracking-wider">{bet.homeTeam ?? "?"}</span>
          </div>

          {/* Edit/Delete buttons */}
          <div className="flex flex-col gap-1 shrink-0 ml-1">
            {canDirectEdit ? (
              <>
                <button type="button" onClick={() => onEdit(bet)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                  title="Edit bet"
                >
                  <Pencil size={11} />
                </button>
                <button type="button" onClick={() => onDelete(bet.id)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete bet"
                >
                  <Trash2 size={11} />
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onEdit(bet)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-yellow-400 hover:bg-yellow-500/10 transition-all"
                  title="Request edit"
                >
                  <FileText size={11} />
                </button>
                <button type="button" onClick={() => onDelete(bet.id)}
                  className="p-1.5 rounded-lg text-zinc-700 hover:text-yellow-400 hover:bg-yellow-500/10 transition-all"
                  title="Request deletion"
                >
                  <Lock size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Row 2: Pick + Bet Details ── */}
        <div className="flex flex-col items-center gap-2">

          {/* Pick row */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {(pickIsAway && bet.awayLogo) && (
              <img src={bet.awayLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            {(pickIsHome && bet.homeLogo) && (
              <img src={bet.homeLogo} alt="" className="w-4 h-4 object-contain opacity-80" />
            )}
            <span className="text-white font-bold text-sm">{fullPickLabel}</span>
            <span className="text-xs bg-zinc-800 text-zinc-200 px-1.5 py-0.5 rounded font-medium tracking-wider">{mktLabel}</span>
            {tfShort && (
              <span className="text-xs bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-medium">{tfShort}</span>
            )}
            <span className={`text-sm font-bold font-mono ${
              bet.odds >= 0 ? "text-emerald-400" : "text-zinc-300"
            }`}>
              {fmtOdds(bet.odds)}
            </span>
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${resultBg(result)}`}>
              {result}
            </span>
          </div>

          {/* Stake row */}
          <div className="flex items-center justify-center gap-2 w-full">
            <div className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg px-3 py-1.5">
              <span className="text-sm text-zinc-300 uppercase tracking-wider">Risk</span>
              <span className="text-xs font-bold font-mono text-white">{fmtStake(risk)}</span>
            </div>
            <span className="text-zinc-700 text-xs">→</span>
            <div className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg px-3 py-1.5">
              <span className="text-sm text-zinc-300 uppercase tracking-wider">Win</span>
              <span className="text-xs font-bold font-mono text-emerald-400">{fmtStake(toWin)}</span>
            </div>
            {result !== "PENDING" && result !== "VOID" && (
              <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${
                result === "WIN" ? "bg-green-500/10" : result === "LOSS" ? "bg-red-500/10" : "bg-yellow-500/10"
              }`}>
                <span className="text-sm text-zinc-300 uppercase tracking-wider">P/L</span>
                <span className={`text-xs font-bold font-mono ${resultColor(result)}`}>
                  {result === "WIN"  ? `+${fmtStake(toWin)}` :
                   result === "LOSS" ? `-${fmtStake(risk)}` :
                   "PUSH"}
                </span>
              </div>
            )}
          </div>

          {/* Quick result buttons (only for direct-edit users) */}
          {canDirectEdit && result === "PENDING" && (
            <div className="flex items-center gap-1.5 w-full justify-center">
              {(["WIN", "LOSS", "PUSH", "VOID"] as Result[]).map(r => (
                <button key={r} type="button" onClick={() => onResult(bet.id, r)}
                  className={`px-2.5 py-1 rounded-lg text-sm font-bold border transition-all hover:opacity-80 ${resultBg(r)}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Linescore removed per user request */}

        {/* Notes */}
        {bet.notes && (
          <div className="text-sm text-zinc-300 bg-zinc-800/40 rounded-lg px-3 py-1.5 italic">
            {bet.notes}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

function LogsTab({
  logsQuery,
  reviewMut,
  invalidateLogs,
}: {
  logsQuery: ReturnType<typeof trpc.betTracker.getLogs.useQuery>;
  reviewMut: ReturnType<typeof trpc.betTracker.reviewEditRequest.useMutation>;
  invalidateLogs: () => void;
}) {
  const [reviewId, setReviewId]     = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "DENY">("APPROVE");
  const [reviewNote, setReviewNote] = useState("");
  const [activeSection, setActiveSection] = useState<"BETS" | "REQUESTS">("REQUESTS");

  const data = logsQuery.data as { editRequests: any[]; bets: any[] } | undefined;
  const editRequests = data?.editRequests ?? [];
  const bets         = data?.bets ?? [];
  const pendingRequests = editRequests.filter((r: any) => r.status === "PENDING");

  function handleReview() {
    if (reviewId === null) return;
    reviewMut.mutate(
      { requestId: reviewId, action: reviewAction, reviewNote: reviewNote || undefined },
      {
        onSuccess: () => {
          setReviewId(null);
          setReviewNote("");
          invalidateLogs();
        },
      }
    );
  }

  if (logsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
        <button type="button"
          onClick={() => setActiveSection("REQUESTS")}
          className={`px-4 py-2 text-xs font-bold tracking-wider rounded-lg transition-all ${
            activeSection === "REQUESTS"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-300 hover:text-zinc-300"
          }`}
        >
          EDIT REQUESTS
          {pendingRequests.length > 0 && (
            <span className="ml-2 bg-yellow-500 text-black text-sm font-black px-1.5 py-0.5 rounded-full">
              {pendingRequests.length}
            </span>
          )}
        </button>
        <button type="button"
          onClick={() => setActiveSection("BETS")}
          className={`px-4 py-2 text-xs font-bold tracking-wider rounded-lg transition-all ${
            activeSection === "BETS"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-300 hover:text-zinc-300"
          }`}
        >
          ALL BETS LOG
          <span className="ml-2 text-zinc-300 text-sm">({bets.length})</span>
        </button>
      </div>

      {/* Edit Requests */}
      {activeSection === "REQUESTS" && (
        <div className="space-y-3">
          {editRequests.length === 0 ? (
            <div className="text-center py-12 text-zinc-300 text-sm">No edit requests submitted yet.</div>
          ) : (
            editRequests.map((req: any) => (
              <div key={req.id} className={`bg-zinc-900/80 border rounded-xl p-4 space-y-2 ${
                req.status === "PENDING" ? "border-yellow-500/30" :
                req.status === "APPROVED" ? "border-green-500/20" :
                "border-zinc-800"
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${
                      req.status === "PENDING"  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                      req.status === "APPROVED" ? "bg-green-500/10 border-green-500/30 text-green-400" :
                      "bg-zinc-800 border-zinc-700 text-zinc-300"
                    }`}>{req.status}</span>
                    <span className={`text-sm font-bold px-2 py-0.5 rounded border ${
                      req.requestType === "DELETE"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                    }`}>{req.requestType}</span>
                    <span className="text-xs text-zinc-200 font-medium">@{req.requesterUsername}</span>
                    <span className="text-sm text-zinc-300">Bet #{req.betId}</span>
                  </div>
                  <span className="text-sm text-zinc-300">
                    {new Date(req.createdAt).toLocaleString()}
                  </span>
                </div>
                {req.reason && (
                  <div className="text-xs text-zinc-200 bg-zinc-800/50 rounded-lg px-3 py-2 italic">
                    "{req.reason}"
                  </div>
                )}
                {req.proposedChanges && (
                  <div className="text-sm text-zinc-300 bg-zinc-800/30 rounded px-2 py-1 font-mono">
                    Changes: {req.proposedChanges}
                  </div>
                )}
                {req.reviewerUsername && (
                  <div className="text-sm text-zinc-300">
                    Reviewed by @{req.reviewerUsername}
                    {req.reviewNote && `: "${req.reviewNote}"`}
                  </div>
                )}
                {req.status === "PENDING" && (
                  <div className="flex gap-2 pt-1">
                    <button type="button"
                      onClick={() => { setReviewId(req.id); setReviewAction("APPROVE"); setReviewNote(""); }}
                      className="flex-1 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold hover:bg-green-500/20 transition-all"
                    >
                      Approve
                    </button>
                    <button type="button"
                      onClick={() => { setReviewId(req.id); setReviewAction("DENY"); setReviewNote(""); }}
                      className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* All Bets Log */}
      {activeSection === "BETS" && (
        <div className="space-y-2">
          {bets.length === 0 ? (
            <div className="text-center py-12 text-zinc-300 text-sm">No bets tracked yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-sm text-zinc-300 uppercase tracking-wider border-b border-zinc-800">
                    <th className="text-left py-2 px-2">ID</th>
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Sport</th>
                    <th className="text-left py-2 px-2">Pick</th>
                    <th className="text-left py-2 px-2">Odds</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-left py-2 px-2">ToWin</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Result</th>
                    <th className="text-left py-2 px-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b: any) => (
                    <tr key={b.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                      <td className="py-2 px-2 text-zinc-300 font-mono">#{b.id}</td>
                      <td className="py-2 px-2">
                        <span className="text-zinc-300 font-medium">@{b.username}</span>
                        <span className={`ml-1 text-xs font-bold uppercase px-1 py-0.5 rounded ${
                          b.userRole === "owner" ? "text-yellow-400" :
                          b.userRole === "admin" ? "text-blue-400" :
                          "text-emerald-400"
                        }`}>{b.userRole}</span>
                      </td>
                      <td className="py-2 px-2 text-zinc-200 font-mono">{fmtDate(b.gameDate)}</td>
                      <td className="py-2 px-2 text-zinc-300">{b.sport}</td>
                      <td className="py-2 px-2 text-white font-medium">{b.pick}</td>
                      <td className={`py-2 px-2 font-mono font-bold ${b.odds >= 0 ? "text-emerald-400" : "text-zinc-300"}`}>
                        {fmtOdds(b.odds)}
                      </td>
                      <td className="py-2 px-2 text-zinc-200 font-mono">{parseFloat(b.risk).toFixed(2)}</td>
                      <td className="py-2 px-2 text-emerald-400 font-mono">{parseFloat(b.toWin).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          (b as any).wagerType === "LIVE"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-800 text-zinc-300"
                        }`}>{(b as any).wagerType ?? "PRE"}</span>
                      </td>
                      <td className={`py-2 px-2 font-bold text-sm ${resultColor(b.result as Result)}`}>{b.result}</td>
                      <td className="py-2 px-2 text-zinc-300 font-mono text-sm">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Review modal */}
      {reviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider">
              {reviewAction === "APPROVE" ? "✅ Approve Request" : "❌ Deny Request"}
            </h3>
            <p className="text-zinc-200 text-xs">Request #{reviewId}</p>
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Note (optional)</label>
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                rows={2}
                placeholder="Reason for decision…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setReviewId(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-200 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleReview}
                disabled={reviewMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  reviewAction === "APPROVE" ? "bg-green-600 hover:bg-green-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {reviewMut.isPending ? "Processing…" : reviewAction}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ── Module-level constants (outside component — never recreated on render) ──────────────────
/** Season start dates per sport (YYYY-MM-DD). Update each new season. */
const SEASON_START_DATES: Record<string, string> = {
  MLB:   "2026-03-25",
  NHL:   "2025-10-04", // 2025-26 NHL season
  NBA:   "2025-10-22", // 2025-26 NBA season
  NCAAM: "2025-11-04", // 2025-26 NCAAM season
  ALL:   "2025-10-04", // earliest of all sports
};

export default function BetTracker() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading } = useAppAuth();

  useEffect(() => {
    if (!authLoading && !appUser) navigate("/");
  }, [authLoading, appUser, navigate]);

  const role      = appUser?.role ?? "user";
  const canAccess = ["owner", "admin", "handicapper"].includes(role);
  const isOwnerOrAdmin = role === "owner" || role === "admin";

  // ── Stake mode ────────────────────────────────────────────────────────────
  const [stakeMode, setStakeMode] = useState<StakeMode>(() => {
    try { return (localStorage.getItem("bt_stakeMode") as StakeMode) || "$"; } catch { return "$"; }
  });
  const [unitSize, setUnitSize] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("bt_unitSize") || "100"); } catch { return 100; }
  });

  useEffect(() => { try { localStorage.setItem("bt_stakeMode", stakeMode); } catch {} }, [stakeMode]);
  useEffect(() => { try { localStorage.setItem("bt_unitSize", String(unitSize)); } catch {} }, [unitSize]);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("BETS");

    // ── Handicapper selector: default to logged-in user ───────────────────────
  // Initialize directly from appUser.id — avoids the useEffect waterfall that caused
  // a second query re-fire after auth resolved (appUser undefined → id set → re-query).
  // appUser is null during authLoading (handled by skeleton above), so this is safe.
  const [targetUserId, setTargetUserId] = useState<number | undefined>(() => appUser?.id);
  const [showAnalytics, setShowAnalytics] = useState(false);
  // All-Time ON by default
  const [filterAllTime, setFilterAllTime] = useState(true);
  // Sync targetUserId if appUser loads after initial render (e.g. cache miss on first load)
  useEffect(() => {
    if (appUser && targetUserId === undefined) {
      setTargetUserId(appUser.id);
    }
  }, [appUser, targetUserId]);
  // Only send an explicit targetUserId when viewing ANOTHER user's bets.
  // When the owner/admin views their own bets, send undefined so the server defaults
  // to ctx.appUser.id — this prevents a cache key change when appUser loads after
  // initial render (undefined → owner's id → re-query with different key).
  const effectiveUserId = isOwnerOrAdmin && targetUserId && targetUserId !== appUser?.id
    ? targetUserId
    : undefined;

  // ── Sport / filter state ──────────────────────────────────────────────────
  const [activeSport, setActiveSport]   = useState<SportOrAll>("ALL");
  const [filterResult, setFilterResult] = useState<Result | "">("");
  // Date range filter: ALL_TIME | TODAY | L7 | L14 | 1M | SEASON
  // SEASON = from sport's season start date through today
  // MLB 2026 season started 2026-03-25 (Yankees vs Giants)
  type DateRange = "ALL_TIME" | "TODAY" | "L7" | "L14" | "1M" | "SEASON";
  const [dateRange, setDateRange] = useState<DateRange>("ALL_TIME");

  // SEASON_START is defined as a module-level constant (outside component) to avoid
  // recreating the object on every render. See SEASON_START_DATES above the component.

  // Compute dateFrom/dateTo from dateRange (UTC-8 based)
  const { dateFrom, dateTo } = useMemo(() => {
    const today = todayPt();
    if (IS_DEV) console.log(`[BetTracker][STATE] dateRange=${dateRange} activeSport=${activeSport} todayPt=${today}`);
    if (dateRange === "TODAY")    return { dateFrom: today, dateTo: today };
    if (dateRange === "L7")       return { dateFrom: subtractDays(today, 6), dateTo: today };
    if (dateRange === "L14")      return { dateFrom: subtractDays(today, 13), dateTo: today };
    if (dateRange === "1M")       return { dateFrom: subtractDays(today, 29), dateTo: today };
    if (dateRange === "SEASON") {
      const start = SEASON_START_DATES[activeSport] ?? SEASON_START_DATES.ALL;
      if (IS_DEV) console.log(`[BetTracker][STATE] SEASON start=${start} for sport=${activeSport}`);
      return { dateFrom: start, dateTo: today };
    }
    return { dateFrom: undefined, dateTo: undefined }; // ALL_TIME
  }, [dateRange, activeSport]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [formDate, setFormDate]           = useState(todayEst);
  const [formGame, setFormGame]           = useState<SlateGame | null>(null);
  const [formTimeframe, setFormTimeframe] = useState<Timeframe>("FULL_GAME");
  const [formMarket, setFormMarket]       = useState<Market>("ML");
  const [formPickSide, setFormPickSide]   = useState<PickSide>("AWAY");
  const [formOdds, setFormOdds]           = useState("");
  const [formRisk, setFormRisk]           = useState("2");
  const [formToWin, setFormToWin]         = useState(""); // editable toWin
  const [formToWinManual, setFormToWinManual] = useState(false); // true if user typed it
  const [formNotes, setFormNotes]         = useState("");
  const [formError, setFormError]         = useState("");
  const [formWagerType, setFormWagerType] = useState<WagerType>("PREGAME");
  const [formCustomLine, setFormCustomLine] = useState(""); // custom line for RL/TOTAL

  // Edit / delete modal
  const [editBet, setEditBet]       = useState<TrackedBet | null>(null);
  const [editNotes, setEditNotes]   = useState("");
  const [editResult, setEditResult] = useState<Result>("PENDING");
  const [editIsRequest, setEditIsRequest] = useState(false); // true = submit request, not direct edit
  const [editRequestReason, setEditRequestReason] = useState("");

  // Delete modal
  const [deleteId, setDeleteId]         = useState<number | null>(null);
  const [deleteIsRequest, setDeleteIsRequest] = useState(false);
  const [deleteRequestReason, setDeleteRequestReason] = useState("");

  // Auto-grade toast
  const [gradeToast, setGradeToast] = useState<{ graded: number; wins: number; losses: number; pushes: number; stillPending: number } | null>(null);
  // ── Mobile collapsible sections ───────────────────────────────────────────
  // Add Bet form: collapsed by default on mobile
  const [addBetOpen, setAddBetOpen] = useState(false);
  // Per-date expanded state: Set of date strings that are currently expanded
  // Default: all collapsed (empty Set)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const toggleDate = useCallback((date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const oddsNum = parseInt(formOdds, 10);
  const riskNum = parseFloat(formRisk);

  const autoToWin = useMemo(() => {
    if (!isNaN(oddsNum) && oddsNum !== 0 && !isNaN(riskNum) && riskNum > 0) {
      return calcToWin(oddsNum, riskNum);
    }
    return null;
  }, [oddsNum, riskNum]);

  // Sync auto-calculated toWin into the field when not manually overridden
  useEffect(() => {
    if (!formToWinManual && autoToWin !== null) {
      setFormToWin(String(autoToWin));
    }
  }, [autoToWin, formToWinManual]);

  // Reset manual override when odds/risk change significantly
  useEffect(() => {
    setFormToWinManual(false);
  }, [formOdds, formRisk]);

  const toWinNum = parseFloat(formToWin);

  const riskLabel  = stakeMode === "$" ? "Risk $" : "Risk (U)";
  const toWinLabel = stakeMode === "$" ? "To Win $" : "To Win (U)";

  function fmtToWin(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(n);
  }

  function fmtStake(n: number): string {
    if (stakeMode === "$") return fmtDollar(n);
    return fmtUnits(unitSize > 0 ? n / unitSize : n);
  }

  // When activeSport is ALL, default the form sport to MLB
  const formSport: Sport = activeSport === "ALL" ? "MLB" : activeSport;
  const timeframeOptions = TIMEFRAMES_BY_SPORT[formSport];

  useEffect(() => { setFormTimeframe("FULL_GAME"); }, [activeSport]);
  useEffect(() => { setFormGame(null); setFormPickSide("AWAY"); setFormOdds(""); setFormCustomLine(""); }, [formDate, activeSport]);

  // NRFI/YRFI: auto-set market=TOTAL and pickSide when timeframe changes
  useEffect(() => {
    if (formTimeframe === "NRFI") {
      setFormMarket("TOTAL");
      setFormPickSide("UNDER");
    } else if (formTimeframe === "YRFI") {
      setFormMarket("TOTAL");
      setFormPickSide("OVER");
    }
  }, [formTimeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const newSide: PickSide = formMarket === "TOTAL" ? "OVER" : "AWAY";
    setFormPickSide(newSide);
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, newSide);
      setFormOdds(o !== null ? String(o) : "");
    }
    // Reset custom line when market changes
    setFormCustomLine("");
  }, [formMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, formPickSide);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket, formPickSide]);

  // ── tRPC ──────────────────────────────────────────────────────────────────
  // [PERF] Past-date slates are immutable — once fetched they never change.
  // Use staleTime:Infinity for past dates so React Query never refetches them.
  // For today/future dates, use 4-minute staleTime to pick up live odds updates.
  const isFormDatePast = formDate < todayEst();
  const slateQuery = trpc.betTracker.getSlate.useQuery(
    { sport: activeSport === "ALL" ? "MLB" : activeSport, gameDate: formDate },
    {
      enabled:   canAccess && !!formDate,
      staleTime: isFormDatePast ? Infinity : 4 * 60 * 1000,
      gcTime:    isFormDatePast ? 30 * 60 * 1000 : 5 * 60 * 1000,  // keep past slates in cache 30min
      retry:     1,
    }
  );

  // ── OPTIMIZED: Paginated infinite-scroll query — 50 bets per page, cursor-based ──────────
  // - staleTime:Infinity for historical ranges (immutable graded data never needs refetch)
  // - staleTime:60s for TODAY/SEASON (live data may update)
  // - isHistorical flag skips AN slate enrichment on historical pages
  // - useInfiniteQuery: only fetches page 1 on load; subsequent pages on scroll
  const today = todayPt();
  const isHistoricalRange = useMemo(() => {
    if (dateRange === "TODAY") return false;
    if (dateRange === "SEASON") return false;
    // L7/L14/1M: historical if dateTo < today (no pending bets possible)
    if (dateTo && dateTo < today) return true;
    // ALL_TIME: never treat as historical — may have pending bets on today/future
    return false;
  }, [dateRange, dateTo, today]);

  const paginatedQueryInput = useMemo(() => ({
    sport:        activeSport === "ALL" ? undefined : activeSport,
    // ALL_TIME: no gameDate/dateFrom/dateTo — returns all bets regardless of date
    gameDate:     undefined,
    dateFrom:     dateRange !== "ALL_TIME" ? dateFrom : undefined,
    dateTo:       dateRange !== "ALL_TIME" ? dateTo : undefined,
    result:       filterResult || undefined,
    targetUserId: effectiveUserId,
    unitSize:     unitSize > 0 ? unitSize : 100,
    limit:        50,
    isHistorical: isHistoricalRange,
  }), [activeSport, dateRange, dateFrom, dateTo, filterResult, effectiveUserId, unitSize, isHistoricalRange]);

  const paginatedQuery = trpc.betTracker.listWithStatsPaginated.useInfiniteQuery(
    paginatedQueryInput,
    {
      enabled: canAccess,
      // staleTime:Infinity for historical data — graded bets never change
      // staleTime:60s for live ranges (TODAY, SEASON with pending bets)
      staleTime: isHistoricalRange ? Infinity : 60_000,
      gcTime: isHistoricalRange ? 30 * 60_000 : 5 * 60_000,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
      retry: 1,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  // Flatten all pages into a single bets array
  const allPageBets = useMemo(() => {
    if (!paginatedQuery.data) return [];
    return paginatedQuery.data.pages.flatMap(p => p.bets) as EnrichedBet[];
  }, [paginatedQuery.data]);

  // Stats always come from the first page (stats are computed over the full set server-side)
  const firstPageStats = paginatedQuery.data?.pages[0]?.stats;

  // Compatibility aliases so all downstream code works unchanged
  const listQuery  = { data: allPageBets, isLoading: paginatedQuery.isLoading, isFetching: paginatedQuery.isFetching };
  const statsQuery = { data: firstPageStats, isLoading: paginatedQuery.isLoading };
  const hasNextPage = paginatedQuery.hasNextPage ?? false;
  const isFetchingNextPage = paginatedQuery.isFetchingNextPage;

  const handicappersQuery = trpc.betTracker.listHandicappers.useQuery(
    undefined,
    {
      enabled: canAccess && isOwnerOrAdmin,
      staleTime: 5 * 60 * 1000, // 5 min — user list rarely changes
      refetchOnWindowFocus: false,
    }
  );

  // Derive the display name for the currently selected handicapper
  // Used in Analytics panel header (e.g. "PREZ BETS" vs "HANKSTHEBANK")
  const selectedHandicapperName = useMemo(() => {
    if (!targetUserId || targetUserId === appUser?.id) {
      // Viewing own bets — use own username/discordUsername
      return (appUser?.username ?? appUser?.discordUsername ?? "PREZ BETS").toUpperCase();
    }
    // Viewing another handicapper's bets — look up in the list
    const found = (handicappersQuery.data ?? []).find(
      (h: { id: number; username: string; role: string }) => h.id === targetUserId
    );
    if (found) return (found.username ?? "HANDICAPPER").toUpperCase();
    return "HANDICAPPER";
  }, [targetUserId, appUser, handicappersQuery.data]);

  // ── Linescore query (MLB only) ─────────────────────────────────────────────
  const enrichedBets = (listQuery.data ?? []) as EnrichedBet[];
  const mlbDates = useMemo(() => {
    const dates = new Set<string>();
    for (const b of enrichedBets) {
      if (b.sport === "MLB") dates.add(b.gameDate);
    }
    return Array.from(dates).sort();
  }, [enrichedBets]);

  // Historical MLB linescores never change — staleTime:Infinity prevents refetching graded dates
  // Only today's dates need live polling (refetchInterval:60s)
  const hasLiveMlbDates = useMemo(() => mlbDates.some(d => d >= today), [mlbDates, today]);
  const linescoreQuery = trpc.betTracker.getLinescores.useQuery(
    { sport: "MLB", dates: mlbDates },
    {
      enabled: canAccess && mlbDates.length > 0,
      staleTime: hasLiveMlbDates ? 30_000 : Infinity,
      gcTime:    hasLiveMlbDates ? 5 * 60_000 : 30 * 60_000,
      refetchInterval: hasLiveMlbDates ? 60_000 : false,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  );

  const linescoreByTeams = useMemo(() => {
    // linescoreByTeams — keyed by "gameDate:away:home" (non-DH fallback only)
    // WARNING: For doubleheaders this map is AMBIGUOUS — both G1 and G2 share the same key.
    // Always prefer linescoreByGameNum for DH-safe lookups.
    const map = new Map<string, LinescoreEntry>();
    if (!linescoreQuery.data) return map;
    for (const ls of Object.values(linescoreQuery.data)) {
      const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
      map.set(key, ls); // last write wins — only safe for non-DH games
    }
    return map;
  }, [linescoreQuery.data]);

  /**
   * linescoreByPk — keyed by gamePk (MLB Stats API integer).
   * NOTE: Action Network game IDs ≠ MLB gamePk — these are DIFFERENT number spaces.
   *   AN game ID:  e.g. 287818, 290399
   *   MLB gamePk:  e.g. 824848, 824850
   * DO NOT use this map with bet.anGameId or slateGame.id — they will never match.
   * Use linescoreByGameNum for DH-safe lookups from SlateGame or TrackedBet objects.
   */
  const linescoreByPk = useMemo(() => {
    const map = new Map<number, LinescoreEntry>();
    if (!linescoreQuery.data) return map;
    for (const ls of Object.values(linescoreQuery.data)) {
      map.set(ls.gamePk, ls);
    }
    // Summary-only log: per-entry logging (30+ lines/60s) was removed for performance
    if (IS_DEV) console.log(`[Linescore][OUTPUT] linescoreByPk built: ${map.size} entries`);
    return map;
  }, [linescoreQuery.data]);

  /**
   * linescoreByGameNum — keyed by "gameDate:awayAbbrev:homeAbbrev:gameNumber".
   *
   * This is the CORRECT DH-safe map for all linescore lookups.
   * Both getLinescores (server) and getSlate (server) assign gameNumber by chronological
   * start time: G1 = earlier game, G2 = later game. The key is identical in both systems
   * regardless of whether AN IDs or MLB gamePks are used.
   *
   * Usage:
   *   SlateGame:   linescoreByGameNum.get(`${g.gameDate}:${g.awayTeam}:${g.homeTeam}:${g.gameNumber}`)
   *   TrackedBet:  linescoreByGameNum.get(`${bet.gameDate}:${bet.awayTeam}:${bet.homeTeam}:${bet.gameNumber ?? 1}`)
   */
  const linescoreByGameNum = useMemo(() => {
    const map = new Map<string, LinescoreEntry>();
    if (!linescoreQuery.data) return map;
    for (const ls of Object.values(linescoreQuery.data)) {
      const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}:${ls.gameNumber}`;
      map.set(key, ls);
    }
    // Summary-only log: per-entry logging removed for performance
    if (IS_DEV) console.log(`[Linescore][OUTPUT] linescoreByGameNum built: ${map.size} entries (DH-safe)`);
    return map;
  }, [linescoreQuery.data]);

  // ── Logs query (owner/admin only) ─────────────────────────────────────────
  const logsQuery = trpc.betTracker.getLogs.useQuery(
    { limit: 200, offset: 0 },
    { enabled: canAccess && isOwnerOrAdmin && activeTab === "LOGS", staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 }
  );

  const utils = trpc.useUtils();
  const invalidate = useCallback(() => {
    // Invalidate both query variants
    utils.betTracker.listWithStats.invalidate();
    utils.betTracker.listWithStatsPaginated.invalidate();
  }, [utils]);
  const invalidateLogs = useCallback(() => {
    utils.betTracker.getLogs.invalidate();
    invalidate();
  }, [utils, invalidate]);

  // ── IntersectionObserver sentinel — auto-fetches next page when scrolled into view ──
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && paginatedQuery.hasNextPage && !paginatedQuery.isFetchingNextPage) {
          if (IS_DEV) console.log("[BetTracker][STEP] IntersectionObserver: sentinel visible — fetching next page");
          paginatedQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" } // pre-load 200px before sentinel is visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [paginatedQuery.hasNextPage, paginatedQuery.isFetchingNextPage, paginatedQuery.fetchNextPage]);

  // ── Prefetch helper — builds query input for a given sport+dateRange combination ──
  const buildPrefetchInput = useCallback((sport: SportOrAll, range: typeof dateRange) => {
    const _today = todayPt();
    let dFrom: string | undefined;
    let dTo:   string | undefined;
    if (range === "TODAY")  { dFrom = _today; dTo = _today; }
    else if (range === "L7")  { dFrom = subtractDays(_today, 6);  dTo = _today; }
    else if (range === "L14") { dFrom = subtractDays(_today, 13); dTo = _today; }
    else if (range === "1M")  { dFrom = subtractDays(_today, 29); dTo = _today; }
    else if (range === "SEASON") {
      const start = { MLB: "2026-03-25", NHL: "2025-10-04", NBA: "2025-10-22", NCAAM: "2025-11-04", ALL: "2025-10-04" }[sport] ?? "2025-10-04";
      dFrom = start; dTo = _today;
    }
    const _isHistorical = range !== "TODAY" && range !== "SEASON" && dTo !== undefined && dTo < _today;
    return {
      sport:        sport === "ALL" ? undefined : (sport as "MLB" | "NHL" | "NBA" | "NCAAM" | "NFL" | "CUSTOM"),
      gameDate:     undefined,
      dateFrom:     range !== "ALL_TIME" ? dFrom : undefined,
      dateTo:       range !== "ALL_TIME" ? dTo   : undefined,
      result:       filterResult || undefined,
      targetUserId: effectiveUserId,
      unitSize:     unitSize > 0 ? unitSize : 100,
      limit:        50,
      isHistorical: _isHistorical,
    };
  }, [filterResult, effectiveUserId, unitSize]);

  const handlePrefetch = useCallback((sport: SportOrAll, range: typeof dateRange) => {
    const input = buildPrefetchInput(sport, range);
    // prefetchInfinite only needs the input key; staleTime is respected from existing cache
    utils.betTracker.listWithStatsPaginated.prefetchInfinite(input, {
      pages: 1,
      getNextPageParam: (lastPage: { nextCursor: string | null }) => lastPage.nextCursor ?? undefined,
    }).catch(() => {}); // fire-and-forget, never throw
  }, [utils, buildPrefetchInput]);

  function _isHistoricalInput(input: { dateTo?: string }): boolean {
    const _today = todayPt();
    return !!(input.dateTo && input.dateTo < _today);
  }

  const createMut    = trpc.betTracker.create.useMutation({
    // ── Optimistic create: insert bet into cache immediately before server confirms ──
    onMutate: async (newBet) => {
      await utils.betTracker.listWithStatsPaginated.cancel();
      const previousData = utils.betTracker.listWithStatsPaginated.getInfiniteData(paginatedQueryInput);
      const tempId = -Date.now(); // unique negative ID for this optimistic entry
      utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, (old) => {
        if (!old) return old;
        const optimisticBet = {
          id: tempId, // temp negative ID — stored in context for precise onSuccess replacement
          ...newBet,
          result: "PENDING" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: effectiveUserId ?? 0,
          // enrichment fields (all nullable — server will fill on settle)
          awayScore: null, homeScore: null, gameStatus: null,
          awayAbbrev: newBet.awayTeam ?? null, homeAbbrev: newBet.homeTeam ?? null,
          anGameId: newBet.anGameId ?? null,
          awayLogo: null, homeLogo: null,
          awayFull: null, homeFull: null,
          awayNickname: null, homeNickname: null,
          awayColor: null, homeColor: null,
          gameTime: null, startUtc: null,
          // required non-null fields with defaults
          notes: newBet.notes ?? null,
          market: newBet.market ?? null,
          betType: null,
          wagerType: newBet.wagerType ?? null,
          timeframe: newBet.timeframe ?? null,
          riskUnits: newBet.riskUnits ?? null,
          toWinUnits: newBet.toWinUnits ?? null,
          lineMovement: null,
          gradedAt: null,
          isParlay: null,
          parlayLegs: null,
          pick: "",
        } as unknown as typeof old.pages[0]['bets'][0];
        return {
          ...old,
          pages: old.pages.map((page, i) =>
            i === 0
              ? { ...page, bets: [optimisticBet, ...page.bets] }
              : page
          ),
        };
      });
      return { previousData, tempId };
    },
    onError: (err: any, _newBet, context: any) => {
      // Rollback on error
      if (context?.previousData) {
        utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, context.previousData);
      }
      // Surface the error — the catch block in handleSubmit will also fire, but
      // this path handles errors that bypass mutateAsync (e.g. background retries).
      const msg = err?.message ?? String(err);
      console.error(`[BetTracker][onError] create mutation failed:`, err);
      // Only set formError if handleSubmit's catch hasn't already set it
      // (handleSubmit sets it synchronously before this fires)
      setFormError(prev => prev ? prev : `Save failed: ${msg}`);
    },
    // ── Replace optimistic PENDING bet with real server-returned bet (already graded) ──
    // The server awaits gradeTrackedBet synchronously before returning, so the response
    // already contains the final WIN/LOSS/PUSH result for past games. We replace the
    // optimistic bet using its exact tempId (stored in context) — zero PENDING window,
    // safe for rapid-fire bet creation (each optimistic entry has a unique tempId).
    onSuccess: (realBet, _input, context: any) => {
      const tempId = context?.tempId;
      if (tempId == null) return;
      // Guard: idempotency-guard returns { id, duplicate: true } — not a full bet row.
      // If the server returned a duplicate sentinel, skip cache replacement and let
      // onSettled → invalidate() fetch the real data from the server.
      if ((realBet as any)?.duplicate === true) {
        console.log(`[BetTracker][IDEMPOTENCY] duplicate sentinel received — skipping optimistic replacement, invalidate will sync`);
        return;
      }
      utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            bets: page.bets.map((b) =>
              // Replace only the specific optimistic placeholder with this tempId
              b.id === tempId ? (realBet as unknown as typeof b) : b
            ),
          })),
        };
      });
    },
    onSettled: () => invalidate(),
  });
  const updateMut    = trpc.betTracker.update.useMutation({
    // ── Optimistic update: apply result/notes change immediately ──
    onMutate: async (updated) => {
      await utils.betTracker.listWithStatsPaginated.cancel();
      const previousData = utils.betTracker.listWithStatsPaginated.getInfiniteData(paginatedQueryInput);
      utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map(page => ({
            ...page,
            bets: page.bets.map(b =>
              b.id === updated.id ? { ...b, ...updated } : b
            ),
          })),
        } as typeof old;
      });
      return { previousData };
    },
    onError: (_err, _updated, context: any) => {
      if (context?.previousData) {
        utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, context.previousData);
      }
    },
    onSettled: () => invalidate(),
  });
  const deleteMut    = trpc.betTracker.delete.useMutation({
    // ── Optimistic delete: remove bet from cache immediately ──
    onMutate: async ({ id }) => {
      await utils.betTracker.listWithStatsPaginated.cancel();
      const previousData = utils.betTracker.listWithStatsPaginated.getInfiniteData(paginatedQueryInput);
      utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map(page => ({
            ...page,
            bets: page.bets.filter((b: { id: number }) => b.id !== id),
          })),
        };
      });
      return { previousData };
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previousData) {
        utils.betTracker.listWithStatsPaginated.setInfiniteData(paginatedQueryInput, context.previousData);
      }
    },
    onSettled: () => invalidate(),
  });
  const submitRequestMut = trpc.betTracker.submitEditRequest.useMutation({ onSuccess: invalidateLogs });
  const reviewMut    = trpc.betTracker.reviewEditRequest.useMutation({ onSuccess: invalidateLogs });
  const autoGradeMut = trpc.betTracker.autoGrade.useMutation({
    onSuccess: (data) => {
      console.log(`[BetTracker][OUTPUT] autoGrade: graded=${data.graded} wins=${data.wins} losses=${data.losses} pushes=${data.pushes} stillPending=${data.stillPending}`);
      invalidate();
      setGradeToast(data);
      setTimeout(() => setGradeToast(null), 6000);
    },
    onError: (err) => {
      console.log(`[BetTracker][ERROR] autoGrade: ${err.message}`);
    },
  });

  // ── Real-time auto-grade polling ───────────────────────────────────────────
  const prevLinescoreRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!canAccess) return;

    const pendingBets = enrichedBets.filter(b => b.result === "PENDING");
    if (pendingBets.length === 0) return;

    if (linescoreQuery.data) {
      let newFinalFound = false;
      for (const ls of Object.values(linescoreQuery.data)) {
        const key = `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}`;
        const prev = prevLinescoreRef.current[key];
        if (ls.status === "Final" && prev && prev !== "Final") {
          const hasPending = pendingBets.some(b =>
            b.gameDate === ls.gameDate &&
            (b.awayTeam === ls.awayAbbrev || b.homeTeam === ls.homeAbbrev)
          );
          if (hasPending) {
            if (IS_DEV) console.log(`[BetTracker][STATE] autoGrade: game ${ls.awayAbbrev}@${ls.homeAbbrev} just went Final — firing immediate grade`);
            newFinalFound = true;
          }
        }
        prevLinescoreRef.current[key] = ls.status;
      }
      if (newFinalFound && !autoGradeMut.isPending) {
        autoGradeMut.mutate({});
      }
    }

    const interval = setInterval(() => {
      if (!autoGradeMut.isPending) {
        if (IS_DEV) console.log(`[BetTracker][STEP] autoGrade: 60s poll — grading ${pendingBets.length} PENDING bets`);
        autoGradeMut.mutate({});
      }
    }, 60_000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedBets, linescoreQuery.data, canAccess]);

  // ── Game selection ────────────────────────────────────────────────────────
  const slateGames = (slateQuery.data ?? []) as SlateGame[];

  const handleGameSelect = useCallback((game: SlateGame) => {
    if (IS_DEV) console.log(`[BetTracker][INPUT] game selected: id=${game.id} ${game.awayTeam}@${game.homeTeam}`);
    setFormGame(game);
    setFormPickSide("AWAY");
    const o = getPickOdds(game.odds, formMarket, "AWAY");
    setFormOdds(o !== null ? String(o) : "");
    setFormCustomLine("");
  }, [formMarket]);

  const handlePickSide = useCallback((side: PickSide) => {
    setFormPickSide(side);
    if (formGame?.odds) {
      const o = getPickOdds(formGame.odds, formMarket, side);
      setFormOdds(o !== null ? String(o) : "");
    }
  }, [formGame, formMarket]);

  const pickButtons = useMemo(() => {
    if (!formGame) return null;
    const { odds, awayTeam, homeTeam, awayLogo, homeLogo, awayNickname, homeNickname } = formGame;

    if (formMarket === "TOTAL") {
      return (
        <div className="flex gap-2">
          <PickButton selected={formPickSide === "OVER"} onClick={() => handlePickSide("OVER")}
            odds={odds?.over?.odds ?? null} line={getPickLine(odds, "TOTAL", "OVER")} side="OVER"
            customLine={formCustomLine || undefined} />
          <PickButton selected={formPickSide === "UNDER"} onClick={() => handlePickSide("UNDER")}
            odds={odds?.under?.odds ?? null} line={getPickLine(odds, "TOTAL", "UNDER")} side="UNDER"
            customLine={formCustomLine || undefined} />
        </div>
      );
    }

    const awayOdds = formMarket === "ML" ? (odds?.awayMl?.odds ?? null) : (odds?.awayRl?.odds ?? null);
    const homeOdds = formMarket === "ML" ? (odds?.homeMl?.odds ?? null) : (odds?.homeRl?.odds ?? null);
    const awayLine = formMarket === "RL" ? (odds?.awayRl?.value ?? null) : null;
    const homeLine = formMarket === "RL" ? (odds?.homeRl?.value ?? null) : null;

    // For RL: pass the raw signed customLine as typed by the user.
    // The user enters the signed value they want (e.g. "-1.5" for favorite, "+1.5" for underdog).
    // DO NOT force sign by side — the user controls the sign.
    const awayCustomLine = formMarket === "RL" && formCustomLine ? formCustomLine : undefined;
    const homeCustomLine = formMarket === "RL" && formCustomLine ? formCustomLine : undefined;

    return (
      <div className="flex gap-2">
        <PickButton selected={formPickSide === "AWAY"} onClick={() => handlePickSide("AWAY")}
          logo={awayLogo} teamAbbr={awayTeam} teamNickname={awayNickname}
          odds={awayOdds} line={awayLine} side="AWAY" customLine={awayCustomLine} />
        <PickButton selected={formPickSide === "HOME"} onClick={() => handlePickSide("HOME")}
          logo={homeLogo} teamAbbr={homeTeam} teamNickname={homeNickname}
          odds={homeOdds} line={homeLine} side="HOME" customLine={homeCustomLine} />
      </div>
    );
  }, [formGame, formMarket, formPickSide, handlePickSide]);

  // ── Submit ────────────────────────────────────────────────────────────────
  // Submission lock: prevents duplicate bets from double-click or rapid re-tap.
  // createMut.isPending is already true during the mutation, but we add an extra
  // ref-based guard to block the second tap before React re-renders.
  const isSubmittingRef = useRef(false);
  const handleSubmit = async () => {
    console.log(`[BetTracker][ENTRY] handleSubmit called — isSubmittingRef=${isSubmittingRef.current} isPending=${createMut.isPending} formGame=${formGame?.id ?? 'null'} canAccess=${canAccess}`);
    if (isSubmittingRef.current || createMut.isPending) return;
    isSubmittingRef.current = true;
    setFormError("");
    // CRITICAL: always release the lock on validation failure — otherwise the
    // submit button is permanently disabled for the rest of the session.

    // [FIX] Validate and normalize gameDate before sending to server.
    // iOS Safari can return empty string or ISO datetime from date inputs.
    const normalizedDate = (formDate || "").slice(0, 10);
    if (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      console.error(`[BetTracker][ERROR] handleSubmit: invalid gameDate="${formDate}" normalized="${normalizedDate}"`);
      setFormError("Select a valid date (YYYY-MM-DD format required).");
      isSubmittingRef.current = false;
      return;
    }
    console.log(`[BetTracker][STATE] handleSubmit: gameDate validated — formDate="${formDate}" normalizedDate="${normalizedDate}"`);

    if (!formGame) {
      setFormError("Select a game from the slate.");
      isSubmittingRef.current = false;
      return;
    }
    if (isNaN(oddsNum) || oddsNum === 0) {
      setFormError("Enter valid American odds (e.g. -110, +145).");
      isSubmittingRef.current = false;
      return;
    }
    if (isNaN(riskNum) || riskNum <= 0) {
      setFormError(`Enter a valid ${stakeMode === "U" ? "unit" : "dollar"} amount.`);
      isSubmittingRef.current = false;
      return;
    }

    const riskDollars  = stakeMode === "U" ? riskNum * unitSize : riskNum;
    const toWinFinal   = !isNaN(toWinNum) && toWinNum > 0
      ? (stakeMode === "U" ? toWinNum * unitSize : toWinNum)
      : (stakeMode === "U" ? (autoToWin ?? 0) * unitSize : (autoToWin ?? calcToWin(oddsNum, riskNum)));

    let effectiveMarket   = formMarket;
    let effectivePickSide = formPickSide;
    let linePick: number | undefined = undefined;

    if (formTimeframe === "NRFI") {
      effectiveMarket   = "TOTAL";
      effectivePickSide = "UNDER";
      linePick          = 0.5;
      console.log(`[BetTracker][STATE] NRFI bet: enforcing market=TOTAL pickSide=UNDER line=0.5`);
    } else if (formTimeframe === "YRFI") {
      effectiveMarket   = "TOTAL";
      effectivePickSide = "OVER";
      linePick          = 0.5;
      console.log(`[BetTracker][STATE] YRFI bet: enforcing market=TOTAL pickSide=OVER line=0.5`);
    } else if (formGame?.odds) {
      const lv = getPickLine(formGame.odds, effectiveMarket, effectivePickSide);
      // CRITICAL: Store the raw signed value — do NOT apply Math.abs().
      // RL convention: HOME pick on favorite → lv = -1.5 (must win by >1.5)
      //                AWAY pick on underdog → lv = +1.5 (can lose by <1.5)
      // The grader formula: pickedMargin + rlLine > 0 requires the signed value.
      // Math.abs() was previously here and caused SEA -1.5 (won by 1) to grade as WIN.
      if (lv !== null && lv !== undefined) linePick = lv;
    }

    // Custom line override (for RL/TOTAL)
    const customLineNum = formCustomLine.trim() !== "" ? parseFloat(formCustomLine) : undefined;
    const effectiveCustomLine = (effectiveMarket === "RL" || effectiveMarket === "TOTAL") && customLineNum !== undefined && !isNaN(customLineNum)
      ? customLineNum
      : undefined;

    console.log(`[BetTracker][INPUT] create: sport=${activeSport} date=${formDate} game=${formGame.awayTeam}@${formGame.homeTeam} market=${effectiveMarket} pickSide=${effectivePickSide} odds=${oddsNum} risk=${riskDollars} toWin=${toWinFinal} wagerType=${formWagerType} customLine=${effectiveCustomLine ?? "null"}`);

    // Compute unit-denominated values for accurate bySize analytics
    const riskUnitsVal  = stakeMode === "U" ? riskNum : (unitSize > 0 ? riskDollars / unitSize : riskDollars);
    const toWinFinalU   = !isNaN(toWinNum) && toWinNum > 0
      ? (stakeMode === "U" ? toWinNum : (unitSize > 0 ? toWinFinal / unitSize : toWinFinal))
      : (stakeMode === "U" ? (autoToWin ?? 0) : (unitSize > 0 ? toWinFinal / unitSize : toWinFinal));
    console.log(`[BetTracker][STATE] riskUnits=${riskUnitsVal.toFixed(2)} toWinUnits=${toWinFinalU.toFixed(2)}`);
    try {
      await createMut.mutateAsync({
        anGameId:   formGame.id,
        gameNumber: formGame.gameNumber,  // 1 for G1/non-DH, 2 for G2 — critical for DH grading
        sport:      formSport,
        gameDate:   normalizedDate,  // [FIX] use normalized date (strips iOS Safari time component)
        awayTeam:   formGame.awayTeam,
        homeTeam:   formGame.homeTeam,
        timeframe:  formTimeframe,
        market:     effectiveMarket,
        pickSide:   effectivePickSide,
        odds:       oddsNum,
        risk:       riskDollars,
        toWin:      toWinFinal,
        riskUnits:  parseFloat(riskUnitsVal.toFixed(4)),
        toWinUnits: parseFloat(toWinFinalU.toFixed(4)),
        line:       linePick,
        notes:      formNotes || undefined,
        wagerType:  formWagerType,
        customLine: effectiveCustomLine,
      });
      setFormGame(null);
      setFormTimeframe("FULL_GAME");
      setFormMarket("ML");
      setFormPickSide("AWAY");
      setFormOdds("");
      setFormRisk("2");
      setFormToWin("");
      setFormToWinManual(false);
      setFormNotes("");
      setFormWagerType("PREGAME");
      setFormCustomLine("");
      console.log(`[BetTracker][OUTPUT] create: SUCCESS — bet saved to tracker`);
    } catch (err: unknown) {
      // Surface the exact error to the user — previously this was swallowed silently.
      // The user would see the optimistic bet appear and disappear with zero feedback.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BetTracker][ERROR] create FAILED:`, err);
      // Map common tRPC error codes to actionable user messages
      let userMsg = `Save failed: ${msg}`;
      if (msg.includes('UNAUTHORIZED') || msg.includes('Not authenticated') || msg.includes('Invalid session')) {
        userMsg = 'Session expired — please log out and log back in.';
      } else if (msg.includes('FORBIDDEN') || msg.includes('Access denied') || msg.includes('Handicapper access')) {
        userMsg = 'Access denied — your account does not have Bet Tracker access.';
      } else if (msg.includes('Session invalidated')) {
        userMsg = 'Session invalidated — please log out and log back in.';
      } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('Network')) {
        userMsg = 'Network error — check your connection and try again.';
      }
      setFormError(userMsg);
    } finally {
      // Always release the submission lock so the button re-enables after success OR error
      isSubmittingRef.current = false;
    }
  };

  // ── Stable callback refs — memo(BetCard) only re-renders when bet data changes, not parent state ──
  // Stable ref pattern: updateMut.mutateAsync changes every render (tRPC mutation object
  // is recreated). Storing it in a ref makes handleResult a stable callback reference,
  // so React.memo(BetCard) never re-renders due to a changed onResult prop.
  const updateMutRef = useRef(updateMut.mutateAsync);
  useEffect(() => { updateMutRef.current = updateMut.mutateAsync; });
  const handleResult = useCallback(async (id: number, result: Result) => {
    await updateMutRef.current({ id, result });
  }, []); // stable — never changes

  const handleEditSave = async () => {
    if (!editBet) return;
    if (editIsRequest) {
      // Submit edit request for porter/hank
      await submitRequestMut.mutateAsync({
        betId:       editBet.id,
        requestType: "EDIT",
        reason:      editRequestReason || undefined,
        proposedChanges: { notes: editNotes, result: editResult },
      });
    } else {
      await updateMut.mutateAsync({ id: editBet.id, notes: editNotes, result: editResult });
    }
    setEditBet(null);
    setEditIsRequest(false);
    setEditRequestReason("");
  };

  const handleDeleteConfirm = async () => {
    if (deleteId === null) return;
    if (deleteIsRequest) {
      await submitRequestMut.mutateAsync({
        betId:       deleteId,
        requestType: "DELETE",
        reason:      deleteRequestReason || undefined,
      });
    } else {
      await deleteMut.mutateAsync({ id: deleteId });
    }
    setDeleteId(null);
    setDeleteIsRequest(false);
    setDeleteRequestReason("");
  };

  // Stable onDelete/onEdit for BetCard memo — inline lambdas break memo every render
  const handleDeleteOpen = useCallback((id: number) => {
    setDeleteId(id);
    setDeleteIsRequest(!isOwnerOrAdmin);
    setDeleteRequestReason("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnerOrAdmin]);

  const handleEditOpen = useCallback((b: TrackedBet) => {
    setEditBet(b as EnrichedBet);
    setEditNotes(b.notes ?? "");
    setEditResult(b.result as Result);
    setEditIsRequest(!isOwnerOrAdmin);
    setEditRequestReason("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnerOrAdmin]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = (statsQuery.data ?? {
    totalBets: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
    totalRisk: 0, netProfit: 0, roi: 0,
    bestWin: 0, worstLoss: 0,
    byType: [], bySize: [], byMonth: [], bySport: [], byResult: [], byTimeframe: [],
    equityCurve: [],
  }) as StatsData;

  // ── Bet list with day separators ──────────────────────────────────────────
  const bets = listQuery.data ?? [];
  const betsWithSeparators = useMemo(() => {
    const result: Array<{ type: "separator"; date: string; wins: number; losses: number; pushes: number; pending: number; netProfit: number } | { type: "bet"; bet: EnrichedBet }> = [];

    // ── Sort logic within each date group ──────────────────────────────────
    // Rule 1: Wins before Losses (PUSH/PENDING/VOID after)
    // Rule 2: Within each result group, sort by riskUnits DESC (highest unit play first)
    //
    // Result priority: WIN=0, LOSS=1, PUSH=2, PENDING=3, VOID=4
    const RESULT_PRIORITY: Record<string, number> = {
      WIN: 0, LOSS: 1, PUSH: 2, PENDING: 3, VOID: 4,
    };
    function sortDayBets(dayBets: EnrichedBet[]): EnrichedBet[] {
      return [...dayBets].sort((a, b) => {
        const rA = RESULT_PRIORITY[a.result ?? "PENDING"] ?? 3;
        const rB = RESULT_PRIORITY[b.result ?? "PENDING"] ?? 3;
        if (rA !== rB) return rA - rB; // wins first
        // Within same result: highest riskUnits first
        const uA = parseFloat(String(a.riskUnits ?? 0));
        const uB = parseFloat(String(b.riskUnits ?? 0));
        return uB - uA;
      });
    }

    // Group bets by date (preserving date order from server: desc)
    const dateOrder: string[] = [];
    const byDate = new Map<string, EnrichedBet[]>();
    for (const bet of enrichedBets) {
      const d = bet.gameDate ?? "";
      if (!byDate.has(d)) {
        dateOrder.push(d);
        byDate.set(d, []);
      }
      byDate.get(d)!.push(bet);
    }

    for (const d of dateOrder) {
      const dayBets = byDate.get(d) ?? [];
      // ── Single-pass aggregation: replaces 4 separate .filter() + 1 .reduce() per date group ──
      let wins = 0, losses = 0, pushes = 0, pending = 0, netProfit = 0;
      for (const b of dayBets) {
        switch (b.result) {
          case "WIN":  { wins++;  const tw = parseFloat(String(b.toWinUnits ?? 0)); netProfit += isNaN(tw) ? 0 : tw; break; }
          case "LOSS": { losses++; const rk = parseFloat(String(b.riskUnits  ?? 0)); netProfit -= isNaN(rk) ? 0 : rk; break; }
          case "PUSH": pushes++;  break;
          case "PENDING": pending++; break;
        }
      }
      result.push({ type: "separator", date: d, wins, losses, pushes, pending, netProfit });
      // Sort within this date group before pushing
      for (const bet of sortDayBets(dayBets)) {
        result.push({ type: "bet", bet });
      }
    }

    return result;
  }, [enrichedBets]);

  // ── Pre-computed day sections — avoids rebuilding the sections array on every render ──
  // Previously this was an IIFE inside JSX that ran on every render cycle.
  // ── canDirectEdit map — hoisted out of per-bet render loop ─────────────────────────────────
  // Previously computed inline per bet (betOwnerIsHandicapper + canDirectEdit) — O(n) string
  // comparisons per render. Now computed once per bet list change as a Map<betId, boolean>.
  const canDirectEditMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const bet of enrichedBets) {
      const betOwnerIsHandicapper = bet.userId === appUser?.id && role === "handicapper";
      map.set(bet.id, isOwnerOrAdmin || !betOwnerIsHandicapper);
    }
    return map;
  }, [enrichedBets, appUser?.id, role, isOwnerOrAdmin]);

  // Now it runs only when betsWithSeparators changes (i.e. when bet data updates).
  type DaySectionItem = {
    sep: { date: string; wins: number; losses: number; pushes: number; pending: number; netProfit: number };
    bets: EnrichedBet[];
  };
  const daySections = useMemo((): DaySectionItem[] => {
    const sections: DaySectionItem[] = [];
    let current: DaySectionItem | null = null;
    for (const item of betsWithSeparators) {
      if (item.type === "separator") {
        current = { sep: item, bets: [] };
        sections.push(current);
      } else if (current) {
        current.bets.push(item.bet);
      }
    }
    return sections;
  }, [betsWithSeparators]);


  // ── Access guard ──────────────────────────────────────────────────────────
  if (authLoading) {
    // Show a page-structure skeleton instead of a blank full-screen spinner.
    // Eliminates the perceived blank-screen delay during auth check (~200-400ms).
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
          <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
              <div className="h-5 w-28 rounded bg-zinc-800 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              {[1,2,3].map(i => <div key={i} className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />)}
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 lg:px-8 border-b border-zinc-800/60">
          <div className="flex gap-6 h-11 items-end">
            {[1,2,3,4,5].map(i => <div key={i} className="h-4 w-10 rounded bg-zinc-800 animate-pulse mb-2" />)}
          </div>
        </div>
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex gap-2">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-8 w-16 rounded-full bg-zinc-800 animate-pulse" />)}
        </div>
        <div className="px-4 sm:px-6 lg:px-8 py-2 grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 h-20 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <AlertCircle className="mx-auto text-red-400" size={32} />
          <p className="text-white font-bold">Access Restricted</p>
          <p className="text-zinc-300 text-sm">Bet Tracker is available to Handicappers, Admins, and Owners only.</p>
          <button type="button" onClick={() => navigate("/")} className="text-emerald-400 text-sm underline">Go back</button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
    return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── Global error toast (fixed top, visible regardless of scroll) ── */}
      {formError && (
        <div className="fixed top-0 left-0 right-0 z-[100] flex items-center gap-2 bg-red-600 text-white text-xs font-semibold px-4 py-2.5 shadow-lg" role="alert">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span className="flex-1">{formError}</span>
          <button type="button" onClick={() => setFormError("")} className="ml-2 text-white/70 hover:text-white transition-colors text-base leading-none">&times;</button>
        </div>
      )}
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate("/")} className="text-zinc-300 hover:text-white transition-colors p-1">
              <ChevronLeft size={18} />
            </button>
            <TrendingUp size={18} className="text-emerald-400" />
            <span className="font-bold tracking-wider text-sm sm:text-base">BET TRACKER</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* $ / Units toggle */}
            <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
              <button type="button" onClick={() => setStakeMode("$")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${stakeMode === "$" ? "bg-emerald-500 text-white" : "text-zinc-300 hover:text-zinc-300"}`}
              >
                <DollarSign size={10} />$
              </button>
              <button type="button" onClick={() => setStakeMode("U")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all ${stakeMode === "U" ? "bg-emerald-500 text-white" : "text-zinc-300 hover:text-zinc-300"}`}
              >
                <Hash size={10} />U
              </button>
            </div>
            {/* Unit size (only in U mode) — narrower on mobile */}
            {stakeMode === "U" && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-300 hidden xs:inline">1u=$</span>
                <input
                  type="number"
                  value={unitSize}
                  onChange={e => setUnitSize(parseFloat(e.target.value) || 100)}
                  className="w-12 sm:w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  min={1}
                />
              </div>
            )}
            {/* Analytics toggle */}
            <button
              type="button"
              onClick={() => setShowAnalytics(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                showAnalytics
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-zinc-900 border-zinc-700 text-zinc-200 hover:text-zinc-200"
              }`}
              title="Toggle Analytics Panel"
            >
              <BarChart2 size={13} />
              <span className="hidden sm:inline">Analytics</span>
            </button>
            {/* Role badge */}
            <span className={`text-sm font-bold tracking-widest px-2 py-0.5 rounded-full border uppercase ${
              role === "owner"      ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              : role === "admin"    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            }`}>
              {appUser?.username ?? role}
            </span>
          </div>
        </div>

        {/* Sport tabs */}
        {/* Sport tabs: scrollable on mobile so all tabs are always visible */}
        <div className="w-full overflow-x-auto scrollbar-none">
          <div className="flex gap-0 px-4 sm:px-6 lg:px-8 min-w-max sm:min-w-0">
             {(["ALL", ...SPORTS] as SportOrAll[]).map(s => (
              <button type="button" key={s}
                onClick={() => setActiveSport(s)}
                onMouseEnter={() => s !== activeSport && handlePrefetch(s, dateRange)}
                className={`flex-shrink-0 px-4 py-2.5 text-xs font-bold tracking-wider transition-all border-b-2 ${
                  activeSport === s ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-300 hover:text-zinc-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/50 border-b border-zinc-800/60">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 space-y-3">

          {/* Handicapper selector + Date range pills — all in one scrollable row */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {/* Handicapper selector (owner/admin only) */}
            {isOwnerOrAdmin && (handicappersQuery.data?.length ?? 0) > 0 && (
              <div className="flex-shrink-0">
                <HandicapperSelector
                  handicappers={handicappersQuery.data ?? []}
                  selectedId={targetUserId}
                  onSelect={setTargetUserId}
                  currentUserId={appUser!.id}
                />
              </div>
            )}
            {/* Date range filter pills */}
            {(["ALL_TIME", "TODAY", "L7", "L14", "1M", "SEASON"] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setDateRange(r);
                  setFilterAllTime(r === "ALL_TIME");
                  if (IS_DEV) console.log(`[BetTracker][INPUT] dateRange changed to ${r}`);
                }}
                onMouseEnter={() => r !== dateRange && handlePrefetch(activeSport, r)}
                className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  dateRange === r
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-zinc-300"
                }`}
              >
                {r === "ALL_TIME" ? "All-Time"
                  : r === "TODAY"  ? "Today"
                  : r === "L7"     ? "L7"
                  : r === "L14"    ? "L14"
                  : r === "1M"     ? "1M"
                  : "Season"}
              </button>
            ))}
            {statsQuery.isLoading && (
              <div className="flex-shrink-0 w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Stat cards — desktop/tablet: centered flex-wrap row with equal spacing */}
          <div className="hidden sm:flex flex-wrap justify-center gap-2 sm:gap-3">
            {/* Each pill gets a consistent min-width so they're all the same height */}
            <div className="min-w-[100px]"><StatCard label="Total Bets" value={stats.totalBets} /></div>
            <div className="min-w-[100px]"><StatCard label="Wins"       value={stats.wins}   color="text-green-400" /></div>
            <div className="min-w-[100px]"><StatCard label="Losses"     value={stats.losses} color="text-red-400" /></div>
            {stats.pushes > 0 && (
              <div className="min-w-[100px]"><StatCard label="Pushes"   value={stats.pushes} color="text-yellow-400" /></div>
            )}
            {stats.pending > 0 && (
              <div className="min-w-[100px]"><StatCard label="Pending"  value={stats.pending} color="text-zinc-200" /></div>
            )}
            <div className="min-w-[100px]">
              <StatCard
                label="WP%"
                value={`${stats.wins + stats.losses > 0 ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) : "0.0"}%`}
                color="text-white"
              />
            </div>
            <div className="min-w-[110px]">
              <StatCard
                label="ROI%"
                value={`${stats.roi}%`}
                color={stats.roi >= 0 ? "text-green-400" : "text-red-400"}
                sub={`on ${stakeMode === "$" ? fmtDollar(stats.totalRisk * unitSize) : fmtUnits(stats.totalRisk)} risked`}
              />
            </div>
            <div className="min-w-[110px]">
              <StatCard
                label="Biggest Day"
                value={(stats.biggestDayUnits ?? 0) > 0 ? `+${fmtUnits(stats.biggestDayUnits ?? 0)}` : "—"}
                color="text-green-400"
                sub={stats.biggestDayDate ? stats.biggestDayDate.substring(5) : undefined}
              />
            </div>
            <div className="min-w-[100px]">
              <StatCard
                label="Win Streak"
                value={(stats.longestWinStreak ?? 0) > 0 ? `${stats.longestWinStreak}W` : "—"}
                color="text-emerald-400"
              />
            </div>
          </div>

          {/* Mobile: strict 3×2 grid — row1: Total Bets / +Units / Wins; row2: Losses / WP% / ROI% */}
          <div className="grid grid-cols-3 gap-2 sm:hidden">
            <StatCard label="Total Bets" value={stats.totalBets} />
            <StatCard label="+/- Units"  value={fmtUnits(stats.netProfit)} color={stats.netProfit >= 0 ? "text-green-400" : "text-red-400"} />
            <StatCard label="Wins"       value={stats.wins}   color="text-green-400" />
            <StatCard label="Losses"     value={stats.losses} color="text-red-400" />
            <StatCard
              label="WP%"
              value={`${stats.wins + stats.losses > 0 ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) : "0.0"}%`}
              color="text-white"
            />
            <StatCard
              label="ROI%"
              value={`${stats.roi}%`}
              color={stats.roi >= 0 ? "text-green-400" : "text-red-400"}
              sub={`on ${stakeMode === "$" ? fmtDollar(stats.totalRisk * unitSize) : fmtUnits(stats.totalRisk)} risked`}
            />
          </div>
        </div>
      </div>

      {/* ── Analytics Panel ────────────────────────────────────────────────── */}
      {showAnalytics && (
        <div className="bg-zinc-900/30 border-b border-zinc-800/60">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-4 space-y-4">
            <div>
              <div className="flex flex-col items-center justify-center gap-1 mb-3">
                {dateRange === "SEASON" ? (
                  /* ── Season mode: sport logo + season title + PREZ BETS + units ── */
                  <>
                    {/* Sport-specific season title */}
                    <div className="flex items-center gap-2 mb-0.5">
                      {/* Sport logo/emoji */}
                      {activeSport === "MLB" && (
                        <span className="text-2xl" role="img" aria-label="MLB">⚾</span>
                      )}
                      {activeSport === "NHL" && (
                        <span className="text-2xl" role="img" aria-label="NHL">🏒</span>
                      )}
                      {activeSport === "NBA" && (
                        <span className="text-2xl" role="img" aria-label="NBA">🏀</span>
                      )}
                      {activeSport === "NCAAM" && (
                        <span className="text-2xl" role="img" aria-label="NCAAM">🏀</span>
                      )}
                      {activeSport === "ALL" && (
                        <span className="text-2xl" role="img" aria-label="All Sports">🏆</span>
                      )}
                      <span className="text-lg sm:text-xl font-bold tracking-widest uppercase text-white">
                        {activeSport === "MLB"   ? "2026 MLB SEASON"
                          : activeSport === "NHL"   ? "2025-26 NHL SEASON"
                          : activeSport === "NBA"   ? "2025-26 NBA SEASON"
                          : activeSport === "NCAAM" ? "2025-26 NCAAM SEASON"
                          : "2025-26 SEASON"}
                      </span>
                    </div>
                    {/* Dynamic handicapper name */}
                    <span className="text-sm text-zinc-300 tracking-widest uppercase font-semibold mb-1">{selectedHandicapperName}</span>
                    {/* +/- Units for the season */}
                    <div className="flex items-center gap-2">
                      <TrendingUp size={24} className={stats.netProfit >= 0 ? "text-emerald-400" : "text-red-400"} />
                      <span className={`text-3xl sm:text-4xl font-bold tracking-widest ${stats.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {stats.netProfit >= 0 ? "+" : ""}{fmtUnits(stats.netProfit)}
                      </span>
                    </div>
                    {/* Dollar P&L — shown when unitSize > 0 */}
                    {unitSize > 0 && (
                      <div className={`text-sm font-mono font-semibold ${
                        stats.netProfit >= 0 ? "text-emerald-300" : "text-red-300"
                      }`}>
                        {stats.netProfit >= 0 ? "+" : ""}
                        ${Math.abs(stats.netProfit * unitSize).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        {" "}tailing @{selectedHandicapperName.toLowerCase().replace(/\s+/g, "")}
                      </div>
                    )}
                  </>
                ) : (
                  /* ── All other modes: trend icon + units value ── */
                  <>
                    <div className="flex items-center gap-2.5">
                      <TrendingUp size={28} className={stats.netProfit >= 0 ? "text-emerald-400" : "text-red-400"} />
                      <span className={`text-3xl sm:text-4xl font-bold tracking-widest uppercase ${stats.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {stats.netProfit >= 0 ? "+" : ""}{fmtUnits(stats.netProfit)}
                      </span>
                    </div>
                    <span className="text-sm text-zinc-300">
                      {dateRange === "ALL_TIME"
                        ? (activeSport === "ALL" ? "All Sports · All-Time" : `${activeSport} · All-Time`)
                        : dateRange === "TODAY"
                          ? (activeSport === "ALL" ? "All Sports · Today" : `${activeSport} · Today`)
                          : dateRange === "L7"
                            ? (activeSport === "ALL" ? "All Sports · L7" : `${activeSport} · L7`)
                            : dateRange === "L14"
                              ? (activeSport === "ALL" ? "All Sports · L14" : `${activeSport} · L14`)
                              : (activeSport === "ALL" ? "All Sports · 1M" : `${activeSport} · 1M`)
                      }
                    </span>
                  </>
                )}
              </div>
              <EquityChart points={stats.equityCurve} />
            </div>

          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 xl:gap-6 items-start">

          {/* ── Left Column: Add Bet Form + Breakdowns ───────────────────── */}
          <div className="flex flex-col gap-4">
          {/* ── Add Bet Form ──────────────────────────────────────────────── */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl h-fit">
            {/* Header — always visible; tap to collapse/expand on mobile */}
            <button
              type="button"
              onClick={() => {
                setAddBetOpen(prev => !prev);
                if (IS_DEV) console.log(`[BetTracker][INPUT] addBet toggled: ${!addBetOpen}`);
              }}
              className="w-full flex items-center gap-2 px-5 pt-5 pb-4 border-b border-zinc-800 lg:cursor-default"
            >
              <Plus size={15} className="text-emerald-400 shrink-0" />
              <h2 className="font-bold text-sm tracking-wider flex-1 text-left">ADD BET</h2>
              {/* Chevron: only visible on mobile/tablet (hidden on lg+) */}
              <ChevronDown
                size={16}
                className={`text-zinc-200 transition-transform duration-200 lg:hidden ${addBetOpen ? "rotate-180" : ""}`}
              />
            </button>
            {/* Body — always visible on lg+; toggle on mobile */}
            <div className={`p-5 space-y-4 ${
              addBetOpen ? "block" : "hidden"
            } lg:block`}>

            {/* DATE */}
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Date</label>
              <input
                type="date"
                value={formDate}
                onChange={e => {
                  // [FIX] iOS Safari <input type="date"> sometimes returns a full ISO datetime
                  // string (e.g. "2026-05-16T12:00:00") instead of a plain date string.
                  // Slice to first 10 chars to normalize to YYYY-MM-DD in all browsers.
                  const raw = e.target.value || "";
                  const normalized = raw.slice(0, 10);
                  // Validate format before setting — reject malformed values
                  if (normalized && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
                    console.warn(`[BetTracker][WARN] date input rejected: raw="${raw}" normalized="${normalized}" — not YYYY-MM-DD`);
                    return;
                  }
                  console.log(`[BetTracker][STATE] formDate changed: raw="${raw}" → normalized="${normalized}"`);
                  setFormDate(normalized);
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* WAGER TYPE: PREGAME / LIVE */}
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Wager Type</label>
              <div className="flex items-center bg-zinc-900 border border-zinc-700 rounded-lg p-0.5 w-fit">
                <button type="button" onClick={() => setFormWagerType("PREGAME")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    formWagerType === "PREGAME"
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-300 hover:text-zinc-300"
                  }`}
                >
                  PRE-GAME
                </button>
                <button type="button" onClick={() => setFormWagerType("LIVE")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    formWagerType === "LIVE"
                      ? "bg-red-500/20 border border-red-500/30 text-red-400"
                      : "text-zinc-300 hover:text-zinc-300"
                  }`}
                >
                  <Radio size={10} />LIVE
                </button>
              </div>
            </div>

            {/* GAME */}
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Game</label>
              <GameSelector
                games={slateGames}
                selectedId={formGame?.id ?? null}
                onSelect={handleGameSelect}
                loading={slateQuery.isLoading}
                sport={formSport}
                formDate={formDate}
                linescoreByTeams={linescoreByTeams}
                linescoreByPk={linescoreByPk}
                linescoreByGameNum={linescoreByGameNum}
              />
            </div>

            {/* TIMEFRAME */}
            <SelectField
              label="Timeframe"
              value={formTimeframe}
              onChange={v => setFormTimeframe(v as Timeframe)}
              options={timeframeOptions}
            />

            {/* MARKET — hidden for NRFI/YRFI */}
            {formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <SelectField
                label={`Market — ${MARKET_LABELS[formSport][formMarket]}`}
                value={formMarket}
                onChange={v => setFormMarket(v as Market)}
                options={(["ML", "RL", "TOTAL"] as Market[]).map(m => ({
                  value: m,
                  label: MARKET_LABELS[formSport][m],
                }))}
              />
            )}

            {/* NRFI/YRFI locked info banner */}
            {(formTimeframe === "NRFI" || formTimeframe === "YRFI") && (
              <div className="flex items-start gap-2 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2.5">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-sm text-zinc-300 leading-relaxed">
                  <span className="font-bold text-emerald-400">{formTimeframe}</span>
                  {formTimeframe === "NRFI"
                    ? " — No Run First Inning. Auto-set: TOTAL UNDER 0.5 runs in inning 1."
                    : " — Yes Run First Inning. Auto-set: TOTAL OVER 0.5 runs in inning 1."}
                </div>
              </div>
            )}

            {/* PICK — hidden for NRFI/YRFI */}
            {formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Pick</label>
                {formGame ? (
                  pickButtons
                ) : (
                  <div className="flex gap-2">
                    {(formMarket === "TOTAL" ? ["OVER", "UNDER"] : ["AWAY", "HOME"]).map(s => (
                      <div key={s} className="flex-1 flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 opacity-40">
                        <div className="w-8 h-8 rounded-full bg-zinc-800" />
                        <div className="text-sm text-zinc-300 font-bold">{s}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CUSTOM LINE (for RL and TOTAL only) */}
            {(formMarket === "RL" || formMarket === "TOTAL") && formTimeframe !== "NRFI" && formTimeframe !== "YRFI" && (
              <div className="flex flex-col gap-1">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">
                  {formMarket === "TOTAL" ? "Total Line (e.g. 8, 8.5)" : "Run Line (e.g. -1.5, +1.5)"}
                </label>
                <input
                  type="number"
                  value={formCustomLine}
                  onChange={e => setFormCustomLine(e.target.value)}
                  placeholder={formMarket === "TOTAL" ? "8.0" : "-1.5"}
                  step="0.5"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />

              </div>
            )}

            {/* ODDS + RISK + TO WIN */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Odds</label>
                <input
                  type="number"
                  value={formOdds}
                  onChange={e => setFormOdds(e.target.value)}
                  placeholder="-110"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">{riskLabel}</label>
                <input
                  type="number"
                  value={formRisk}
                  onChange={e => setFormRisk(e.target.value)}
                  placeholder={stakeMode === "U" ? "2" : "200"}
                  min={0}
                  step={stakeMode === "U" ? "0.5" : "10"}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">
                  {toWinLabel}
                  {formToWinManual && (
                    <button type="button"
                      onClick={() => { setFormToWinManual(false); if (autoToWin !== null) setFormToWin(String(autoToWin)); }}
                      className="ml-1 text-xs text-emerald-400 underline"
                    >
                      reset
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  value={formToWin}
                  onChange={e => { setFormToWin(e.target.value); setFormToWinManual(true); }}
                  placeholder={autoToWin !== null ? String(autoToWin) : "0"}
                  min={0}
                  step={stakeMode === "U" ? "0.5" : "10"}
                  className={`w-full bg-zinc-900 border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors ${
                    formToWinManual ? "border-emerald-500/50 text-emerald-400" : "border-zinc-700"
                  }`}
                />
              </div>
            </div>

            {/* Unit math explainer */}
            {stakeMode === "U" && !isNaN(toWinNum) && toWinNum > 0 && riskNum > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-zinc-300 bg-zinc-800/50 rounded-lg px-3 py-2">
                <Hash size={10} className="text-emerald-400 shrink-0" />
                <span>
                  {fmtUnits(riskNum)} to win {fmtUnits(toWinNum)}
                  {unitSize > 0 && (
                    <span className="text-zinc-300 ml-1">
                      ({fmtDollar(riskNum * unitSize)} to win {fmtDollar(toWinNum * unitSize)})
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* NOTES */}
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Notes (optional)</label>
              <textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Model edge, reasoning, context…"
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder:text-zinc-300"
              />
            </div>

            {/* Error */}
            {formError && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle size={13} />
                {formError}
              </div>
            )}

            {/* Submit */}
            <button type="button" onClick={handleSubmit}
              disabled={createMut.isPending || !formGame}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm tracking-wider transition-all"
            >
              {createMut.isPending ? "Saving…" : "TRACK BET"}
            </button>
            </div>{/* end Add Bet body */}
          </div>{/* end Add Bet card */}

          {/* ── Breakdowns (below Add Bet, same left column) ───────────── */}
          {/* Always visible on all screen sizes — collapsible on mobile/tablet */}
          <BreakdownsSidebar stats={stats} unitSize={unitSize} />
          </div>{/* end left column */}
          {/* ── Right Panel: Tabs (BETS | LOGS) ──────────────────────────── */}
          <div className="space-y-4">

            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
              <button type="button"
                onClick={() => setActiveTab("BETS")}
                className={`px-4 py-2.5 text-xs font-bold tracking-wider border-b-2 transition-all ${
                  activeTab === "BETS"
                    ? "border-emerald-400 text-emerald-400"
                    : "border-transparent text-zinc-300 hover:text-zinc-300"
                }`}
              >
                BETS
              </button>
              {isOwnerOrAdmin && (
                <button type="button"
                  onClick={() => setActiveTab("LOGS")}
                  className={`px-4 py-2.5 text-xs font-bold tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                    activeTab === "LOGS"
                      ? "border-emerald-400 text-emerald-400"
                      : "border-transparent text-zinc-300 hover:text-zinc-300"
                  }`}
                >
                  <FileText size={11} />LOGS
                </button>
              )}
            </div>

            {/* BETS Tab */}
            {activeTab === "BETS" && (
              <>
                {/* Filter bar */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Result</label>
                    <div className="relative">
                      <select
                        value={filterResult}
                        onChange={e => setFilterResult(e.target.value as Result | "")}
                        className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                      >
                        <option value="">All Results</option>
                        {RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-300 pointer-events-none" />
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2 self-end pb-2">
                    <span className="text-xs text-zinc-300">{bets.length} bet{bets.length !== 1 ? "s" : ""}</span>
                    {(linescoreQuery.isFetching || autoGradeMut.isPending) && (
                      <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" title={autoGradeMut.isPending ? "Auto-grading…" : "Refreshing linescores…"} />
                    )}
                  </div>
                </div>

                {/* Bet cards with day separators */}
                {listQuery.isLoading ? (
                  /* ── Skeleton BetCard placeholders — eliminates layout shift on load ── */
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="rounded-xl overflow-hidden border border-zinc-800/60 animate-pulse">
                        {/* Date strip skeleton */}
                        <div className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900/80">
                          <div className="h-4 w-24 bg-zinc-800 rounded" />
                          <div className="flex-1 h-px bg-zinc-800" />
                          <div className="h-3 w-16 bg-zinc-800 rounded" />
                          <div className="h-3 w-12 bg-zinc-800 rounded" />
                        </div>
                        {/* BetCard skeleton */}
                        <div className="p-3 space-y-3 bg-zinc-950/40">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-zinc-800" />
                            <div className="flex-1 flex flex-col items-center gap-1">
                              <div className="h-4 w-32 bg-zinc-800 rounded" />
                              <div className="h-3 w-20 bg-zinc-800 rounded" />
                            </div>
                            <div className="w-10 h-10 rounded-full bg-zinc-800" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="h-6 w-28 bg-zinc-800 rounded-lg" />
                            <div className="h-5 w-16 bg-zinc-800 rounded" />
                            <div className="h-5 w-16 bg-zinc-800 rounded" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : bets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                    <Clock size={28} className="text-zinc-700" />
                    <p className="text-zinc-300 text-sm">
                      {filterAllTime
                        ? `No bets tracked yet${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`
                        : dateRange === "TODAY"
                          ? `No bets for ${activeSport !== "ALL" ? activeSport : "any sport"} today (${fmtDate(todayEst())}).`
                          : dateRange === "L7"
                            ? `No bets in the last 7 days${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`
                            : dateRange === "L14"
                              ? `No bets in the last 14 days${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`
                              : dateRange === "1M"
                                ? `No bets in the last 30 days${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`
                                : dateRange === "SEASON"
                                  ? `No bets this season${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`
                                  : `No bets tracked yet${activeSport !== "ALL" ? ` for ${activeSport}` : ""}.`}
                    </p>
                    {!filterAllTime && (
                      <button
                        type="button"
                        onClick={() => { setDateRange("ALL_TIME"); setFilterAllTime(true); }}
                        className="mt-1 px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        ← Switch to All-Time
                      </button>
                    )}
                    {filterAllTime && (
                      <p className="text-zinc-300 text-xs">Use the form above to add your first bet.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {daySections.map(section => {
                        const { sep } = section;
                        const isExpanded = expandedDates.has(sep.date);
                        const record = `${sep.wins}W-${sep.losses}L${sep.pushes > 0 ? `-${sep.pushes}P` : ""}`;
                        const pl = sep.netProfit;
                        const plStr = `${pl >= 0 ? "+" : ""}${pl.toFixed(2)}u`;
                        const plColor = pl > 0 ? "text-emerald-400" : pl < 0 ? "text-red-400" : "text-zinc-200";

                        return (
                          <div key={`day-${sep.date}`} className="rounded-xl overflow-hidden border border-zinc-800/60">
                            {/* ── Collapsible strip: DATE  W-L  +/-UNITS  chevron ── */}
                            <button
                              type="button"
                              onClick={() => toggleDate(sep.date)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 bg-zinc-900/80 hover:bg-zinc-800/80 transition-colors"
                            >
                              {/* Date label */}
                              <span className="text-sm font-bold tracking-wide text-white whitespace-nowrap">
                                {sep.date ? fmtDate(sep.date) : "Unknown Date"}
                              </span>
                              {/* Divider line */}
                              <div className="flex-1 h-px bg-zinc-700/50" />
                              {/* W-L record */}
                              <span className="text-xs font-mono text-zinc-200 whitespace-nowrap">{record}</span>
                              {/* +/- units */}
                              <span className={`text-xs font-bold font-mono whitespace-nowrap ${plColor}`}>{plStr}</span>
                              {/* Chevron */}
                              <ChevronDown
                                size={14}
                                className={`text-zinc-300 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>

                            {/* ── Expanded bet cards ── */}
                            {isExpanded && (
                              <div className="space-y-2 p-2 bg-zinc-950/40">
                                {section.bets.map(bet => {
                                  // DH-SAFE linescore resolution for bet history cards.
                                  // AN game IDs ≠ MLB gamePks — linescoreByPk.get(bet.anGameId) ALWAYS misses.
                                  // Correct approach: match by gameDate:away:home:gameNumber.
                                  // bet.gameNumber is stored at bet-creation time from SlateGame.gameNumber.
                                  // Legacy bets without gameNumber default to 1 (non-DH or G1).
                                  const betGameNum = (bet as { gameNumber?: number | null }).gameNumber ?? 1;
                                  const ls = bet.sport === "MLB"
                                    ? (
                                        // Primary: DH-safe gameNumber key
                                        linescoreByGameNum.get(`${bet.gameDate}:${bet.awayTeam}:${bet.homeTeam}:${betGameNum}`) ??
                                        // Fallback: team-name key (safe for non-DH games)
                                        linescoreByTeams.get(`${bet.gameDate}:${bet.awayTeam}:${bet.homeTeam}`)
                                      ) ?? undefined
                                    : undefined;
                                  if (IS_DEV && bet.sport === "MLB") {
                                    console.log(`[BetCard][LINESCORE] betId=${bet.id} gameNum=${betGameNum} ${bet.awayTeam}@${bet.homeTeam} date=${bet.gameDate} → gamePk=${ls?.gamePk ?? "MISS"} R=${ls?.awayR ?? "?"}-${ls?.homeR ?? "?"}`);
                                  }
                                  const canDirectEdit = canDirectEditMap.get(bet.id) ?? true;
                                  return (
                                    <BetCard
                                      key={bet.id}
                                      bet={bet}
                                      stakeMode={stakeMode}
                                      unitSize={unitSize}
                                      onResult={handleResult}
                                      onDelete={handleDeleteOpen}
                                      onEdit={handleEditOpen}
                                      linescore={ls}
                                      canDirectEdit={canDirectEdit}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                    })}
                  </div>
                )}

                {/* ── IntersectionObserver sentinel — auto-triggers next page fetch when scrolled into view ── */}
                {/* Placed 200px before list end; observer pre-loads next page before user reaches bottom */}
                <div ref={loadMoreRef} className="flex justify-center py-4 min-h-[1px]">
                  {isFetchingNextPage && (
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      Loading more bets…
                    </div>
                  )}
                </div>
              </>
            )}

            {/* LOGS Tab */}
            {activeTab === "LOGS" && isOwnerOrAdmin && (
              <LogsTab
                logsQuery={logsQuery}
                reviewMut={reviewMut}
                invalidateLogs={invalidateLogs}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editBet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider">
              {editIsRequest ? "📋 REQUEST EDIT" : "EDIT BET"}
            </h3>
            {editIsRequest && (
              <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                <Lock size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-sm text-zinc-300">
                  Your bets are immutable. This will submit an edit request for owner/admin review.
                </p>
              </div>
            )}
            <div className="text-xs text-zinc-200">{editBet.pick} · {fmtOdds(editBet.odds)}</div>
            <SelectField
              label="Result"
              value={editResult}
              onChange={v => setEditResult(v as Result)}
              options={RESULTS.map(r => ({ value: r, label: r }))}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Notes</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
            {editIsRequest && (
              <div className="flex flex-col gap-1">
                <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Reason for Request</label>
                <textarea
                  value={editRequestReason}
                  onChange={e => setEditRequestReason(e.target.value)}
                  rows={2}
                  placeholder="Explain why this change is needed…"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500 transition-colors"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditBet(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-200 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleEditSave}
                disabled={updateMut.isPending || submitRequestMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  editIsRequest ? "bg-yellow-600 hover:bg-yellow-500" : "bg-emerald-500 hover:bg-emerald-400"
                }`}
              >
                {(updateMut.isPending || submitRequestMut.isPending)
                  ? "Saving…"
                  : editIsRequest ? "Submit Request" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grade toast ─────────────────────────────────────────────────────── */}
      {gradeToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/40 rounded-2xl shadow-2xl p-4 w-72 animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-emerald-400" />
            <span className="text-sm font-bold text-white tracking-wider">BETS GRADED</span>
            <button type="button" onClick={() => setGradeToast(null)} className="ml-auto text-zinc-300 hover:text-zinc-300 transition-colors">
              <Minus size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-zinc-800 rounded-lg px-3 py-2">
              <div className="text-zinc-300 text-sm uppercase tracking-wider">Graded</div>
              <div className="text-white font-bold">{gradeToast.graded}</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
              <div className="text-zinc-300 text-sm uppercase tracking-wider">Wins</div>
              <div className="text-green-400 font-bold">{gradeToast.wins}</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <div className="text-zinc-300 text-sm uppercase tracking-wider">Losses</div>
              <div className="text-red-400 font-bold">{gradeToast.losses}</div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded
-lg px-3 py-2">
              <div className="text-zinc-300 text-sm uppercase tracking-wider">Pushes</div>
              <div className="text-yellow-400 font-bold">{gradeToast.pushes}</div>
            </div>
          </div>
          {gradeToast.stillPending > 0 && (
            <div className="mt-2 text-sm text-zinc-300">
              {gradeToast.stillPending} bet{gradeToast.stillPending !== 1 ? "s" : ""} still pending (game not final yet)
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-sm tracking-wider text-red-400">
              {deleteIsRequest ? "📋 REQUEST DELETION" : "DELETE BET"}
            </h3>
            {deleteIsRequest ? (
              <>
                <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                  <Lock size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-zinc-300">
                    Your bets are immutable. This will submit a deletion request for owner/admin review.
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm tracking-widest text-zinc-300 uppercase font-medium">Reason for Request</label>
                  <textarea
                    value={deleteRequestReason}
                    onChange={e => setDeleteRequestReason(e.target.value)}
                    rows={2}
                    placeholder="Explain why this bet should be removed…"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500 transition-colors"
                  />
                </div>
              </>
            ) : (
              <p className="text-zinc-200 text-sm">This action cannot be undone. The bet will be permanently removed.</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setDeleteId(null); setDeleteIsRequest(false); setDeleteRequestReason(""); }}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-200 text-sm font-medium hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
              <button type="button" onClick={handleDeleteConfirm}
                disabled={deleteMut.isPending || submitRequestMut.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40 ${
                  deleteIsRequest ? "bg-yellow-600 hover:bg-yellow-500" : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {(deleteMut.isPending || submitRequestMut.isPending)
                  ? "Processing…"
                  : deleteIsRequest ? "Submit Request" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
