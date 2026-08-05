# ISSUE-005 — Suppress HR and strikeout props until the units fix ships

**Wave:** 1 — Customer truth · **Effort:** S · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-001 (graft)
**Doctrine:** D8 (acceptance threshold) · §19 compliance gate

---

## Scope

DR-001's graft from Option 2: **treat 'broken' differently from 'unproven'.**

Seven of the nine gated markets are *insufficient-sample* — real models whose edge is not yet proven
with statistical confidence. Two are different:

- **Strikeout props were structurally broken** — an opponent-adjustment units bug shrank every
  projection to ~72% of the book line. Root-caused and fixed **on the archive branch**; the repaired
  walk-forward backtest reads 59% with zero bias.
- **HR props underperformed the league base rate** — negative skill.

Showing a projection from a model known to be miscalibrated is a different act from showing one that
is merely unproven. Suppress these two outright until the units fix ships.

## Files

- Modify: the MLB props read path (`server/mlbFullBacktestEngine.ts` consumers, the props feed route)
- Modify: the feed component that renders `k_prop` / `hr_prop`
- Create: `server/propMarketSuppression.test.ts`

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `k_prop` and `hr_prop` render **nothing** on any customer surface — not a zeroed value, not a placeholder
- [ ] Paid-tier copy that promises "Player Prop Projections" (Max tier, `landing-content.ts:336`) is reconciled — either the claim is suppressed or the tier description states the current state honestly
- [ ] Suppression is server-side and test-covered (red-green)
- [ ] A written re-activation trigger exists: *the units fix from `archive/mlb-model-audit-2026` is merged and its walk-forward backtest is re-verified on `main`*

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
npx vitest run server/propMarketSuppression.test.ts 2>&1 | tail -20
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit; echo "EXIT=$?"

# After deploy: no prop projections served
curl -s "https://aisportsbettingmodels.com/api/trpc/games.list?batch=1" | grep -c "k_prop\|hr_prop"  # expect 0
```

## Depends on

ISSUE-004 (same read path). Re-activation depends on ISSUE-001 (the fix is on the archive branch).

## If the ruling differs

If DR-001 is rejected, cut. If DR-001 is accepted but this graft is not, these two markets are
merely down-classified with the other seven — record that as the ruling, noting that a known-broken
model is then still publishing a projection.

## Notes

**Revenue note, stated honestly:** Max ($199.99) bundles "Player Prop Projections". Suppressing both
prop markets removes that tier's headline differentiator until the fix ships. That is a real cost and
it is Prez's call, not the executor's.
