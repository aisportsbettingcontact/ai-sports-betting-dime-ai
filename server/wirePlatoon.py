"""P4-B: Wire computePlatoonAdj into K-props lambda computation"""

with open("server/mlbKPropsModelService.ts") as f:
    content = f.read()

# Wire platoon adj into lambdaRaw computation
old = """      ); // ── Poisson lambda (direction-split calibration) ─────────────────────
      // OVER uses stronger factor (0.800) to correct high-line over-projection.
      // UNDER uses standard factor (0.739) calibrated from full-sample backtest.
      const lambdaRaw = pitcherK9 * xfipAdj * oppAdj * (ipExpected / 9);"""

new = """      );
      // ── P4-B: Platoon composition adjustment ───────────────────────────
      // Determine which lineup to use: pitcher is on 'away' side → faces home lineup
      // pitcher is on 'home' side → faces away lineup
      const oppLineupJson = row.side === "away" ? row.homeLineup : row.awayLineup;
      const oppLineupConfirmed = row.side === "away" ? row.homeLineupConfirmed : row.awayLineupConfirmed;
      const platoonTag = `[KProps][P4-B][${row.pitcherName}]`;
      const platoonAdj = computePlatoonAdj(oppLineupJson, throwsHand, oppLineupConfirmed, platoonTag);
      // ── Poisson lambda (direction-split calibration) ─────────────────────
      // OVER uses stronger factor (0.800) to correct high-line over-projection.
      // UNDER uses standard factor (0.739) calibrated from full-sample backtest.
      // P4-B: platoonAdj multiplied into lambdaRaw (adjusts K-rate for lineup hand composition)
      const lambdaRaw = pitcherK9 * xfipAdj * oppAdj * platoonAdj * (ipExpected / 9);"""

if old in content:
    content = content.replace(old, new, 1)
    print("[STEP] Wired computePlatoonAdj into K-props lambdaRaw")
else:
    print("[WARN] lambdaRaw section not found")

with open("server/mlbKPropsModelService.ts", "w") as f:
    f.write(content)
print("[OUTPUT] Done")
