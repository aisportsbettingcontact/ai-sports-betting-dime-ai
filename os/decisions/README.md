# Decisions

Decision records. Each preserves **the evidence considered, the constraints, the standard applied,
and the ruling** — so a future cycle can tell whether it still applies *(doctrine §6, D6)*.

A decision record is never an option survey. Every one carries a shortlist of live options with
honest tradeoffs, **exactly one recommendation**, and a requested ruling that states what a yes
commits Prez to.

## Status

**All fifteen are AWAITING RULING.** Nothing in Stage 3 or Stage 4 begins until they are ruled —
that is the Stage 2 gate.

## Read in this order

**Start with [DR-014](DR-014-consolidation-ruling.md).** It is the consolidation ruling from three
adversarial critics who reviewed DR-004…DR-013 together. It cuts three records, resolves the
collisions between the rest, and fills four holes nobody owned. **Where DR-014 and any other record
disagree, DR-014 governs.**

### Urgent — live customer-facing exposure, independently shippable

| # | Decision | Recommendation |
|---|---|---|
| [DR-001](DR-001-publish-posture.md) | Posture on 9 markets Dime's own evidence gates BACKTEST-ONLY | Wire the gate; keep projections and grades, suppress "Edge Detected"; suppress the two broken prop markets outright |
| [DR-002](DR-002-pricing-reconciliation.md) | Three contradictory price sets ship simultaneously | Reconcile to live checkout ($49.99/$99.99/$199.99); **generate** the prerender from `TIERS` rather than resyncing it |
| [DR-003](DR-003-dark-state-rescue.md) | Getting finished work into the repository | Preserve first (today, zero-risk — a non-`main` push is not a deploy), triage in five reviewed PRs after |

### Design — the operating system itself

| # | Decision | Recommendation | DR-014 |
|---|---|---|---|
| [DR-004](DR-004-orchestration-spine.md) | The orchestration-spine substitution | Native substitution for all four; **reject LiteLLM tiering outright** | store choice overruled; the LiteLLM rejection stands and is permanent |
| [DR-005](DR-005-first-loop-selection.md) | First-loop selection | **Engineering Build Loop** — its apply step (merge-to-main) already exists and fires ~13×/day | designation upheld; +LOOP-002 Operations as its cross-link partner |
| [DR-006](DR-006-artifact-schema-ledger.md) | Artifact schema and ledger mechanics | Two tiers, one envelope; **all enforcement rides the already-required `Vitest` check** | upheld and expanded — owns the one frontmatter schema; **structural validation only, no time assertions** |
| [DR-007](DR-007-context-layer.md) | The queryable context layer (L3) | The OS Index | **cut (optional)** — absorbed into DR-006 |
| [DR-008](DR-008-loud-silence.md) | Making silence loud (the defining gap) | The clock ladder | `observe_by` survives and is the single best idea in the set; its channels move to `prompt-capsule.sh`. **Its stated safety premise is VERIFIED FALSE** — no review is required on `main` |
| [DR-009](DR-009-agent-seats.md) | Agent seats, charters, activation order | Charter files + a gate inside the required typecheck job | upheld; **one** active seat at v1, not three |
| [DR-010](DR-010-factory-thresholds.md) | The two factories and their thresholds | Two ACCEPTANCE files + a checker | **CUT** — ~90% duplicates PR #362, which is already built and open |
| [DR-011](DR-011-founder-dashboard.md) | The founder dashboard | Generated brief + GitHub-issue escalation | **CUT** — escalates through a channel with zero uses in company history |
| [DR-012](DR-012-token-ledger.md) | Token ledger mechanics | Git-native session ledger from transcripts | upheld; **owns D10 outright.** Its emitter already ran and produced real numbers |
| [DR-013](DR-013-loop-rollout-order.md) | Eight-function loop rollout | Paired activation | **CUT** — an eight-loop program handed to a company that just watched a one-loop program die |

## Format — two record kinds

A record's kind is **`decision`** unless it declares otherwise with a `**Kind:**` line in its
header. Only `consolidation` records declare themselves.

### `decision` — one contested choice (DR-001 … DR-013)

```
# DR-NNN — <decision>
Status · DRI · Raised · Doctrine sections
## The question          one decision, phrased as a question          [REQUIRED]
## Why this is contested why it is a judgment call, not an obvious default
## Options               2-4 real options: what, pros, cons, effort, risk, doctrine fit
## Recommendation        exactly one, why it beats the runners-up, grafts from them  [REQUIRED]
## Requested ruling      the exact question, and what a yes commits Prez to  [REQUIRED]
## Depends on            other DRs by id
## Open unknowns         what could not be determined, and what would resolve it
```

### `consolidation` — a ruling over a *set* of records (DR-014)

A consolidation record does not answer one question. It resolves collisions between records that
were drafted independently, cuts what will not survive, and fills gaps no single record owned. Its
decomposition into separately-rulable parts **is** its recommendation, so forcing it into the
`decision` shape would misrepresent it.

```
# DR-NNN — <consolidation>
Status · DRI · Raised · Doctrine sections
**Kind:** consolidation                                              [REQUIRED]
**Governs:** DR-aaa … DR-bbb                                         [REQUIRED]
## Ruling N — <name>     one per separately-rulable part, ≥1         [REQUIRED]
## Requested ruling      the exact question, and what a yes commits Prez to  [REQUIRED]
## Depends on
## Open unknowns
```

> **This contract is not yet machine-enforced.** `DR-006` owns the one frontmatter/structure
> validator, riding the already-required `Vitest` check. Until it is ruled and built, this section
> is a convention — and a convention with no verification step is exactly the F6/D15 #8 failure the
> audit documented. **The drift that produced this section was found by hand, which is the point:
> it should not have needed a human.**

## After a ruling

The ruling is appended to the record with its date and rationale, `Status:` changes to `RULED`, and
the record becomes the durable answer to *"why is it like this?"* A ruling that reverses an earlier
one supersedes rather than overwrites — the reasoning of both stays readable.

## Provenance

DR-001 through DR-003 were written by the executor from the Stage 1 audit. DR-004 through DR-013
came from ten parallel designers, each exploring its option space independently. DR-014 came from
three critics — coherence, doctrine, and survival — reviewing the set together.

Full critic output: [`appendix/`](appendix/). Total Stage 2 cost: **1,705,337 subagent tokens across
13 agents.**
