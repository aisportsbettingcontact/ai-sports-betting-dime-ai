# STATE — Dime AI

**v1 · as of 2026-08-05 · DRI: Prez · Derived from artifacts, not summaries**

This file answers the four questions of doctrine §4 (D4). It is updated when events change company
state — a release ships, a test fails, a subscriber churns, a calibration moves, a cost rises.
Every line carries VERIFIED / INFERRED / UNKNOWN. **Currency beats completeness.**

> **v1 honesty note.** This version is hand-derived by the executor from the Stage 1 audit. It is
> *not yet* continuously updated, which means it violates the very property it exists to hold
> (D16: "organizational state stays current because it updates continuously"). Making this file
> generated rather than typed is a Stage 4 deliverable and a D16 certification criterion. Until
> then, treat its freshness as **manual, dated, and decaying**.

---

## 1. What is the company trying to accomplish?

**Company outcome.** Dime AI sells analytical software for sports betting — never picks, never
tout. The customer outcome is *better decisions, honestly evidenced*. The stated differentiator is
transparency: publishing model failures and fixes.

**Current binding constraint.** Dime cannot honestly sell decision quality it cannot demonstrate.
Today it demonstrates nothing to customers: every grading surface is owner-only, CLV is NULL, and
production holds its own "do not publish" verdicts that no code reads. *(→ U1)*

**Mission outcome in flight.** 100% AI-Native certification against the twelve-criterion scorecard
in `os/DOCTRINE.md` §17 — every criterion VERIFIED with a linked artifact.

**Explicit limits on the mission goal** *(D5: a goal without limits is unevaluable)*:
- No merge to `main` or production deploy without a Prez gate — **merge to main IS a production
  deploy**.
- No production data touched.
- No loop ships that blends live-pregame and walkforward-replay provenance.
- No customer-facing output bypasses the voice/compliance gate.
- `gitleaks`-clean before every push.

**Status: [VERIFIED]** — Stage 1 complete. Stage 2 open. Awaiting Prez rulings on DR-001…DR-00n.

---

## 2. What is happening now?

### Company
| Fact | Value | Label |
|---|---|---|
| Humans | 1 (Prez) | VERIFIED |
| Engineering throughput | 366 PRs in 28 days (~13/day), 326 merged | VERIFIED |
| Open GitHub issues | **0 — none have ever been opened** | VERIFIED |
| Open PRs | 1 — #362, ten-layer verification framework | VERIFIED |
| Production host | Railway, sole host, auto-deploys `main` | VERIFIED |
| Live deploy | `31fe9638` (PR #365) | VERIFIED |
| Domain | aisportsbettingmodels.com → Railway `ai-sports-betting-dime-ai:3000` | VERIFIED |
| Database | TiDB Cloud (port 4000). A *separate* Railway `mysql:9.4` service named "MySQL: Dime AI" also exists | VERIFIED |
| Revenue | Stripe live; public anonymous pay-first signup shipped; **no free tier, no trial-without-card** | VERIFIED |
| AI spend | **Not measured anywhere.** No USD is persisted by any code path | VERIFIED |

### Product
| Surface | State | Label |
|---|---|---|
| MLB projections feed | Live, 400K-sim Monte Carlo, 24/7 refresh cycle | VERIFIED |
| NHL model | Live, 200K-sim correlated negative-binomial | VERIFIED |
| Soccer | WC2026-only Dixon-Coles (JS); its two target fixtures were played 2026-07-18/19 | VERIFIED |
| NBA / NCAAM / NFL | **No model code.** Ingestion only. NCAAM's model was deleted | VERIFIED |
| Dime Chat | Live, provider `"anthropic"` (hardcoded constant, not env) | VERIFIED |
| Bet Tracker | Live — manual entry, auto-settles to WIN/LOSS/PUSH/VOID, ROI/units/equity curve | VERIFIED |
| **Bet Grader / CLV Auditor (the stated GTM wedge)** | **NOT BUILT** — no ingest path, no bettor-side CLV, no audit surface | VERIFIED |
| Public model track record | **Does not exist.** All grading is behind `RequireOwner` | VERIFIED |

### Operating system (this mission's subject)
| Layer | State |
|---|---|
| L1 Goals | ⚠️ prose only, no record type |
| L2 Artifacts | ⚠️ strong where present, unenforced, no cron writes a run record |
| L3 Context | ❌ tool-by-tool, zero issues, governance files loaded by nothing |
| L4 Agents | ❌ zero charters |
| L5 Tools | ⚠️ real allowlists, no `AUTHORITY.md` |
| L6 Evaluation | ❌ ~2,500 lines dead since 2026-05-23; two key CI gates advisory |
| L7 Memory | ❌ lessons attach to nothing; drift state upserted |
| L8 Governance | ⚠️ prose in files no machine reads |

**D1 level: 2 of 4. [VERIFIED]**

### Open incidents
- **Incident 21** (2026-07-25) — OPEN. PR #199 removed the governed Dime runbook; the P2 review
  finding is unresolved. Must stay open until the replacement foundation is merged and verified.
- **Incident 39** (2026-07-25) — OPEN (low priority). Once-per-boot `ER_NO_SUCH_TABLE` on backend
  startup.
- **Unfiled:** the AI-native program's own incidents 41/42/43 were never written to `INCIDENTS.md`;
  those numbers were taken by a concurrent workstream. *(→ F6.8)*

---

## 3. How does current reality differ from the intended outcome?

Ordered by how much they threaten the intended outcome.

| # | Gap | Intended | Actual |
|---|---|---|---|
| **U1** | Production holds 9 `publish_*` BACKTEST-ONLY verdicts | Do not sell edges the data does not support | All 9 markets publish anyway — no code reads the verdicts |
| **U2** | Three contradictory price sets on one page | One honest price | Checkout $49.99/$99.99/$199.99 · objections copy "$99" + a dead tier · schema.org $99/$249/$499 to Google |
| **U3** | MLB forensic audit (26 commits) + 52 GB evidence on one laptop | Durable organizational evidence | Never pushed to any remote; production was mutated by tooling nobody else has |
| **F2** | Owner-gated queue with no ageing | Blocked work becomes loud | 5 items, 8 days, zero signal anywhere |
| **F1** | The AI-native program is dark state | Artifacts are queryable | Untracked; `git log` empty; the company's own model of its loops lives on one disk |
| **F4** | Drift detector self-patches the engine | Agent authority matches demonstrated reliability | Rewrites `MLBAIModel.py` automatically — no proposal, no approval, no version |
| **F5** | Live-pregame vs replay separation | Enforced provenance | **No mechanism exists**; a re-run silently overwrites the original |
| **F3** | Evaluation drives adjustment | Outcome compared to goal | Publication gate authorizes nothing; CLV NULL; log-loss never persisted; walk-forward leakage counter always reports zero |
| **F6** | Gates bind | Acceptance criteria are binding | DB Tests + Build & Preview Gate advisory; 30 of 38 Playwright tests run nowhere; one test passes green with zero assertions |
| **F7** | Actions are observed | Outcome observed | No cron writes a run record; cadence claims `*/5`, fires 8–10×/day, every under-run reports success |
| **F8** | Money path is atomic and evaluated | Correctness + stability | Zero DB transactions on the Stripe path; claim-before-process kills redelivery; the double-charge guard is absent in production |

**The one-sentence difference:** Dime produces excellent work at extraordinary volume and **observes
the outcome of almost none of it** — including, most tellingly, the outcome of its own previous
attempt to fix that.

---

## 4. What action should occur next?

### Blocked on Prez — decisions only he can make
| # | Decision | Why it cannot be delegated |
|---|---|---|
| **DR-001** | Posture on the 9 BACKTEST-ONLY markets: suppress, relabel, or publish-with-record | Customer-facing claim + revenue tradeoff |
| **DR-002** | Whether to reconcile pricing to the live checkout numbers (and which are canonical) | Pricing is a founder decision |
| **DR-003** | Authorize pushing `local/audit-mlb-model-2026` and committing the AI-native program | Ends the dark-state exposure; that branch also carries the provenance regime and publication-gate wiring that close F5 and F3 |
| **DR-004** | The orchestration-spine question: the named stack (Temporal/Pydantic AI/Mastra/OPA/LiteLLM) does not exist here and LiteLLM tiering **contradicts code-enforced model policy**. Adopt, substitute, or defer? | Reverses a documented standing rule |
| **DR-005** | First-loop selection (recommendation forthcoming in Stage 2) | Sets the mission's critical path |

### Executor's next action — not blocked
Stage 2 BRAINSTORM: generate the design space for closing F1–F9 and write `os/decisions/DR-*.md`,
each with a live shortlist, tradeoffs, **one recommendation**, and a requested ruling.

### Standing constraint on all of it
D14: **visibility before autonomy, evaluation before scale.** F1 (durability) and F2 (loud silence)
ship before anything else, because every other fix built before them becomes more dark state — which
is exactly what happened on 2026-07-28.

---

## Provenance

| Source | Kind |
|---|---|
| `os/audits/2026-08-ai-native-audit.md` | 110-claim forensic ledger, 84 agents, 6.13M tokens |
| `os/audits/gap-map.md` | 96 open loops → 9 families + 3 urgent |
| `os/audits/appendix/` | Full claim evidence + 71 adversarial re-checks |
| `INCIDENTS.md` | 61 numbered incidents, 2 OPEN |
| `docs/ai-native/` *(untracked)* | Prior program: registry, ledger, state, factory |
| `gh` / Railway MCP (read-only) | Live PR, deploy, and service state |

**Known staleness:** deploy state and PR counts were read 2026-08-05 and drift within hours. The
`UNKNOWN` items in the audit §8 — production `publish_*` impact, Railway builder, analytics
enablement, RunPod status, the `modelProb` precision defect — remain unresolved and each names what
would resolve it.
