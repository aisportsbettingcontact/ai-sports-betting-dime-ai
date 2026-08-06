# Source-to-implementation concept register

Sole external source: Diana Hu (YC Partner), *The Playbook For Building An AI Native Company*, YC Startup Library
(`https://www.ycombinator.com/library/OX-the-playbook-for-building-an-ai-native-company`).
Source access: VERIFIED 2026-07-28 (transcript extracted from page-embedded JSON; sha256 `78fab51d…591143`).
Quotes below are short verbatim phrases from the transcript; everything else is faithful paraphrase.

Status values: VERIFIED_COMPLETE | IMPLEMENTED_UNVERIFIED | PARTIAL | BLOCKED | NOT_STARTED.
Statuses reconciled at Gate 6 — see the reconciliation table at the bottom (it supersedes the
per-row `_gate 6_` placeholders); execution evidence in verification-report.md.

| # | YC concept | Direct source support | Dime AI translation | Mechanism / location | Validation | Status |
|---|---|---|---|---|---|---|
| 1 | AI as the operating system | "it should not be a tool your company just uses. It should be the operating system your company runs on… every workflow, every decision… should flow through an intelligent layer that is constantly learning and improving." | The projection lifecycle (ingest→predict→display→grade→improve) runs through one shared loop spine with machine-readable artifacts at every step. | `shared/loop/` primitives + `docs/ai-native/loop-registry.yaml` + exercised slice | End-to-end fixture run + vitest | _gate 6_ |
| 2 | Capability multiplication | "less about productivity boosts than entirely new capabilities… The right person with AI tools can now build features that used to require an entire team." | A single builder-operator can now run the full projection-grading loop (previously absent entirely — no settlement/grading existed). | Vertical slice (grading + calibration + CLV engine) | Before/after: grading coverage 0 → automated; test evidence | _gate 6_ |
| 3 | Closed-loop company | "A closed loop captures information, feeds it back into an intelligent system, and improves the process over time… your company should run as a closed loop." | observation→canonical fact→prediction→display→result→evaluation→guarded improvement proposal, all recorded in an append-only ledger. | `shared/loop/` ledger + slice pipeline | Ledger trace test linking every stage by artifact id | _gate 6_ |
| 4 | Queryable company | "you will need to make your entire company queryable… the whole organization should be legible to AI. Every important action should produce an artifact." | Typed query layer over the artifact ledger: decision-time view, grading by model version, freshness, conflicts. | `shared/loop/queries.ts` | Query tests incl. missing-data behavior | _gate 6_ |
| 5 | Artifact-producing operations | "Every important action should produce an artifact that the intelligence at the center of the company can learn from." | Every loop stage emits a canonical artifact envelope (id, schema version, timestamps, lineage, versions, hash, uncertainty). | `shared/loop/envelope.ts` schema | Schema validation tests; downstream stages consume prior artifacts | _gate 6_ |
| 6 | AI-legible communication | "minimizing DMs and emails… Status, decisions, and outcomes are continuously captured and fed back." | Decisions and status live in machine-readable state (`execution-state.json`, decision records in ledger), not chat memory. | `docs/ai-native/execution-state.json`, ledger | Files exist, updated at every gate; consumed to resume | _gate 6_ |
| 7 | Unified dashboards | "building custom dashboards with everything in the company. Revenue, sales, engineering, hiring, ops, everything." | One metric dictionary with lineage (model accuracy vs policy vs product vs economics kept separate) + a query surface over canonical records. | `docs/ai-native/metrics-dictionary.md` + `queries.ts` | Reconciliation checks in tests | _gate 6_ |
| 8 | Cross-functional agent context | "provide models with as much context as you would provide an employee." (bounded here by least-privilege) | Context assembly rules: minimum relevant artifacts, citations by artifact id, access classification on envelopes. | Envelope `access` field + context assembly in brief generator | Access-boundary test | _gate 6_ |
| 9 | Intelligence layer | "the intelligence layer serves that purpose [routing]… you should have almost no human middleware." | Operating brief generated from canonical artifacts replaces manual status roll-ups. | `docs/ai-native/operating-brief.md` generated from ledger | Brief cites artifact ids; regenerable | _gate 6_ |
| 10 | Builder-operator | "the individual contributor or IC, basically the builder operator… someone who directly makes and runs things… Everyone builds." | One role specifies, implements, validates, instruments, and reads the outcome of a bounded slice (this program is itself the proof trace). | Work packet in `docs/ai-native/factory/` | Completed packet problem→observed result | _gate 6_ |
| 11 | Directly responsible individual | "the DRI… the person with a clear responsibility for the result. One person, one outcome, no hiding." | Each loop in the registry names one accountable role, decision boundary, and escalation path. | `loop-registry.yaml` `accountable` fields | Registry lint: every loop has DRI + approval boundary | _gate 6_ |
| 12 | AI-founder archetype | "The third is the AI founder type. This person still builds, still coaches and leads by example." | Founder-facing cross-functional brief grounded in canonical evidence with uncertainty shown; prepares decisions, never auto-authorizes risk. | Operating brief + open-decision queue | Brief includes uncertainty + pending approvals | _gate 6_ |
| 13 | Founder-led AI execution | "If you're the founder, this needs to be you at the forefront… not delegating your AI strategy to someone else. You cannot outsource your conviction." | Recurring decision artifact (approval queue for model/policy promotions) designed for direct owner use. | `shared/loop/` proposal + approval records | Promotion blocked without owner approval record (test) | _gate 6_ |
| 14 | Token-maxing | "Maximizing token usage, not headcount… willing to run an uncomfortably high API bill, because it's replacing… expensive… headcount." | Spend is justified per verified outcome: cost/latency/outcome fields on AI workflow artifacts; verified-leverage metric defined. | Economics fields in envelope + `ai-economics.md` | Cost-per-verified-outcome computed in tests/brief | _gate 6_ |
| 15 | Thousand-X builder | "This is how you achieve the thousand X engineer… by surrounding a single engineer with a system of agents." | Leverage comes from reusable loop primitives + factory templates, not persona claims. | `shared/loop/` reuse across 2 work packets | Second packet reuses primitives without rebuild | _gate 6_ |
| 16 | Software factory | "humans write a spec and a set of tests that define success. And then AI agents generate the implementation… iterate until the tests pass." | Spec → executable acceptance criteria → implementation → deterministic gates → evaluation → classified defects → regression. | `docs/ai-native/factory/` templates + vitest harness | Factory exercised on slice + one second packet | _gate 6_ |
| 17 | Probabilistic satisfaction | "scenario-based validations drive agents to write, test, and iterate on code until it meets a probabilistic satisfaction threshold." | Deterministic invariants gate first and cannot be overridden; probabilistic rubric only for judgment dimensions (e.g. user-facing copy quality), with calibration + disagreement handling. | Rubric in factory docs; ordering enforced in eval harness | Test: failed invariant cannot be outvoted by grader | _gate 6_ |
| 18 | AI-native implementation cell | (Structural implication of IC/DRI/founder triad + "small internal skunk work teams that can build AI-native systems from scratch") | Compact unit: one outcome, one DRI, bounded authority, shared work packet, acceptance tests, outcome instrumentation. | Cell definition in `target-architecture.md` + packet | Completed packet for the slice | _gate 6_ |
| 19 | Startup structural advantage (recon: see below) | "You don't have legacy systems… You are small enough to build your company right from day one… operate a thousand times faster than the incumbents." | Build the loop spine now, on the already-approved canonical MLB DB direction, before scale hardens open loops. | Incremental, compatible slice on existing branch | Short cycle evidence: audit→implemented slice in one session | _gate 6_ |

## Gate 6 reconciliation (2026-07-28, supersedes per-row placeholders)

Evidence: executed commands and raw results in `verification-report.md`; artifact paths as in
the table above. "fixture scope" = verified by executed tests on synthetic fixtures — never to
be described as production/live verification (OPERATING-RULES §7).

| # | Concept | Status | Basis |
|---|---|---|---|
| 1 | AI as the operating system | PARTIAL | Loop spine + one exercised end-to-end loop (fixture); other company loops registered but not yet on the spine |
| 2 | Capability multiplication | PARTIAL | New capability (version-attributed, CLV/leakage-graded evaluation) exists and is test-verified; no production before/after window has elapsed |
| 3 | Closed-loop company | VERIFIED_COMPLETE (fixture scope) | loop-registry.yaml + complete loop with traceable evidence; 32/32 tests incl. full-lineage assertion |
| 4 | Queryable company | PARTIAL | Queries tested with provenance/freshness/missing-data honesty; accessClass recorded on artifacts but read-boundary enforcement not yet implemented at a consumer edge |
| 5 | Artifact-producing operations | VERIFIED_COMPLETE (fixture scope) | Envelope schema + every stage consumes prior artifacts; ledger referential integrity tested |
| 6 | AI-legible communication | VERIFIED_COMPLETE | execution-state.json / ledger / decision records are machine-readable and were used to run this program across interruptions |
| 7 | Unified dashboards | PARTIAL | Metric dictionary with lineage + query surface + reconciliation-by-construction; no rendered unified view |
| 8 | Cross-functional agent context | PARTIAL | Context assembly with citations + access classes + retrieval tests; cross-function enforcement pending |
| 9 | Intelligence layer | PARTIAL | operating-brief.md generated from canonical artifacts with citations; regeneration is not yet automated |
| 10 | Builder-operator | VERIFIED_COMPLETE | Packets 001/002: problem → spec → implementation → gates → observed result, one role |
| 11 | Directly responsible individual | VERIFIED_COMPLETE | Every registry loop names DRI + approval boundary + escalation; packets carry DRI |
| 12 | AI-founder archetype | VERIFIED_COMPLETE | Cross-functional brief grounded in canonical evidence with uncertainty and pending-decision queue |
| 13 | Founder-led AI execution | PARTIAL | Decision artifact + gated approval path exist (tested); recurring owner use not yet demonstrated |
| 14 | Token-maxing | PARTIAL | Cost block + cost-per-verified-outcome query implemented and tested; zero production emitters; session USD unknown |
| 15 | Thousand-X builder | VERIFIED_COMPLETE (fixture scope) | Reusable primitives; packet 002 entered the factory without process rebuild; measured quality delta (+6 reattached, +32 new executed tests) |
| 16 | Software factory | VERIFIED_COMPLETE | Pipeline exercised on the slice and a second packet; defects classified; regressions rerun |
| 17 | Probabilistic satisfaction | PARTIAL | Deterministic-first ordering enforced and tested; rubric defined with anchors + calibration protocol but NOT executed |
| 18 | AI-native implementation cell | VERIFIED_COMPLETE | Cell defined (outcome, DRI, authority, gates, metrics) and completed via packet 001 |
| 19 | Startup structural advantage | VERIFIED_COMPLETE (session scope) | Audit → design → implementation → adversarial verification in one session on reusable infrastructure |

Source-verification status: VERIFIED — sole source fetched and transcript extracted
(sha256 recorded in execution-state.json); no other external source consulted.
Tally: 8 VERIFIED_COMPLETE (3 scope-qualified) · 11 PARTIAL · 0 BLOCKED · 0 NOT_STARTED.
