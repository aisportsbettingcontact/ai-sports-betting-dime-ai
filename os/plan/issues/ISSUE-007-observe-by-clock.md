# ISSUE-007 — Make silence loud: the observe_by clock on every prompt

**Wave:** 2 — Visibility · **Effort:** M · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-008 + DR-014 Ruling 3
**Doctrine:** D5 (an open loop fails silently) · D12-L7 · gap F2

---

## Scope

**This is the mechanism whose absence killed the 2026-07-28 program** — five owner-gated items sat
untouched for 8 days and nothing noticed.

Add a mandatory `observe_by` field to every open `/os/` artifact. It makes it **structurally
impossible to write "blocked on owner" without writing the date at which that silence becomes a
defect.**

Deliver it through the channel the entire decision set missed: **`.claude/scripts/prompt-capsule.sh`
is a `UserPromptSubmit` hook that fires on EVERY prompt.** It is already wired, already trusted,
`exit 0` always, and today it is a static heredoc. `SessionStart` fires once per session; this fires
once per prompt.

**Not** a GitHub issue (0 opened in 366 PRs). **Not** a new required check (never once promoted in
five ruleset revisions). **Not** a scheduled workflow (`security-audit-weekly` failed 4/4 over three
weeks with zero response).

## Files

- Modify: `shared/os/frontmatter.ts` — add `observe_by` to the required set for open artifacts
- Create: `scripts/os/clock.mjs` — computes overdue items, writes a cached JSON
- Modify: `.claude/scripts/prompt-capsule.sh` — append one dynamic line
- Modify: `scripts/os/artifacts.test.ts` — assert the clock's generator produces valid output
- Create: `os/overrides/` — the documented escape valve

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Every open `/os/` artifact carries `observe_by`; one that does not **fails `Vitest`**
- [ ] `prompt-capsule.sh` emits a line like `[OS] 3 items overdue — DR-001 ruling (12d), LOOP-001 outcome unobserved (4d)` and **`exit 0` unconditionally** (a hook that fails must never wedge a session)
- [ ] Hook budget **≤ 2s**; reads only the cached JSON, never `git log` per artifact
- [ ] **If the generator breaks, `Vitest` goes red on the next merge** — verified by deliberately breaking it
- [ ] Nothing overdue ⇒ the capsule line is absent, not noisy
- [ ] The `os/overrides/` valve requires a written reason and an expiry date
- [ ] DR-001 and DR-002 become the first two clocked items — the fastest honest test of whether this works on a real Prez decision

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# The generator
node scripts/os/clock.mjs --check && echo "EXIT=$?"

# The hook — must be fast and must never fail
time bash .claude/scripts/prompt-capsule.sh; echo "EXIT=$?"   # expect EXIT=0, <2s

# Break the generator on purpose; Vitest must go red
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -10
```

## Depends on

ISSUE-006 (the frontmatter schema and the validator it rides).

## If the ruling differs

DR-008's own recommendation (Option C) routes through a **new required check + a standing GitHub
issue**. DR-014 overrules both channels on measured evidence. If Prez restores them, note that
DR-008's stated safety premise is **VERIFIED FALSE** — it assumed a second account approves every
merge; `required_approving_review_count: 0` and `bypass_actors: []`, so every override is genuinely
unilateral with no co-signer.
