# DR-001 — Publish posture for nine markets Dime's own evidence gates BACKTEST-ONLY

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 by the executor (Stage 2)
**observe_by:** 2026-08-12
**Urgency:** HIGHEST — live customer-facing claims contradict Dime's own evidence
**Doctrine:** D5 (evaluation → adjustment) · D7 (relevance, not just execution) · D8 (acceptance
threshold) · §19 compliance gate · D15 #2 (open-loop automation), #9 (generated output mistaken for
completion)

---

## The question

**Dime's own forensic audit gated all nine MLB markets BACKTEST-ONLY. The product publishes them
anyway because nothing reads the gate. What posture ships while the gate gets wired?**

## What is actually true — VERIFIED 2026-08-05

**The verdict exists and is unambiguous.** From `MASTER-REPORT.md` on branch
`local/audit-mlb-model-2026` (2026-07-25, tip `8190a7d96`):

> **All nine markets: BACKTEST-ONLY.** … the evidence gate then says the quiet part out loud: none
> of the nine markets yet beats its market/naive baseline with statistical confidence, so every
> market is gated BACKTEST-ONLY pending more sample and the registered next-round improvements.
> **Publish graded results and transparent projections; do not sell edges the data does not yet
> support.**

**The verdict was written to production.** `publish_*` rows were written to
`mlb_calibration_constants` (all `0`) on 2026-07-25, alongside 13,408 regrades, 8,464 new ledger
rows, and 7,632 CLV backfills — real, snapshot-backed writes against production TiDB.

**Nothing reads them.** `grep -rn "publish_" server/ shared/ client/ scripts/ --include=*.ts
--include=*.py` (excluding tests) → **zero hits.** And the gate module that would consume them,
`server/mlbPublicationGate.ts`, has exactly two importers: **itself and its own test.** So the
platform holds an evidence-based "do not sell this as an edge" verdict for every market and displays
Edge Detected classifications anyway, **fail-open**.

**What the audit actually found, per market** *(this nuance matters for the ruling)*:

| Market | Finding |
|---|---|
| Full-game moneyline | **Genuine skill as-published** (the strongest of the nine) |
| Run line (pick channel) | Genuine skill to a lesser degree; the naive-looking 59% RL "edge" is **structural**, not skill |
| Full-game totals | Ran **half a run cold** against a hotter 2026 run environment — environment multiplier now fitted walk-forward *(fix is on the branch)* |
| Strikeout props | **Structurally broken** — a units bug shrank every projection to ~72% of the book line; root-caused and fixed *(fix is on the branch; repaired backtest 59% with zero bias)* |
| HR props | **Underperformed the league base rate** |
| NRFI | **Coin flip** — rebuilt as a walk-forward logistic model *(on the branch)* |

**The critical distinction:** the gate says BACKTEST-ONLY because *none beats its baseline **with
statistical confidence*** — that is **insufficient sample**, not proven-worthless. Full-game ML
showed real skill. This is a "cannot yet prove it" verdict, not a "we know it's bad" verdict. The
posture should reflect that difference honestly in both directions.

**The audit also invalidated the platform's prior grades**, which is why this cannot be waved off as
over-caution: the previous stored grades were *"unusable"* — F5 "model correct" flags were grading an
always-bet-the-away-team strategy, NRFI/F5 Brier scores divided 0–1 probabilities by 100, and three
games carried the wrong final score.

## Why this is contested

Suppressing nine markets is a real product and revenue action. Sharp ($99.99) and Max ($199.99) exist
largely to sell **model projections** — Max explicitly bundles "Player Prop Projections", which
includes the two prop markets the audit rates worst. A blunt suppression could gut the paid tiers'
stated value while the sample matures.

Against that: the marketing copy already commits Dime to a standard it is currently failing.
`landing-content.ts:265` — *"Dime evaluates market prices and claims nothing it can't grade: no
guaranteed wins, no locks, no fake win rates."* `:211` — *"Books price most markets tight, so expect
Pass more often than the other two."* The product's own three-verdict model (**Pass / Monitor / Edge
Detected**) is already built for exactly this situation. **Dime does not need a new concept to be
honest here; it needs to use the one it already sells.**

## Options

### Option 1 — Wire the gate; gated markets can show projections and grades, but never "Edge Detected" ✅ RECOMMENDED
Read `publish_*` in the production read path. For any market where the gate is `0`: continue showing
the projection, the implied-vs-projected comparison, and the graded record — but **suppress the Edge
Detected classification**, collapsing it to Monitor or Pass, and label the market with its evidence
state ("Backtest only — not yet proven against baseline"). Ship the audit branch's publication-gate
wiring rather than writing it fresh.

- **Pros:** does exactly what Dime's own MASTER-REPORT instructs — *publish graded results and
  transparent projections; do not sell edges the data does not yet support* · preserves nearly all
  product value (the board, the chat, the tracker, the grades all still work) · **turns the finding
  into the transparency differentiator the brand already claims** but has never shipped (gap: no
  public track record exists) · the gate module and its thresholds already exist · uses the existing
  Pass/Monitor/Edge vocabulary, so no new customer concept
- **Cons:** "Edge Detected" is the headline feature and it goes quiet on most markets until sample
  matures · requires a production read path change plus UI work under brand law · needs a clear,
  non-alarming customer explanation
- **Effort:** M · **Risk:** medium (touches a customer-facing surface)
- **Doctrine fit:** strongest. Closes the D5 evaluation→adjustment gap, satisfies D8's acceptance
  threshold, and is the only option where the gate actually gates.

### Option 2 — Suppress the nine gated markets entirely until they clear the gate
Hide gated markets from the feed and chat.

- **Pros:** unambiguously safe · smallest surface area of claim · trivially defensible
- **Cons:** **guts the paid tiers** — Max's "Player Prop Projections" would show nothing · discards
  full-game moneyline, which the audit says has *genuine skill* · a paying customer sees an empty
  product with no explanation, which is worse for trust than an honest label · over-corrects a
  "insufficient sample" verdict into a "we were wrong" posture
- **Effort:** S · **Risk:** high (revenue and churn)
- **Doctrine fit:** satisfies the compliance gate but fails D7 relevance — it treats an evidence
  state as a product kill switch.

### Option 3 — Publish everything, add a disclaimer, wire the gate later
Leave the feed as-is; add copy explaining that markets are backtest-gated.

- **Pros:** zero product disruption · fastest
- **Cons:** **this is the status quo with words added.** The gate still authorizes nothing, so it is
  still fail-open · a disclaimer beside an "Edge Detected" badge does not undo the claim the badge
  makes · it is precisely the "disclaimer theater" the repo's own compliance engineering avoids
  elsewhere · leaves the D5 loop open indefinitely
- **Effort:** XS · **Risk:** high (the risk is simply unaddressed)
- **Doctrine fit:** weakest. D15 #9 — generated output mistaken for completion.

## Recommendation

**Option 1 — wire the gate, keep projections and grades visible, suppress Edge Detected on gated
markets, and label the evidence state.**

Three reasons it beats the others:

1. **It is literally the instruction Dime's own audit wrote.** "Publish graded results and
   transparent projections; do not sell edges the data does not yet support" is Option 1 stated as a
   sentence. Option 2 over-reads it; Option 3 ignores it.
2. **It converts the worst finding into the differentiator the brand already sells and has never
   delivered.** Stage 1 refuted "transparency-first: model failures published" — every grading
   surface is owner-only, so the record the landing page calls *"the record"* is readable by exactly
   one person. Shipping the gate *with* the graded record is the first honest public track record
   Dime would have, and it is a stronger anti-tout proof point than any copy.
3. **It respects the actual finding.** The verdict is insufficient-confidence, not proven-bad. Full
   game ML has genuine skill. Option 2 would suppress it anyway.

**Grafted from the runners-up:**
- From Option 2 — **HR props and strikeout props should be suppressed outright, not merely
  down-classified**, until the branch's units fix ships. HR props underperformed the base rate and K
  props were structurally broken; showing a projection from a model known to be miscalibrated is
  different from showing one that is merely unproven. Treat "broken" and "unproven" differently.
- From Option 3 — the customer-facing explanation matters and should be written properly, routed
  through the voice/compliance gate, and reviewed against the banned-certainty regex.

## Requested ruling

> **Prez: authorize wiring `publish_*` into the production read path such that a gated market keeps
> its projection and graded record but cannot display an Edge Detected classification — and
> separately authorize suppressing HR props and strikeout props outright until the audit branch's
> units fix ships.**

**A yes commits you to:** Edge Detected going quiet on most MLB markets until sample matures; a
customer-visible evidence label on gated markets; a production read-path change and UI work; and
publishing the graded record where today it is owner-only.

**A no** means the current fail-open posture continues knowingly. If that is the call, say so
explicitly and I will record it as a ruling with its rationale — but I will not implement Option 3's
disclaimer as a substitute, because it would let the artifact claim the gap is closed when it is not.

**Timing question I need answered separately:** should anything ship *before* the full wiring — e.g.
suppressing the two broken prop markets today, which is a much smaller change than the full gate?

## Depends on

- **DR-003** (dark-state rescue) — the publication-gate wiring, the K-props units fix, and the
  provenance regime all live on the unpushed branch. Ruling yes here without DR-003 means rebuilding
  work that already exists.
- **DR-005** (first-loop selection) — if the model release loop is chosen as first loop, this
  decision is its first live cycle.

## Open unknowns

- **Whether production is currently serving Edge Detected on gated markets to real customers.** Code
  analysis proves nothing reads `publish_*`; confirming customer impact needs one read-only query
  against `mlb_calibration_constants` plus one live page check. **This is the single highest-value
  unknown in the mission and I cannot resolve it without your authorization.**
- Whether the nine `publish_*` rows are still `0` or have been altered since 2026-07-25.
- The revenue attributable to prop-market access specifically — needed to size Option 1's cost
  honestly.
- `mlbOutcomeIngestor.ts:162` still applies `/100` to probabilities the audit says are stored 0–1.
  If true in production, Brier scores in the `games` table are near-meaningless *today*, independent
  of this decision. Unchanged since 2026-07-23.
