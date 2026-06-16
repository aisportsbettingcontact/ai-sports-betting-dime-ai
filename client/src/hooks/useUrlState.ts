/**
 * useUrlState — Sync feed-level state to URL query params via wouter's useSearch.
 *
 * Manages: sport, date, tab, statuses
 * Enables browser back/forward for sport + date changes and bookmarkable URLs.
 * Falls back to localStorage for tab persistence (existing behavior preserved).
 *
 * [CHANGE 2026-06-10] Added "WC" as a valid Sport so the WORLD CUP tab renders
 * inline on the feed instead of redirecting to a separate /wc2026 route.
 * WC bypasses all games.* tRPC procedures (they use zodSport which only accepts
 * MLB/NHL/NBA). The feed guards those queries with `enabled: selectedSport !== 'WC'`
 * and passes `skipToken` when WC is active.
 */
import { useCallback, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { todayUTC } from "@/components/CalendarPicker";

export type Sport = "MLB" | "NBA" | "WC"; // NHL removed — season over
export type FeedMobileTab = "dual" | "splits" | "lineups" | "props" | "f5nrfi" | "hrprops" | "jackmac";
export type GameStatus = "upcoming" | "live" | "final";

const VALID_SPORTS: Sport[] = ["MLB", "NBA", "WC"]; // NHL removed — season over
const VALID_TABS: FeedMobileTab[] = ["dual", "splits", "lineups", "props", "f5nrfi", "hrprops", "jackmac"];
const VALID_STATUSES: GameStatus[] = ["upcoming", "live", "final"];
const FEED_TAB_KEY = "prez_bets_mobile_tab_v4";

function getPersistedTab(): FeedMobileTab {
  try {
    const stored = localStorage.getItem(FEED_TAB_KEY);
    if (VALID_TABS.includes(stored as FeedMobileTab)) return stored as FeedMobileTab;
  } catch { /* ignore */ }
  return "dual";
}

export interface UrlState {
  selectedSport: Sport;
  selectedDate: string;
  feedMobileTab: FeedMobileTab;
  selectedStatuses: Set<GameStatus>;
  setSelectedSport: (s: Sport, isAutoSwitch?: boolean) => void;
  setSelectedDate: (d: string) => void;
  setFeedMobileTab: (t: FeedMobileTab) => void;
  setSelectedStatuses: (s: Set<GameStatus>) => void;
  resetFilters: () => void;
}

export function useUrlState(): UrlState {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const params = useMemo(() => new URLSearchParams(search), [search]);

  // Parse current values from URL, with fallbacks
  const selectedSport = useMemo((): Sport => {
    const s = params.get("sport") as Sport;
    return VALID_SPORTS.includes(s) ? s : "MLB";
  }, [params]);

  const selectedDate = useMemo((): string => {
    const d = params.get("date");
    // Validate YYYY-MM-DD format
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayUTC();
  }, [params]);

  const feedMobileTab = useMemo((): FeedMobileTab => {
    const t = params.get("tab") as FeedMobileTab;
    if (VALID_TABS.includes(t)) return t;
    // Fall back to localStorage for backward compat
    return getPersistedTab();
  }, [params]);

  const selectedStatuses = useMemo((): Set<GameStatus> => {
    const raw = params.get("statuses");
    if (!raw) return new Set<GameStatus>();
    const parts = raw.split(",") as GameStatus[];
    return new Set(parts.filter(p => VALID_STATUSES.includes(p)));
  }, [params]);

  // Setter: update a single param, preserve others
  // replace=true  → filter/auto changes (tab, statuses, auto-sport-switch)
  // replace=false → user-initiated navigation (sport pill click, date picker)
  const setParam = useCallback(
    (key: string, value: string | null, replace = true) => {
      const next = new URLSearchParams(search);
      if (value === null || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const qs = next.toString();
      setLocation(qs ? `?${qs}` : "?", { replace });
    },
    [search, setLocation]
  );

  const setSelectedSport = useCallback(
    (s: Sport, isAutoSwitch = false) => setParam("sport", s, isAutoSwitch),
    [setParam]
  );

  const setSelectedDate = useCallback(
    (d: string) => {
      const today = todayUTC();
      // Date changes are user-initiated navigation → push to history (replace=false)
      setParam("date", d === today ? null : d, false);
    },
    [setParam]
  );

  const setFeedMobileTab = useCallback(
    (t: FeedMobileTab) => {
      // Also persist to localStorage for backward compat
      try { localStorage.setItem(FEED_TAB_KEY, t); } catch { /* ignore */ }
      setParam("tab", t === "dual" ? null : t);
    },
    [setParam]
  );

  const setSelectedStatuses = useCallback(
    (s: Set<GameStatus>) => {
      const arr = Array.from(s);
      setParam("statuses", arr.length > 0 ? arr.join(",") : null);
    },
    [setParam]
  );

  const resetFilters = useCallback(() => {
    const next = new URLSearchParams(search);
    next.delete("statuses");
    next.delete("date");
    const qs = next.toString();
    setLocation(qs ? `?${qs}` : "?", { replace: true });
  }, [search, setLocation]);

  return {
    selectedSport,
    selectedDate,
    feedMobileTab,
    selectedStatuses,
    setSelectedSport,
    setSelectedDate,
    setFeedMobileTab,
    setSelectedStatuses,
    resetFilters,
  };
}
