# Repository Assessment Standard

Use this reference to classify repository evidence, assess architecture, decide cleanup actions, and produce consistent reports. Apply only the sections relevant to the detected repository.

## Contents

1. Classification vocabulary
2. Architecture coverage
3. Cleanup decision standard
4. Target architecture tests
5. Validation selection
6. Reporting schemas

## 1. Classification vocabulary

Assign the narrowest supported category. Use `Unknown` rather than guessing.

| Category | Evidence to seek |
| --- | --- |
| Production source | Reachable runtime code, published package surface, or direct application behavior |
| Runtime entry point | Manifest command, process start, route discovery, worker registration, scheduler, container command, or external invocation |
| Shared library | Multiple verified consumers or an intentional exported contract |
| Public contract or schema | API schema, serialization contract, package export, protocol, or versioned shared type |
| Configuration | Runtime, build, compiler, framework, test, tool, or environment behavior |
| Build tooling | Compilation, bundling, packaging, generation, validation, or release preparation |
| CI or deployment automation | Workflow, pipeline, deployment, release, environment, or hosting definition |
| Infrastructure | Infrastructure-as-code, container orchestration, networking, or service configuration |
| Test | Unit, integration, end-to-end, smoke, contract, performance, or security test |
| Fixture, mock, or snapshot | Test-discovered input, controlled substitute, golden result, or regression artifact |
| Database migration or seed | Ordered schema/data transition, bootstrap data, or operational recovery input |
| Documentation | Maintained setup, operation, architecture, decision, runbook, or user material |
| Static asset | Runtime-served image, font, data, stylesheet, media, or public resource |
| Generated artifact | Reproducible output with an identified source and generator |
| Cache or build output | Reproducible transient output excluded from source ownership |
| Vendor dependency | Third-party code intentionally stored in the repository |
| Experimental or prototype work | Bounded exploration with unclear production ownership |
| One-off operational script | Manual or rare administration, repair, migration, analysis, or support procedure |
| Deprecated but referenced | Marked or superseded, yet still reachable or operationally invoked |
| Duplicate or superseded implementation | Behavior overlaps another implementation, subject to caller and side-effect comparison |
| Suspected dead code | No established consumer after static, dynamic, conventional, and operational checks |
| Sensitive or secret-bearing content | Credentials, private keys, tokens, personal data, dumps, or protected configuration |
| Unknown | Evidence is insufficient or contradictory |

## 2. Architecture coverage

Evaluate these dimensions when applicable. Record `not applicable` rather than omitting a relevant check without explanation.

1. Repository topology, root hygiene, nested repositories, submodules, worktrees, and symlinks.
2. Application, package, service, and workspace boundaries.
3. Dependency direction, circular dependencies, boundary violations, and hidden coupling.
4. Runtime, build, worker, command-line, scheduled, and administrative entry points.
5. Frontend, backend, shared, data, infrastructure, and integration separation.
6. Configuration ownership and environment-specific behavior.
7. Manifests, lockfiles, workspaces, compiler configuration, path aliases, and runtime versions.
8. Test placement, discovery, fixtures, snapshots, mocks, and coverage boundaries.
9. Scripts, notebooks, experiments, migrations, prototypes, and operational tools.
10. Static assets, generated outputs, caches, build artifacts, vendored code, and large files.
11. API contracts, schemas, generated clients, shared types, and versioning.
12. Data models, migration history, seeds, backup dependencies, and irreversible data risk.
13. CI, release, deployment, containers, hosting, and infrastructure references.
14. Documentation accuracy, setup, ownership, runbooks, and architectural decisions.
15. Dependency duplication, abandoned packages, inconsistent versions, and package-manager drift.
16. Secret exposure, committed environment files, dumps, and sensitive artifacts.
17. Naming consistency, discoverability, and directory ownership.
18. Developer workflow, onboarding friction, command reliability, and local-to-CI parity.
19. Architectural complexity relative to demonstrated product requirements.
20. Constraints that block scaling, testing, redesign, automation, release, or maintenance.

## 3. Cleanup decision standard

### Required evidence record

For every delete, move, rename, merge, split, archive, or regeneration candidate, record:

| Field | Required content |
| --- | --- |
| Target | Exact path or component |
| Current purpose | Observed or documented role |
| References | Static and configuration references found or not found |
| Entry points | Runtime, build, test, CI, deployment, scheduler, container, and manual invocation |
| Supporting evidence | Evidence favoring the proposed action |
| Opposing evidence | Evidence favoring retention or further investigation |
| Dynamic risk | Reflection, discovery, routing, convention, generation, shell, or external invocation |
| User-change risk | Tracked, untracked, modified, ignored, or ownership concern |
| Confidence | Confirmed, Strongly supported, Uncertain, or Contradicted |
| Action | Keep, delete, move, rename, merge, split, archive, regenerate, document, or investigate |
| Dependencies | Actions or knowledge required first |
| Validation | Checks that can disprove safety |
| Reversal | Exact recovery method |

### Deletion gates

Permit deletion only when all applicable gates pass:

1. The target and repository root are unambiguous.
2. The target contains no unrelated user changes.
3. Static references and executable configuration have been inspected.
4. Dynamic loading, framework conventions, file-system routing, plugin discovery, shell invocation, schedules, containers, CI, deployment, generation, migrations, package exports, test discovery, and manual procedures have been considered.
5. Ownership and lifecycle are established.
6. Replacement or superseding behavior is proven when applicable.
7. Required data retention, migration, rollback, and compliance constraints are satisfied.
8. A recovery method exists and is proportionate to the risk.
9. Targeted validation is defined and can be run safely.
10. The requested implementation scope authorizes the action.

If any material gate fails, choose `investigate`, `keep`, or a reversible archive plan. Do not convert uncertainty into confidence because the user requests aggressive cleanup.

### Special lifecycle checks

- **Lockfiles:** Preserve unless the package-manager strategy is intentionally changed and regeneration is verified.
- **Migrations and seeds:** Establish ordering, applied state, rollback, bootstrap, production history, and disaster-recovery use.
- **Generated clients or source:** Identify generator, source schema, version pin, build use, publication use, and deterministic reproduction.
- **Fixtures, mocks, and snapshots:** Inspect discovery rules, indirect test loading, contract tests, and regression history.
- **Framework convention files:** Verify routing, discovery, hooks, naming, and build-time scanning.
- **Notebooks and experiments:** Distinguish reproducible research, operational analysis, product prototypes, and disposable exploration.
- **One-off scripts:** Check runbooks, shell history documentation, schedules, CI, support procedures, data repair, and emergency use.
- **Environment templates:** Preserve documented variable names while preventing secret values from exposure.
- **Deployment and infrastructure files:** Trace external platform references, environments, containers, and release workflows.
- **Large or binary files:** Determine runtime, test, model, fixture, asset, backup, and Git LFS roles before action.
- **Secrets or dumps:** Do not print contents. Contain further exposure and route credential, history, or data remediation to an explicitly authorized workflow.

## 4. Target architecture tests

Accept a proposed target only when it passes these tests:

1. **Problem fit:** Every material move or new boundary resolves a verified defect or requirement.
2. **Convention fit:** The layout respects functional language and framework discovery rules.
3. **Ownership:** Each directory, package, service, configuration, generated output, and operational tool has a clear owner and lifecycle.
4. **Dependency direction:** Allowed imports and prohibited cross-boundary dependencies can be stated and checked.
5. **Entry-point continuity:** Runtime, build, worker, CLI, scheduled, test, generation, container, CI, and deployment entry points remain addressable.
6. **Change proportionality:** The migration cost and operational risk are justified by the expected gain.
7. **Verification:** Repository-native checks can demonstrate the preserved behavior to a useful degree.
8. **Reversibility:** High-risk batches have a practical rollback path.
9. **Future work:** The structure enables demonstrated near-term needs without speculative generalization.
10. **Comprehension:** A new contributor can locate production code, tests, configuration, generated files, operational scripts, and documentation without hidden knowledge.

Choose among a simpler layout, package boundaries, a modular monolith, a workspace or monorepo, or service separation only after comparing current coupling, deployment independence, ownership, scaling, validation, and release requirements. Do not treat any option as a maturity ladder.

## 5. Validation selection

Prefer commands already declared in manifests, task runners, CI, or documentation. Compare local commands with CI behavior.

| Change type | Minimum relevant checks |
| --- | --- |
| File move or rename | Reference search, import resolution, targeted tests, build or package check |
| Module or package boundary | Type check or compile, dependency/cycle check, affected tests, packaging, entry-point smoke |
| Script relocation or removal | Manifest, shell, CI, scheduler, container, documentation, and manual invocation search |
| Configuration consolidation | Parser or tool validation, environment matrix, build, tests, and documented command check |
| Generated artifact change | Generator execution or dry run, reproducibility comparison, build, package, and consumer checks |
| Migration or seed change | Migration discovery, ordering, dry run or isolated test database, rollback and bootstrap checks |
| Test or fixture move | Test discovery, affected tests, full feasible suite, snapshot or fixture path search |
| CI or deployment path change | Local syntax validation, workflow references, container or infrastructure validation, no remote run unless authorized |
| Documentation path change | Link and command search, setup-command validation when safe |
| Deletion | Every applicable deletion gate plus final stale-reference and diff inspection |

Record each command with:

| Command | Purpose | Baseline result | Final result | Status | Limitation |
| --- | --- | --- | --- | --- | --- |

Use `pass`, `fail`, `blocked`, or `not run`. Never collapse a baseline failure into an introduced failure or claim success from a command that did not execute.

## 6. Reporting schemas

### Material finding

| Field | Content |
| --- | --- |
| Finding | Specific architectural condition |
| Evidence state | Confirmed, Strongly supported, Uncertain, or Contradicted |
| Evidence | Paths, configuration, references, and command results without secret values |
| Impact | Correctness, delivery, maintainability, security, or verification consequence |
| Recommendation | Smallest justified response |
| Risk | Change and non-change risk |

### Action register

| Priority | Action | Target | Evidence | Confidence | Dependencies | Risk | Reversal | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Order actions by dependency and risk, not cosmetic preference. Separate blocking safety work from optional cleanup.

### Final report

1. Outcome and operating mode.
2. Scope and bounded assumptions.
3. Repository profile and stack.
4. Current topology, boundaries, and entry points.
5. Inventory by classification.
6. Material findings and confidence states.
7. Cleanup and architecture action register.
8. Target architecture and differences from current state.
9. Completed batches, if implementation was authorized.
10. Validation matrix.
11. Unrelated changes preserved.
12. Contradictions, remaining uncertainty, risks, and deferred work.
13. Exact next action.
