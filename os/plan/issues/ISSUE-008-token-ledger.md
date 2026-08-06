# ISSUE-008 — Measure AI spend for the first time

**Wave:** 2 — Visibility · **Effort:** M · **Status:** DONE — shipped in #388 · **DRI:** Prez
**Ruling dependency:** DR-012
**Doctrine:** D10 (token-maxing, the six ledger questions) · D16 criterion 8

> **Closed #388.** `os/ledger/` + `shared/os/cost.ts` — $6,272.08, 87.7% saved by caching. Verified after landing: CI green on the merge commit,
> both Railway services deployed, live smoke passing.

---

## Scope

**No USD is measured anywhere at Dime today.** The only USD field (`dimeAgent.ts:92`) is returned and
never persisted. The prior program could not price its own ~400k-token run and honestly recorded it
as UNKNOWN.

DR-012's emitter **has already run and produced defensible numbers**: `$18,274` cache-aware,
`66.3%` PR-attributable, `$36.69` per accepted unit, `2.3%` waste, `31.5%` dark. It is git-native,
hook-driven, needs no schema change, and fixes the `aiCostMeter` typecheck break by **deleting** a
phantom import rather than creating a table.

**Urgent sub-task:** the substrate is being destroyed right now. Claude Code's `cleanupPeriodDays`
is unset (30-day default) and the oldest transcript in this project is **2026-07-25** — 11 days of
history in a 403 MB corpus. **Set the retention before more evaporates.**

## Files

- Create: `os/ledger/sessions/` (hash-chained JSONL, git tier)
- Create: `scripts/os/ledger-session.mjs` (SessionStart catch-up hook)
- Modify: `.claude/settings.json` — register the hook; set `cleanupPeriodDays`
- Create: `os/ledger/PRICES.json` (versioned price table; a re-pricing is a visible version bump)
- Create: `os/ledger/HUMAN-EQUIVALENCE.md` (the D10 comparison basis and its assumption ranges)
- Modify: `server/_core/aiCostMeter.ts` (delete the phantom import — see ISSUE-002)

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `cleanupPeriodDays` is set to a stated value **before any other step** — this is time-sensitive
- [ ] A cost record carries: session id, model, input/output/cache tokens, `listUsd`, latency, and `links.outcomeRef`
- [ ] `listUsd` (cache-aware first-party replacement cost) is the declared D10 numerator, **not** the actual cash bill — because subscription auth means interactive work is not billed per token
- [ ] Two labelled ratios are reported, sharing denominators with the factory acceptance units: product-code (unit = accepted merged PR) and model (unit = settled grading)
- [ ] All six D10 questions are answered or **explicitly proxied with the proxy named** — an unanswerable question is stated as such, never silently dropped
- [ ] This mission's own cost is in the ledger as its first entry: Stage 1 = 6,134,033 tokens / 84 agents; Stage 2 = 1,705,337 / 13 agents
- [ ] The hook `exit 0`s unconditionally

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# FIRST — stop the substrate decaying
python3 -c "import json;p='.claude/settings.json';d=json.load(open(p));print(d.get('cleanupPeriodDays','UNSET'))"

# How much history is left right now
ls -t ~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/*.jsonl | tail -1
du -sh ~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/

# The emitter
node scripts/os/ledger-session.mjs --catch-up --dry-run | tail -20
node scripts/os/ledger-session.mjs --verify-chain && echo "chain intact" 
```

## Depends on

ISSUE-002 (the phantom import), ISSUE-006 (the envelope and ledger primitives).

## If the ruling differs

If DR-012 is rejected in favour of the `ai_workflow_costs` DB table (its Option B), the ledger
instruments the **empty pipe**: server-runtime AI spend is near zero while $18,274 sits in
transcripts the table cannot see. It would cost a `db-push.yml` run plus a production deploy to
report a number near zero — and a schema-correct table with no meaningful rows makes the six
questions *look* answered, which is the exact F9 trap.
