/**
 * JackMacView.tsx — Inline JACK MAC tab component.
 *
 * Embeds all 4 Rotogrinders THE BAT X projection sub-tabs directly inside the
 * main feed tab bar (MLB only). Access is restricted to @prez, @sippi, and
 * @lucianobets. Any other user (logged in or not) who somehow reaches this
 * component sees an Access Denied wall — the tab itself is never rendered in
 * the tab bar for non-whitelisted users.
 *
 * Sub-tabs:
 *   1. Today Pitchers    (today-pitchers)
 *   2. Today Hitters     (today-hitters)
 *   3. Tomorrow Pitchers (tomorrow-pitchers)
 *   4. Tomorrow Hitters  (tomorrow-hitters)
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface JackMacViewProps {
  /** The authenticated app user object from useAppAuth(). Null if not logged in. */
  appUser: { username: string } | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function JackMacView({ appUser }: JackMacViewProps) {
  // ── Whitelist guard (client-side) ──────────────────────────────────────────
  const isAllowed = Boolean(appUser && JACK_MAC_WHITELIST.has(appUser.username));

  // ── State ──────────────────────────────────────────────────────────────────
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
    if (isAllowed) fetchTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAllowed]);

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

  // ── Access Denied wall (double-layer: tab bar never shows for non-whitelist,
  //    but this guard catches any edge-case direct render) ────────────────────
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
            <span className="text-zinc-400 text-xs">THE BAT X Projections</span>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
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
          </div>
        </div>

        {/* Sub-tab bar */}
        <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-0.5">
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
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-900/40"
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
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3 w-full">

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

        {/* Error banner */}
        {activeError && (
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

        {/* Bottom padding */}
        <div className="h-8" />
      </div>
    </div>
  );
}
