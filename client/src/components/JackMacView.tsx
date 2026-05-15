/**
 * JackMacView.tsx — Inline JACK MAC tab component.
 *
 * Embeds all 4 Rotogrinders THE BAT X projection sub-tabs + MLB Lineups tab
 * directly inside the main feed tab bar (MLB only).
 * Access is restricted to @prez, @sippi, and @lucianobets.
 *
 * Sub-tabs:
 *   1. Today Pitchers    (today-pitchers)
 *   2. Today Hitters     (today-hitters)
 *   3. Tomorrow Pitchers (tomorrow-pitchers)
 *   4. Tomorrow Hitters  (tomorrow-hitters)
 *   5. Lineups           (lineups — MLB Stats API, card layout)
 *
 * Features (identical to Resources.tsx):
 *   - CSV Export per sub-tab
 *   - Column Visibility Groups (localStorage-persisted)
 *   - Staleness Auto-Refresh (>15 min)
 *   - Player Headshots (MLB static CDN)
 *   - Team / Opponent Logos (ESPN CDN)
 *   - Sort + Search
 *
 * Diagnostic logging: all state transitions use structured console labels.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  AlertTriangle,
  Lock,
  Loader2,
  Download,
  Columns,
  CheckSquare,
  Square,
  RotateCcw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RgTableData {
  title: string;
  pageKey: string;
  type: "pitchers" | "hitters";
  updatedAt: string;
  columns: string[];
  rows: Record<string, string>[];
}
interface CacheEntry {
  data: RgTableData;
  fetchedAt: number;
}
type SortDir = "asc" | "desc" | null;

// Lineup types (mirrors server/fangraphsScraper.ts)
interface FgPitcher {
  playerId: number;
  name: string;
  throws: string;
  wins: number;
  losses: number;
  era: string;
  ip: string;
  strikeouts: number;
  whip: string;
}
interface FgBatter {
  order: number;
  playerId: number;
  name: string;
  bats: string;
  position: string;
  isProjected: boolean;
}
interface FgTeamLineup {
  teamId: number;
  teamName: string;
  teamAbbr: string;
  winProbability: number;
  pitcher: FgPitcher | null;
  lineup: FgBatter[];
  lineupStatus: "Posted" | "Projected" | "None";
}
interface FgGame {
  gameId: number;
  gameTimeUtc: string;
  away: FgTeamLineup;
  home: FgTeamLineup;
}
interface FgDateResult {
  date: string;
  games: FgGame[];
  scrapedAt: string;
  elapsedMs: number;
}
interface FgScrapeResult {
  today: FgDateResult;
  tomorrow: FgDateResult;
  totalGames: number;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STALE_MS = 15 * 60 * 1000;
const LS_COL_VIS_KEY = "rg_col_vis_v2"; // shared with Resources.tsx intentionally

const TABS = [
  { key: "today-pitchers",    label: "Today Pitchers",    short: "T.P",  type: "pitchers" as const },
  { key: "today-hitters",     label: "Today Hitters",     short: "T.H",  type: "hitters"  as const },
  { key: "tomorrow-pitchers", label: "Tomorrow Pitchers", short: "TM.P", type: "pitchers" as const },
  { key: "tomorrow-hitters",  label: "Tomorrow Hitters",  short: "TM.H", type: "hitters"  as const },
] as const;
type TabKey = typeof TABS[number]["key"];

// JACK MAC whitelist — must match server/rotogrinderProxy.ts ALLOWED_USERNAMES
const JACK_MAC_WHITELIST = new Set(["prez", "lucianobets", "sippi"]);

const INTERNAL_COLS = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);

// ─── Column Groups ────────────────────────────────────────────────────────────

interface ColGroup { label: string; cols: string[] }

const PITCHER_GROUPS: ColGroup[] = [
  { label: "Identity",    cols: ["NAME", "PLAYER_ID", "MLB_ID", "TEAM", "OPP", "OPP_TM", "HAND"] },
  { label: "Core Stats",  cols: ["IP", "W", "K", "ERA", "WHIP", "FPTS", "QS", "L"] },
  { label: "DFS Lines",   cols: ["TOMORROW_DK", "TOMORROW_FD", "TOMORROW_YAHOO", "TOMORROW_5X5", "TOMORROW_ESPN", "TOMORROW_YAHOO_SL"] },
  { label: "Ownership",   cols: ["12TEAM_OWN", "15TEAM_OWN"] },
  { label: "Context",     cols: ["PARK", "ROOF", "UMPIRE", "PLATOON", "GVF", "HFA", "DH", "TILT_BIAS"] },
  { label: "Advanced",    cols: ["ER", "H", "HR", "BB", "TBF", "IBB", "HBP", "TB", "SH", "SF", "GIDP", "SB", "CS", "CG", "CGSH"] },
  { label: "Flags",       cols: ["OPENER", "CATCHER", "BPC", "PPC", "MPC", "2H", "ERROR"] },
];
const HITTER_GROUPS: ColGroup[] = [
  { label: "Identity",      cols: ["NAME", "PLAYER_ID", "MLB_ID", "TEAM", "OPP_TM", "POS", "HAND"] },
  { label: "Core Stats",    cols: ["FPTS", "FPTS/$", "HR", "RBI", "R", "SB", "BA", "OBP", "SLG", "WOBA"] },
  { label: "DFS Salary",    cols: ["SALARY", "LP", "OL", "OD", "IPL", "POWN", "FLOOR", "CEILING", "SLATE"] },
  { label: "Advanced",      cols: ["CNWOBA", "XWOBA_CS", "XWOBA_LS", "ISO", "PA", "PAVSSP", "PAVSSP%", "OBFPTS", "0%_PH%_FPTS"] },
  { label: "Context",       cols: ["PITCHER", "CATCHER", "UMPIRE", "PARK", "ROOF", "GVF", "HFA", "PLATOON", "PH%", "COLD", "TILT_BIAS"] },
  { label: "Raw Counting",  cols: ["AB", "K", "BB", "IBB", "HBP", "H", "1B", "2B", "3B", "HR_DEPENDENCE", "TB", "CS", "SH", "SF", "GIDP"] },
  { label: "Flags",         cols: ["2H", "ERROR"] },
];

function getGroups(type: "pitchers" | "hitters"): ColGroup[] {
  return type === "pitchers" ? PITCHER_GROUPS : HITTER_GROUPS;
}
function buildDefaultVisibility(type: "pitchers" | "hitters"): Record<string, boolean> {
  const groups = getGroups(type);
  const result: Record<string, boolean> = {};
  for (const g of groups) result[g.label] = true;
  return result;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadColVisFromStorage(): Partial<Record<TabKey, Record<string, boolean>>> {
  try {
    const raw = localStorage.getItem(LS_COL_VIS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}
function saveColVisToStorage(colVis: Partial<Record<TabKey, Record<string, boolean>>>) {
  try { localStorage.setItem(LS_COL_VIS_KEY, JSON.stringify(colVis)); } catch { /* ignore */ }
}

// ─── CSV Utility ──────────────────────────────────────────────────────────────

function exportCsv(tabKey: TabKey, columns: string[], rows: Record<string, string>[]) {
  const exportCols = columns.filter(c => !INTERNAL_COLS.has(c));
  console.log(`[JACKMAC][CSV][STEP] Exporting ${rows.length} rows × ${exportCols.length} cols for tab="${tabKey}"`);
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const header = exportCols.map(escape).join(",");
  const body = rows.map(r => exportCols.map(c => escape(r[c] ?? "")).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  a.href = url;
  a.download = `jackmac-${tabKey}-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[JACKMAC][CSV][OUTPUT] Downloaded: jackmac-${tabKey}-${ts}.csv (${(csv.length / 1024).toFixed(1)} KB)`);
}

// ─── Age Label ────────────────────────────────────────────────────────────────

function formatAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
}

// ─── Lineup Card Components ───────────────────────────────────────────────────

function PitcherBadge({ pitcher, side }: { pitcher: FgPitcher | null; side: "away" | "home" }) {
  if (!pitcher) {
    return (
      <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
        <span className="font-medium">TBD</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${pitcher.throws === "L" ? "bg-amber-900/50 text-amber-300" : "bg-sky-900/50 text-sky-300"}`}>
          {pitcher.throws}HP
        </span>
        <span className="text-xs font-semibold text-white truncate max-w-[120px]">{pitcher.name}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
        <span>{pitcher.wins}-{pitcher.losses}</span>
        <span className="text-zinc-600">·</span>
        <span>{pitcher.era} ERA</span>
        <span className="text-zinc-600">·</span>
        <span>{pitcher.ip} IP</span>
        <span className="text-zinc-600">·</span>
        <span>{pitcher.strikeouts} K</span>
      </div>
    </div>
  );
}

function LineupTable({ team }: { team: FgTeamLineup }) {
  const statusColor = team.lineupStatus === "Posted"
    ? "text-emerald-400"
    : team.lineupStatus === "Projected"
    ? "text-amber-400"
    : "text-zinc-500";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">{team.teamAbbr} Lineup</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider ${statusColor}`}>
          {team.lineupStatus}
        </span>
      </div>
      {team.lineup.length === 0 ? (
        <div className="text-xs text-zinc-600 italic py-2 text-center">Lineup not yet posted</div>
      ) : (
        <div className="space-y-0.5">
          {team.lineup.map((batter) => (
            <div key={batter.playerId} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-4 text-right text-zinc-600 font-mono shrink-0">{batter.order}</span>
              <span className={`w-5 text-center font-bold text-[9px] px-0.5 rounded shrink-0 ${
                batter.bats === "L" ? "text-amber-400 bg-amber-950/40" :
                batter.bats === "S" ? "text-violet-400 bg-violet-950/40" :
                "text-sky-400 bg-sky-950/40"
              }`}>{batter.bats}</span>
              <span className="text-zinc-200 truncate flex-1">{batter.name}</span>
              <span className="text-zinc-500 text-[10px] font-mono shrink-0 w-8 text-right">{batter.position}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({ game }: { game: FgGame }) {
  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const gameTimePst = pstFormatter.format(new Date(game.gameTimeUtc));

  return (
    <div className="bg-[#0d0d18] border border-zinc-800 rounded-lg overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Game header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white">{game.away.teamAbbr}</span>
          <span className="text-zinc-600 text-xs">@</span>
          <span className="text-xs font-bold text-white">{game.home.teamAbbr}</span>
        </div>
        <span className="text-[10px] text-zinc-400 font-mono">{gameTimePst} PST</span>
      </div>

      {/* Pitching matchup */}
      <div className="grid grid-cols-2 gap-3 px-3 py-2 border-b border-zinc-800/60">
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Away SP</div>
          <PitcherBadge pitcher={game.away.pitcher} side="away" />
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Home SP</div>
          <PitcherBadge pitcher={game.home.pitcher} side="home" />
        </div>
      </div>

      {/* Batting orders */}
      <div className="grid grid-cols-2 gap-3 px-3 py-2">
        <LineupTable team={game.away} />
        <LineupTable team={game.home} />
      </div>
    </div>
  );
}

function LineupsView({
  isAllowed,
  onRefresh,
}: {
  isAllowed: boolean;
  onRefresh?: () => void;
}) {
  const [lineupDay, setLineupDay] = useState<"today" | "tomorrow">("today");
  const [lineupSearch, setLineupSearch] = useState("");
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const utils = trpc.useUtils();

  const {
    data: lineupData,
    isLoading: lineupLoading,
    error: lineupError,
    refetch: lineupRefetch,
  } = trpc.jackMac.getLineups.useQuery(
    { forceRefresh: false },
    {
      enabled: isAllowed,
      staleTime: STALE_MS,
      refetchOnWindowFocus: false,
    }
  );

  const handleForceRefresh = useCallback(async () => {
    setIsForceRefreshing(true);
    try {
      await utils.jackMac.getLineups.fetch({ forceRefresh: true });
      // Invalidate so the useQuery hook picks up the fresh data
      await utils.jackMac.getLineups.invalidate();
    } catch (err) {
      console.error("[LineupsView] Force refresh failed:", err);
    } finally {
      setIsForceRefreshing(false);
    }
  }, [utils]);

  const games: FgGame[] = useMemo(() => {
    if (!lineupData) return [];
    const dateResult = lineupDay === "today" ? lineupData.today : lineupData.tomorrow;
    const allGames = dateResult.games;
    if (!lineupSearch.trim()) return allGames;
    const q = lineupSearch.trim().toLowerCase();
    return allGames.filter(g =>
      g.away.teamAbbr.toLowerCase().includes(q) ||
      g.home.teamAbbr.toLowerCase().includes(q) ||
      g.away.teamName.toLowerCase().includes(q) ||
      g.home.teamName.toLowerCase().includes(q) ||
      g.away.pitcher?.name.toLowerCase().includes(q) ||
      g.home.pitcher?.name.toLowerCase().includes(q) ||
      g.away.lineup.some(b => b.name.toLowerCase().includes(q)) ||
      g.home.lineup.some(b => b.name.toLowerCase().includes(q))
    );
  }, [lineupData, lineupDay, lineupSearch]);

  const dateResult = lineupData ? (lineupDay === "today" ? lineupData.today : lineupData.tomorrow) : null;
  const postedCount = games.filter(g => g.away.lineupStatus === "Posted" || g.home.lineupStatus === "Posted").length;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Day selector */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
          {(["today", "tomorrow"] as const).map(day => (
            <button
              key={day}
              type="button"
              onClick={() => setLineupDay(day)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                lineupDay === day
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {day === "today" ? "Today" : "Tomorrow"}
            </button>
          ))}
        </div>

        {/* Meta + search */}
        <div className="flex items-center gap-2">
          {dateResult && (
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-0.5 font-mono">
              <span>{dateResult.date}</span>
              <span className="text-zinc-700">·</span>
              <span>{games.length} games</span>
              <span className="text-zinc-700">·</span>
              <span className="text-emerald-400">{postedCount} posted</span>
            </div>
          )}
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
            <Input
              value={lineupSearch}
              onChange={e => setLineupSearch(e.target.value)}
              placeholder="Search team / player..."
              className="pl-7 h-7 text-xs bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-violet-500"
            />
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={handleForceRefresh}
            disabled={lineupLoading || isForceRefreshing}
            className="text-zinc-400 hover:text-white gap-1.5 h-7 text-xs px-2"
          >
            <RefreshCw className={`w-3 h-3 ${lineupLoading || isForceRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isForceRefreshing ? "Refreshing..." : "Refresh"}</span>
          </Button>
        </div>
      </div>

      {/* Loading */}
      {lineupLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <span className="text-sm">Loading lineups from MLB Stats API...</span>
        </div>
      )}

      {/* Error */}
      {lineupError && !lineupLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <AlertTriangle className="w-7 h-7 text-red-400" />
          <p className="text-red-300 text-sm font-medium">{lineupError.message}</p>
          <Button variant="outline" size="sm" onClick={() => lineupRefetch()} className="border-zinc-700 text-white">
            Retry
          </Button>
          <Button variant="outline" size="sm" onClick={handleForceRefresh} disabled={isForceRefreshing} className="border-violet-700 text-violet-300">
            {isForceRefreshing ? "Refreshing..." : "Force Refresh"}
          </Button>
        </div>
      )}

      {/* No games */}
      {!lineupLoading && !lineupError && games.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
          <span className="text-sm">No games found for {lineupDay === "today" ? "today" : "tomorrow"}</span>
          {lineupSearch && (
            <button
              type="button"
              onClick={() => setLineupSearch("")}
              className="text-xs text-violet-400 hover:text-violet-300"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* Game cards grid */}
      {!lineupLoading && !lineupError && games.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {games.map(game => (
            <GameCard key={game.gameId} game={game} />
          ))}
        </div>
      )}

      {/* Partial errors */}
      {lineupData && lineupData.errors.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/20 border border-amber-900/40 rounded px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Partial data: {lineupData.errors.join("; ")}</span>
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JackMacViewProps {
  /** The authenticated app user object from useAppAuth(). Null if not logged in. */
  appUser: { username: string } | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function JackMacView({ appUser }: JackMacViewProps) {
  // ── Whitelist guard (client-side) ──────────────────────────────────────────
  const isAllowed = Boolean(appUser && JACK_MAC_WHITELIST.has(appUser.username));

  // ── Google Sheets Sync mutation ───────────────────────────────────────────
  const syncToSheets = trpc.jackMac.syncToSheets.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          `Google Sheets synced! ${result.totalRowsWritten.toLocaleString()} rows written across ${result.tabs.length} tabs in ${(result.elapsedMs / 1000).toFixed(1)}s`,
          { duration: 6000 }
        );
        console.log(`[JACKMAC][SHEETS][OUTPUT] Sync success: totalRows=${result.totalRowsWritten} elapsed=${result.elapsedMs}ms`);
      } else {
        const failedTabs = result.tabs.filter(t => t.status === "error").map(t => t.sheetTab).join(", ");
        toast.warning(`Partial sync — some tabs failed: ${failedTabs}`, { duration: 8000 });
        console.warn(`[JACKMAC][SHEETS][VERIFY] PARTIAL — failed tabs: ${failedTabs}`);
      }
    },
    onError: (err) => {
      toast.error(`Google Sheets sync failed: ${err.message}`, { duration: 8000 });
      console.error(`[JACKMAC][SHEETS][VERIFY] FAIL — ${err.message}`);
    },
  });

  // ── Main tab state: "projections" | "lineups" ─────────────────────────────
  const [mainTab, setMainTab] = useState<"projections" | "lineups">("projections");

  // ── State (RG projections) ─────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>("today-pitchers");
  const [cache, setCache] = useState<Partial<Record<TabKey, CacheEntry>>>({});
  const [loadingTabs, setLoadingTabs] = useState<Set<TabKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<TabKey, string>>>({});
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [colVis, setColVis] = useState<Partial<Record<TabKey, Record<string, boolean>>>>(
    () => loadColVisFromStorage()
  );
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);

  // ── Persist column visibility ──────────────────────────────────────────────
  useEffect(() => { saveColVisToStorage(colVis); }, [colVis]);

  // ── Fetch logic ────────────────────────────────────────────────────────────
  const fetchTab = useCallback(async (tab: TabKey, force = false) => {
    if (!isAllowed) {
      console.log("[JACKMAC][AUTH][VERIFY] FAIL — user not in whitelist, skipping fetch");
      return;
    }
    const existing = cache[tab];
    if (!force && existing) {
      const ageMs = Date.now() - existing.fetchedAt;
      if (ageMs < STALE_MS) {
        console.log(`[JACKMAC][FETCH][SKIP] tab="${tab}" age=${Math.round(ageMs/1000)}s < stale threshold`);
        return;
      }
      console.log(`[JACKMAC][STALE] tab="${tab}" fetched ${formatAge(ageMs)} ago — auto-refreshing`);
    }

    setLoadingTabs(prev => new Set(prev).add(tab));
    setErrors(prev => { const n = { ...prev }; delete n[tab]; return n; });

    const t0 = performance.now();
    console.log(`[JACKMAC][FETCH][INPUT] tab="${tab}" force=${force}`);

    try {
      const res = await fetch(`/api/rg-proxy?page=${tab}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: RgTableData = await res.json();
      const elapsed = Math.round(performance.now() - t0);
      console.log(`[JACKMAC][FETCH][OUTPUT] tab="${tab}" rows=${data.rows.length} cols=${data.columns.length} elapsed=${elapsed}ms updatedAt="${data.updatedAt}"`);

      setCache(prev => ({ ...prev, [tab]: { data, fetchedAt: Date.now() } }));

      setColVis(prev => {
        if (prev[tab]) return prev;
        const defaults = buildDefaultVisibility(data.type);
        console.log(`[JACKMAC][COLVIS][INIT] tab="${tab}" type="${data.type}" groups=${Object.keys(defaults).join(", ")}`);
        return { ...prev, [tab]: defaults };
      });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[JACKMAC][FETCH][FATAL] tab="${tab}" error="${msg}"`);
      setErrors(prev => ({ ...prev, [tab]: msg }));
    } finally {
      setLoadingTabs(prev => { const next = new Set(prev); next.delete(tab); return next; });
    }
  }, [cache, isAllowed]);

  // ── Auto-fetch on tab switch ───────────────────────────────────────────────
  useEffect(() => {
    if (isAllowed && mainTab === "projections") fetchTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAllowed, mainTab]);

  // ── Reset search/sort on tab switch ───────────────────────────────────────
  useEffect(() => {
    setSearch("");
    setSortCol(null);
    setSortDir(null);
    setColPanelOpen(false);
  }, [activeTab]);

  // ── Refresh All ───────────────────────────────────────────────────────────
  const refreshAll = useCallback(async () => {
    console.log("[JACKMAC][REFRESH_ALL][STEP] Force-refreshing all 4 tabs in parallel");
    await Promise.all(TABS.map(t => fetchTab(t.key, true)));
    console.log("[JACKMAC][REFRESH_ALL][OUTPUT] All 4 tabs refreshed");
  }, [fetchTab]);

  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
        console.log(`[JACKMAC][SORT][STATE] col="${col}" dir=desc`);
      } else {
        setSortCol(null); setSortDir(null);
        console.log(`[JACKMAC][SORT][STATE] cleared`);
      }
    } else {
      setSortCol(col); setSortDir("asc");
      console.log(`[JACKMAC][SORT][STATE] col="${col}" dir=asc`);
    }
  };

  // ── Column visibility helpers ─────────────────────────────────────────────
  const activeTabType = TABS.find(t => t.key === activeTab)!.type;
  const activeGroups = getGroups(activeTabType);
  const activeColVis = colVis[activeTab] ?? buildDefaultVisibility(activeTabType);

  const tableData = cache[activeTab]?.data;

  const visibleCols = useMemo(() => {
    const entry = cache[activeTab];
    if (!entry) return [];
    const allCols = entry.data.columns;
    const visibleSet = new Set<string>();
    for (const g of activeGroups) {
      if (activeColVis[g.label] !== false) {
        for (const c of g.cols) visibleSet.add(c);
      }
    }
    return allCols.filter(c => visibleSet.has(c) && !INTERNAL_COLS.has(c));
  }, [cache, activeTab, activeGroups, activeColVis]);

  const toggleGroup = (label: string) => {
    const current = activeColVis[label] !== false;
    const next = !current;
    console.log(`[JACKMAC][COLVIS][STEP] tab="${activeTab}" group="${label}" → ${next ? "visible" : "hidden"}`);
    setColVis(prev => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? buildDefaultVisibility(activeTabType)), [label]: next },
    }));
  };
  const showAllCols = () => {
    const all: Record<string, boolean> = {};
    for (const g of activeGroups) all[g.label] = true;
    setColVis(prev => ({ ...prev, [activeTab]: all }));
  };
  const resetColVis = () => {
    setColVis(prev => ({ ...prev, [activeTab]: buildDefaultVisibility(activeTabType) }));
  };

  // ── Filtered + sorted rows ────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (!tableData) return [];
    let rows = tableData.rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        (r["NAME"] ?? "").toLowerCase().includes(q) ||
        (r["TEAM"] ?? "").toLowerCase().includes(q) ||
        (r["OPP_TM"] ?? r["OPP"] ?? "").toLowerCase().includes(q)
      );
    }
    if (sortCol && sortDir) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortCol] ?? "";
        const bv = b[sortCol] ?? "";
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [tableData, search, sortCol, sortDir]);

  // Key columns for highlighting
  const KEY_COLS_PITCHERS = new Set(["NAME", "TEAM", "OPP", "IP", "K", "ERA", "FPTS", "W", "WHIP"]);
  const KEY_COLS_HITTERS  = new Set(["NAME", "TEAM", "OPP_TM", "POS", "FPTS", "HR", "RBI", "R", "SB", "BA", "WOBA"]);
  const keyCols = activeTabType === "pitchers" ? KEY_COLS_PITCHERS : KEY_COLS_HITTERS;

  // Staleness display
  const cacheEntry = cache[activeTab];
  const ageMs = cacheEntry ? Date.now() - cacheEntry.fetchedAt : null;
  const ageLabel = ageMs !== null ? formatAge(ageMs) : null;
  const isStaleDisplay = ageMs !== null && ageMs > STALE_MS;

  // ── Close col panel on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) {
        setColPanelOpen(false);
      }
    };
    if (colPanelOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPanelOpen]);

  const isLoadingActive = loadingTabs.has(activeTab);
  const activeError = errors[activeTab];

  // ── Access Denied wall ────────────────────────────────────────────────────
  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <Lock className="w-10 h-10 text-red-400" />
        <p className="text-white text-base font-semibold">Access Denied</p>
        <p className="text-zinc-400 text-sm text-center max-w-xs">
          This section is restricted to authorized users only.
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col w-full bg-[#0a0a0f] text-white">

      {/* ── JACK MAC Header Bar ─────────────────────────────────────────────── */}
      <div className="sticky top-[calc(var(--header-height,112px))] z-20 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">

          {/* Left: title badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-widest text-[#39FF14] uppercase">JACK MAC</span>
            <span className="text-zinc-600 text-xs">·</span>
            <span className="text-zinc-400 text-xs">
              {mainTab === "projections" ? "THE BAT X Projections" : "MLB Lineups"}
            </span>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {mainTab === "projections" && (
              <>
                <Button
                  variant="outline" size="sm"
                  onClick={refreshAll}
                  disabled={loadingTabs.size > 0}
                  className="border-zinc-700 text-zinc-300 hover:text-white hover:border-violet-500 gap-1.5 bg-transparent h-7 text-xs px-2"
                  title="Force-refresh all 4 tabs"
                >
                  <RotateCcw className={`w-3 h-3 ${loadingTabs.size > 0 ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Refresh All</span>
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => fetchTab(activeTab, true)}
                  disabled={isLoadingActive}
                  className="text-zinc-400 hover:text-white gap-1.5 h-7 text-xs px-2"
                  title="Refresh current tab"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingActive ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => {
                    if (tableData && visibleCols.length > 0) {
                      exportCsv(activeTab, visibleCols, filteredRows);
                    }
                  }}
                  disabled={!tableData || filteredRows.length === 0}
                  className="text-zinc-400 hover:text-emerald-400 gap-1.5 h-7 text-xs px-2"
                  title="Download visible columns as CSV"
                >
                  <Download className="w-3 h-3" />
                  <span className="hidden sm:inline">CSV</span>
                </Button>
              </>
            )}
            {/* REFRESH GOOGLE SHEETS button — always visible */}
            <button
              type="button"
              onClick={() => {
                console.log("[JACKMAC][SHEETS][INPUT] REFRESH GOOGLE SHEETS triggered by user");
                syncToSheets.mutate();
              }}
              disabled={syncToSheets.isPending}
              style={{ backgroundColor: "#34A853", opacity: syncToSheets.isPending ? 0.7 : 1 }}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-bold text-white whitespace-nowrap transition-opacity disabled:cursor-not-allowed"
              title="Sync all tabs (RG + Lineups) to Google Sheets"
            >
              {syncToSheets.isPending ? (
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19.5 3h-15A1.5 1.5 0 003 4.5v15A1.5 1.5 0 004.5 21h15a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0019.5 3z" fill="white" opacity="0.9"/>
                  <rect x="6" y="8" width="12" height="1.5" rx="0.5" fill="#34A853"/>
                  <rect x="6" y="11" width="12" height="1.5" rx="0.5" fill="#34A853"/>
                  <rect x="6" y="14" width="8" height="1.5" rx="0.5" fill="#34A853"/>
                  <path d="M14.5 1.5v5h5" fill="none" stroke="#34A853" strokeWidth="1.2"/>
                  <path d="M14.5 1.5L19.5 6.5H14.5V1.5z" fill="#34A853" opacity="0.7"/>
                </svg>
              )}
              <span className="hidden sm:inline">
                {syncToSheets.isPending ? "Syncing..." : "REFRESH GOOGLE SHEETS"}
              </span>
            </button>
          </div>
        </div>

        {/* Main tab selector: Projections | Lineups */}
        <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setMainTab("projections")}
            className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${
              mainTab === "projections"
                ? "bg-violet-600 text-white shadow-lg shadow-violet-900/40"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            THE BAT X
          </button>
          <button
            type="button"
            onClick={() => setMainTab("lineups")}
            className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${
              mainTab === "lineups"
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            LINEUPS
          </button>

          {/* RG sub-tabs — only show when in projections mode */}
          {mainTab === "projections" && (
            <>
              <span className="text-zinc-700 mx-1">|</span>
              {TABS.map(tab => {
                const isActive = activeTab === tab.key;
                const isLoading = loadingTabs.has(tab.key);
                const hasError = !!errors[tab.key];
                const tabEntry = cache[tab.key];
                const tabAge = tabEntry ? Date.now() - tabEntry.fetchedAt : null;
                const tabStale = tabAge !== null && tabAge > STALE_MS;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`
                      relative px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all
                      ${isActive
                        ? "bg-violet-600/60 text-white"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                      }
                    `}
                  >
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.short}</span>
                    {isLoading && <Loader2 className="inline w-3 h-3 ml-1 animate-spin" />}
                    {!isLoading && hasError && <span className="ml-1 text-red-400 text-xs">!</span>}
                    {!isLoading && !hasError && tabStale && !isActive && (
                      <span className="ml-1 text-amber-400 text-xs" title="Data may be stale">↻</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3 w-full">

        {/* ── LINEUPS VIEW ─────────────────────────────────────────────────── */}
        {mainTab === "lineups" && (
          <LineupsView isAllowed={isAllowed} />
        )}

        {/* ── PROJECTIONS VIEW ─────────────────────────────────────────────── */}
        {mainTab === "projections" && (
          <>
            {/* Toolbar: metadata + search + column toggle */}
            {tableData && (
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                {/* Left: title + metadata strip */}
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h2 className="text-xs font-semibold text-white truncate">{tableData.title}</h2>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-0.5 font-mono">
                    {ageLabel && (
                      <span
                        className={isStaleDisplay ? "text-amber-400" : "text-zinc-400"}
                        title={isStaleDisplay ? "Data is stale — will auto-refresh on next tab switch" : "Data is fresh"}
                      >
                        {isStaleDisplay ? "⚠ " : "↻ "}{ageLabel}
                      </span>
                    )}
                    {ageLabel && <span className="text-zinc-700">·</span>}
                    <span className="text-zinc-400">
                      {filteredRows.length === tableData.rows.length
                        ? `${tableData.rows.length} rows`
                        : `${filteredRows.length} / ${tableData.rows.length} rows`}
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-zinc-400">
                      {visibleCols.length === tableData.columns.filter(c => !INTERNAL_COLS.has(c)).length
                        ? `${visibleCols.length} cols`
                        : `${visibleCols.length} / ${tableData.columns.filter(c => !INTERNAL_COLS.has(c)).length} cols`}
                    </span>
                    {tableData.updatedAt && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="text-zinc-500">RG: {tableData.updatedAt}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Right: search + columns button */}
                <div className="flex items-center gap-2">
                  {/* Column visibility dropdown */}
                  <div className="relative" ref={colPanelRef}>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setColPanelOpen(p => !p)}
                      className="border-zinc-700 text-zinc-300 hover:text-white hover:border-violet-500 gap-1.5 bg-transparent h-7 text-xs px-2"
                    >
                      <Columns className="w-3 h-3" />
                      <span className="hidden sm:inline">Columns</span>
                    </Button>
                    {colPanelOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[#13131f] border border-zinc-700 rounded-lg shadow-2xl shadow-black/60 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Column Groups</span>
                          <div className="flex gap-1">
                            <button onClick={showAllCols} className="text-xs text-violet-400 hover:text-violet-300 transition-colors px-1" title="Show all">All</button>
                            <span className="text-zinc-600">|</span>
                            <button onClick={resetColVis} className="text-xs text-zinc-400 hover:text-white transition-colors px-1" title="Reset to defaults">Reset</button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {activeGroups.map(g => {
                            const isVis = activeColVis[g.label] !== false;
                            const colsInData = g.cols.filter(c => tableData.columns.includes(c) && !INTERNAL_COLS.has(c));
                            return (
                              <button
                                key={g.label}
                                type="button"
                                onClick={() => toggleGroup(g.label)}
                                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 transition-colors group"
                              >
                                <div className="flex items-center gap-2">
                                  {isVis
                                    ? <CheckSquare className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                                    : <Square className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                                  }
                                  <span className={`text-xs ${isVis ? "text-white" : "text-zinc-500"}`}>{g.label}</span>
                                </div>
                                <span className="text-xs text-zinc-600 group-hover:text-zinc-400">{colsInData.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Search */}
                  <div className="relative w-48 sm:w-56">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                    <Input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search name / team..."
                      className="pl-7 h-7 text-xs bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Loading spinner */}
            {isLoadingActive && !tableData && (
              <div className="flex items-center justify-center py-16 gap-3 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                <span className="text-sm">Loading projections...</span>
              </div>
            )}

            {/* Error banner — full page only when NO data is present */}
            {activeError && (!tableData || tableData.rows.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
                <AlertTriangle className="w-7 h-7 text-red-400" />
                <p className="text-red-300 text-sm font-medium">{activeError}</p>
                <p className="text-zinc-500 text-xs text-center max-w-sm">
                  The table may not have loaded from Rotogrinders. Try refreshing.
                </p>
                <Button
                  variant="outline" size="sm"
                  onClick={() => fetchTab(activeTab, true)}
                  className="mt-1 border-zinc-700 text-white"
                >
                  Retry
                </Button>
              </div>
            )}

            {/* Stale data warning — compact banner when data IS present but refresh failed */}
            {activeError && tableData && tableData.rows.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-amber-950/60 border border-amber-800/50 text-amber-300 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Showing cached data — live refresh failed ({activeError})</span>
                <button
                  type="button"
                  onClick={() => fetchTab(activeTab, true)}
                  className="ml-auto text-amber-400 hover:text-white underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}

            {/* No visible columns */}
            {!isLoadingActive && tableData && tableData.rows.length > 0 && visibleCols.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
                <Columns className="w-7 h-7" />
                <p className="text-sm">All column groups are hidden.</p>
                <Button variant="outline" size="sm" onClick={showAllCols} className="mt-1 border-zinc-700 text-white">
                  Show All Columns
                </Button>
              </div>
            )}

            {/* Data Table */}
            {tableData && tableData.rows.length > 0 && visibleCols.length > 0 && (
              <div className="overflow-auto rounded-lg border border-zinc-800 shadow-2xl">
                <table className="w-full text-xs border-collapse min-w-max">
                  <thead>
                    <tr className="bg-zinc-900 border-b border-zinc-700">
                      {visibleCols.map((col, i) => {
                        const isKey = keyCols.has(col);
                        const isSorted = sortCol === col;
                        return (
                          <th
                            key={`h-${col}-${i}`}
                            onClick={() => handleSort(col)}
                            className={`
                              px-3 py-2.5 text-left font-semibold cursor-pointer select-none whitespace-nowrap
                              transition-colors group
                              ${isKey ? "text-violet-300 bg-violet-950/30 hover:bg-violet-950/50" : "text-zinc-300 hover:bg-zinc-800"}
                              ${isSorted ? "bg-zinc-800" : ""}
                            `}
                          >
                            <span className="flex items-center gap-1">
                              {col}
                              {isSorted && sortDir === "asc"  && <ChevronUp   className="w-3 h-3 text-violet-400" />}
                              {isSorted && sortDir === "desc" && <ChevronDown  className="w-3 h-3 text-violet-400" />}
                              {!isSorted && (
                                <ChevronsUpDown className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={`
                          border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/40
                          ${ri % 2 === 0 ? "bg-[#0d0d14]" : "bg-[#0a0a0f]"}
                        `}
                      >
                        {visibleCols.map((col, ci) => {
                          const val = row[col] ?? "";
                          const isKey    = keyCols.has(col);
                          const isName   = col === "NAME";
                          const isTeam   = col === "TEAM";
                          const isOpp    = col === "OPP_TM" || col === "OPP";
                          const isFpts   = col === "FPTS";
                          const isBool   = val === "true" || val === "false";
                          const isSalary = col === "SALARY";
                          const isId     = col === "PLAYER_ID" || col === "MLB_ID";

                          if (isName) {
                            const headshotUrl = row["HEADSHOT_URL"] ?? "";
                            return (
                              <td key={`d-${col}-${ci}`} className="px-2 py-1.5 whitespace-nowrap font-semibold text-white sticky left-0 bg-inherit z-10 min-w-[160px] shadow-[2px_0_8px_rgba(0,0,0,0.4)]">
                                <div className="flex items-center gap-2">
                                  {headshotUrl ? (
                                    <img src={headshotUrl} alt={val} className="w-7 h-7 rounded-full object-cover bg-zinc-800 border border-zinc-700 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center text-zinc-600 text-[10px] font-bold">{val.charAt(0)}</div>
                                  )}
                                  <span className="truncate max-w-[120px]">{val || <span className="text-zinc-700">—</span>}</span>
                                </div>
                              </td>
                            );
                          }
                          if (isTeam) {
                            const logoUrl = row["TEAM_LOGO_URL"] ?? "";
                            return (
                              <td key={`d-${col}-${ci}`} className="px-3 py-1.5 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  {logoUrl ? <img src={logoUrl} alt={val} className="w-5 h-5 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
                                  <span className="text-zinc-200 font-medium text-xs">{val || <span className="text-zinc-700">—</span>}</span>
                                </div>
                              </td>
                            );
                          }
                          if (isOpp) {
                            const logoUrl = row["OPP_LOGO_URL"] ?? "";
                            return (
                              <td key={`d-${col}-${ci}`} className="px-3 py-1.5 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  {logoUrl ? <img src={logoUrl} alt={val} className="w-5 h-5 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
                                  <span className="text-zinc-200 font-medium text-xs">{val || <span className="text-zinc-700">—</span>}</span>
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td
                              key={`d-${col}-${ci}`}
                              className={`
                                px-3 py-2 whitespace-nowrap
                                ${isFpts   ? "text-emerald-400 font-bold" : ""}
                                ${isSalary ? "text-sky-300 font-medium" : ""}
                                ${isId     ? "text-zinc-500 font-mono text-[10px]" : ""}
                                ${isKey && !isFpts && !isSalary && !isId ? "text-violet-200" : ""}
                                ${!isKey && !isFpts && !isSalary && !isId ? "text-zinc-300" : ""}
                              `}
                            >
                              {isBool
                                ? (val === "true"
                                  ? <span className="text-emerald-400 font-bold">✔</span>
                                  : <span className="text-zinc-700">—</span>)
                                : (val || <span className="text-zinc-700">—</span>)
                              }
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Bottom padding */}
        <div className="h-8" />
      </div>
    </div>
  );
}
