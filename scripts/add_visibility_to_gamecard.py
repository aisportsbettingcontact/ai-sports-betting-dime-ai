"""
Add useVisibility hook to GameCard.tsx for IntersectionObserver-gated data fetching.
- Add import for useVisibility
- Add cardRef and isCardVisible in GameCard component
- Add ref={cardRef} to the root motion.div
- Pass enabled={isCardVisible} to secondary panels that make tRPC calls
"""

with open("/home/ubuntu/ai-sports-betting/client/src/components/GameCard.tsx") as f:
    lines = f.readlines()

changes = 0

# Step 1: Add useVisibility import after the existing imports
for i, line in enumerate(lines):
    if 'import { getGameTeamColorsClient } from "@shared/teamColors";' in line:
        lines.insert(i + 1, 'import { useVisibility } from "@/hooks/useVisibility";\n')
        changes += 1
        print(f"Added useVisibility import at line {i + 2}")
        break

# Step 2: Add cardRef and isCardVisible after the handleStarClick declaration
# Find the line with "const isNhlGame" which comes early in the component
for i, line in enumerate(lines):
    if "  const isNhlGame   = game.sport" in line:
        # Insert before this line
        lines.insert(
            i,
            "  // IntersectionObserver-gated visibility — secondary panels only fetch when card is in viewport\n",
        )
        lines.insert(
            i + 1,
            '  const [cardRef, isCardVisible] = useVisibility({ rootMargin: "200px" });\n',
        )
        lines.insert(i + 2, "\n")
        changes += 1
        print(f"Added cardRef + isCardVisible at line {i + 1}")
        break

# Step 3: Add ref={cardRef} to the root motion.div
# Find the motion.div with className="w-full relative"
for i, line in enumerate(lines):
    if '        className="w-full relative"' in line:
        # Check if it's the main card motion.div (has borderLeft style nearby)
        context = "".join(lines[i : i + 8])
        if "borderLeft" in context and "borderColor" in context:
            # Add ref after the className line
            lines.insert(i + 1, "        ref={cardRef}\n")
            changes += 1
            print(f"Added ref={{cardRef}} to motion.div at line {i + 2}")
            break

# Step 4: Pass enabled={isCardVisible} to secondary panels
# BettingSplitsPanel
for i, line in enumerate(lines):
    if "<BettingSplitsPanel" in line:
        # Find the closing of this component and add enabled prop
        # Look for the next few lines to find where to add it
        for j in range(i, min(i + 20, len(lines))):
            if "gameId={game.id}" in lines[j]:
                lines[j] = lines[j].rstrip("\n") + "\n"
                lines.insert(j + 1, "            enabled={isCardVisible}\n")
                changes += 1
                print(f"Added enabled to BettingSplitsPanel at line {j + 2}")
                break
        break

# OddsHistoryPanel
for i, line in enumerate(lines):
    if "<OddsHistoryPanel" in line:
        for j in range(i, min(i + 20, len(lines))):
            if "gameId={game.id}" in lines[j]:
                lines[j] = lines[j].rstrip("\n") + "\n"
                lines.insert(j + 1, "            enabled={isCardVisible}\n")
                changes += 1
                print(f"Added enabled to OddsHistoryPanel at line {j + 2}")
                break
        break

# RecentSchedulePanel
for i, line in enumerate(lines):
    if "<RecentSchedulePanel" in line:
        for j in range(i, min(i + 20, len(lines))):
            if 'sport="MLB"' in lines[j]:
                lines[j] = lines[j].rstrip("\n") + "\n"
                lines.insert(j + 1, "            enabled={isCardVisible}\n")
                changes += 1
                print(f"Added enabled to RecentSchedulePanel at line {j + 2}")
                break
        break

# SituationalResultsPanel
for i, line in enumerate(lines):
    if "<SituationalResultsPanel" in line:
        for j in range(i, min(i + 20, len(lines))):
            if 'sport="MLB"' in lines[j]:
                lines[j] = lines[j].rstrip("\n") + "\n"
                lines.insert(j + 1, "            enabled={isCardVisible}\n")
                changes += 1
                print(f"Added enabled to SituationalResultsPanel at line {j + 2}")
                break
        break

with open(
    "/home/ubuntu/ai-sports-betting/client/src/components/GameCard.tsx", "w"
) as f:
    f.writelines(lines)

print(f"\nTotal changes: {changes}")
