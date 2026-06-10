"""
Migrate ModelProjections.tsx to use useUrlState hook for URL query params.
Uses line-number-based replacement to avoid whitespace matching issues.
"""

with open("/home/ubuntu/ai-sports-betting/client/src/pages/ModelProjections.tsx") as f:
    lines = f.readlines()

# ── Step 1: Add useUrlState import after useLocation import ──────────────────
for i, line in enumerate(lines):
    if 'import { useLocation } from "wouter";' in line:
        lines[i] = line.rstrip("\n") + "\n"
        lines.insert(
            i + 1, 'import { useUrlState, type Sport } from "@/hooks/useUrlState";\n'
        )
        print(f"Added useUrlState import at line {i + 2}")
        break

# ── Step 2: Replace lines 274-293 (state declarations) ──────────────────────
# Find the exact range
start_line = None
end_line = None
for i, line in enumerate(lines):
    if (
        'const [selectedSport, setSelectedSport] = useState<"MLB" | "NBA" | "NHL">("MLB");'
        in line
    ):
        start_line = i
    if (
        start_line is not None
        and "const [selectedDate, setSelectedDate] = useState<string>(() => todayUTC());"
        in line
    ):
        end_line = i
        break

print(f"Replacing lines {start_line + 1}-{end_line + 1} with useUrlState destructuring")

new_state_lines = [
    "  // Architecture: URL query params for feed state (sport, date, tab, statuses)\n",
    "  // Enables browser back/forward and bookmarkable URLs\n",
    "  const {\n",
    "    selectedSport, setSelectedSport,\n",
    "    selectedDate, setSelectedDate,\n",
    "    feedMobileTab: urlFeedMobileTab, setFeedMobileTab: setUrlFeedMobileTab,\n",
    "    selectedStatuses, setSelectedStatuses,\n",
    "    resetFilters: resetUrlFilters,\n",
    "  } = useUrlState();\n",
    "\n",
    "  // Query which sports have games today or tomorrow (UTC) — hides pills with no games\n",
    "  const { data: activeSports } = trpc.games.activeSports.useQuery(undefined, {\n",
    "    staleTime: 5 * 60 * 1000, // re-check every 5 minutes\n",
    "    refetchOnWindowFocus: true,\n",
    "  });\n",
    "  // Auto-switch away from a sport with no games once activeSports loads\n",
    "  useEffect(() => {\n",
    "    if (!activeSports) return;\n",
    "    const sportActive = activeSports[selectedSport as 'NBA' | 'NHL' | 'MLB'];\n",
    "    if (!sportActive) {\n",
    "      // Pick the first active sport in display order: MLB → NHL → NBA\n",
    "      const fallback = (['MLB', 'NHL', 'NBA'] as const).find(s => activeSports[s]);\n",
    "      if (fallback) setSelectedSport(fallback);\n",
    "    }\n",
    "  // eslint-disable-next-line react-hooks/exhaustive-deps\n",
    "  }, [activeSports]);\n",
]

lines[start_line : end_line + 1] = new_state_lines

# ── Step 3: Replace feedMobileTab state + handler block ──────────────────────
# Find the FEED_TAB_KEY / getPersistedFeedTab block
feed_start = None
feed_end = None
for i, line in enumerate(lines):
    if (
        "type FeedMobileTab = 'dual' | 'splits' | 'lineups' | 'props' | 'f5nrfi' | 'hrprops';"
        in line
    ):
        feed_start = i
    if feed_start is not None and "const feedIsDual = feedMobileTab" in line:
        feed_end = i
        break

if feed_start is not None and feed_end is not None:
    print(f"Replacing feedMobileTab block: lines {feed_start + 1}-{feed_end + 1}")
    new_feed_lines = [
        "  type FeedMobileTab = 'dual' | 'splits' | 'lineups' | 'props' | 'f5nrfi' | 'hrprops';\n",
        "  // feedMobileTab now comes from URL params (via useUrlState), with localStorage fallback\n",
        "  const feedMobileTab = urlFeedMobileTab;\n",
        "  const handleFeedTabChange = (next: FeedMobileTab) => {\n",
        "    setUrlFeedMobileTab(next);\n",
        "  };\n",
        "  const feedIsDual = feedMobileTab === 'dual';\n",
    ]
    lines[feed_start : feed_end + 1] = new_feed_lines
else:
    print(
        f"WARNING: feedMobileTab block not found (feed_start={feed_start}, feed_end={feed_end})"
    )

# ── Step 4: Verify resetUrlFilters was already applied ──────────────────────
for i, line in enumerate(lines):
    if "resetUrlFilters()" in line:
        print(f"resetUrlFilters already applied at line {i + 1}")
        break

with open(
    "/home/ubuntu/ai-sports-betting/client/src/pages/ModelProjections.tsx", "w"
) as f:
    f.writelines(lines)
print("Migration complete")
