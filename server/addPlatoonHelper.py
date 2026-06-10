"""P4-B: Add computePlatoonAdj helper function to mlbKPropsModelService.ts"""

with open("server/mlbKPropsModelService.ts") as f:
    content = f.read()

# Find clamp function end to insert after it
idx = content.find("function clamp(val: number, min: number, max: number): number {")
if idx < 0:
    print("[WARN] clamp function not found")
    exit(1)

# Find the closing brace of clamp
brace_count = 0
i = idx
while i < len(content):
    if content[i] == "{":
        brace_count += 1
    elif content[i] == "}":
        brace_count -= 1
        if brace_count == 0:
            break
    i += 1

platoon_helper = """

// ─── P4-B: Platoon composition adjustment helper ──────────────────────────────
/**
 * computePlatoonAdj: Compute K-rate multiplier based on pitcher hand vs lineup
 * batting hand composition.
 *
 * Logic:
 * - Parse lineup JSON to count R/L/S batters (switch-hitters = 0.5R + 0.5L)
 * - LHP vs RHH-heavy (>=60% RHH): +8% K-rate boost
 * - LHP vs LHH-heavy (>=60% LHH): -6% K-rate penalty
 * - RHP vs LHH-heavy (>=60% LHH): +5% K-rate boost
 * - RHP vs RHH-heavy (>=60% RHH): -3% K-rate penalty
 * - Otherwise: neutral (1.0)
 *
 * @param lineupJson  JSON string from mlbLineups.awayLineup / homeLineup
 * @param pitcherHand 'L' | 'R'
 * @param confirmed   true if lineup is confirmed
 * @param tag         Logging tag
 * @returns Platoon adjustment multiplier (clamped to [0.88, 1.15])
 */
function computePlatoonAdj(
  lineupJson: string | null | undefined,
  pitcherHand: string,
  confirmed: boolean | null | undefined,
  tag: string,
): number {
  if (!confirmed || !lineupJson) {
    console.log(`${tag} [P4-B] No confirmed lineup — platoon adj = 1.0`);
    return 1.0;
  }
  let lineup: Array<{ bats?: string }> = [];
  try {
    lineup = JSON.parse(lineupJson);
  } catch {
    console.log(`${tag} [P4-B] JSON parse error — platoon adj = 1.0`);
    return 1.0;
  }
  if (!Array.isArray(lineup) || lineup.length < 7) {
    console.log(`${tag} [P4-B] Lineup < 7 players — platoon adj = 1.0`);
    return 1.0;
  }
  // Count R/L/S batters (switch-hitters count as 0.5 R + 0.5 L)
  let rCount = 0, lCount = 0;
  for (const player of lineup.slice(0, 9)) {
    const bats = (player.bats ?? 'R').toUpperCase();
    if (bats === 'R') { rCount += 1; }
    else if (bats === 'L') { lCount += 1; }
    else if (bats === 'S') { rCount += 0.5; lCount += 0.5; }
    else { rCount += 1; }
  }
  const total = rCount + lCount;
  if (total === 0) return 1.0;
  const rPct = rCount / total;
  const lPct = lCount / total;
  const hand = pitcherHand.toUpperCase();
  let adj = 1.0;
  let reason = 'neutral';

  if (hand === 'L') {
    if (rPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_LHP_VS_RHH_BOOST;
      reason = `LHP vs RHH-heavy (${(rPct * 100).toFixed(0)}% RHH) +${((adj - 1) * 100).toFixed(0)}%`;
    } else if (lPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_LHP_VS_LHH_PENALTY;
      reason = `LHP vs LHH-heavy (${(lPct * 100).toFixed(0)}% LHH) ${((adj - 1) * 100).toFixed(0)}%`;
    }
  } else {
    if (lPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_RHP_VS_LHH_BOOST;
      reason = `RHP vs LHH-heavy (${(lPct * 100).toFixed(0)}% LHH) +${((adj - 1) * 100).toFixed(0)}%`;
    } else if (rPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_RHP_VS_RHH_PENALTY;
      reason = `RHP vs RHH-heavy (${(rPct * 100).toFixed(0)}% RHH) ${((adj - 1) * 100).toFixed(0)}%`;
    }
  }

  const clamped = Math.min(Math.max(adj, MIN_PLATOON_ADJ), MAX_PLATOON_ADJ);
  console.log(
    `${tag} [P4-B] Platoon: pitcher=${hand} R=${rCount.toFixed(1)} L=${lCount.toFixed(1)} ` +
    `(${(rPct * 100).toFixed(0)}%R/${(lPct * 100).toFixed(0)}%L) ${reason} adj=${clamped.toFixed(4)}`
  );
  return clamped;
}
"""

content = content[: i + 1] + platoon_helper + content[i + 1 :]
print("[STEP] Added computePlatoonAdj helper function after clamp()")

with open("server/mlbKPropsModelService.ts", "w") as f:
    f.write(content)
print("[OUTPUT] Done")
