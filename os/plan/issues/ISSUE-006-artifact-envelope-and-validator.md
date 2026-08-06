# ISSUE-006 — Adopt the artifact envelope and validate /os/ on the required Vitest check

**Wave:** 2 — Visibility · **Effort:** M · **Status:** DONE — shipped in #387 · **DRI:** Prez
**Ruling dependency:** DR-006
**Doctrine:** D6 (artifact law, seven properties) · D12-L2 · D16 criteria 2, 5, 12

> **Closed #387.** `shared/os/artifacts.ts` + `scripts/os/artifacts.test.ts`, riding the required Vitest check. Verified after landing: CI green on the merge commit,
> both Railway services deployed, live smoke passing.

---

## Scope

Establish the artifact substrate. Two tiers, one envelope, **no fourth substrate**.

Adopt `shared/loop/envelope.ts` + `ledger.ts` (11 typed artifact kinds, four timestamps, resolvable
source refs, sha-256 content hash over a canonical view that excludes processing time so replays
dedupe; append-only prev-hash chain; refuses fabricated hashes and unresolved citations; **32
adversarial tests**). Add the **goal** kind (HOLE A) and a `runMode: "live" | "replay"` field so a
replay hashes differently and appends as a distinct artifact instead of overwriting the original —
which is the provenance law of §19 that gap F5 says has **no mechanism at all** today.

Enforcement rides the **already-required `Vitest` check** — `shared/**/*.test.ts` and
`scripts/**/*.test.ts` are already in the include globs. **No new required status check.**

**Structural validation only. No time-based assertions** — those turn `Vitest` red on unrelated PRs
at 13 merges/day and get skipped, and this repo has a documented instance of exactly that
(`kenpomCredentials.test.ts`, F6.3).

## Files

- Adopt: `shared/loop/envelope.ts`, `ledger.ts`, `queries.ts` (from ISSUE-001's archive branch)
- Create: `shared/os/frontmatter.ts` (one zod schema; per-kind required fields contributed by owning records)
- Create: `scripts/os/artifacts.test.ts` (the validator; runs inside the required `Vitest` job)
- Modify: `os/decisions/README.md` — note the contract is now machine-enforced

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Every `/os/**/*.md` artifact carries valid frontmatter; an invalid one **fails `Vitest`**
- [ ] The decision-record format contract (both `decision` and `consolidation` kinds) is enforced by the validator, not by convention
- [ ] `os/decisions/`, `os/goals/`, `os/loops/`, `os/agents/charters/`, `os/memory/lessons/` all validate
- [ ] A cross-link assertion (absorbed from DR-013): a loop may not be `LIVE` unless an artifact id it produced **resolves** inside another loop's recorded decision
- [ ] **Zero time-based assertions** in the validator — staleness belongs to ISSUE-007
- [ ] `runMode` participates in the content hash: replaying the same input with `runMode: "replay"` produces a **different** artifact id, verified by test
- [ ] The 32 inherited adversarial tests still pass unmodified
- [ ] The validator **fails** when a required section is removed — red-green verified

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# Red: break a record on purpose, confirm the gate catches it
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -20

# Green
npx vitest run shared/loop scripts/os/artifacts.test.ts 2>&1 | tail -8   # expect 32+ pass
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit; echo "EXIT=$?"

# Confirm it rides the ALREADY-REQUIRED job (no ruleset change needed)
gh api repos/aisportsbettingcontact/ai-sports-betting-dime-ai/rulesets/18701573 \
  --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
# expect exactly: Security Audit, TypeScript Check, Vitest
```

## Depends on

ISSUE-001, ISSUE-002.

## If the ruling differs

If DR-006 is rejected in favour of a fresh minimal schema (its Option D), this issue rewrites instead
of adopting and **loses the 32 adversarial tests** — the single largest quality regression available
in this plan. If the TiDB tier is ordered built now instead of deferred, that inverts D14 and needs a
`db-push.yml` run before any code deploy.
