/**
 * Resources.tsx — Private RESOURCES page for @prez, @sippi, and @lucianobets only.
 *
 * Features:
 *  1. CSV Export — per-tab download + "Refresh All" global button
 *  2. Column Visibility Groups — toggle named column groups per tab type
 *     - All groups visible by default
 *     - User preferences persisted in localStorage
 *  3. Staleness Auto-Refresh — re-fetch if cached data is >15 minutes old
 *  4. Player Headshots — MLB static CDN headshots in the NAME column
 *  5. Team Logos — ESPN CDN logos in TEAM/OPP columns
 *  6. Player IDs — PLAYER_ID (RG) and MLB_ID columns in Identity group
 *
 * Diagnostic logging: all state transitions logged to console with structured labels.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  fetchedAt: number; // Unix ms
}
type SortDir = "asc" | "desc" | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const STALE_MS = 15 * 60 * 1000; // 15 minutes
const LS_COL_VIS_KEY = "rg_col_vis_v2"; // localStorage key for column visibility

const TABS = [
  { key: "today-pitchers",    label: "Today Pitchers",    short: "T.P",  type: "pitchers" as const },
  { key: "today-hitters",     label: "Today Hitters",     short: "T.H",  type: "hitters"  as const },
  { key: "tomorrow-pitchers", label: "Tomorrow Pitchers", short: "TM.P", type: "pitchers" as const },
  { key: "tomorrow-hitters",  label: "Tomorrow Hitters",  short: "TM.H", type: "hitters"  as const },
] as const;
type TabKey = typeof TABS[number]["key"];

// JACK MAC whitelist: @prez, @sippi, @lucianobets
const ALLOWED = new Set(["prez", "lucianobets", "sippi"]);

// ─── Internal-only columns (used for rendering, never shown as raw text columns) ──

const INTERNAL_COLS = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);

// ─── Column Groups ─────────────────────────────────────────────────────────────
// ALL groups default to visible. User can hide them; preference is saved to localStorage.

interface ColGroup {
  label: string;
  cols: string[];
}

const PITCHER_GROUPS: ColGroup[] = [
  {
    label: "Identity",
    cols: ["NAME", "PLAYER_ID", "MLB_ID", "TEAM", "OPP", "OPP_TM", "HAND"],
  },
  {
    label: "Core Stats",
    cols: ["IP", "W", "K", "ERA", "WHIP", "FPTS", "QS", "L"],
  },
  {
    label: "DFS Lines",
    cols: ["TOMORROW_DK", "TOMORROW_FD", "TOMORROW_YAHOO", "TOMORROW_5X5", "TOMORROW_ESPN", "TOMORROW_YAHOO_SL"],
  },
  {
    label: "Ownership",
    cols: ["12TEAM_OWN", "15TEAM_OWN"],
  },
  {
    label: "Context",
    cols: ["PARK", "ROOF", "UMPIRE", "PLATOON", "GVF", "HFA", "DH", "TILT_BIAS"],
  },
  {
    label: "Advanced",
    cols: ["ER", "H", "HR", "BB", "TBF", "IBB", "HBP", "TB", "SH", "SF", "GIDP", "SB", "CS", "CG", "CGSH"],
  },
  {
    label: "Flags",
    cols: ["OPENER", "CATCHER", "BPC", "PPC", "MPC", "2H", "ERROR"],
  },
];

const HITTER_GROUPS: ColGroup[] = [
  {
    label: "Identity",
    cols: ["NAME", "PLAYER_ID", "MLB_ID", "TEAM", "OPP_TM", "POS", "HAND"],
  },
  {
    label: "Core Stats",
    cols: ["FPTS", "FPTS/$", "HR", "RBI", "R", "SB", "BA", "OBP", "SLG", "WOBA"],
  },
  {
    label: "DFS Salary",
    cols: ["SALARY", "LP", "OL", "OD", "IPL", "POWN", "FLOOR", "CEILING", "SLATE"],
  },
  {
    label: "Advanced",
    cols: ["CNWOBA", "XWOBA_CS", "XWOBA_LS", "ISO", "PA", "PAVSSP", "PAVSSP%", "OBFPTS", "0%_PH%_FPTS"],
  },
  {
    label: "Context",
    cols: ["PITCHER", "CATCHER", "UMPIRE", "PARK", "ROOF", "GVF", "HFA", "PLATOON", "PH%", "COLD", "TILT_BIAS"],
  },
  {
    label: "Raw Counting",
    cols: ["AB", "K", "BB", "IBB", "HBP", "H", "1B", "2B", "3B", "HR_DEPENDENCE", "TB", "CS", "SH", "SF", "GIDP"],
  },
  {
    label: "Flags",
    cols: ["2H", "ERROR"],
  },
];

function getGroups(type: "pitchers" | "hitters"): ColGroup[] {
  return type === "pitchers" ? PITCHER_GROUPS : HITTER_GROUPS;
}

/** All groups visible by default */
function buildDefaultVisibility(type: "pitchers" | "hitters"): Record<string, boolean> {
  const groups = getGroups(type);
  const result: Record<string, boolean> = {};
  for (const g of groups) {
    result[g.label] = true; // ALL groups visible by default
  }
  return result;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadColVisFromStorage(): Partial<Record<TabKey, Record<string, boolean>>> {
  try {
    const raw = localStorage.getItem(LS_COL_VIS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    console.log("[COLVIS][LOAD] Loaded column visibility from localStorage");
    return parsed;
  } catch {
    return {};
  }
}

function saveColVisToStorage(colVis: Partial<Record<TabKey, Record<string, boolean>>>) {
  try {
    localStorage.setItem(LS_COL_VIS_KEY, JSON.stringify(colVis));
  } catch { /* ignore quota errors */ }
}

// ─── CSV Utility ──────────────────────────────────────────────────────────────

function exportCsv(tabKey: TabKey, columns: string[], rows: Record<string, string>[]) {
  // Exclude internal-only columns from CSV
  const exportCols = columns.filter(c => !INTERNAL_COLS.has(c));
  console.log(`[CSV][STEP] Exporting ${rows.length} rows × ${exportCols.length} cols for tab="${tabKey}"`);
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const header = exportCols.map(escape).join(",");
  const body = rows.map(r => exportCols.map(c => escape(r[c] ?? "")).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  a.href = url;
  a.download = `rg-${tabKey}-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[CSV][OUTPUT] Downloaded: rg-${tabKey}-${ts}.csv (${(csv.length / 1024).toFixed(1)} KB)`);
}

// ─── Age Label Utility ────────────────────────────────────────────────────────

function formatAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Resources() {
  const { appUser, loading: authLoading } = useAppAuth();
  const [, setLocation] = useLocation();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>("today-pitchers");

  // Cache: tab → { data, fetchedAt }
  const [cache, setCache] = useState<Partial<Record<TabKey, CacheEntry>>>({});

  // Loading/error per tab
  const [loadingTabs, setLoadingTabs] = useState<Set<TabKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<TabKey, string>>>({});

  // Search + sort
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Column visibility: tab → groupLabel → boolean
  // Initialized from localStorage; all groups default to true
  const [colVis, setColVis] = useState<Partial<Record<TabKey, Record<string, boolean>>>>(
    () => loadColVisFromStorage()
  );

  // Column panel open state
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !ALLOWED.has(appUser.username))) {
      console.log("[AUTH][VERIFY] FAIL — user not in allowlist, redirecting");
    }
  }, [authLoading, appUser]);

  // ── Persist column visibility to localStorage ────────────────────────────────
  useEffect(() => {
    saveColVisToStorage(colVis);
  }, [colVis]);

  // ── Fetch logic ──────────────────────────────────────────────────────────────
  const fetchTab = useCallback(async (tab: TabKey, force = false) => {
    const existing = cache[tab];
    if (!force && existing) {
      const ageMs = Date.now() - existing.fetchedAt;
      if (ageMs < STALE_MS) {
        console.log(`[FETCH][SKIP] tab="${tab}" age=${Math.round(ageMs/1000)}s < stale threshold`);
        return;
      }
      console.log(`[STALE] tab="${tab}" fetched ${formatAge(ageMs)} ago — auto-refreshing`);
    }

    setLoadingTabs(prev => new Set(prev).add(tab));
    setErrors(prev => { const n = { ...prev }; delete n[tab]; return n; });

    const t0 = performance.now();
    console.log(`[FETCH][INPUT] tab="${tab}" force=${force}`);

    try {
      const res = await fetch(`/api/rg-proxy?page=${tab}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: RgTableData = await res.json();
      const elapsed = Math.round(performance.now() - t0);
      console.log(`[FETCH][OUTPUT] tab="${tab}" rows=${data.rows.length} cols=${data.columns.length} elapsed=${elapsed}ms updatedAt="${data.updatedAt}"`);

      setCache(prev => ({
        ...prev,
        [tab]: { data, fetchedAt: Date.now() },
      }));

      // Initialize column visibility for this tab type if not already set in localStorage
      setColVis(prev => {
        if (prev[tab]) return prev; // User has a saved preference — don't overwrite
        const defaults = buildDefaultVisibility(data.type);
        console.log(`[COLVIS][INIT] tab="${tab}" type="${data.type}" groups=${Object.keys(defaults).join(", ")}`);
        return { ...prev, [tab]: defaults };
      });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[FETCH][FATAL] tab="${tab}" error="${msg}"`);
      setErrors(prev => ({ ...prev, [tab]: msg }));
    } finally {
      setLoadingTabs(prev => {
        const next = new Set(prev);
        next.delete(tab);
        return next;
      });
    }
  }, [cache]);

  // ── Auto-fetch on tab switch (with staleness check) ─────────────────────────
  useEffect(() => {
    if (appUser && ALLOWED.has(appUser.username)) {
      fetchTab(activeTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, appUser]);

  // ── Reset search/sort on tab switch ─────────────────────────────────────────
  useEffect(() => {
    setSearch("");
    setSortCol(null);
    setSortDir(null);
    setColPanelOpen(false);
  }, [activeTab]);

  // ── Refresh All ─────────────────────────────────────────────────────────────
  const refreshAll = useCallback(async () => {
    console.log("[REFRESH_ALL][STEP] Force-refreshing all 4 tabs in parallel");
    await Promise.all(TABS.map(t => fetchTab(t.key, true)));
    console.log("[REFRESH_ALL][OUTPUT] All 4 tabs refreshed");
  }, [fetchTab]);

  // ── Sort handler ─────────────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
        console.log(`[SORT][STATE] col="${col}" dir=desc`);
      } else {
        setSortCol(null); setSortDir(null);
        console.log(`[SORT][STATE] cleared`);
      }
    } else {
      setSortCol(col); setSortDir("asc");
      console.log(`[SORT][STATE] col="${col}" dir=asc`);
    }
  };

  // ── Column visibility helpers ────────────────────────────────────────────────
  const activeTabType = TABS.find(t => t.key === activeTab)!.type;
  const activeGroups = getGroups(activeTabType);
  const activeColVis = colVis[activeTab] ?? buildDefaultVisibility(activeTabType);

  const visibleCols = useMemo(() => {
    const entry = cache[activeTab];
    if (!entry) return [];
    const allCols = entry.data.columns;
    const visibleSet = new Set<string>();
    for (const g of activeGroups) {
      if (activeColVis[g.label] !== false) { // default true if not set
        for (const c of g.cols) visibleSet.add(c);
      }
    }
    // Exclude internal-only columns from display
    return allCols.filter(c => visibleSet.has(c) && !INTERNAL_COLS.has(c));
  }, [cache, activeTab, activeGroups, activeColVis]);

  const toggleGroup = (label: string) => {
    const current = activeColVis[label] !== false; // default true
    const next = !current;
    console.log(`[COLVIS][STEP] tab="${activeTab}" group="${label}" → ${next ? "visible" : "hidden"}`);
    setColVis(prev => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? buildDefaultVisibility(activeTabType)), [label]: next },
    }));
  };

  const showAllCols = () => {
    console.log(`[COLVIS][STEP] tab="${activeTab}" — show all groups`);
    const all: Record<string, boolean> = {};
    for (const g of activeGroups) all[g.label] = true;
    setColVis(prev => ({ ...prev, [activeTab]: all }));
  };

  const resetColVis = () => {
    console.log(`[COLVIS][STEP] tab="${activeTab}" — reset to defaults (all visible)`);
    setColVis(prev => ({ ...prev, [activeTab]: buildDefaultVisibility(activeTabType) }));
  };

  // ── Filtered + sorted rows ───────────────────────────────────────────────────
  const tableData = cache[activeTab]?.data;

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

  // ── Close col panel on outside click ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) {
        setColPanelOpen(false);
      }
    };
    if (colPanelOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPanelOpen]);

  // ── Render guards ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#45E0A8] animate-spin" />
      </div>
    );
  }
  if (!appUser || !ALLOWED.has(appUser.username)) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <Lock className="w-12 h-12 text-white" />
        <p className="text-white text-lg font-semibold">Access Denied</p>
        <p className="text-white text-sm">This page is restricted to authorized users only.</p>
        <Button variant="outline" onClick={() => setLocation("/")} className="mt-2 border-white text-white">
          Return to Feed
        </Button>
      </div>
    );
  }

  const isLoadingActive = loadingTabs.has(activeTab);
  const activeError = errors[activeTab];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-black backdrop-blur border-b border-white px-4 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setLocation("/")} className="text-white hover:text-white transition-colors">
              ← Feed
            </button>
            <span className="text-white">/</span>
            <span className="text-white font-semibold tracking-wide">RESOURCES</span>
            <span className="text-white">/</span>
            <span className="text-[#45E0A8] font-medium">THE BAT X</span>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Refresh All */}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loadingTabs.size > 0}
              className="border-white text-white hover:text-white hover:border-[#45E0A8] gap-1.5 bg-transparent"
              title="Force-refresh all 4 tabs"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loadingTabs.size > 0 ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh All</span>
            </Button>
            {/* Refresh active tab */}
            <Button
              variant="ghost" size="sm"
              onClick={() => fetchTab(activeTab, true)}
              disabled={isLoadingActive}
              className="text-white hover:text-white gap-1.5"
              title="Refresh current tab"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingActive ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {/* Download CSV */}
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                if (tableData && visibleCols.length > 0) {
                  exportCsv(activeTab, visibleCols, filteredRows);
                }
              }}
              disabled={!tableData || filteredRows.length === 0}
              className="text-white hover:text-[#45E0A8] gap-1.5"
              title="Download visible columns as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Tab Bar ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-[57px] z-20 bg-black border-b border-white px-4">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-1 overflow-x-auto py-1">
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
                onClick={() => setActiveTab(tab.key)}
                className={`
                  relative px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all
                  ${isActive
                    ? "bg-[#45E0A8] text-white"
                    : "text-white hover:text-white hover:bg-black"
                  }
                `}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.short}</span>
                {isLoading && <Loader2 className="inline w-3 h-3 ml-1.5 animate-spin" />}
                {!isLoading && hasError && <span className="ml-1.5 text-white text-xs">!</span>}
                {!isLoading && !hasError && tabStale && !isActive && (
                  <span className="ml-1.5 text-white text-xs" title="Data may be stale">↻</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-4 max-w-screen-2xl mx-auto w-full">

        {/* ── Toolbar: metadata + search + column toggle ─────────────────────── */}
        {tableData && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            {/* Left: title + compact metadata strip */}
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-sm font-semibold text-white truncate">{tableData.title}</h1>
              {/* Compact metadata strip — single clean row */}
              <div className="flex items-center gap-1.5 text-xs text-white bg-black border border-white rounded-md px-2.5 py-1 font-mono">
                {/* Fetch age */}
                {ageLabel && (
                  <span
                    className={isStaleDisplay ? "text-white" : "text-white"}
                    title={isStaleDisplay ? "Data is stale — will auto-refresh on next tab switch" : "Data is fresh"}
                  >
                    {isStaleDisplay ? "⚠ " : "↻ "}{ageLabel}
                  </span>
                )}
                {ageLabel && <span className="text-white">·</span>}
                {/* Row count */}
                <span className="text-white">
                  {filteredRows.length === tableData.rows.length
                    ? `${tableData.rows.length} rows`
                    : `${filteredRows.length} / ${tableData.rows.length} rows`}
                </span>
                <span className="text-white">·</span>
                {/* Column count */}
                <span className="text-white">
                  {visibleCols.length === tableData.columns.filter(c => !INTERNAL_COLS.has(c)).length
                    ? `${visibleCols.length} cols`
                    : `${visibleCols.length} / ${tableData.columns.filter(c => !INTERNAL_COLS.has(c)).length} cols`}
                </span>
                {/* RG updated timestamp */}
                {tableData.updatedAt && (
                  <>
                    <span className="text-white">·</span>
                    <span className="text-white">RG: {tableData.updatedAt}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: search + columns button */}
            <div className="flex items-center gap-2">
              {/* Column visibility dropdown */}
              <div className="relative" ref={colPanelRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setColPanelOpen(p => !p)}
                  className="border-white text-white hover:text-white hover:border-[#45E0A8] gap-1.5 bg-transparent"
                >
                  <Columns className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Columns</span>
                </Button>
                {colPanelOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-black border border-white rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white uppercase tracking-wider">Column Groups</span>
                      <div className="flex gap-1">
                        <button
                          onClick={showAllCols}
                          className="text-xs text-[#45E0A8] hover:text-[#45E0A8] transition-colors px-1"
                          title="Show all columns"
                        >
                          All
                        </button>
                        <span className="text-white">|</span>
                        <button
                          onClick={resetColVis}
                          className="text-xs text-white hover:text-white transition-colors px-1"
                          title="Reset to defaults (all visible)"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {activeGroups.map(g => {
                        const isVis = activeColVis[g.label] !== false; // default true
                        const colsInData = g.cols.filter(c => tableData.columns.includes(c) && !INTERNAL_COLS.has(c));
                        return (
                          <button
                            key={g.label}
                            onClick={() => toggleGroup(g.label)}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-black transition-colors group"
                          >
                            <div className="flex items-center gap-2">
                              {isVis
                                ? <CheckSquare className="w-3.5 h-3.5 text-[#45E0A8] shrink-0" />
                                : <Square className="w-3.5 h-3.5 text-white shrink-0" />
                              }
                              <span className={`text-sm ${isVis ? "text-white" : "text-white"}`}>{g.label}</span>
                            </div>
                            <span className="text-xs text-white group-hover:text-white">{colsInData.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name / team..."
                  className="pl-8 h-8 text-sm bg-black border-white text-white placeholder:text-white focus:border-[#45E0A8]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Loading spinner */}
        {isLoadingActive && !tableData && (
          <div className="flex items-center justify-center py-20 gap-3 text-white">
            <Loader2 className="w-6 h-6 animate-spin text-[#45E0A8]" />
            <span className="text-sm">Loading projections...</span>
          </div>
        )}

        {/* Error banner */}
        {activeError && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-white">
            <AlertTriangle className="w-8 h-8 text-white" />
            <p className="text-white text-sm font-medium">{activeError}</p>
            <p className="text-white text-xs text-center max-w-sm">
              The table may not have loaded from Rotogrinders. Try refreshing.
            </p>
            <Button
              variant="outline" size="sm"
              onClick={() => fetchTab(activeTab, true)}
              className="mt-2 border-white text-white"
            >
              Retry
            </Button>
          </div>
        )}

        {/* No visible columns state */}
        {!isLoadingActive && tableData && tableData.rows.length > 0 && visibleCols.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-white">
            <Columns className="w-8 h-8" />
            <p className="text-sm">All column groups are hidden.</p>
            <Button
              variant="outline" size="sm"
              onClick={showAllCols}
              className="mt-2 border-white text-white"
            >
              Show All Columns
            </Button>
          </div>
        )}

        {/* Data Table */}
        {tableData && tableData.rows.length > 0 && visibleCols.length > 0 && (
          <div className="overflow-auto rounded-lg border border-white">
            <table className="w-full text-xs border-collapse min-w-max">
              <thead>
                <tr className="bg-black border-b border-white">
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
                          ${isKey ? "text-[#45E0A8]" : "text-white hover:bg-black"}
                          ${isSorted ? "bg-black" : ""}
                        `}
                      >
                        <span className="flex items-center gap-1">
                          {col}
                          {isSorted && sortDir === "asc"  && <ChevronUp   className="w-3 h-3 text-[#45E0A8]" />}
                          {isSorted && sortDir === "desc" && <ChevronDown  className="w-3 h-3 text-[#45E0A8]" />}
                          {!isSorted && (
                            <ChevronsUpDown className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
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
                      border-b border-white transition-colors
                      ${ri % 2 === 0 ? "bg-black" : "bg-black"}
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

                      // ── NAME cell: headshot + name ────────────────────────
                      if (isName) {
                        const headshotUrl = row["HEADSHOT_URL"] ?? "";
                        return (
                          <td
                            key={`d-${col}-${ci}`}
                            className="px-2 py-1.5 whitespace-nowrap font-semibold text-white sticky left-0 bg-inherit z-10 min-w-[160px]"
                          >
                            <div className="flex items-center gap-2">
                              {headshotUrl ? (
                                <img
                                  src={headshotUrl}
                                  alt={val}
                                  className="w-7 h-7 rounded-full object-cover bg-black border border-white shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-black border border-white shrink-0 flex items-center justify-center text-white text-[10px] font-bold">
                                  {val.charAt(0)}
                                </div>
                              )}
                              <span className="truncate max-w-[120px]">{val || <span className="text-white">—</span>}</span>
                            </div>
                          </td>
                        );
                      }

                      // ── TEAM cell: logo + abbreviation ────────────────────
                      if (isTeam) {
                        const logoUrl = row["TEAM_LOGO_URL"] ?? "";
                        return (
                          <td
                            key={`d-${col}-${ci}`}
                            className="px-3 py-1.5 whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1.5">
                              {logoUrl ? (
                                <img
                                  src={logoUrl}
                                  alt={val}
                                  className="w-5 h-5 object-contain shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : null}
                              <span className="text-white font-medium text-xs">{val || <span className="text-white">—</span>}</span>
                            </div>
                          </td>
                        );
                      }

                      // ── OPP / OPP_TM cell: logo + abbreviation ────────────
                      if (isOpp) {
                        const logoUrl = row["OPP_LOGO_URL"] ?? "";
                        return (
                          <td
                            key={`d-${col}-${ci}`}
                            className="px-3 py-1.5 whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1.5">
                              {logoUrl ? (
                                <img
                                  src={logoUrl}
                                  alt={val}
                                  className="w-5 h-5 object-contain shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : null}
                              <span className="text-white font-medium text-xs">{val || <span className="text-white">—</span>}</span>
                            </div>
                          </td>
                        );
                      }

                      // ── Default cell ──────────────────────────────────────
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
      </main>
    </div>
  );
}
