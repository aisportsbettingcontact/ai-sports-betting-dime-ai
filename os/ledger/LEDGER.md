# Token ledger — Dime AI

**Generated:** 2026-08-05 · **ISSUE-008** · **DRI:** Prez
**Source:** `os/ledger/sessions.jsonl`, extracted from Claude Code session transcripts
**Price table:** `prices-2026-08-05` · **Numerator:** `listUsd` (cache-aware list-price
replacement cost, **not** a cash bill)

> **Before this file, Dime measured zero USD anywhere.** The only USD field in the repo
> (`dimeAgent.ts:92`) was returned and never persisted; chat usage went to `console.log`. The
> prior program could not price its own run and honestly recorded it as UNKNOWN.

---

## The measured window

| Metric | Value |
|---|---|
| Sessions | **26** |
| Window | 2026-07-25 → 2026-08-05 (11 days — see the retention note) |
| Input tokens | 124,740 |
| Output tokens | 27,989,480 |
| Cache **write** | 139,043,141 |
| Cache **read** | **9,953,288,122** |
| **Total tokens** | **10,120,445,483** |
| **listUsd** | **$6,272.08** |

## The single most important number

**98.3% of all tokens are cache reads**, priced at 0.1× input.

| | |
|---|---|
| Actual, cache-aware | **$6,272.08** |
| Same work with **no caching** | **$51,061.88** |
| **Saving attributable to caching** | **$44,789.80 — 87.7%** |

That is not a rounding detail; it is the dominant economic fact of how Dime operates. Any future
decision that changes cache behaviour — shorter sessions, different context strategy, a model swap
that breaks caching — moves the bill by roughly **8×**. **Nothing in the repo was measuring this.**

## The six D10 questions

D10 requires these six to be answered for significant spend. Each is answered or **explicitly
proxied with the proxy named** — an unanswerable question is stated as such, never silently dropped.

**1. How much accepted work did this usage produce?**
**ANSWERED.** **185** PRs merged in the window. Accepted-work unit = *merged PR*, which is the same
denominator the product-code factory uses, so cost and acceptance share units.
→ **$6,272.08 / 185 ≈ $33.90 per accepted merged PR.**

**2. How much human time did it remove?**
**PROXIED — proxy named.** No time-tracking exists at Dime, so this cannot be measured directly.
Proxy: engineering throughput of **366 PRs in 28 days (~13/day) from one human**. A conventional
team shipping at that rate would be several engineers. The proxy's weakness is stated plainly: PR
count is an *activity* measure, and D7 warns explicitly against mistaking activity for outcome.

**3. How much coordination did it eliminate?**
**PROXIED — proxy named.** Dime has one human, so there is no coordination baseline to compare
against. The honest proxy is *coordination never created*: zero standups, zero handoffs, zero status
meetings, and — per the Stage 1 audit — zero human middleware roles. This is the D9 "never build the
middleware in the first place" mandate, and it means the number is structurally unmeasurable rather
than merely unmeasured.

**4. How much faster did the company learn?**
**PARTIALLY ANSWERED.** One hard datapoint: the Stage 1 audit verified 110 claims with file-level
evidence and produced 96 open-loop findings in a single day, at a measured 6,134,033 subagent
tokens. The comparable manual audit — the 2026-07-25 MLB forensic audit — took multiple days.
**Weakness stated:** these are different subjects, so this is suggestive, not a controlled
comparison.

**5. How much additional product surface could one person direct?**
**NOT ANSWERED.** Requires a before/after window that has not elapsed. Stating it as unanswered
rather than estimating it. *Resolves via:* comparing shipped surface over the next two comparable
windows.

**6. What human organization would the same result have required?**
**NOT ANSWERED — and deliberately not estimated.** This is the question most prone to a flattering
guess. Answering it honestly needs a costed role-by-role reconstruction, which is
`HUMAN-EQUIVALENCE.md` and needs a Prez-stated plan fee and ratified assumption ranges. Until
those exist the field stays null. **A number invented here would be exactly the "token waste
mistaken for token-maxing" failure D15 #14 names.**

## Two labelled ratios

Per DR-014, the ledger reports two ratios sharing denominators with factory acceptance units:

| Factory | Unit | Cost per unit |
|---|---|---|
| **Product-code** | accepted merged PR | **$33.90** |
| **Model** | settled grading | **`not_measured`** — the model factory has produced no settled grading in this window; CLV columns are NULL and the publication gate is unwired (DR-001). Reporting `not_measured` rather than 0 |

## The mission's own cost, stated

This AI-native mission is itself in the ledger. Its measured subagent spend alone:

| Stage | Agents | Subagent tokens |
|---|---|---|
| Stage 1 AUDIT | 84 | 6,134,033 |
| Stage 2 BRAINSTORM | 13 | 1,705,337 |
| **Total** | **97** | **7,839,370** |

The prior program's equivalent line read *"Exact USD is UNKNOWN from inside the session."* That is
now a number.

## Honest limitations

1. **The window is 11 days, not all history.** `cleanupPeriodDays` was **unset** (30-day default)
   and the oldest surviving transcript is 2026-07-25. Spend before that is **permanently
   unrecoverable**. This issue sets retention to **365** so the window grows from here — but it
   cannot recover what already expired.
2. **`listUsd` is replacement cost, not a cash bill.** Interactive work runs on subscription auth
   and is not billed per token. The number answers *"what would this have cost to buy"*, which is
   what D10 compares against — but it is **not** what Dime paid.
3. **Retention costs disk.** 415 MB / 11 days ≈ 13.6 GB/year at current intensity. Mitigated by
   design: these extracted records are the system of record and are tiny; transcripts are needed
   only for re-derivation.
4. **Cross-project sessions are excluded.** Only this project's transcript directory is read.
5. **Unpriced messages are counted, never dropped** — see `unpricedMessages` per session.
