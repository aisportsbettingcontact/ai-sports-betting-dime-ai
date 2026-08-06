# ISSUE-004 — Wire publish_* into the production read path

**Wave:** 1 — Customer truth · **Effort:** M · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-001
**Doctrine:** D5 (evaluation → adjustment) · D8 (acceptance threshold) · D15 #2, #9 · §19 compliance gate

---

## Scope

Production holds **9 `publish_*` BACKTEST-ONLY verdict rows** written to `mlb_calibration_constants`
on 2026-07-25 by Dime's own forensic audit. **No shipped code reads them** — verified: `grep -rn
"publish_" server/ shared/ client/ scripts/` returns zero non-test hits. So the platform publishes
all nine markets fail-open, against its own evidence.

The audit's instruction is explicit: *"Publish graded results and transparent projections; do not
sell edges the data does not yet support."*

Implement exactly that: a gated market keeps its projection and its graded record, but **cannot
display an Edge Detected classification** — it collapses to Monitor or Pass and carries a visible
evidence label. Ship the audit branch's gate wiring rather than writing it fresh.

## Files

- Modify: the MLB read path that serves `games.list` (`server/routers.ts`) to load `publish_*` from `mlb_calibration_constants`
- Modify: `client/src/lib/gameInsight.ts` (BET/WATCH/NO_EDGE decision) to respect the gate
- Modify: the feed cell/badge component that renders the verdict (inherits `design-system/dime-ai/MASTER.md`)
- Port from `archive/mlb-model-audit-2026`: the publication-gate wiring and `GATE-TABLE.json`
- Create: `server/publicationGateReadPath.test.ts`

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `publish_* = 0` for a market ⇒ that market **cannot** render Edge Detected on any surface (feed, chat, prerender)
- [ ] A gated market still renders its projection, its implied-vs-projected comparison, and its graded record
- [ ] A visible, compliance-gate-approved evidence label appears on gated markets — no certainty language; passes the banned-certainty regex
- [ ] The gate is read **server-side**; a client-only suppression is not acceptable
- [ ] Behaviour is covered by a test that **fails** when the gate is removed (red-green verified)
- [ ] Copy routed through the voice/compliance gate before shipping
- [ ] **Before any code change**, a read-only production query records the current `publish_*` values as evidence

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# 0. Establish ground truth FIRST (read-only, owner-authorized)
#    Record the 9 publish_* rows as an artifact before changing anything.
gh workflow run db-query.yml -f query="SELECT paramName, currentValue, updateSource, lastUpdatedAt FROM mlb_calibration_constants WHERE paramName LIKE 'publish\_%' ORDER BY paramName"

# 1. Red-green on the gate
npx vitest run server/publicationGateReadPath.test.ts 2>&1 | tail -20

# 2. Full suite + typecheck
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit; echo "EXIT=$?"
npx vitest run 2>&1 | tail -5

# 3. After deploy — a gated market must not show Edge Detected
curl -s https://aisportsbettingmodels.com/api/trpc/games.list?batch=1 | head -c 600
```

## Depends on

ISSUE-001 (the gate wiring lives on the archive branch).

## If the ruling differs

If DR-001 is rejected and the current fail-open posture continues knowingly, **cut this issue and
record the ruling with its rationale.** Do not substitute a disclaimer — that would let the artifact
claim the gap is closed when it is not (D15 #9).

## Notes

**UNKNOWN this issue must resolve first:** whether production is currently serving Edge Detected on
gated markets to real customers. Code analysis proves nothing reads `publish_*`; confirming customer
impact needs the read in step 0. This is the highest-value open unknown in the mission.
