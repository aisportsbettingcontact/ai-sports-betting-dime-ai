"""
1. Add enabled?: boolean prop to BettingSplitsPanel, OddsHistoryPanel, RecentSchedulePanel, SituationalResultsPanel
2. Wire enabled into their tRPC query options
3. Replace trpc.teamColors.getForGame in BettingSplitsPanel with client-side getGameTeamColorsClient
"""

# ── BettingSplitsPanel ────────────────────────────────────────────────────────
with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/BettingSplitsPanel.tsx"
) as f:
    content = f.read()

# Add getGameTeamColorsClient import
if "getGameTeamColorsClient" not in content:
    old_import = 'import { trpc } from "@/lib/trpc";'
    new_import = 'import { trpc } from "@/lib/trpc";\nimport { getGameTeamColorsClient } from "@shared/teamColors";'
    content = content.replace(old_import, new_import, 1)
    print("Added getGameTeamColorsClient import to BettingSplitsPanel")

# Add enabled prop to BettingSplitsPanelProps
old_props_end = (
    "  /** Called whenever the user switches the SPREAD/TOTAL/MONEYLINE toggle */"
)
new_props_end = "  /** IntersectionObserver gate — only fetch data when card is in viewport */\n  enabled?: boolean;\n  /** Called whenever the user switches the SPREAD/TOTAL/MONEYLINE toggle */"
if "enabled?: boolean" not in content:
    content = content.replace(old_props_end, new_props_end, 1)
    print("Added enabled prop to BettingSplitsPanelProps")

# Replace the trpc.teamColors.getForGame call with client-side lookup
old_colors = """  const sport = (game.sport ?? "NBA") as "MLB" | "NBA" | "NHL";
  const { data: colors } = trpc.teamColors.getForGame.useQuery(
    { awayTeam: game.awayTeam, homeTeam: game.homeTeam, sport },
    { staleTime: 1000 * 60 * 60 }
  );"""
new_colors = """  const sport = (game.sport ?? "NBA") as "MLB" | "NBA" | "NHL";
  // Performance Fix #5: client-side color lookup (eliminates tRPC round-trip per card)
  const colors = getGameTeamColorsClient(game.awayTeam, game.homeTeam, sport);"""
if old_colors in content:
    content = content.replace(old_colors, new_colors, 1)
    print("Replaced teamColors tRPC call in BettingSplitsPanel")
else:
    print(
        "WARNING: teamColors call not found in BettingSplitsPanel - may already be replaced"
    )

with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/BettingSplitsPanel.tsx", "w"
) as f:
    f.write(content)
print("BettingSplitsPanel done\n")

# ── OddsHistoryPanel ──────────────────────────────────────────────────────────
with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/OddsHistoryPanel.tsx"
) as f:
    content = f.read()

# Add enabled prop to OddsHistoryPanelProps
if "enabled?: boolean" not in content:
    # Find the Props interface
    old_props = "interface OddsHistoryPanelProps {"
    # Find what's after it and add enabled
    idx = content.find(old_props)
    if idx >= 0:
        # Find the closing brace
        end_idx = content.find("\n}", idx)
        insert_pos = end_idx
        content = (
            content[:insert_pos]
            + "\n  /** IntersectionObserver gate — only fetch data when card is in viewport */\n  enabled?: boolean;"
            + content[insert_pos:]
        )
        print("Added enabled prop to OddsHistoryPanelProps")

# Wire enabled into the OddsHistoryPanel function signature
old_sig = "export function OddsHistoryPanel({"
idx = content.find(old_sig)
if idx >= 0:
    # Find the closing of the destructuring
    end_paren = content.find("}: OddsHistoryPanelProps)", idx)
    if end_paren >= 0:
        # Check if enabled is already in the destructuring
        sig_section = content[idx:end_paren]
        if "enabled" not in sig_section:
            content = content[:end_paren] + ",\n  enabled = true" + content[end_paren:]
            print("Added enabled to OddsHistoryPanel function signature")

# Wire enabled into the first useQuery in OddsHistoryPanel
# The first query uses { enabled: open, staleTime: 30_000 }
old_query_opt = "    { enabled: open, staleTime: 30_000 }"
new_query_opt = "    { enabled: (enabled ?? true) && open, staleTime: 30_000 }"
if old_query_opt in content:
    content = content.replace(old_query_opt, new_query_opt, 1)
    print("Wired enabled into OddsHistoryPanel first query")

with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/OddsHistoryPanel.tsx", "w"
) as f:
    f.write(content)
print("OddsHistoryPanel done\n")

# ── RecentSchedulePanel ───────────────────────────────────────────────────────
with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/RecentSchedulePanel.tsx"
) as f:
    content = f.read()

# Add enabled prop to RecentSchedulePanelProps
if "enabled?: boolean" not in content:
    old_props = "export interface RecentSchedulePanelProps {"
    idx = content.find(old_props)
    if idx >= 0:
        end_idx = content.find("\n}", idx)
        content = (
            content[:end_idx]
            + "\n  /** IntersectionObserver gate — only fetch data when card is in viewport */\n  enabled?: boolean;"
            + content[end_idx:]
        )
        print("Added enabled prop to RecentSchedulePanelProps")

# Wire enabled into function signature
old_sig_end = "}: RecentSchedulePanelProps)"
idx = content.find(old_sig_end)
if idx >= 0:
    # Find the start of the destructuring
    start = content.rfind("export default function RecentSchedulePanel({", 0, idx)
    sig_section = content[start:idx]
    if "enabled" not in sig_section:
        content = content[:idx] + ",\n  enabled = true" + content[idx:]
        print("Added enabled to RecentSchedulePanel function signature")

# Wire enabled into the tRPC queries
# The queries use { enabled: enabled && sport === "MLB", ... }
# Replace the internal 'enabled' variable with 'isDataEnabled'
old_enabled_var = "  const enabled = !!awaySlug && !!homeSlug;"
new_enabled_var = (
    "  const isDataEnabled = (enabled ?? true) && !!awaySlug && !!homeSlug;"
)
if old_enabled_var in content:
    content = content.replace(old_enabled_var, new_enabled_var, 1)
    # Now replace all uses of 'enabled &&' in query options
    content = content.replace("enabled: enabled &&", "enabled: isDataEnabled &&")
    print("Replaced enabled variable in RecentSchedulePanel queries")

with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/RecentSchedulePanel.tsx", "w"
) as f:
    f.write(content)
print("RecentSchedulePanel done\n")

# ── SituationalResultsPanel ───────────────────────────────────────────────────
with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/SituationalResultsPanel.tsx"
) as f:
    content = f.read()

# Add enabled prop to SituationalResultsPanelProps
if "enabled?: boolean" not in content:
    old_props = "export interface SituationalResultsPanelProps {"
    idx = content.find(old_props)
    if idx >= 0:
        end_idx = content.find("\n}", idx)
        content = (
            content[:end_idx]
            + "\n  /** IntersectionObserver gate — only fetch data when card is in viewport */\n  enabled?: boolean;"
            + content[end_idx:]
        )
        print("Added enabled prop to SituationalResultsPanelProps")

# Wire enabled into function signature
old_sig_end = "}: SituationalResultsPanelProps)"
idx = content.find(old_sig_end)
if idx >= 0:
    start = content.rfind("export default function SituationalResultsPanel({", 0, idx)
    sig_section = content[start:idx]
    if "enabled" not in sig_section:
        content = content[:idx] + ",\n  enabled = true" + content[idx:]
        print("Added enabled to SituationalResultsPanel function signature")

# Wire enabled into the tRPC queries
# Replace { enabled: sport === "MLB", ... } with { enabled: (enabled ?? true) && sport === "MLB", ... }
old_q1 = '    { enabled: sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }'
new_q1 = '    { enabled: (enabled ?? true) && sport === "MLB", staleTime: 5 * 60 * 1000, retry: 1 }'
count = content.count(old_q1)
content = content.replace(old_q1, new_q1)
print(f"Replaced {count} MLB enabled conditions in SituationalResultsPanel")

old_q2 = '    { enabled: sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }'
new_q2 = '    { enabled: (enabled ?? true) && sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }'
count2 = content.count(old_q2)
content = content.replace(old_q2, new_q2)
print(f"Replaced {count2} NBA enabled conditions in SituationalResultsPanel")

with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/SituationalResultsPanel.tsx",
    "w",
) as f:
    f.write(content)
print("SituationalResultsPanel done\n")

print("All panels updated successfully")
