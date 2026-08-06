# ISSUE-010 — Write the authority ladder, including the executor's own rung

**Wave:** 3 — Ownership · **Effort:** S · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-014 Ruling 4 (HOLE C)
**Doctrine:** D12-L5 (graduated authority) · D12-L8 · D16 criterion 7

---

## Scope

**No `AUTHORITY.md` exists anywhere in the repo** — VERIFIED. Yet DR-009 validates every charter's
`authority_rung` against it, DR-004 proposes a different format for it, and DR-005 asserts a rung for
merge-to-main. The set has an enforcement gate, two consumers, two file formats, **and no ladder.**

This is the most valuable single gap by certification cost: it is a named D16 criterion, it blocks
ISSUE-014 absolutely, and it was scheduled to be invented as a side effect of implementing something
else — which is how governance files become the next `OPERATING-RULES.md`.

Doctrine L5 requires a rung for **the executor of this mission** explicitly. Everything Stage 4 does
is performed under that rung, so it must be written before Stage 4 acts.

## Files

- Create: `os/agents/AUTHORITY.md` (human-readable, canonical)
- Create: `os/agents/authority.json` (machine mirror, generated from the markdown — one source, not two)
- Modify: `scripts/os/artifacts.test.ts` — assert the two stay in sync

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Three rungs defined: (1) read-only analysis and recommendation; (2) reversible low-risk action after evaluation shows reliability; (3) high-impact or hard-to-reverse — human-gated
- [ ] **The mission executor's rung is written explicitly**, naming what it may and may not do
- [ ] Merge-to-`main` and production deploy are rung 3 — consistent with the deploy law
- [ ] Every activated seat gets a rung; every deferred seat is recorded deferred **with its reason**
- [ ] The JSON mirror is **generated** from the markdown, and drift fails `Vitest`
- [ ] The ladder states plainly what it **cannot** enforce: `required_approving_review_count: 0`, `bypass_actors: []`, and Prez is the admin — these gates raise the cost of a violation, they do not make one impossible

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -10
node scripts/os/authority-sync.mjs --check; echo "EXIT=$?"   # markdown vs json

# Confirm the honest limits are real
gh api repos/aisportsbettingcontact/ai-sports-betting-dime-ai/rulesets/18701573 \
  --jq '{reviews: (.rules[]|select(.type=="pull_request").parameters.required_approving_review_count), bypass: .bypass_actors}'
```

## Depends on

ISSUE-006. **Blocks ISSUE-014 absolutely.**

## If the ruling differs

No record claimed this, so there is no competing recommendation to differ from. If Prez prefers
DR-004's `authority.json`-first shape, generate the markdown from the JSON instead — one source
either way, never two hand-maintained files.
