# Appendix — doctrine critique (Stage 2)

Scores the SET against all twelve D16 certification criteria. Source of DR-014's four holes (goal record, live open-loop automation, authority ladder, diagnostic).

# DR-014 — Doctrine review of the Stage 2 decision set: four uncovered certification criteria, four incompatible substrates, and one live automation nobody claimed

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 by the doctrine critic (Stage 2)
**Doctrine:** D16 §17 (twelve criteria) · D14 (ordering) · D15 (#2, #4, #8, #9, #15, #16) · D4 (one reality) · D12-L1/L5/L7
**Scope:** the SET of DR-004…DR-013. Individual records are not re-argued; only what the set misses, duplicates, or contradicts.

---

## The question

**The ten drafted records are individually strong and collectively unreconciled. Scored against D16's twelve criteria, two criteria have zero owner, two more have a specific unowned sub-element, four incompatible artifact substrates are proposed by six records, and eight new blocking CI surfaces are proposed with no budget owner. Do we patch the gaps into the existing records, mint the minimum set of new ones and impose set-wide constraints, re-cut Stage 2 smaller, or accept the set as-is and let Stage 6 find the holes?**

## What the set gets right (stated once, so the criticism lands)

Three records independently invented the same anti-theater mechanism: a thing that **breaks loudly when its own generator stops** — DR-008's 48h heartbeat, DR-010's `expiresAt` on lowered thresholds, DR-011's `check-brief-fresh`. DR-006's insight that enforcement should ride the *already-required* `Vitest` check rather than adding a fifth required context is the cheapest correct idea in the whole set. DR-009's ruling that ~200 skills and 61 plugins are tools and never seats is the correct answer to D15 #16 and kills the 32-seat fiction structurally rather than rhetorically. DR-012's core emitter already ran and produced real numbers. This is a good set. The findings below are about the seams between records, which is where nothing was assigned.

---

## 1. Scoring the set against the twelve D16 §17 certification criteria

| # | Criterion | Owner | Verdict |
|---|---|---|---|
| 1 | Level 4 achieved | — | **NO OWNER for the instrument.** The Level-2 score came from an 84-agent / 6.13M-token one-off. Nothing in the set makes the rescore repeatable or names who signs it |
| 2 | Six elements live and linked | DR-006/007/009/010/013 | **PARTIAL — element 1 (human goals) has no owner.** See HOLE A |
| 3 | Every important process is a closed loop | DR-005, DR-013 | **PARTIAL — one important process stays open all mission.** See HOLE B |
| 4 | Eight function loops operating and interconnected | DR-013 | COVERED (D14 caveat §2.3; rule conflict with DR-005 §4.5) |
| 5 | All eight layers implemented | DR-006 (L2), DR-007 (L3), DR-009 (L4), DR-010 (L6), DR-011 (L8) | **PARTIAL — L1 unowned (HOLE A); L5 contested (HOLE C); L7 retrieval-by-process undesigned** |
| 6 | Both factories certified | DR-010 | COVERED, contingent on the `modelProb` defect (§3.3) |
| 7 | **Authority ladder enforced** | **—** | **NO OWNER.** See HOLE C |
| 8 | Token economics operating | DR-012 (+DR-004) | COVERED-with-collision (§4.3). Neither owns D10's hire-test |
| 9 | The four questions answer current | DR-011 (partial) | **SEAM.** Nothing makes `os/STATE.md` generated; question 1 depends on HOLE A |
| 10 | Queryability proven | DR-007 | COVERED |
| 11 | **Diagnostic clean** | **—** | **NO OWNER.** See HOLE D |
| 12 | No dark state | DR-003, DR-006, DR-012 | COVERED, contingent on DR-003 Phase B |

### HOLE A — the goal record (D12-L1) is referenced by three records and designed by none

Doctrine L1 specifies `os/goals/GR-####-*.md` with **nine fields**. The audit records L1 as ⚠️ with "no goal record type anywhere"; F9 lists it **ABSENT**; `artifactTypeSchema`'s 11 kinds include no goal.

- DR-011's check **C1 (priority-vs-activity)** parses `os/goals/GR-*.md` frontmatter and lists the field names as UNKNOWN, blocked on "a sibling Stage-2 record [that] is not yet numbered."
- DR-013's loop files carry an outcome per loop but no goal record.
- DR-007 defers its `kind` enum to DR-006; DR-006's kind vocabulary is the envelope's 11 loop kinds, none of which is a goal.

Consequence: D13's founder-loop flagship requirement — *"surfaces contradictions: a claimed priority that engineering activity ignores"* — is **not computable** anywhere in the set. Neither is D5's "Goal, specific enough to evaluate, **with limits**," which is the component the doctrine warns about most explicitly (the support loop that closes tickets, the engineering loop that produces unnecessary code). Criteria 2, 5 and 9 all fail on this one missing type.

### HOLE B — the one live open-loop automation survives the entire mission unowned

`server/mlbDriftDetector.ts:814` still executes `fs.writeFileSync(MODEL_PY, src)` on `main` today (VERIFIED this session). This is the audit's named D15 #2 exemplar and gap-map F4.1, rated HIGH.

Across ten records: DR-009 **forbids** SEAT-002 from patching model constants and defers `model-promotion-approver` (`blocked_on: DR-005 + the missing apply/promote step`); DR-005 selects the Engineering loop and defers the model loop; DR-013 places the model loop in a later wave; DR-004/006/007/008/010/011/012 do not touch it. **Forbidding a new seat from doing the thing the shipped code already does is not a control.** Criterion 3 cannot pass while it stands.

Aggravating: DR-005 raises (INFERRED, unresolved) that `path.resolve(__dirname, "MLBAIModel.py")` may not resolve under the esbuild bundle, so the patch may silently no-op or write to a filesystem wiped every deploy. **Nobody owns resolving that either.** An automation whose effect status is unknown is worse than one known to fire.

### HOLE C — the authority ladder has two claimants, two formats, and no owner

Criterion 7 is *"authority ladder enforced."* Doctrine L5 requires `os/agents/AUTHORITY.md`, **including a rung for the executor of this mission and a rung for every activated seat.** VERIFIED this session: no `AUTHORITY.md` exists anywhere in the repo.

- **DR-009** validates every charter's `authority_rung` against that file and states plainly in its unknowns: *"Which decision record owns `os/agents/AUTHORITY.md`… DR-009 cannot ship before the ladder exists… if no DR claims it, AUTHORITY.md must be created inside DR-009's implementation."* A record that declines ownership and then proposes to absorb it by default is how governance files become the next `OPERATING-RULES.md` — the audit's F6.9: "read at every session start, non-negotiable," loaded by nothing.
- **DR-004** independently proposes a `Seat:` PR trailer validated against **`authority.json`** by `scripts/check-authority.mjs`.
- **DR-005** names it as `DR-00n (AUTHORITY LADDER) — FORWARD DEPENDENCY` and asserts merge-to-main is rung 3.

So the set has an *enforcement gate* (DR-004), *consumers* (DR-005, DR-009), and **no ladder** — two file formats, no rung definitions, no rung for the mission executor. This is the most valuable single finding by certification cost: it is a named criterion, it blocks DR-009 absolutely, and it is currently scheduled to be invented as a side effect of implementing something else.

### HOLE D — the OS has no scheduled self-audit

§17 is explicit: **"Recertification cadence: monthly, on the first Monday"** plus four immediate triggers (a new loop reaching live, a change to `AUTHORITY.md`, a factory threshold moving, an incident classified as a doctrine violation), and **"The D15 diagnostic protocol runs on the same monthly cadence, independently of certification."**

No record schedules either. DR-008 ages decisions, loops, incidents and STATE.md; DR-011 surfaces six contradictions daily; neither touches the 17-mode diagnostic or the certification scorecard. `os/certification/` is empty.

This is the recursive form of the exact failure the mission was convened to fix. The 2026-07-28 program built the observers and nothing observed the observers. A set of ten records that installs eight clocks, gates and generators — and schedules no periodic audit of whether they still fire — has reproduced the shape one level up. Criterion 11 has no owner and criterion 1 has no instrument.

### Secondary, recorded so it is not lost

**F8 (money path integrity) is out of scope in every record and the exclusion is nowhere recorded.** Zero DB transactions on the Stripe path, claim-before-process on 6 of 14 event types, `request_id` uniqueness declared in Drizzle and absent in production, nothing ever grants credits. DR-013's Revenue loop *observes* Stripe events; it does not make the process correct or atomic. For a SaaS, the money path is the most important process, and criterion 3 says every important process is a closed loop. This belongs in a Stage 3 engineering plan, not a decision record — but the *decision to exclude it from Stage 2* must be written down.

---

## 2. D14 ordering — where the set grants substrate, authority or scale ahead of observability

### 2.1 DR-004 vs DR-006 — a direct sequencing contradiction, both citing D14

DR-004's recommendation makes **one durable artifact store in TiDB** (`loop_artifacts`, first emitter `job_run` from `cronRunner`) the answer to durable execution. DR-006's recommendation **defers exactly that table**, ships the git tier first, and argues — correctly, and in these words — that the TiDB-first option "pays a schema change, a db-push run, and a deploy before the first artifact exists, **inverting D14's explicit order**." DR-006 then lists DR-004 under "SUBSTRATE COMPATIBILITY" without noticing that DR-004's headline capability lands entirely in DR-006's deferred tier.

One must yield, and doctrine says which: an owner-gated `db-push.yml` run plus a production deploy before a single artifact exists is substrate-before-visibility, and the precedent is on record — the `aiWorkflowCosts` export vanished in the Incident-43 column revert and is *the reason the working tree does not typecheck today*. **DR-006's ordering governs; DR-004's store is the second wave, triggered by DR-005's loop, not the first act.**

### 2.2 DR-009 activates three seats against a governance file that does not exist

L5 places the ladder in `AUTHORITY.md` "including… a rung for every activated seat." DR-009 charters SEAT-001 at rung 2 (writes artifacts), SEAT-003 at rung 3 (hard-block), and validates those rungs against a file no record owns (HOLE C). Declaring authority against a nonexistent ladder is authority before governance. Fix is cheap: the ladder ships in the same wave as, and no later than, the first charter.

### 2.3 DR-013 scales loop count before any loop has demonstrated Adjustment+Memory

D14 stage 15: **"Expand only after the loop learns — a loop scales when it can explain its goal, context, action, result, evaluation, and adjustment."** Zero loops have ever closed at Dime. DR-013 brings eight live in waves inside one mission. Paired activation genuinely mitigates (a pair cannot be declared live until a cross-link resolves mechanically) and the `not_exercised` verdicts are honest. But the gating condition for W2+ is a *resolved cross-link*, which proves components 4–5 of the seven. It should be a **filed adjustment** — component 7 — from W1. As written, the set can reach "eight loops live" with zero instances of a loop having changed its own next cycle, which is the property D5 exists to require.

### 2.4 DR-011 buys visibility with standing authority

Its weekly deep run puts full-privilege `DATABASE_URL` on a recurring schedule where today it is manual-dispatch-only behind an environment gate. DR-011 flags this and names the correct fallback itself. Doctrine answer: visibility is never purchased with authority expansion — panels 6/7 stay `not_measured` with the reason printed until a read-only TiDB user exists.

### 2.5 Records that pass D14 cleanly

DR-008, DR-007, DR-012, DR-010, DR-005, DR-006. DR-005 in particular is the strongest D14 argument in the set: it adds observation while adding **zero** authority, and its criticism of the model-loop alternative ("adds authority to a system that has no way to catch it failing… a 2026-07-28 repeat at higher stakes") is exactly right.

---

## 3. D15 failure modes committed by specific recommendations

### 3.1 #2 open-loop automation — one live instance, unowned

HOLE B. Ten records, and the audit's named exemplar is untouched.

### 3.2 #9 generated output mistaken for completion — inside the charter template itself

DR-009's SEAT-003 charter declares its `evaluation` as *"emit one aggregate artifact per day."* That is an artifact requirement wearing an evaluation's name, and it reproduces F3.7 (compliance blocks logged with no aggregation surface) one layer up: now there is an aggregation surface, and still nothing compares it to a standard or acts on it. SEAT-001's evaluation — declared-vs-observed cadence per job per day — is a real comparison but carries **no threshold and no consequence**. D5 is explicit: evaluation compares outcome to goal *and standard*; success is never assumed because planned activity occurred.

This matters more than two seats because **the charter is the template every future seat copies.** A `evaluation:` field that accepts "emits an artifact" will be filled that way forever. Fix: the charter schema must require `evaluation.standard` (a threshold or comparison) and `evaluation.on_breach` (an escalation target), and `check-charters.mjs` must reject a charter whose evaluation is an emission.

DR-011's brief is the other classic #9 shape and is well mitigated — `check-brief-fresh` proves the generator ran, and time-to-first-acknowledgement instruments whether anyone read it. Accept as drafted.

### 3.3 #8 weak tests — DR-010 is the correction and carries two unmeasured numbers

DR-010 is the right answer to F6 and its `expiresAt` mechanism is excellent. Two exposures, both self-flagged, neither owned by anyone:

- Mutation thresholds 75 (M) / 60 (E) have **never been measured**. A probabilistic bar set from an estimate is a bar that certifies whatever the code currently does.
- Model-factory gate 2 (Brier/BSS) computes on `mlb_game_backtest.modelProb`, declared `decimal(5,2)` documented "(0-100)" while the writer stores 0–1. If real, scale 2 quantizes every probability into 1-percentage-point buckets and **every score the acceptance threshold is computed from is noise.** Three records name this (DR-005, DR-010, gap-map F5.5). **Zero own it.** It costs one read-only `SELECT DISTINCT modelProb FROM mlb_game_backtest LIMIT 50`.

### 3.4 #4 data collection without meaning / D4 "one reality" — the set's worst collective violation

D4: *"Specialized agents share one source of truth. They may divide labor; they may never maintain incompatible realities."* Counting write targets proposed across six records:

| Substrate | Proposed by |
|---|---|
| `os/` on `main` | DR-006, DR-007, DR-008, DR-012 |
| TiDB `loop_artifacts` | DR-004 (primary), DR-006 (deferred) |
| orphan branch **`os-ledger`** | DR-005, DR-013 |
| orphan branch **`os-state`** | DR-011 |
| per-PR `os/factory/runs/<pr>.json` | DR-010 |
| GitHub Issues as store/escalation | DR-008 (standing issue), DR-011 (contradiction issues), DR-013 (tracker as loop substrate) |
| `os/ledger/LEDGER-YYYY-MM.md` **vs** `os/ledger/LEDGER.md` + `os/ledger/sessions/` | DR-004 **vs** DR-012 |

Two differently-named orphan branches, two ledger rollup conventions, and no record owns the reconciliation. Every record is individually defensible; the union is exactly the "incompatible realities" clause, and it is *cheaper to fix now than after two orphan branches exist and diverge*.

Compounding: **DR-011 and DR-013 independently flag the same blocking precondition** — whether Railway's deploy trigger is branch-scoped to `main` — and neither owns resolving it. DR-013 states correctly that if either service has no branch filter, every hourly ledger push becomes a production deploy. One read-only `get-service-config` answers it, and it must happen before any orphan tier is created, not after.

### 3.5 The aggregate gate load — the set's most likely cause of death

Today `main` has **4 required checks**. PR #362 stages 11–12 more behind a Wave graduation. The set adds, across records: DR-005's `13-loop-intent` (fail-closed intent gate at ~13 PRs/day), DR-006's two vitest files inside required `Vitest`, DR-007's `OS Context Index`, DR-008's `OS Clock`, DR-009's charter gate inside the typecheck job, DR-010's `check-required-checks.mjs` + scenario tier + in-PR iteration trace, DR-011's `os-brief-fresh`, DR-012's `os-ledger`. **Five separate records each say "sequence this against PR #362's Wave 1" and no record owns the sequence.**

No individual record is wrong. The union asks one human merging ~13 times a day to satisfy roughly twenty gates, several of which fail on work unrelated to the gate's subject. DR-005 names this as its top risk and it is behavioral, not technical: the failure will not be rot, it will be **disablement** — and F6.1 establishes that this repo demotes gates by one API call that leaves no trace, having already done it to the two remediation gates. Doctrine hook is D3: the productive unit is the person plus context, agents, tools and *permission to act* — not the person plus a queue of gates.

The fix is already invented inside the set and simply needs to be made a rule: **DR-006's technique — new enforcement rides an already-required check.**

### 3.6 #16 isolated agent departments — no instance

DR-009 handles this correctly and explicitly (skills/plugins are tools; the roster is derived from loops; `check-charters.mjs` may never read `.claude/skills/`). The set is clean here.

---

## 4. Prototype theater — ranked by likelihood of demoing then rotting

1. **DR-004's `loop_artifacts` + `artifactStore.ts` (highest).** It depends on an owner-gated schema change that DR-006 argues should not happen yet and whose revert precedent is *the reason the tree does not typecheck today*. If the migration stalls, `artifactStore.ts` becomes the **eighth** member of F1.2's "written, tested, imported by nothing" set — the exact artifact class this mission exists to eliminate. Rule: it may not be built until the table exists **and** one emitter merges in the same wave.
2. **DR-009's `--emit-bindings` → `.claude/agents/dime-<slug>.md`.** Generated subagent files for seats that are deterministic TS modules, on an unverified assumption about frontmatter tolerance. Decoration. Cut from v1. Same for DR-009's `Seat:`-trailer path-scope check — DR-009 writes its own verdict: *"an opt-in gate that reads like enforcement is its own kind of dishonesty."* Cut it too.
3. **DR-007's `scripts/os-query.mjs` CLI.** The index and its gate are load-bearing; the human-facing CLI is the part most likely to be built and never run. Survival condition: the SessionStart capsule and DR-011's brief must both consume the *same module* the CLI wraps, so it cannot rot separately.
4. **DR-011's panels 6/7/8** — three of nine ship as `not_measured`. Honest and doctrine-correct (D6: never a number without explanation), but one-third placeholders on day one is the shape that gets ignored. Fix: a panel `not_measured` for >30 days becomes its own DR-008 clock item, so placeholders age.
5. **DR-012's `HUMAN-EQUIVALENCE.md`.** A founder-declared multiplier converting agent-hours to human-hours, feeding ledger questions 2, 3 and 6 — the one place the set derives company economics from a constant rather than a measurement. DR-012's handling (INFERRED label, ranges, assumption id) is correct; the residual risk is the number being quoted without the label. Rule: the assumption id travels in the same string as any number derived from it.
6. **Lowest theater risk, and the model for everything else:** DR-008's clock, DR-006's vitest enforcement, DR-010's expiring thresholds. All three self-break when neglected.

**The generalizable rule the set half-invented:** *every OS mechanism must name its watchman — the specific check that goes red when the mechanism itself stops.* Three records independently invented one. Apply it set-wide, and no record ships a mechanism that cannot name one. Two current failures of the rule: DR-009's charter `evaluation` fields (nothing notices if a seat's evaluation never produces a consequence) and DR-004's `workflow_cost` artifacts with a null cost block (nothing must ever reconcile them).

---

## Options

### Option A — Amend the ten in place; mint nothing
Append a one-page amendment to each affected record assigning the holes to the nearest owner.
- **Pros:** no new rulings for Prez; the set stays at ten.
- **Cons:** two of the four holes were **explicitly declined** by the record nearest them (DR-009 says the ladder needs an owner and it isn't DR-009; nothing at all is near the cadence). Forcing a record to own what it argued against produces a charter nobody believes, which is F6.9's mechanism exactly. The D4 substrate conflict is *between* records and cannot be fixed by amending either one.
- **Effort:** S · **Risk:** medium-high
- **Doctrine:** fails D12-L8 (governance must be owned, not inherited by default) and leaves criterion 7 owned by a record that disclaimed it.

### Option B — Reconcile the seams here; fold what has a home; mint exactly two records ✅ RECOMMENDED
This record rules four set-wide constraints (one substrate map, one gate-budget rule, one critical path, the watchman rule), folds three holes into named existing owners, mints **DR-015 (goal record type, L1)** and **DR-016 (authority ladder, L5 / criterion 7)**, and assigns the three unowned blocking reads.
- **Pros:** the two literally-unowned certification criteria get real owners before Stage 3; the D4 conflict is settled once, before any orphan branch exists; the gate budget is fixed by a technique the set already invented, so it costs nothing to adopt; HOLE B gets a ~20-line fix that is also DR-005's first non-meta cycle.
- **Cons:** two more records for a founder already holding thirteen; this record itself becomes a dependency of six others.
- **Effort:** M · **Risk:** low
- **Doctrine:** D12-L1 and L5 get owners; D4 one-reality restored; §17 criteria 1/11 acquire a mechanism; D14 ordering conflict resolved in favor of the visibility-first record.

### Option C — Hold the set; re-cut Stage 2 to three records
Ship only DR-003 Phase A+B1/B2, DR-008, DR-005. Defer DR-004, 006, 007, 009, 010, 011, 012, 013 to Stage 5 with recorded reasons and let Stage 6 report six criteria MISSING.
- **Pros:** the most honest scope for one human; §17 already says PARTIAL/MISSING are failing grades that route back through the cycle rather than being papered over; it eliminates the gate-load risk entirely.
- **Cons:** discards DR-010's expiring thresholds, DR-012's already-produced $18,274 measurement, and DR-013's cross-link proof — genuinely good work, and DR-006/DR-007 are cheap. It also buys focus that Option B buys with a sequencing rule.
- **Effort:** S · **Risk:** low, but guarantees a failed certification
- **Doctrine:** honest, and D14-clean. Loses D16 criteria 4, 5, 6, 8, 10 by choice.

### Option D — Accept as-is; sequence by D14; let the clock find the holes
- **Pros:** zero additional rulings; DR-008's clock will eventually surface anything with an `observe_by`.
- **Cons:** the clock cannot age an item that was never written — the four holes have no artifact to age. They surface at Stage 6 certification, the most expensive place to find them, after seats are live under an invented ladder and two orphan branches have diverged.
- **Effort:** XS · **Risk:** high
- **Doctrine:** violates D14 (activating L4 seats before L5's ladder), D4 (four substrates), and §17 (two criteria with no owner at certification time).

---

## Recommendation

**Option B**, with one graft from Option C.

**Why it beats D:** the two unowned criteria are not Stage-6 paperwork. Criterion 7's ladder is a *precondition* for DR-009's seats under L5, and criterion 11's diagnostic is the only mechanism in the entire design that would notice the operating system rotting. Finding them at certification means re-opening DR-009 after seats are live, which is the most expensive possible ordering.

**Why it beats A:** you cannot amend ownership into a record that reasoned its way out of it. DR-009's own unknown — *"if no DR claims it, AUTHORITY.md must be created inside DR-009's implementation"* — describes precisely how `OPERATING-RULES.md` came to be a non-negotiable file loaded by nothing (F6.9). And the D4 substrate collision lives between DR-004/005/006/011/012/013; no per-record amendment can settle a naming conflict across six.

**Why it beats C:** C's honesty is real and B keeps it — B does not promise twelve criteria inside the mission, it makes the uncovered ones explicit with named owners so Stage 6 reports MISSING against a plan rather than a surprise. But C throws away three mechanisms that are already the best anti-theater work in the set to buy focus that B buys with a sequencing rule.

**The graft from C:** narrow the critical path to **DR-003 Phase B1+B2 → DR-006 git tier → DR-016 ladder → DR-008 clock → DR-005 LOOP-001**, and sequence everything else behind a *demonstrated* first cycle — one loop that has filed one adjustment — not behind a designed one.

### The four set-wide rulings

**R1 — One substrate map, three tiers, named now.**
- **Tier 1, `os/` on `main`:** all decision, goal, loop, charter, lesson, incident-link and certification records. Written by the PR that changes them (~13/day supplies freshness naturally). This is DR-006's git tier and it wins the D14 argument against DR-004's TiDB-first.
- **Tier 2, ONE orphan branch named `os-state`:** all machine-generated high-frequency output — DR-011's brief, DR-012's ledger rollups, DR-005/DR-013's ledger appends. `os-ledger` is retired as a name. **Precondition, assigned to DR-011:** one read-only Railway `get-service-config` on both services confirming branch-scoped deploy, before the branch is created.
- **Tier 3, TiDB `loop_artifacts`:** DEFERRED, fully specified by DR-006, triggered by DR-005's loop needing a per-game-volume kind. DR-004's `job_run` emitter is the first consumer, in the second wave.
- **Ledger filenames:** DR-012's `os/ledger/sessions/` + `os/ledger/LEDGER.md` are canonical; DR-004's `LEDGER-YYYY-MM.md` is retired. DR-004 measures runtime `workflow_cost`; DR-012 measures subscription session spend; they are two populations in **one** ledger, reported as two clearly labelled ratios (which DR-012 already proposes for the two factories).

**R2 — Gate budget: exactly one new required context.** `OS Clock` (DR-008) is the only new required check on `main` in this mission. Every other proposed gate rides an already-required job, using DR-006's technique: DR-006/DR-007/DR-012's checks become vitest files inside the required `Vitest` context; DR-009's charter gate rides the required `TypeScript Check`; DR-010's `check-required-checks.mjs` rides `Security Audit`. DR-005's `13-loop-intent` starts in WARNING mode as it already proposes and requires a separate Prez ruling to graduate. Adding a new required *context* requires a Prez ruling each time. This drops ruleset-edit races against PR #362 to zero.

**R3 — Fold the certification and diagnostic cadence into DR-008.** It is literally the same mechanism. `os/certification/SCORECARD.md` becomes a clock item with a 30-day `observe_by`; the D15 17-mode diagnostic becomes `kind: diagnostic` with a 30-day window; `os/agents/AUTHORITY.md` and each factory's ACCEPTANCE file get `observe_by` on change, which mechanizes two of §17's four immediate recertification triggers. Cost: three rows in DR-008's per-kind window table. This is the recursive watchman the set was missing and it is nearly free.

**R4 — The watchman rule, set-wide.** No record ships a mechanism that cannot name the check that goes red when the mechanism itself stops. Two records must answer now: DR-009 (charter schema must require `evaluation.standard` + `evaluation.on_breach`, and `check-charters.mjs` must reject an evaluation that is merely an emission) and DR-004 (`workflow_cost` artifacts with a null cost block need a reconciliation consumer or the kind is not emitted).

### Two new records

- **DR-015 — Goal record type (L1).** The nine-field `os/goals/GR-####-*.md` schema, its frontmatter contract (which DR-007's index and DR-011's C1 both consume), and the rule for what makes a goal's *limits* machine-checkable. Unblocks criteria 2, 5, 9 and DR-011's flagship contradiction check.
- **DR-016 — The authority ladder (L5, criterion 7).** Rung definitions 1/2/3 as doctrine states them; a rung for the mission executor as L5 explicitly requires; a rung for each activated seat; and the ruling on format — `os/agents/AUTHORITY.md` as the human-readable law with a generated `authority.json` for DR-004's `check-authority.mjs`, so the two claimants become one source and one derived artifact rather than two files. Must land **before or with** DR-009's first charter.

### Three assignments, no new record needed

- **HOLE B → DR-005, as LOOP-001's first cycle.** Demote `mlbDriftDetector`'s self-patch from apply to propose: write `MLBAIModel.py.proposed` plus an `approval_decision` artifact instead of `MLBAIModel.py`, behind a flag defaulted to propose-only. ~20 lines, no schema change, no new service, and it reuses the propose/decide/apply shape already written in the untracked `mlbRecalibrationGate.ts`. This also fixes DR-005's honest weakness — its first cycle is otherwise meta — with a payload that, unlike DR-001's U1 posture, is **not blocked on an owner ruling.**
- **Three unowned blocking reads, assigned:** Railway branch-scope → DR-011 (blocks Tier 2). `SELECT DISTINCT modelProb` → DR-010 (blocks model-factory gate 2). Whether the drift self-patch fires at all under esbuild, via one Railway `[Drift]` log read → DR-005 (changes the urgency of the demotion, not its correctness).
- **F8 exclusion recorded:** money-path integrity is Stage 3 engineering, not Stage 2 decision space. Written down here so criterion 3 does not silently inherit it.

### One correction to how eight records state their dependency

Eight records declare "DR-003 — HARD BLOCKER." What they actually need is **DR-003 Phase B item 1 (the `aiWorkflowCosts` typecheck fix) and item 2 (`shared/loop/` + `server/loop/` onto `main`)** — not Phase A's archive push, which preserves to `archive/*` branches and puts nothing on `main` where CI and a bare checkout can see it. Re-point the dependencies at B1+B2 and pull them out as the mission's first merge. Phase A is zero-risk and should not be hostage to Phase B, and B1+B2 is small, reviewable, and should not be hostage to the 26-commit forensic branch's model changes.

---

## Requested ruling

> **Prez: rule R1 (one substrate map — `os/` on `main`, one orphan branch `os-state`, TiDB deferred) and R2 (exactly one new required check, `OS Clock`; every other gate rides an existing required job). Authorize minting DR-015 (goal record type) and DR-016 (authority ladder), and folding the certification + D15 diagnostic cadence into DR-008.**

**A "yes" commits you to:**
- Two more decision records to rule on before Stage 3 PLAN, and DR-004/005/006/011/012/013 being amended to the single substrate map (retiring the `os-ledger` name and DR-004's `LEDGER-YYYY-MM.md`).
- Exactly one new red-check surface on `main` in this mission, and a separate explicit ruling any time a record wants a second.
- A monthly obligation that has teeth: once R3 lands, an unobserved certification scorecard or an overdue D15 diagnostic turns your next merge red. That is the point, and it is also the thing you will most want to route around in week three.
- DR-005's first live cycle carrying a small production behavior change (drift detector demoted to propose-only) rather than being purely meta.

**Also requested, and cheap:** authorize the three read-only checks now — Railway service branch scope, `SELECT DISTINCT modelProb`, and one `[Drift]` log read. All three are read-only, none touches production data, and each currently blocks a record that was drafted around an assumption.

## Depends on

- **DR-003** — Phase B1+B2 specifically, not Phase A. Nothing in R1's Tier 1 is buildable until `shared/loop/` is on `main` and `tsc --noEmit` exits 0.
- **Amends:** DR-004 (§2.1 ordering, R1 ledger name, R4 watchman), DR-005 (HOLE B payload, `os-ledger`→`os-state`), DR-006 (confirmed as the governing substrate record), DR-007 (L7 retrieval-by-process folded in; CLI must share the hook's module), DR-008 (R3 fold: three new clock kinds), DR-009 (blocked on DR-016; charter `evaluation` schema; cut `--emit-bindings` and the `Seat:` path check from v1), DR-010 (owns the `modelProb` read; thresholds provisional until measured), DR-011 (owns the Railway read; `os-state` is the only orphan branch; `not_measured` panels age), DR-012 (canonical ledger location and filenames), DR-013 (`os-ledger`→`os-state`; W2+ gated on a filed adjustment, not a resolved cross-link).
- **Mints:** DR-015, DR-016.
- **Sequencing, not a DR:** PR #362 owns workflow numbers 01–12 and the Wave graduation. Under R2 there is exactly one ruleset edit left to sequence against it.

## Unknowns

- **Whether Railway's deploy trigger is branch-scoped.** Blocks Tier 2 entirely. Two records assumed it; neither verified it. *Resolves via:* one read-only `get-service-config` on both services in `stunning-creativity`, before any orphan branch is created.
- **Whether `modelProb decimal(5,2)` corrupts the model factory's acceptance bar.** *Resolves via:* one read-only `SELECT DISTINCT modelProb FROM mlb_game_backtest LIMIT 50`.
- **Whether `mlbDriftDetector`'s self-patch currently fires.** VERIFIED that the write exists at `server/mlbDriftDetector.ts:814`; UNKNOWN whether `path.resolve(__dirname, …)` resolves under the esbuild bundle. *Resolves via:* one Railway `[Drift]` log read.
- **Whether Prez tolerates any fail-closed gate at ~13 PRs/day.** This is the set's real survival risk and it is behavioral. R2 reduces the surface to one check; it does not answer the question. *Resolves via:* DR-005's proposed week of WARNING mode, with the would-have-blocked count published daily. If the exempt rate exceeds ~20%, R2 should tighten to zero new required checks and the whole set falls back to Option C.
- **Whether `os/` should live in this repo.** DR-006 flags it and it is unresolved: every `os/` commit on `main` is a production deploy under §19. Tier 1 accepts that cost in exchange for CODEOWNERS, branch protection and the four existing required checks applying with zero new setup. A separate repo would break R2's entire enforcement story and should not be chosen without re-arguing it.
- **Who signs the Level-4 rescore, and with what instrument.** §17 requires the fresh-context verifier to sign and Prez to countersign. Nothing in the set makes the rescore repeatable. R3 schedules *when*; it does not design *how*. Flagged as remaining open after this record, and the cheapest honest answer is probably that DR-016's record carries the scorecard template since it already owns criterion 7.