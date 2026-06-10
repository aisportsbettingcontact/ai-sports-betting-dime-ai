with open("/home/ubuntu/ai-sports-betting/client/src/pages/ModelProjections.tsx") as f:
    content = f.read()

# Step 1: Add useUrlState import
old_import = 'import { useLocation } from "wouter";'
new_import = 'import { useLocation } from "wouter";\nimport { useUrlState, type Sport } from "@/hooks/useUrlState";'
content = content.replace(old_import, new_import, 1)

# Step 2: Replace the state declarations block
old_state = """  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [selectedSport, setSelectedSport] = useState<"MLB" | "NBA" | "NHL">("MLB");
  // Query which sports have games today or tomorrow (UTC) — hides pills with no games
  const { data: activeSports } = trpc.games.activeSports.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // re-check every 5 minutes
    refetchOnWindowFocus: true,
  });
  // Auto-switch away from a sport with no games once activeSports loads
  useEffect(() => {
    if (!activeSports) return;
    const sportActive = activeSports[selectedSport as 'NBA' | 'NHL' | 'MLB'];
    if (!sportActive) {
      // Pick the first active sport in display order: MLB → NHL → NBA
      const fallback = (['MLB', 'NHL', 'NBA'] as const).find(s => activeSports[s]);
      if (fallback) setSelectedSport(fallback);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSports]);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<"upcoming" | "live" | "final">>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>(() => todayUTC());"""

new_state = """  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Architecture: URL query params for feed state (sport, date, tab, statuses)
  // Enables browser back/forward and bookmarkable URLs
  const {
    selectedSport, setSelectedSport,
    selectedDate, setSelectedDate,
    feedMobileTab: urlFeedMobileTab, setFeedMobileTab: setUrlFeedMobileTab,
    selectedStatuses, setSelectedStatuses,
    resetFilters: resetUrlFilters,
  } = useUrlState();
  // Query which sports have games today or tomorrow (UTC) — hides pills with no games
  const { data: activeSports } = trpc.games.activeSports.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // re-check every 5 minutes
    refetchOnWindowFocus: true,
  });
  // Auto-switch away from a sport with no games once activeSports loads
  useEffect(() => {
    if (!activeSports) return;
    const sportActive = activeSports[selectedSport as 'NBA' | 'NHL' | 'MLB'];
    if (!sportActive) {
      // Pick the first active sport in display order: MLB → NHL → NBA
      const fallback = (['MLB', 'NHL', 'NBA'] as const).find(s => activeSports[s]);
      if (fallback) setSelectedSport(fallback);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSports]);"""

count = content.count(old_state)
content = content.replace(old_state, new_state, 1)
print(f"Replaced state declarations: {count}")

# Step 3: Replace the feedMobileTab state + handler block
old_feed_tab = """  // ── Main page tab: projections | splits ───────────────────────────────────
  // ── Feed-wide mobile tab filter ───────────────────────────────────────────
  // Tabs: MODEL PROJECTIONS (dual) | BETTING SPLITS (splits) | LINEUPS (lineups, MLB only)
  //       K PROPS (props, MLB only) | F5/NRFI (f5nrfi, MLB only) | HR PROPS (hrprops, MLB only)
  type FeedMobileTab = 'dual' | 'splits' | 'lineups' | 'props' | 'f5nrfi' | 'hrprops';
  const FEED_TAB_KEY = 'prez_bets_mobile_tab_v4';
  const getPersistedFeedTab = (): FeedMobileTab => {
    try {
      const stored = localStorage.getItem(FEED_TAB_KEY);
      const valid: FeedMobileTab[] = ['dual', 'splits', 'lineups', 'props', 'f5nrfi', 'hrprops'];
      if (valid.includes(stored as FeedMobileTab)) return stored as FeedMobileTab;
    } catch { /* ignore */ }
    return 'dual';
  };
  const [feedMobileTab, setFeedMobileTab] = useState<FeedMobileTab>(getPersistedFeedTab);
  const handleFeedTabChange = (next: FeedMobileTab) => {
    setFeedMobileTab(next);
    try { localStorage.setItem(FEED_TAB_KEY, next); } catch { /* ignore */ }
  };"""

new_feed_tab = """  // ── Main page tab: projections | splits ───────────────────────────────────
  // ── Feed-wide mobile tab filter ───────────────────────────────────────────
  // Tabs: MODEL PROJECTIONS (dual) | BETTING SPLITS (splits) | LINEUPS (lineups, MLB only)
  //       K PROPS (props, MLB only) | F5/NRFI (f5nrfi, MLB only) | HR PROPS (hrprops, MLB only)
  type FeedMobileTab = 'dual' | 'splits' | 'lineups' | 'props' | 'f5nrfi' | 'hrprops';
  // feedMobileTab now comes from URL params (via useUrlState), with localStorage fallback
  const feedMobileTab = urlFeedMobileTab;
  const handleFeedTabChange = (next: FeedMobileTab) => {
    setUrlFeedMobileTab(next);
  };"""

count2 = content.count(old_feed_tab)
content = content.replace(old_feed_tab, new_feed_tab, 1)
print(f"Replaced feedMobileTab block: {count2}")

# Step 4: Replace the resetFilters call (setSelectedStatuses + setSelectedDate)
old_reset = """  useEffect(() => {
    setSelectedStatuses(new Set());
    setSelectedDate(todayUTC());
  }, [selectedSport]);"""

new_reset = """  useEffect(() => {
    resetUrlFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);"""

count3 = content.count(old_reset)
content = content.replace(old_reset, new_reset, 1)
print(f"Replaced resetFilters call: {count3}")

with open(
    "/home/ubuntu/ai-sports-betting/client/src/pages/ModelProjections.tsx", "w"
) as f:
    f.write(content)
print("Done")
