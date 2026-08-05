# DOCTRINE — the operating law of Dime AI

Status: v1 · Established 2026-08-05 · DRI: Prez · Mission: 100% AI-Native
Source: Y Combinator's playbook for building an AI-native company, as distilled into the
mission doctrine D1–D16. This file is the Dime-specific translation of that doctrine and is
the law every `/os/` artifact, every issue, and every push is checked against.

> **Source boundary.** Doctrine derives solely from the YC playbook. No outside framework,
> company, or theory is imported. Implementation detail here is operational translation only,
> and each section names the doctrine concept it translates. Where doctrine and Dime's
> operating reality conflict, the conflict is flagged in the relevant artifact and a
> resolution proposed — never silently overridden in either direction.

> **Provenance note (VERIFIED 2026-08-05).** The mission prompt's `<thesis>` block arrived as
> an unfilled placeholder (`[PASTE THE FULL THESIS DOCUMENT HERE …]`). D1–D16 is complete and
> self-describes as "the operative law, distilled from the thesis," so this doctrine is built
> on D1–D16. The underlying primary source is independently identified and was already
> registered by Dime's prior program: Diana Hu (YC), *The Playbook For Building An AI Native
> Company*, YC Startup Library — see `os/audits/2026-08-ai-native-audit.md` §Prior art.
> Restoring the full thesis text would let this file cite the primary source directly; until
> then every section cites its D-number.

---

## 0. The operating sentence

The whole doctrine compresses to one sentence, and it governs every agent seat at Dime:

> **Understand the goal. Retrieve the relevant company context. Act through a defined role.
> Produce a durable artifact. Observe the real result. Evaluate it against the intended
> outcome. Preserve the lesson. Improve the next action. Keep a named human responsible.**

*(D16)*

---

## 1. The central test *(D1)*

Applied to every audit, every design, every proposal, before anything else:

> Does this merely use AI to accelerate individual tasks, or has it redesigned how
> information, work, evaluation, and responsibility move through the company?

**The four levels.** (1) AI as occasional utility. (2) AI embedded in workflows still designed
around human coordination. (3) AI connecting workflows across functions. (4) The company
organized around the intelligence — work continuously creates artifacts, processes contain
feedback, agents take controlled action, humans own outcomes.

Level 4 is the condition this mission builds. Dime's current score and the evidence for it
live in `os/audits/2026-08-ai-native-audit.md`; the post-build rescore is a D16 certification
criterion.

AI-native does not mean removing every human. It means removing *unnecessary dependence* on
humans for information processing, routine digital production, and coordination. A role is
justified by creation, judgment, direction, mentorship, customer understanding, or
accountability. It is structurally vulnerable when it exists mainly because information is
fragmented and cannot move or interpret itself.

## 2. The six elements *(D2)*

Dime is one operating system built from six elements. Remove any one and the whole weakens:

1. Human goals
2. Accessible organizational context
3. Agents capable of reasoning and action
4. Workflows that produce observable artifacts
5. Evaluation systems that compare results with goals
6. Named humans responsible for important outcomes

**Diagnose every failure against the element pattern:**

| Symptom | Missing element |
|---|---|
| Poorly informed work | Goals without context |
| A searchable archive, not a company | Context without action |
| Uncontrolled automation | Action without evaluation |
| The same lesson relearned | Evaluation without memory |
| Unclear responsibility | Agent activity without human ownership |
| Manual coordination | Human ownership without intelligent systems |

## 3. Capability, not productivity *(D3)*

Never evaluate AI adoption by time saved on existing tasks. Evaluate the **expansion of
feasible action**. The standing questions, asked at every planning cycle:

- What can one person now own end to end?
- Which projects no longer require a dedicated team?
- Which internal tools can be built immediately rather than roadmapped?
- Which ideas get tested as working prototypes rather than discussed as decks?
- Which coordination exists only because building or analyzing directly used to be impossible?
- Which product surfaces become reasonable when implementation, testing, and iteration are
  supplied by agents?

Planning must challenge staffing priors. But the large multipliers describe **potential, not a
constant** — the result depends on the person, the problem, the context, the agent system, and
the evaluation.

**The productive unit is not the employee. It is the employee plus context, agents, tools,
tests, feedback, and permission to act.**

Design command: do not automate the old job description. Reconstruct the role around the
outcomes one person can now direct.

## 4. The four questions and the stateful company *(D4)*

The intelligent layer is Dime's shared capacity to observe, interpret, and act — not one
central model. At any scope, from a single task to the whole company, it must answer:

1. What is the company trying to accomplish?
2. What is happening now?
3. How does current reality differ from the intended outcome?
4. What action should occur next?

`os/STATE.md` is structured around exactly these four questions and is updated as events change
company state — a release ships, a test fails, a subscriber churns, a calibration moves, a cost
rises. Question 1 stays normative: humans set purpose and tradeoff boundaries.

**No isolated automation.** An operating-system agent understands each request in relation to
goals, prior decisions, current work, evidence, and later outcomes. It participates in
organizational memory and control; it does not merely produce output.

**One reality.** Specialized agents share one source of truth. They may divide labor; they may
never maintain incompatible realities.

## 5. The closed loop *(D5)* — mandatory schema

The closed loop is the smallest complete unit of Dime. Every important process is captured as
one, in `os/loops/LOOP-*.md`, with seven components:

```
Goal → Context → Action → Artifact → Outcome → Evaluation → Adjustment + Memory → Updated Context
                                                                          ↑                    │
                                                                          └────────────────────┘
```

Requirements per component:

- **Goal** — specific enough to evaluate, **with limits.** A support loop told only to reduce
  tickets closes conversations without solving problems. An engineering loop told only to
  increase output produces unnecessary code. A sales loop told only to maximize meetings fills
  the calendar with low-value talk.
- **Context** — what a capable employee would need, not just a task.
- **Action** — agent authority matches demonstrated loop reliability *(see §8, L5)*.
- **Artifact** — every action leaves one.
- **Outcome** — what actually happened downstream. **An action is not an outcome.** Shipping is
  an action; adoption is an outcome. A message is an action; a qualified response is an outcome.
- **Evaluation** — compares outcome to goal *and* standard. Success is never assumed because
  planned activity occurred.
- **Adjustment + Memory** — changes the next cycle, and the lesson stays retrievable.

**What closed loops buy:** correctness (results match the objective) and stability (behavior
stays predictable as conditions change — an open loop fails silently when inputs shift; a
closed loop notices the mismatch).

**Generation is the beginning of execution, never proof of success.**

**Self-improvement does not require retraining.** It flows through updated context, better
instructions, stronger tests, improved routing, new examples, and more accurate evaluation. The
base model can stand still while the organizational system compounds.

### The nine-question interrogation

Every `LOOP-*.md` must answer all nine at any time. A loop that cannot is incomplete.

1. What objective controls this process?
2. Who owns the result?
3. What evidence informed the most recent action?
4. What did the system do?
5. What artifact records it?
6. What happened afterward?
7. How was the result evaluated?
8. What changed because of the evaluation?
9. What knowledge will influence the next cycle?

## 6. The queryable company *(D6)* — artifact law

Dime is queryable when important questions are answered from **durable organizational
evidence**, not reconstructed from memory.

The **artifact** is the unit of organizational evidence: it records an intention, decision,
action, result, or evaluation. Every important event must create one — goals, plans, decisions,
sessions, customer feedback, work assignments, prototypes, code changes, tests, releases,
hiring decisions, revenue changes, operating incidents, evaluations.

**Seven required artifact properties.** What happened · when · the relevant person/team/agent ·
the goal or process it connects to · accessible to the appropriate intelligent system ·
comprehensible after the original participants are gone · linkable to later results.

**Artifacts must form semantic connections.** A task links to its goal; customer evidence links
to the task it influenced; a code change links to its spec and tests; a release links to the
work; post-release feedback links back to the release. The objective is **traceability from
intention to result**, not a bigger archive.

**Preserve reasoning, not only conclusions.** A decision record carries the evidence
considered, the constraints, the standard applied, and the ruling — so a future cycle can tell
whether it still applies.

**Minimize invisible consequential state.** At Dime the private channel is the chat session.
When a consequential decision happens in one, its result and reasoning become a shared
artifact. Embedded observation extracts the units that affect future action — decisions,
commitments, unresolved questions, priority changes, customer evidence, risks — not raw
transcripts.

**Dashboards** are structured, queryable company state connecting functions: revenue to the
customers and products producing it; sales activity to objections and later customer results;
engineering work to plans, evidence, and release outcomes; hiring to actual bottlenecks;
operations to recurring delays, costs, failures.

**Context parity** governs agent inputs: the relevant organizational information a capable
human would need for the same responsibility. Sufficient, current, goal-retrieved — **not**
maximal volume, which creates confusion and cost. Every agent knows where its context came
from, how current it is, and which parts are incomplete, **and reports gaps instead of
inventing continuity.**

This layer is institutional memory: the ability to use previous intentions, actions, and
outcomes in the next decision.

## 7. The five-level chain *(D7)* — execution vs. relevance

Every production loop connects five levels:

```
strategic intention → customer evidence → planned activity → actual result → business/customer outcome
```

This chain is what prevents confusing ticket completion with success. A sprint can complete
while customer value stays flat. A plan can look efficient while concentrating effort on
low-value work. Output volume can rise without advancing the company.

**Evaluate both:** *execution* (did the loop complete what it reasonably committed to?) and
*relevance* (was it the right work?).

Generalized: for each function, identify the local equivalents of tickets, communication,
customer evidence, plans, recurring updates, and outcomes — then construct full-context loops
that remove manual status reconstruction entirely. **Information flow is a direct source of
company speed.**

## 8. The eight layers *(D12)*

Built as **one loop, not eight projects**: a goal creates work; work creates artifacts;
artifacts become context; agents use the context; tools allow action; evaluation measures the
result; memory improves the next cycle; humans own the outcome and govern the system.

### L1 — Goals + ownership
Every important process starts from a stated **outcome** — what must become true, not what
activity should occur — with one DRI who can answer for the result, approve the standard, make
tradeoffs, and intervene.

Goal records live at `os/goals/GR-####-*.md` and carry **nine fields**: desired outcome · the
customer or company need behind it · the evidence that justified pursuing it · acceptance
criteria · constraints · time horizon · responsible individual · current status · evaluation
measures.

Goal records give agents a stable interpretation of intent. Without them, systems optimize
different meanings of success.

### L2 — Artifact system
The D6 event list defines what must produce artifacts; links make them traceable
intention-to-result; consequential private work becomes shared record.

`INCIDENTS.md` remains the append-only single source of truth for incidents — **link to it,
never move or rewrite it.**

The objective is never maximum documentation. It is that **no critical organizational state
exists only in memory.**

### L3 — Queryable context
Dime's actual tool surface — GitHub, Claude Code sessions, TiDB, Stripe, Discord, Railway, and
the `/os/` tree itself — maps into a retrieval design where context is fetched **by goal,
customer, project, owner, time period, and outcome** — never tool-by-tool as separate universes.

The layer must answer: which evidence caused this work to be prioritized · which decisions
changed the plan · which tasks remain incomplete · which release attempted the fix · what
happened after · which assumptions were disproved · who owns the next action.

**Currency beats completeness — flag staleness.**

### L4 — Specialized agents
Every activated seat gets a charter in `os/agents/charters/` with six fields: **defined scope ·
permitted actions · required inputs · expected outputs · evaluation method · escalation path.**
This is the agent equivalent of clear job design.

Seats without a loop to serve are **deferred, not activated**, and the deferral is recorded
with its reason. Specialization must never create isolated intelligence — all seats read shared
goals, ownership, standards, and artifacts.

### L5 — Execution tools
Agents act, not only generate — but authority is **graduated**:

1. Read-only analysis and recommendation first.
2. Reversible, low-risk actions after evaluation shows reliability.
3. High-impact or hard-to-reverse actions stay human-gated.

The ladder is codified in `os/agents/AUTHORITY.md`, including a rung for the executor of this
mission and a rung for every activated seat.

### L6 — Evaluation
Every agent action connects to a way of judging the result, **at the outcome level wherever
possible**: code against specs/tests/scenarios/thresholds; planning against completion,
predictability, relevance, and later results; GTM against qualified movement and customer
outcomes, not message volume; operations against delay, cost, and failure reduction.

A recommendation that sounds intelligent is not value. A generated artifact is not success. A
completed action is not a reached objective. **This layer protects Dime from mistaking activity
for progress.**

### L7 — Memory + improvement
Evaluation results change future behavior. Failures produce better instructions, added context,
stronger tests, narrower authority, or escalation. Successes become reusable specs, scenarios,
workflows, examples.

**Lessons attach to the process** — when the same work begins again, the relevant lesson is
retrieved automatically, not buried in a postmortem.

`os/memory/lessons/`: one lesson per file, one-line summary on top, corrections and confirmed
approaches alike with why they mattered. Update rather than duplicate. Delete notes proven
wrong. Never store what the repo or artifact system already records.

### L8 — Human governance
Named humans stay connected to every important outcome. Governance defines: which goals agents
may pursue · which context they may access · which actions they may perform · which standards
control acceptance · which failures escalate · who can change the system · who is responsible
when results reach a customer or the company.

Policy is the enforcement surface; **the founder owns the AI-native standard itself.** The
intelligent layer routes information and executes work; **it never absorbs accountability.**

## 9. The software factory *(D8)*

Humans define what should be built and judge the result. Agents perform implementation,
testing, failure analysis, and revision.

**The specification and the evaluation system are the controlling assets.** Implementations are
regenerable; intent and proof of correctness are not.

A factory exists only when **all ten parts** are present:

1. An explicit specification
2. Executable tests
3. Realistic scenarios
4. Automated generation
5. Repeated evaluation
6. Failure-driven revision
7. Defined acceptance criteria — a *probabilistic satisfaction threshold*: repeated validation
   across scenarios until estimated reliability clears a stated bar, never "looks plausible"
8. Human ownership of intent and outcome
9. Durable artifacts from every iteration
10. Reusable memory that improves future production

**Specification quality is where human effort concentrates** — expected behavior, inputs,
outputs, constraints, unacceptable behavior, edge cases. A weak spec transfers ambiguity into
the loop and the agents solve the wrong problem efficiently.

**Tests prove only what they check.** Narrow happy-path tests certify defective work, so test
design gains importance as generation gets cheap. **Scenarios** validate whole-system behavior
in realistic sequences, because components correct in isolation still fail in interaction.

**The factory is itself queryable:** which spec controlled each implementation, which tests
failed, what revisions occurred, what evidence supported acceptance.

When production is cheap, **judgment is the limiting factor** — selecting the right problem,
defining the right behavior, naming the meaningful edge cases, setting the bar, and confirming
the tests represent real success.

**The unit of engineering performance is reliable product capability delivered against a
meaningful specification — never lines of code.**

### Dime runs two factories

| Factory | Spec | Generation | Evaluation | Acceptance |
|---|---|---|---|---|
| **Product-code** | Written spec + acceptance criteria | Implementation | Deterministic validators + scenario runs + design/compliance gates | Threshold cleared → push |
| **Model** | Market-family specs | Backfill / walkforward generation under provenance controls | Brier / log-loss / CLV / EV thresholds | Calibration-auditor acceptance |

Each factory run **is a Dime Cycle**: the spec is Plan, generation is Execute, tests are Test,
scenario evaluation against the acceptance threshold is Validate, and **nothing Pushes below
the bar.**

**Each project must improve the factory** — reusable specs, validation patterns, test
infrastructure, agent instructions, failure understanding. *The factory does not only produce
software; it produces a better factory.*

The thousand-times engineer is one person directing this system end to end — **architect and
governor of production, not sole manual producer.**

## 10. Archetypes, middleware, and the flat company *(D9)*

**Human middleware** — people whose main product is collecting, translating, summarizing, and
routing information — is the layer AI dissolves. Every routing hop adds delay and loss, and
company velocity is limited by information flow.

**Dime's version of the mandate is preventive: never build the middleware in the first place.**
The intelligent layer provides continuous visibility from day one, and humans guide from the
edges — the edges being where goals enter and responsibility remains.

**Flat requires stronger ownership, not weaker.** Removing coordination without visibility
creates blindness. Agent action without a named owner creates accountability gaps.

**Three archetypes, mapped to Dime:**

- **Individual contributors build and operate.** At Dime that is Prez plus every chartered
  agent seat. Building belongs to every function; the standard is arriving with a working
  prototype, never only a deck.
- **Directly responsible individuals own defined outcomes.** One person, one outcome, no
  hiding. The DRI defines the goal, holds the quality bar, inspects the loop, makes tradeoffs,
  and decides when to intervene. **At Dime, Prez is DRI of record for every loop until the
  hiring loop justifies otherwise, and every loop file names its DRI explicitly.**
- **The AI founder** keeps building, keeps coaching, and sets the company's capability standard
  through personal use of the tools. Prez already occupies this role; doctrine's job is to keep
  it structural.

Management survives as judgment, coaching, governance, and accountability. It dies as status
routing.

**Value must be visible as** what you build · what outcome you own · how you improve others ·
how you govern the intelligent system.

## 11. Token-maxing economics *(D10)*

**Maximize productive token usage, not headcount.**

The comparison is never model bill versus zero. It is model bill versus **the full cost of the
human organization otherwise required** — salary, benefits, recruiting, onboarding, management,
communication, office support, and the coordination burden of a larger group — plus the fact
that model capacity redirects in minutes while roles create continuing obligations.

**The key word is *replaces*.** Token spend is valuable when it produces work, analysis,
learning, or customer outcomes that would otherwise cost more.

### The six ledger questions

Applied to every significant spend, and answered in `os/ledger/`:

1. How much accepted work did this usage produce?
2. How much human time did it remove?
3. How much coordination did it eliminate?
4. How much faster did the company learn?
5. How much additional product surface could one person direct?
6. What human organization would the same result have required?

The objective is **maximum useful outcome per combined human-and-model cost.** A high bill
producing redundant drafts or unused work is waste. A high bill letting a one-founder company
build, test, sell, and operate at former-team scale is a rational advantage.

### The capital-allocation rule (the hire-test)

Before opening any role, test whether **better context, better agents, stronger evaluations, or
a redesigned loop** absorbs the need. Hire only when the missing contribution is human
judgment, accountable ownership, customer trust, creativity, or coaching — **never because a
process is poorly designed.**

Tiered model routing is the mechanical expression: spend frontier tokens where
judgment-quality output compounds, cheap tokens where volume does.

**Growth must decouple from proportional headcount growth.** The lean company is created by
giving each person a much larger intelligent system to direct, not by demanding fewer people
work harder.

## 12. Founder conviction and the startup advantage *(D11)*

**Conviction is non-delegable and is operational knowledge, not enthusiasm.** The founder uses
the tools until priors about team size, timelines, and feasibility break. That direct practice
is what lets the founder inspect honestly — whether an agent has sufficient context, whether a
workflow actually closes, whether tests represent the real objective, whether a claimed
automation removes real work.

Prez already operates this way. Doctrine codifies it so the standard survives growth.

**The startup advantage is structural.** Dime has no legacy procedures, org charts, or systems
to unwind. It can record from day one, make shared artifacts the normal form of work, assign
one owner per outcome, require prototypes over decks, build software through specs and tests,
spend tokens before adding coordination roles, and stay flat because no hierarchy needs
removing.

**The advantage is wasted by copying incumbent structure early:** hiring managers before
routing requires them · creating departments that silo context · deciding in private channels ·
measuring credibility by headcount · gatekeeping prototypes behind an engineering queue.

Skunkworks is the incumbent's compromise, and its limit is the boundary with the legacy org.
**Dime has no such boundary — the new operating model is the company itself.** This freedom is
preserved explicitly here, by name, so that no future reorganization quietly spends it.

The thousand-times-faster claim is a structural possibility earned by shorter information
paths, smaller teams, agent production, continuous context, closed feedback, and near-zero
manual coordination — **not by typing faster.**

## 13. Function loops *(D13)*

Apply the universal pattern to every function — define the outcome · expose relevant context ·
make work produce artifacts · use agents to analyze or act · evaluate · preserve the lesson ·
name one owner — **connected, not isolated.**

- **Engineering.** Goals + customer evidence + repo activity + session records + prior sprint
  outcomes as shared context. The planning layer compares prior commitment to actual
  completion, surfaces delays, dependencies, and plan-versus-capacity mismatch, and proposes
  the next sprint; the DRI approves; the factory produces; release artifacts and downstream
  results feed the next cycle. **Measure shipped-the-right-work, not shipped-work.**
- **Product.** Outcome first. Gather requests, sales evidence, support feedback, plans,
  prototypes, prior results; group evidence to find the problem beneath requests; prototype
  before pitch; record interactions; the DRI decides if evidence justifies a spec and factory
  run; post-release, verify the original problem was solved. Sequence: **evidence → prototype →
  evaluation → specification → implementation → outcome.**
- **Sales/GTM.** Calls and shared threads become artifacts. Recurring objections, buyer
  questions, losses, and demand signals are extracted and routed to product and positioning.
  Evaluation never stops at volume — connect action to qualified progress, closed business,
  fit, and later customer success. For Dime now: the Bet Grader wedge funnel and the
  build-in-public channel are the sales surface; objections and activation evidence flow into
  the product loop.
- **Support.** Begin from the customer's actual problem. Context includes product state, prior
  contacts, known incidents. Responses become artifacts. **The loop stays open until resolution
  is observed** — administrative closure is the wrong goal. Repeated failures flow into product
  and engineering context. For Dime: Discord is the support surface.
- **Revenue.** **The dashboard never shows a number without explanation.** Connect financial
  outcomes to the customers, products, sales activity, and delivery results producing them.
  Declines generate questions and actions (product problems, churn, pipeline weakness,
  execution failure); gains reveal needs worth reinforcing. Stripe events are the raw feed; the
  loop turns financial state into learning, not retrospective reporting.
- **Hiring.** Begins with a real capability need and the §11 hire-test. If a human role
  survives the test, define the outcome and required contribution; candidate evidence,
  decisions, and later performance become connected artifacts; eventually compare hiring
  judgment to actual contribution. **Hiring is never the automatic response to workload — at
  Dime it is the exception that must defeat the agent alternative.**
- **Operations.** Identify recurring work, delay, error, and manual coordination. Observe where
  information disappears. Add artifacts; make the process queryable; define the intended
  outcome; automate suitable steps; record exceptions; evaluate whether reliability and speed
  improved. **Operations is a primary builder of the operating system itself.**
- **Founder/company level.** Prez sees company state **derived from underlying artifacts, never
  summaries-of-summaries.** The loop connects strategy, execution, customer evidence, revenue,
  agent economics, and operational state — and **surfaces contradictions**: a claimed priority
  that engineering activity ignores, a recurring objection the plan omits, a workload a better
  agent would absorb.

## 14. The fifteen-stage sequence *(D14)*

Execution order is law inside Execute. **Visibility before autonomy. Evaluation before scale.**
The Dime Cycle sets the *shape* of the work; this sequence sets the *order* in which loops come
alive.

1. Establish the doctrine and demonstrate it.
2. Select one important, bounded, evidence-rich process.
3. Define the outcome and DRI — **begin with the outcome, never the agent.**
4. Map the open loop: where information is lost, which actions are private, where the process
   ends before outcomes are known.
5. Create artifacts until the current process is legible.
6. Provide employee-level context; the agent names what is missing or contradictory.
7. Begin with **analysis** — the agent explains what happened and why; compare to the DRI's
   understanding; fix context gaps. **No broad authority before accurate representation.**
8. Add **recommendations**; record accepted/modified/rejected and why — feedback for the agent
   system.
9. Define **evaluation** before declaring anything successful, at approval time.
10. Add **controlled, reversible action**; keep high-impact human-gated.
11. Build the **software factory**: specs, tests, scenarios, tracked iterations, tests
    strengthened whenever a defect escapes.
12. **Connect** the function to other functions — isolated automation becomes an operating
    system.
13. **Redesign roles**: remove manual status collection, keep and clarify ownership, one
    outcome per responsible individual, everyone prototypes and directs agents.
14. **Shift capital** from headcount to tokens; track spend against accepted outcomes; let the
    bill rise when productive capacity rises more.
15. **Expand only after the loop learns** — a loop scales when it can explain its goal, context,
    action, result, evaluation, and adjustment.

**Peak capability is never the most agents deployed.** It is important processes that are
observable, connected, evaluable, and continuously improving.

## 15. Failure modes and the diagnostic *(D15)*

Run as a recurring audit (see §17 for cadence) and applied to every design review.

| # | Failure mode | Correction |
|---|---|---|
| 1 | AI tools without organizational redesign | Examine information flow and feedback, not tool count |
| 2 | Open-loop automation | Attach every major action to an outcome and evaluation |
| 3 | Unqueryable work | Create shared durable records linked to goals |
| 4 | Data collection without meaning | Build semantic relationships, not a larger archive |
| 5 | Insufficient context | Provide employee-level context; name what is missing |
| 6 | Context overload | Goal-based retrieval; sufficient, not indiscriminate |
| 7 | Weak goals | Define what must become true, and unacceptable tradeoffs |
| 8 | Weak tests | Stronger specs, realistic scenarios, repeated validation, human judgment |
| 9 | Generated output mistaken for completion | Observe the downstream outcome |
| 10 | Removing managers without replacing coordination | Visibility, artifacts, and ownership first |
| 11 | Removing ownership | One DRI per result |
| 12 | Founder delegation | Direct practice until priors change |
| 13 | Headcount as status | Test tokens, agents, redesign first |
| 14 | Token waste mistaken for token-maxing | Compare cost to accepted work, human time removed, complexity avoided |
| 15 | Prototype theater | Prototypes live inside closed loops with observed results |
| 16 | Isolated agent departments | AI-native is company doctrine, not a specialist project |
| 17 | Copying incumbent structure | Preserve builder–DRI–shared-context–loop design |

**Every failure reduces to one question:**

> **Which part of the closed, queryable, human-owned system is missing?**

## 16. Peak state and the compounding moat *(D16)*

The transformation's acceptance criteria:

- Every major outcome has a DRI
- Every major process contains feedback
- Every important action creates an artifact
- Agents retrieve current context across functions
- The company can explain the reason behind current priorities
- Software is increasingly generated through controlled factories
- Contributors build directly across every function
- Management exists for judgment, coaching, and accountability, never status routing
- The founder remains an active user and builder
- Model expenditure grows when it produces more value than headcount would
- The company learns from each cycle and makes the learning available to the next
- Organizational state stays current because it updates continuously

**The moat is cumulative.** Competitors buy the same models but cannot instantly reproduce
years of connected artifacts, refined specs, strong test harnesses, trusted agent workflows,
precise outcome definitions, and habits that expose useful context. **The base intelligence is
commoditized; the operating system built around it stays distinctive.**

**The scarcity shift governs role design forever.** Manual production, information gathering,
basic analysis, and code generation stop being scarce. **Clear goals, strong judgment, customer
understanding, useful context, reliable evaluation, and accountable ownership become the scarce
resources.**

## 17. Certification and cadence

"100% AI-Native" is not a vibe. It is the twelve-criterion scorecard in
`os/certification/`, scored in Stage 6, **every criterion VERIFIED with a linked artifact or
tool result.** PARTIAL and MISSING are failing grades and route the gap back through the cycle.

The twelve criteria: Level 4 achieved · six elements live and linked · every important process
is a closed loop · all eight function loops operating and interconnected · all eight layers
implemented · both factories certified · authority ladder enforced · token economics operating ·
the four questions answer current · queryability proven · diagnostic clean · no dark state.

Certification is **signed by the fresh-context verifier and countersigned by Prez as DRI.**

**Recertification cadence: monthly**, on the first Monday, and immediately upon any of the
following triggers:
- a new function loop reaching live status,
- a change to `os/agents/AUTHORITY.md`,
- a factory acceptance threshold moving,
- an incident classified as a doctrine violation.

The D15 diagnostic protocol runs on the same monthly cadence, independently of certification.

**100% is a state to hold, not a ribbon to cut.**

## 18. The Dime Cycle

The cycle is **fractal**: the arc of a whole mission, the shape of each stage, and the mandatory
micro-cycle for every individual work item.

```
AUDIT → BRAINSTORM → PLAN → EXECUTE → TEST → VALIDATE → PUSH
```

It maps one-to-one onto the closed loop of §5: Audit supplies **Context** against the **Goal**;
Brainstorm and Plan shape the **Action**; Execute performs it and produces the **Artifact**;
Test and Validate are the observed **Outcome** and its **Evaluation**; Push ships the result and
writes the **Adjustment and Memory** that open the next cycle.

**Nothing at any scale skips a stage. Nothing is called done before Validate says so with
evidence.**

## 19. Standing Dime rules that merge with this doctrine

These are Dime's own rules. They are never overridden by doctrine and doctrine never overrides
them; where they bind tighter than doctrine, the tighter rule governs.

- **Evidence taxonomy.** Every material claim in every artifact carries **VERIFIED** (points to
  a tool result, file, or artifact), **INFERRED** (reasoned from verified evidence — say from
  what), or **UNKNOWN** (say what would resolve it). A DONE claim without VERIFIED evidence is
  void under `OPERATING-RULES.md` Rule 6 and must be corrected in the next artifact.
- **Compliance gate.** Dime is analytical software. Any loop touching customer-facing output
  routes through the voice/compliance gate: no picks framing, no guarantees,
  responsible-gambling posture, banned AI-slop voice standard enforced.
- **Data provenance.** Model evaluation artifacts must preserve the live-pregame vs.
  walkforward-replay separation. **A loop that blends them fails its evaluation layer by
  definition.**
- **Design system.** Any dashboard or UI inherits the locked system: pure black `#000000` base
  with elevation surfaces, sole accent Dime mint `#45E0A8` (`#0FA36B` on light), Familjen
  Grotesk display, IBM Plex Mono for metrics, Apple interaction standards, and the banned-pattern
  list — no glassmorphism, gradient fills, mesh backgrounds, sparkle iconography, AI badging,
  yellow accents, or decorative motion. `design-system/dime-ai/MASTER.md` is authoritative.
- **Consequential sessions produce artifacts.** For a one-founder company, chat sessions are the
  DMs doctrine warns about. Any session producing a ruling, a plan change, or a lesson ends with
  a written artifact in `/os/`.
- **Deploy law.** Railway serves the whole app and auto-deploys on push to `main` — **merge to
  main IS a production deploy.** Schema changes require the manual `db-push.yml` workflow before
  any code deploy.

---

*This file is the law. When a deliverable and this doctrine diverge, the deliverable is wrong —
or the divergence is flagged, reasoned, and ruled on, and this file is amended by a decision
record in `os/decisions/`.*
