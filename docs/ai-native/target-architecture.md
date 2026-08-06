# Target architecture — closed-loop spine for Dime AI

Status: Gate 2 design, 2026-07-28. Every element maps to a gap in `current-state-audit.md` (G#)
and a validation method. Scope: the evaluation-integrity vertical slice; wider adoption is queued,
not speculated.

## Loop spine (canonical)

observation → canonical fact → interpretation → decision → authorized action → outcome →
evaluation → proposed improvement → **independent gate** → next observation

## Modules

| Module | Home | Closes | Contract |
|---|---|---|---|
| Artifact envelope | `shared/loop/envelope.ts` | G1, G7, artifact-producing ops | Zod-validated envelope: stable id, type, schemaVersion, observation/event/processing/effective times (epoch-ms, repo convention), producer, source refs, entity refs (gamePk-first per `server/mlbEventIdentity.ts`), versions (modelVersion, paramsHash, codeRef), sha-256 contentHash, uncertainty + freshness, accessClass (public/internal/owner), links (supersedes, correctionOf, approves, outcome), optional cost block (tokens/usd). |
| Append-only ledger | `shared/loop/ledger.ts` | closed-loop, replay/idempotency | Append-only; idempotent on (id, contentHash); same-id different-hash rejected as conflict unless superseding; tamper-evident prev-hash chain; JSONL round-trip for interruption recovery; injected clock (no hidden `Date.now`) for deterministic tests. |
| Query layer | `shared/loop/queries.ts` | G4, queryable company | Typed queries returning honest `{state, value, reason}` points (vocabulary of `server/analytics/metricDefinitions.ts`): decision-time view, grading by model version, lineage, freshness, conflicts, pending approvals, cost per verified outcome. Missing evidence stays missing (`not_measured`), never a fabricated value. |
| Slice engine | `server/loop/projectionLoop.ts` | G1–G6 | Stage functions producing envelope artifacts: observe → canonicalize (gamePk required; doubleheader per identity contract) → immutable odds snapshot → **versioned** projection (modelVersion + paramsHash mandatory; abstention explicit) → display artifact (source ids cross-checked against ledger — closes the `dimeVerdict.ts` unchecked-source_ids gap pattern; unsupported-certainty copy rejected) → result observation (corrections supersede) → grading via `server/mlbBacktestAuditCore.ts` `gradeMarket` (leakage quarantine, CLV vs closing snapshot, Brier) → evaluation report per model version → improvement proposal → approval decision. |
| Independent gate | same | G2 | `approveProposal` rejects self-approval (approver == proposer), requires owner-role approval artifact; promotion state changes only via an approval artifact; zero-tolerance: any leakage-quarantined record in the evaluation window blocks promotion (mirrors `ml/dime-1.0/docs/RELEASE_GATES.md` zero-tolerance family). |
| Economics | envelope cost block + queries | G7 | `verified leverage = value of verified outcome / total workflow cost`; cost artifacts attach to outcomes; budget breach surfaces as a flagged state, never silently absorbed. |
| Factory | `docs/ai-native/factory/` | thousand-X, software factory | Spec template → executable acceptance criteria (vitest) → defect taxonomy → regression path. Deterministic gates outrank the probabilistic rubric (rubric defined with human-anchored samples; an LLM grader may add judgment but can never override a failed invariant). |

## Deterministic invariants (testable, blocking)

1. Every projection artifact carries modelVersion + paramsHash (G1). No unversioned projection enters grading.
2. `modelRunAt < gameStartUtcMs` or the grading record is QUARANTINED / `leakageSafe=false` (G4); closing-line data is evaluation-only input, never a projection input (truth contract).
3. Grading is idempotent: replaying the same result produces no second grading record (dedup by content).
4. Corrections supersede; graded-on-superseded results are regraded with lineage intact.
5. Postponed/cancelled → VOID; ties/pushes → PUSH; missing result → UNGRADED with reason — never a fabricated LOSS/WIN.
6. Display artifacts cite only ledger-resident sources; certainty language and p∉(0,1) claims are rejected.
7. Promotion requires an approval artifact from a distinct authorized approver; self-approval throws (G2).
8. Conflicting result observations (same event, different scores, no correction link) block grading and surface as a conflict.
9. Ledger integrity verifiable (hash chain); resumable from JSONL after interruption.
10. Query layer returns `not_measured`/`incomplete` states below minimum sample; no metric fabricated from zero evidence.

## Authority boundaries

- Slice runs on synthetic fixtures (repo honesty convention: synthetic gamePks) — no DB, no schedulers, no schema change, no production path touched.
- Migration sequence (queued, each owner-gated): (1) add `model_version`/`params_hash` columns + wire `mlbMultiMarketBacktest` to emit GradingInput incl. closing odds via the AN↔gamePk crosswalk (spec Phase 3); (2) route drift-recalibration through improvement-proposal + approval instead of in-place `MLBAIModel.py` patching; (3) surface `mlbPublicationGate` verdicts before any public track record. All require `db-push.yml` and owner review per deploy law.
- DRI map: engine/grading integrity — builder-operator (this program); promotion approval — owner (aisportbettingcontact); production wiring — owner-gated PR review. Escalation: INCIDENTS.md entry per OPERATING-RULES.

## Validation map

Each invariant above ↔ a named vitest case in `shared/loop/*.test.ts` / `server/loop/*.test.ts`
(Gate 6 matrix in `verification-report.md`). Contract satisfied only by executed tests, not code presence.
