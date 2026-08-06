# DR-009 — Agent seat roster, charter format, and activation order (D12-L4)

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**observe_by:** 2026-08-12
**Doctrine:** §8 L4 — Specialized agents (six charter fields; seats without a loop are deferred with the reason recorded; specialization must never create isolated intelligence) · §8 L5 — Execution tools (graduated authority; the ladder codified in os/agents/AUTHORITY.md, including a rung for every activated seat) · §8 L6 — Evaluation (every agent action connects to a way of judging the result, at the outcome level where possible) · §8 L8 — Human governance (which actions agents may perform, which failures escalate, who is responsible; policy is the enforcement surface) · §14 D14 — The fifteen-stage sequence, steps 3 (begin with the outcome, never the agent), 7 (begin with analysis; no broad authority before accurate representation), 10 (controlled reversible action, high-impact human-gated), 15 (expand only after the loop learns) · §5 D5 — The closed loop (action authority matches demonstrated loop reliability; an open loop fails silently) · §6 D6 — Artifact law and context parity (every agent knows where its context came from and reports gaps) · §2 D2 element 3 — Agents capable of reasoning and action; and the diagnostic row 'action without evaluation → uncontrolled automation' · §10 D9 — Archetypes and the flat company (flat requires stronger ownership; agent action without a named owner creates accountability gaps) · §15 D15 #3 (unqueryable work), #10 (removing coordination without visibility), #16 (isolated agent departments) · §19 — Standing Dime rules: evidence taxonomy, compliance gate, design system (SEAT-003's charter inherits all three)

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

How does Dime represent an agent seat — what is the charter's storage format and enforcement mechanism, which seats activate first and on which runtime, how is the deferred majority (including the brief's unbuilt 32-seat "Dime Mint" roster) recorded honestly, and are the ~200 vendored skills and 61 plugins seats, tools, or neither?

## Why this is contested

Doctrine L4 gives the six charter fields but not where charters live or what makes them bind, and the two failure modes pull in opposite directions. Write charters as prose and they join `OPERATING-RULES.md` — which declares itself "read at every session start, non-negotiable" and is loaded by nothing (F6.9); that is exactly how the 2026-07-28 program died. Write them as enforced infrastructure and you add a moving part to a company with one human, where every unobserved moving part is a future audit finding. There is also a genuine judgment call hiding in "seat": the repo already has two agent runtimes, ~200 skills, 61 plugins, and 4 `.claude/agents/*.md` subagents — a plausible engineer could declare any of those the seat layer and claim L4 is already done. The audit proves the opposite: Dime scored Level 2 *with* all of that present, so the count of AI things is not evidence of seats. Finally, activation order is contested because the brief names three seats (data-integrity sentinel, calibration auditor, voice/compliance gate) and doctrine says seats derive from loops, not from a roster — so at least one named seat must be defended and at least one must be refused.

## Options

### A — Seats are Claude Code subagents (.claude/agents/*.md)

**Effort:** S · **Risk:** medium

Extend the mechanism that already works. `.claude/agents/` today holds 4 real subagent definitions (impeccable-asset-producer, -documenter, -finish-reviewer, -manual-edit-applier) with frontmatter `name/description/tools/model/effort/maxTurns` and a prose body. Add `dime-run-recorder.md`, `dime-calibration-auditor.md`, `dime-voice-gate.md` in the same directory, with the six doctrine fields written as body sections (## Scope, ## Permitted actions, ## Required inputs, ## Expected outputs, ## Evaluation, ## Escalation). Deferred seats are a list at the bottom of `SKILLS.md` or a new `.claude/agents/DEFERRED.md`. No CI, no generator — the harness itself is the loader, and a seat is 'real' because it can be invoked by name in a session.

**Pros**

- Zero new infrastructure; the loader already exists and is exercised daily
- A seat is immediately executable — Prez can invoke it at the keyboard the day it is written
- Frontmatter `tools:` is a genuine authority surface: the harness actually restricts the tool list, so permitted-actions is partly self-enforcing
- Cheapest path to a non-empty L4 layer (audit: zero charters, zero occurrences of 'charter')

**Cons**

- Claude-Code-interactive only. It does nothing in CI, nothing in the Express process, nothing for a cron-triggered seat — and the majority of Dime's seats are non-interactive by nature
- Four of the six doctrine fields (required inputs, expected outputs, evaluation method, escalation path) land in unparsed prose, so nothing can check them; this is F6.9 with new filenames
- No loop binding and no deferral record, so the roster can grow to 32 aspirational seats with nothing objecting — the precise inversion doctrine L4 forbids
- Conflates 'prompt for a helper' with 'chartered role holding authority'. The impeccable subagents have no DRI, no loop, and produce no artifact; putting Dime's seats beside them makes the distinction invisible
- Untracked risk: adding seats here does not make them queryable from anything outside a Claude Code session

**Doctrine fit:** Satisfies D12-L4's demand that a seat be defined at all, and L5 partially (tool allowlists are real). Fails L4's 'six fields' as a checkable contract, fails L4's 'seats without a loop are deferred with the reason recorded' entirely, and fails L8 ('policy is the enforcement surface') because no machine reads four of the six fields. Repeats D15 #3 (unqueryable work).

### B — Charter files under os/agents/charters/ + a CI gate inside the already-required typecheck job, with generated bindings ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

One source of truth per seat: `os/agents/charters/SEAT-00N-<slug>.md`, YAML frontmatter carrying the six doctrine fields plus binding metadata — `seat_id, name, status (ACTIVE|DEFERRED|RETIRED), loop (must resolve to os/loops/LOOP-*.md), dri, authority_rung, runtime (deterministic|piAgent|dimeAgent|claude-code-subagent), scope.paths[] + scope.data[], permitted_actions[], forbidden_actions[], required_inputs[], expected_outputs[].artifactType, evaluation.{method,threshold,cadence}, escalation.{on[],to}, deferred_reason, blocked_on`. Deferred seats use the same file shape under `os/agents/charters/deferred/`. Enforcement: `scripts/check-charters.mjs` + `scripts/check-charters.test.ts` — matching the repo's existing `check-bundle-budget.mjs` / `check-environment-failures.mjs` / `check-github-actions-security.mjs` / `check-osv-scan.mjs` idiom (script + colocated vitest) — added as a STEP inside the `typecheck` job of `.github/workflows/ci.yml`, never as a new workflow (a new advisory workflow would reproduce F6.1: DB Tests and Build & Preview Gate are advisory and therefore do not bind). The gate fails on: any of the six fields empty; ACTIVE without a resolvable loop; DEFERRED without both `deferred_reason` and `blocked_on` (a DR id, a loop id, or `NO_LOOP`); any `expected_outputs[].artifactType` outside `artifactTypeSchema` in `shared/loop/envelope.ts`; an `authority_rung` not declared in `os/agents/AUTHORITY.md`; rung 3 without a named human approver; and roster drift — `os/agents/ROSTER.md` must be byte-identical to `node scripts/check-charters.mjs --emit-roster`. Optional path-scope check: when a PR body or commit trailer contains `Seat: SEAT-00N`, every changed path must match that seat's `scope.paths` globs (unnamed PRs exempt, stated openly, so it cannot wedge ordinary work). A `--emit-bindings` mode generates `.claude/agents/dime-<slug>.md` for `runtime: claude-code-subagent` seats, checked in, drift-failed — so the interactive seat and the chartered seat cannot diverge.

**Pros**

- One source, two consumers (CI + the harness binding), no service, no daemon, no vendor — the cheapest thing that can actually bind
- Neglect is loud by construction: a stale roster, a seat without a loop, or a deferral without a reason turns a required CI job red with no human diligence required
- `expected_outputs[].artifactType` is checked against the real enum in `shared/loop/envelope.ts`, which makes the charter non-decorative and structurally couples L4 to L2/L6 — a seat cannot claim an output kind the artifact contract does not have
- Works for every runtime, including the deterministic and in-process seats that Option A cannot house
- Honest deferral is a first-class, machine-checked state, which is exactly what doctrine L4 asks for and what the brief's 32-seat claim needs
- Follows four existing precedents in `scripts/`, so it is a pattern the repo already maintains rather than a new one to learn

**Cons**

- A new script and a new file format — two more things that can rot, mitigated only by living inside a required job and carrying its own vitest suite
- Depends on `shared/loop/envelope.ts` being committed (DR-003); until then the gate must read the enum from an untracked path, which is itself dark state
- The path-scope check only bites on PRs that name a seat, so its coverage is opt-in and should not be described as enforcement of scope generally
- Adds a red-CI failure mode to a repo doing ~13 merges/day; a badly-written gate becomes a tax
- The working tree does not currently typecheck (`server/_core/aiCostMeter.ts:20` imports a non-existent `aiWorkflowCosts`), so a step added to the typecheck job cannot be proven end-to-end until that is fixed

**Doctrine fit:** Directly implements D12-L4 (six fields as a checkable contract; deferral with recorded reason as an enforced state) and supports L5 by making `authority_rung` a validated reference into `os/agents/AUTHORITY.md`. Satisfies L8's 'policy is the enforcement surface' — the policy is read by a machine on every PR. Honors D14 by shipping visibility (the roster, the loop binding) before any autonomy, and D14 step 3 ('begin with the outcome, never the agent') because ACTIVE status is impossible without a loop. Answers D15 #16 (isolated agent departments): all seats read the same `os/` roots. Weak spot: it does not by itself observe seat *outcomes* — that is L6's job, delegated to each charter's `evaluation` block.

### C — Charters as ledger artifacts: a 12th artifact kind and a seat registry table

**Effort:** L · **Risk:** high

Make the charter itself a first-class artifact. Add `agent_charter` (and `charter_activation`) to `artifactTypeSchema` in `shared/loop/envelope.ts`, bump `LOOP_SCHEMA_VERSION`, and persist charters through `LoopLedger` — sha-256 content-hashed, prev-hash chained, append-only, corrections via `links.correctionOf`. Back it with a new `agent_charters` Drizzle table (owner-gated, `db-push.yml` first, per deploy law) plus a tRPC `ownerProcedure` read surface on the existing admin dashboard. Activation, deferral, rung changes, and retirement all become appended artifacts, so the roster has a tamper-evident history rather than a git diff.

**Pros**

- Best provenance story in the option set: every activation and rung change is an immutable, hash-chained record, which is exactly what D6 asks of consequential decisions
- Reuses the repo's genuinely best primitive (`envelope.ts` + `ledger.ts`, adversarially tested 32/32) rather than inventing a parallel one
- Puts the roster where a founder dashboard can query it, closing part of F9's 'founder dashboard: ABSENT'
- Charter changes become queryable by time and by seat, not just by `git log`

**Cons**

- Requires a schema change: owner-gated, `db-push.yml`-first, and Drizzle names every column in INSERTs, so the sequencing is unforgiving
- CI cannot cheaply check a charter that lives in a database — the enforcement surface moves from a PR gate to a runtime read, which is strictly weaker for a repo whose failure mode is 'nobody looks'
- Bumping `LOOP_SCHEMA_VERSION` before the envelope has ever been committed or persisted (the JSONL writer is implemented, tested, and never called) is optimizing an unshipped contract
- Adds a table with, at activation, three rows — a textbook D15 #4 (data collection without meaning) and a violation of the mission's own YAGNI constraint
- Governance that only exists in production is unavailable to the agents doing the work, who read files, not TiDB

**Doctrine fit:** Strong on D6 (artifact law, seven required properties, preserved reasoning) and on L2. Weak on L8: an enforcement surface no PR gate reads does not enforce. Violates D14's ordering in spirit — it builds durable machinery for seats before any seat has demonstrated a closed cycle — and trips D15 #4. It is the option doctrine would pick if Dime's problem were provenance; Dime's proven problem is that nothing notices.

### D — One generated-once roster file, no format, no gate

**Effort:** XS · **Risk:** medium

A single `os/agents/ROSTER.md`: a table with one row per seat and the six doctrine fields as columns for the ACTIVE seats, then a DEFERRED section listing every remaining seat with a one-line reason — including the brief's 32-seat Dime Mint roster recorded as an unbuilt claim. No YAML, no script, no CI job, no generator. Honesty is maintained by convention and by whatever mechanism the F2 queue-ageing decision record ends up building.

**Pros**

- Cheapest possible; can be written in one sitting and cannot break CI
- Zero new moving parts, which is the mission's hardest constraint — nothing here can rot unobserved because there is nothing to rot
- Immediately readable by a human and by any agent that reads `os/`, with no tooling
- Defers the enforcement question until there are enough seats to justify a format, which is a legitimate YAGNI reading

**Cons**

- It is, precisely and demonstrably, the mechanism that already failed: `OPERATING-RULES.md` declares itself non-negotiable and is loaded by nothing; `operating-brief.md` declares itself 'regenerable' and has no generator and sat 8 days stale with a wrong item
- Nothing stops a seat being added without a loop, which is the exact doctrine inversion this DR exists to prevent
- No coupling to `os/loops/`, to `AUTHORITY.md`, or to the artifact contract — the six fields become adjectives
- Its own staleness is invisible, so its failure mode is silence, which the audit names as the company's defining defect
- Provides no runtime binding at all, so a seat is a paragraph rather than a thing that runs

**Doctrine fit:** Records the six fields and the deferrals, so it nominally satisfies the letter of D12-L4. Fails L8 (no enforcement surface), fails D5's stability property (an open loop fails silently when inputs shift), and is the canonical instance of D15 #3 (unqueryable work) and D15 #10 (removing coordination without visibility). Technically low-risk; high risk of reproducing the documented 2026-07-28 outcome.

## Recommendation

**B — Charter files under os/agents/charters/ + a CI gate inside the already-required typecheck job, with generated bindings**

B is the only option where a seat's charter and Dime's neglect of it are both machine-visible, and it buys that with a file format and one script rather than a service, a table, or a schema bump. It beats D because D is the failure already in evidence — `OPERATING-RULES.md` and `operating-brief.md` are two files that declared their own authority and were read by nothing, and a third would be a knowing repeat. It beats A because the majority of Dime's real seats are not interactive: a run-recorder that turns cron executions into artifacts and a compliance gate that aggregates its own firings never appear at a keyboard, and `.claude/agents/` cannot house them, cannot check four of the six fields, and cannot record a deferral. It beats C because C moves governance into a place CI cannot see, requires an owner-gated `db-push.yml` migration before any seat has closed a single cycle, and bumps `LOOP_SCHEMA_VERSION` on a contract that has never been persisted once in production — precisely the 'build durable machinery before demonstrating a loop' error D14 forbids. B also makes the honest answer to the 32-seat claim structural rather than rhetorical: because ACTIVE requires a resolvable `os/loops/LOOP-*.md` and DEFERRED requires a reason plus a `blocked_on`, the roster cannot inflate without turning a required check red.

Concretely, B activates exactly three seats and defers everything else.

SEAT-001 · run-recorder — `runtime: deterministic`, `authority_rung: 2` (reversible, append-only). Scope: `server/cronJobRunner.ts`, `server/routes/cron*`, `shared/loop/**`. It converts every cron and CI execution into a ledger artifact so F7.1 ('no cron job writes a run record'; `CronJobRunner.lastResult` is process memory in a repo that redeploys ~13×/day) stops being true. It emits `workflow_cost` artifacts today with a null cost block and populated `latencyMs`/`retries`, and its charter records that limitation openly; a proper `run_record` kind is a `LOOP_SCHEMA_VERSION` bump owned elsewhere. Evaluation: declared-vs-observed cadence per job per day, which is the only thing that would have caught F7.3 (`cron-mlb-cycle` claims `*/5`, fires 8–10×/day, and every under-run reports success). This seat is chartered even though it contains no model call — the ruling is that a charter governs authority and outputs, not whether a model is in the loop.

SEAT-002 · calibration-auditor — `runtime: deterministic core + piAgent for narrative`, `authority_rung: 1 (read-only, recommend)`. Bound to whichever loop DR-005 selects; if that is the MLB projection-evaluation loop, this seat wires the already-correct, already-tested math (`mlbBacktestAuditCore`, Brier, log-loss, Wilson CI, no-vig, `calcCLV`, walk-forward folds — ~2,500 lines dead since 2026-05-23) and emits `evaluation_report`. `forbidden_actions` explicitly includes patching `MLBAIModel.py` constants and changing any `publish_*` value — F4.1's self-patching drift detector is the anti-pattern this seat exists to replace, and D14 step 7 forbids broad authority before accurate representation. Escalation: any market whose live publication state contradicts its `publish_*` verdict routes to INCIDENTS.md and the owner queue, which is the U1/DR-001 trigger. This ratifies one of the brief's three named seats — on evidence, not on the brief's authority.

SEAT-003 · voice-compliance-gate — `runtime: deterministic`, `authority_rung: 3 (hard-block, human-gated to change)`. This charters what the audit calls the best-built thing in the repo: four defense-in-depth layers with a post-generation certainty screen that withholds whole answers. Chartering costs almost nothing and pays immediately, because the charter's `evaluation` field obliges the gate to emit one aggregate artifact per day — closing F3.7, where blocks are logged per request with no aggregation surface and the gate cannot learn from its own firings. It is also the seat with the only evaluation method satisfiable on day one.

Deferred, with reasons recorded in `os/agents/charters/deferred/`: data-integrity-sentinel (`blocked_on: the F5 provenance discriminator` — no live-pregame vs walkforward-replay column, enum, or guard exists, so there is no loop to serve); model-promotion-approver (`blocked_on: DR-005 + the missing apply/promote step` — approving a proposal currently causes nothing to happen); revenue-reconciler (`blocked_on: F8` — three append-only ledgers with zero readers); support-triage and GTM-evidence seats (`blocked_on: NO_LOOP`); and one file, `os/agents/charters/deferred/BRIEF-CLAIM.md`, recording the 32-seat Dime Mint roster and the Press/Assay Office/Reserve groupings as an unbuilt claim with its audit citation ('Assay' has zero occurrences repo-wide; no design document exists on any branch, ever). The number 32 is retired and the three groupings are not adopted as taxonomy — grouping is derived from loop, never invented.

Runtime assignment is a rule, not a list, and it comes from what the two runtimes actually are. Default to `deterministic` (a plain TS module, no model) — most doctrine seats are deterministic, and calling them agents is exactly how 32-seat rosters get imagined. Use `piAgent` when the seat runs inside the server process, needs narrow app-shaped `AgentTool`s, or must stream; its 3-model allowlist throw at `server/_core/piAgent.ts:57` is the model-policy enforcement point and must not be bypassed. Use `dimeAgent` when the seat must read and reason over the repo — and note the hard structural cap this implies: `agentEnv()` in `server/_core/dimeAgent.ts` is an explicit allowlist that deliberately excludes `DATABASE_URL`, Stripe, Discord, and every other secret because a subprocess granted Bash can read its own environment. Therefore a `dimeAgent` seat can never hold data authority and is capped at rung 1–2 over repo paths. `claude-code-subagent` is reserved for interactive seats Prez drives at the keyboard, and those files are generated from the charter, never hand-written.

On the ~200 skills and 61 plugins, the ruling is decisive: they are TOOLS — context packages a seat may equip — and never seats. A skill has no scope, no authority, no required inputs, no artifact outputs, no evaluation method, and no escalation path; it fails all six charter fields. The four existing `.claude/agents/impeccable-*.md` subagents are actor-shaped but are sub-workers inside one seat's turn, not seats: no loop, no DRI, no artifact, no outcome. Mechanically, a charter MAY list skills under a `tools.skills:` key, which `--emit-bindings` writes into the generated `.claude/agents` file; that is the entire relationship. And the consequence should be said out loud in `os/agents/ROSTER.md`: the skill arsenal is not evidence of AI-nativeness — Dime scored Level 2 with all ~200 skills and 61 plugins already installed. `check-charters.mjs` must never read `.claude/skills/` or `.claude/plugins-vendored/`, so the roster can never be inflated by counting equipment as staff.

**Grafted from the runners-up**

- From A: generate `.claude/agents/dime-<slug>.md` from any charter with `runtime: claude-code-subagent` via `check-charters.mjs --emit-bindings`, check the output in, and fail CI on drift — so an interactive seat is genuinely invocable and cannot diverge from its charter. Reuse the existing frontmatter shape (`name`, `description`, `tools`, `model: inherit`, `effort`, `maxTurns`) proven by the four impeccable subagents.
- From A: use the harness `tools:` allowlist as the mechanical half of `permitted_actions` wherever a seat runs in Claude Code — a real restriction beats a prose one.
- From D: keep exactly one human-readable roster, `os/agents/ROSTER.md`, with the honest DEFERRED table and the days-deferred column — but generated by `--emit-roster` and drift-checked, never typed. D's instinct (one readable file) is right; D's mechanism (typed and trusted) is what failed.
- From C: bind charters to the artifact contract without adopting C's storage — `expected_outputs[].artifactType` is validated against `artifactTypeSchema` in `shared/loop/envelope.ts`, and every activated seat's real outputs are appended to `LoopLedger`. That captures C's provenance value at file cost, with no schema change and no `LOOP_SCHEMA_VERSION` bump.
- From C: reserve the `agent_charter` artifact kind as a future migration path, recorded in the charter format's own version note — if the roster ever outgrows files, the move is a persistence change rather than a redesign.

## Requested ruling

Do you approve seat charters as version-controlled files under `os/agents/charters/` — six required fields in YAML frontmatter, enforced by `scripts/check-charters.mjs` (plus `scripts/check-charters.test.ts`) added as a step inside the already-required `typecheck` job of `.github/workflows/ci.yml` — activating exactly three seats now (SEAT-001 run-recorder, deterministic, rung 2; SEAT-002 calibration-auditor, rung 1 read-only, bound to DR-005's loop; SEAT-003 voice-compliance-gate, rung 3), recording every other seat as DEFERRED with a reason and a `blocked_on`, retiring the brief's 32-seat "Dime Mint" roster and its Press / Assay Office / Reserve groupings to a single recorded unbuilt-claim file, and classifying all ~200 skills and 61 plugins as tools that may never appear on the roster?

A YES commits you to five things:
1. The 32-seat roster and the three groupings stop being a design and become a recorded historical claim. No seat may ever be added without a loop file it serves — the roster grows only when `os/loops/` grows.
2. A new way for CI to go red on a repo doing ~13 merges/day: a charter missing any of the six fields, an ACTIVE seat with no resolvable loop, a DEFERRED seat with no reason, an `expected_outputs` kind outside the envelope enum, or a stale `os/agents/ROSTER.md` all fail the typecheck job. You are accepting that tax in exchange for the roster being unable to rot quietly.
3. The calibration auditor holds rung 1 — analysis and recommendation only — until its own evaluation shows reliability. On activation it will NOT fix the self-patching drift detector (F4.1) and will NOT change any `publish_*` value; it will only produce evidence and escalate. Autonomy there is a later, separate ruling.
4. You are the named approver and escalation target for every rung-3 action, with escalation landing in `INCIDENTS.md` — which means the incident-number allocation defect (F6.8, two sessions both took 41–43) must be fixed or the escalation path is decorative on arrival.
5. DR-003 lands first. Charters cite `shared/loop/envelope.ts`, which is untracked; until it is committed the gate is validating against dark state, and the working tree's `aiCostMeter.ts` typecheck failure must be cleared before any step can be added to the typecheck job at all.

A NO on the enforcement half but YES on the format still yields Option D, and you should say so explicitly — because D is the mechanism that already failed twice in this repo, and choosing it knowingly is very different from drifting into it.

## Depends on

- DR-003
- DR-005
- DR-001
- DR-004

## Open unknowns

- Which decision record owns `os/agents/AUTHORITY.md` and its rung definitions. Every charter carries an `authority_rung` and the CI gate validates it against that file, so DR-009 cannot ship before the ladder exists. Resolves via: the Stage 2 DR index — if no DR claims it, AUTHORITY.md must be created inside DR-009's implementation with rungs 1/2/3 exactly as doctrine L5 states them.
- Whether `artifactTypeSchema` needs a 12th kind, `run_record`. SEAT-001 emits cron/CI run artifacts, and the closest existing kind is `workflow_cost`, which is a poor fit with a null cost block. Adding one is a `LOOP_SCHEMA_VERSION` bump and belongs to whichever DR owns the artifact contract. Resolves via: that DR's ruling; until then SEAT-001's charter records the mismatch as a declared limitation.
- Whether Claude Code subagent frontmatter tolerates unknown keys. `--emit-bindings` would write charter-derived keys into `.claude/agents/dime-<slug>.md`; the four existing files use only `name/description/tools/model/effort/maxTurns` and I did not verify the loader's behavior on extra keys. Resolves via: one interactive invocation of a generated seat file — if extra keys are rejected, the generator emits only the known keys and pushes the rest into the body.
- Whether the F2 queue-ageing mechanism (whichever DR owns 'make silence loud') will accept `os/agents/charters/deferred/` as an input. The deferred roster's honesty depends on something noticing a seat whose `blocked_on` DR has been ruled but which was never activated. DR-009 deliberately does not build a second ager. Resolves via: that DR accepting the input contract, or DR-009 adding a days-deferred column that the ROSTER generator computes and the gate warns on past a threshold.
- Whether the path-scope check (`Seat: SEAT-00N` trailer → changed paths must match `scope.paths`) is worth shipping in v1 at all. Its coverage is opt-in by construction, and an opt-in gate that reads like enforcement is its own kind of dishonesty. Resolves via: a Prez preference — ship it labeled clearly as advisory-by-design, or defer it until a seat actually opens PRs.
- Whether SEAT-002's binding survives DR-005. This DR assumes DR-005 selects the MLB projection-evaluation loop, which the audit supports (the math is correct, unit-tested, and merely unwired; closing-line capture already ships). If DR-005 picks a different first loop, SEAT-002's `loop`, `required_inputs`, and `evaluation` block all change, though its rung-1 posture and forbidden actions do not.
- Whether the ~200-skill / 61-plugin bootstrap can be relied on at all for a `claude-code-subagent` seat. `CLAUDE.md` documents that plugin bootstrap is not guaranteed and that cold containers have started with every plugin silently missing. A seat whose `tools.skills` list is silently absent runs anyway, degraded, with no signal. Resolves via: having the generated binding assert its declared skills at start of turn, or restricting v1 seats to `deterministic` and `piAgent` runtimes only.

