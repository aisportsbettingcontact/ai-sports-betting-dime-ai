# DR-006 — Artifact schema and ledger mechanics — where artifacts live, and what enforces them

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**observe_by:** 2026-08-12
**Doctrine:** §6 D6 — The queryable company: artifact law, the seven required properties, semantic connections, preserve reasoning not only conclusions, minimize invisible consequential state, context parity · §8 D12-L2 — Artifact system: the D6 event list, links make artifacts traceable, and the binding constraint that INCIDENTS.md remains the append-only single source of truth to be linked, never moved or rewritten · §8 D12-L3 — Queryable context: retrieval by goal/customer/project/owner/time/outcome rather than tool-by-tool; currency beats completeness, flag staleness · §4 D4 — The four questions and the stateful company: one reality, specialized agents may divide labor but may never maintain incompatible realities · §5 D5 — The closed loop: every action leaves an artifact; an open loop fails silently when inputs shift · §14 D14 — The fifteen-stage sequence: visibility before autonomy, evaluation before scale; steps 4–5 (map the open loop, create artifacts until the process is legible) · §15 D15 #3 and #4 — Unqueryable work → shared durable records linked to goals; data collection without meaning → semantic relationships, not a larger archive · §16 D16 — Peak state: every important action creates an artifact; organizational state stays current because it updates continuously; the company learns from each cycle · §19 — Standing Dime rules: evidence taxonomy (VERIFIED/INFERRED/UNKNOWN), consequential sessions produce artifacts, and deploy law (merge to main IS a production deploy; schema changes require db-push first)

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

Where do Dime's artifacts physically live, under what schema, and what mechanism makes their absence or staleness impossible to ignore — git files, a TiDB table, or a boundary-enforced split of both under one envelope?

## Why this is contested

The two obvious answers are each fatally incomplete, in opposite directions, and both are defensible.

Git is genuinely a durable, hash-chained, append-only, reviewed, CI-gated store that Dime already runs at 13 merges/day — but the Railway process CANNOT write to it. There are no push credentials in the container, the filesystem is ephemeral, and a push to `main` IS a production deploy (deploy law, §19), so a runtime commit would self-trigger a redeploy loop. Git-only therefore permanently excludes crons, grading, provenance, and spend — the exact half of the company the Stage 1 audit named as unobserved (F3, F5, F7, F8).

A TiDB table can receive runtime writes — but it needs an owner-gated `db-push.yml` run before any deploy, it is invisible to the working mode Prez and every agent actually use (repo checkout, no DB creds), it holds no reviewable reasoning (D6: "preserve reasoning, not only conclusions"), and a table nobody queries is F1's dark state in a new shape.

Sharpening it further: the existing `shared/loop/ledger.ts` prev-hash chain is redundant with git's own Merkle DAG on the git side, and unachievable-against-a-DB-writer on the SQL side — while the same file's `contentHash` dedupe is valuable in both. So "adopt the existing primitive" is not a yes/no; it requires deciding which of its guarantees survive each substrate. And whichever way this goes, it is the substrate every later layer DR inherits.

## Options

### A — Git is the ledger (no table, no committed chain)

**Effort:** S · **Risk:** low

Track `/os/` in this repo. Commit `shared/loop/envelope.ts`, `ledger.ts`, `queries.ts`, `ledger.test.ts` unchanged — VERIFIED they typecheck standalone (`tsc --noEmit --strict` exit 0; deps are only `node:crypto`, `zod`, each other) and are already inside vitest's `shared/**/*.test.ts` include, so they join the REQUIRED "Vitest" check with no workflow edit. Extend `artifactTypeSchema` with `goal_record | decision_record | loop_record | agent_charter | lesson | job_run | incident_ref`. New `shared/loop/markdownArtifact.ts`: every `os/**/*.md` opens with YAML front matter that IS a serialized envelope header (artifactId, artifactType, producer, sources, links, entityRefs, accessClass, createdAt, contentHash); payload is `{path, bodySha256}`. Deliberately commit NO `index.jsonl` — git's Merkle DAG is the chain; `LoopLedger` is used only as a verifier, rebuilt in CI from the sorted artifact set. Enforcement is one file, `scripts/os-artifacts.test.ts`, riding the already-required "Vitest" check: rejects hash mismatch, unresolved `sources`/`links`, duplicate ids, id-number gaps. `os/index/incidents.jsonl` is derived from INCIDENTS.md by `scripts/index-incidents.mjs`; the test regenerates and fails on diff. Runtime artifacts are not persisted at all.

**Pros**

- Zero new infrastructure: no table, no workflow, no service, no vendor, no schema change, no db-push run
- Enforcement is a vitest file, the cheapest merge-blocking gate this repo has — it inherits the existing required check rather than adding a fifth
- Kills F1 (dark state) and U3 outright, and fixes F6.8 incident-number collisions, in one PR
- Review, diff, blame, CODEOWNERS, and history come free and are already trusted here
- Every agent already reads and writes files; nothing new to learn or authenticate against

**Cons**

- Structural ceiling: the Railway process cannot write to git (no creds, ephemeral FS, push to main = deploy), so F7 cron run records, F3 per-version grading, F5 provenance, and F8 money-path events get no home ever
- Leaves the runtime artifact contract undefined, which is precisely how a second, incompatible artifact reality gets invented later (D4 violation in waiting)
- Invites the wrong later fix — someone eventually commits per-game run data and bloats the repo, with no rule saying they may not
- The half of the company the audit called unobserved stays unobserved by construction

**Doctrine fit:** Satisfies D6 (all seven artifact properties, semantic links, preserve reasoning) and D12-L2 fully for the human tier, including the 'link to INCIDENTS.md, never move or rewrite it' clause. Honors D14 (visibility, zero autonomy). Fails D13 Operations/Engineering — production actions still leave no artifact — and leaves D4 'one reality' unprotected.

### B — One TiDB table is the ledger (`loop_artifacts`), /os/ mirrors into it

**Effort:** L · **Risk:** medium

Add `loopArtifacts` to `drizzle/dime.schema.ts`: `artifactId varchar(191)` PK, `seq bigint auto_increment` unique, `artifactType`, `schemaVersion`, `contentHash char(64)`, `prevChainHash`/`chainHash char(64)`, the four envelope timestamps, `producer`, `sources`/`entityRefs`/`versions`/`links`/`cost`/`payload` as `json`, `accessClass`, `freshness`, `uncertainty`; indexes on `(artifactType, createdAtMs)` and the gamePk projection. New `server/loop/artifactStore.ts` implements the `LoopLedger` append contract over SQL inside `db.transaction` with a `SELECT … FOR UPDATE` tail read to compute the chain hash. `/os/` markdown stays ordinary prose and is mirrored as rows by a `push`-triggered workflow with `sources: ["git:os/decisions/DR-006.md@<sha>"]`. `shared/loop/queries.ts` gains a SQL-backed sibling and becomes the founder-dashboard backend. Ships behind `db-push.yml` first, then deploy, per deploy law and prior owner ruling D-006.

**Pros**

- Production can finally write artifacts — the only option that reaches F7, F5, F3, and F8 at all
- One query surface answers the D6/L3 questions across functions; `queries.ts` stops being dead code
- Matches the repo's existing event-table idiom (`payment_events`, `odds_history`, `mlb_game_backtest`)
- Scales to per-game cardinality, which git cannot

**Cons**

- Schema change: owner-gated, manual `db-push.yml` before any deploy — real ceremony on the critical path, and it is exactly the ordering that caused Incident 43
- The prev-hash chain needs a serialized tail read, and BOTH Railway services deploy the same repo (project memory: two-service topology, single-writer choice still pending) — two concurrent appenders can interleave and break the chain during ordinary operation, which trains everyone to ignore a red integrity check
- A TiDB row is invisible to an agent with a checkout and no DB creds — the normal working mode — so it fails D6 'comprehensible after the original participants are gone' in practice
- No review, no diff, no blame; decision reasoning cannot live there in reviewable form
- Rebuilds F1 in a new shape: a table nobody queries is dark state with extra steps
- Builds the machine tier before the human tier is legible, inverting D14's stated order

**Doctrine fit:** Strong on D6 'accessible to the appropriate intelligent system' and on D13 function loops. Weak on D6 'comprehensible after participants are gone' and 'preserve reasoning, not only conclusions'. Inverts D14 (evaluation/visibility ordering). Collides with §19 deploy law by putting a schema change on the critical path of the first artifact.

### C — Two tiers, one envelope (git for org kinds, TiDB for runtime kinds) ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

GIT TIER, built now: commit `shared/loop/{envelope,ledger,queries,ledger.test}.ts` unchanged (VERIFIED: standalone-typechecking; 32/32 green today — 10 in `shared/loop/ledger.test.ts`, 22 in `server/loop/projectionLoop.test.ts`; both already inside vitest include globs, so they land in the REQUIRED "Vitest" check with zero workflow change). Bump `LOOP_SCHEMA_VERSION` to `loop-envelope-v2` and add 7 org kinds (`goal_record`, `decision_record`, `loop_record`, `agent_charter`, `lesson`, `job_run`, `incident_ref`) — zero migration cost because nothing has ever been persisted. Add `shared/loop/markdownArtifact.ts`; `/os/` gets `decisions/DR-####-*.md`, `goals/GR-####-*.md`, `loops/LOOP-*.md`, `agents/charters/`, `agents/AUTHORITY.md`, `memory/lessons/`, `index/`, each file front-mattered with the envelope header. NO committed chain file — git is the chain; `scripts/os-artifacts.test.ts` rebuilds a `LoopLedger` in-memory in artifactId order and asserts `verifyIntegrity().ok` plus resolvable refs, unique ids, dense numbering. INCIDENTS.md is never moved or rewritten: `scripts/index-incidents.mjs` derives `os/index/incidents.jsonl` (handling the one unnumbered 2026-07-11 entry; VERIFIED 60 `## Incident N` headers), the test regenerates and fails on diff, artifacts cite `sources: ["incident:41"]`, and `isIncidentRef()` sits beside `isExternalRef()`. COLLISION FIX (F6.8): the same test asserts incident numbers strictly increasing, dense, unique, AND a diff gate asserts every added `## Incident N` header sorts after the last header on base while no existing header LINE is modified or deleted (body and `Status:` edits stay legal, matching real practice) — two branches both taking 62 means the second to merge goes red. `pnpm os:incident:next` prints max+1; the program's three unfiled incidents are backfilled as 62/63/64. LOUDNESS: `scripts/os-staleness.test.ts`, also on the required check — any artifact `status: awaiting-ruling` past its `reviewBy`, or a `loop_record status: live` past its declared `observationIntervalDays`, turns a REQUIRED check red and blocks every merge; the only escape is a committed decision_record extending the deadline. RUNTIME TIER, specified now and built when DR-005 names the first loop: one `loop_artifacts` table (Option B's exact column list) with `server/loop/artifactStore.ts`; DROP the prev-hash chain in SQL, keep `seq BIGINT AUTO_INCREMENT` for order and `unique(artifactId)` + `contentHash` for replay dedupe; append-only enforced by a `dbSuiteRegistration`-style test that fails if the store module contains `update(`/`delete(`. BOUNDARY RULE, mechanically enforced: artifact type determines tier — the 7 org kinds are git-only, the 11 loop kinds are DB-only, and the test fails if a `projection` appears under `os/` or an org kind reaches the store. Cross-tier links are legal one direction each: a DB artifact may cite `git:os/…@sha`; a git artifact may cite `db:<artifactId>`.

**Pros**

- Reuses the best primitive in the repo unchanged and gets 32 adversarially-designed tests into a REQUIRED status check for free — VERIFIED green today, no port, no rewrite
- Adds no workflow, no service, no vendor, and no schema change today; the entire enforcement surface is two test files inheriting an existing required check
- Kills F1/U3 and gives F2 a mechanism that is loud by construction: in a repo merging ~13×/day, neglect blocks the next merge within hours instead of sitting silent for 8 days
- Fixes F6.8 without touching, moving, or rewriting INCIDENTS.md — the derived index and header-immutability diff gate satisfy D12-L2's constraint literally
- One envelope across both tiers makes an incompatible second reality structurally impossible (D4), which is the specific way the 2026-07-28 slice's good work became strandable
- Defers the expensive half behind DR-005, so the table is built with a real consumer instead of speculatively — and per prior owner ruling D-006 a new table is already the safe schema class
- The staleness gate is the only proposed mechanism that does not require sustained founder effort to keep working

**Cons**

- Two substrates is genuinely more surface than one; the type→tier rule must hold or the boundary blurs into judgment calls
- Front-matter `contentHash` is hand-maintained unless `pnpm os:seal` becomes habitual — mitigated only by the failure message printing the correct hash
- Between now and DR-005 production still writes zero artifacts — deliberate under D14, but it means F7/F3/F5/F8 stay open for this DR's duration
- A merge-blocking staleness check is a real footgun: on a bad day it stops unrelated urgent work, and the escape hatch costs a commit
- The runtime tier is a written promise, and this company's audit shows written promises can go unbuilt

**Doctrine fit:** D6: all seven properties satisfied per tier, with semantic links crossing the boundary — traceability from intention to result preserved. D12-L2: satisfied including the 'link to INCIDENTS.md, never move or rewrite it' clause, plus the missing number-allocation mechanism. D12-L3: git tier is retrievable by goal/owner/outcome, not tool-by-tool. D14: order held — human visibility first, runtime instrumentation second, autonomy in neither. D4 'one reality': protected by the shared envelope. D15 #3/#4: queryable and semantically linked, not a bigger archive. §19 deploy law: respected by deferring the schema change out of the critical path.

### D — Fresh minimal front-matter schema; discard the typed envelope

**Effort:** XS · **Risk:** medium

Skip `shared/loop/` entirely. Write ~60 lines: `os/SCHEMA.md` defining six required front-matter keys (`id`, `type`, `owner`, `status`, `updated`, `links`) plus `scripts/check-os.mjs` validating them across `os/**/*.md`, with the INCIDENTS.md numbering check folded into the same script. No content hash, no ledger, no artifact-type enum beyond the six org kinds, no runtime tier contemplated.

**Pros**

- Smallest possible thing that closes F1 and F6.8 — ships in an afternoon
- A one-founder company can hold the entire spec in its head; almost nothing to rot
- No dependency on the untracked prior program at all, so DR-003 does not block it

**Cons**

- Discards an adversarially-tested primitive that already exists, already passes 32 tests, and already typechecks — the audit's own 'build on' list names it first
- When the runtime tier arrives it gets designed independently: two incompatible artifact realities, the exact D4 failure, and exactly why the 2026-07-28 work was strandable
- No content hash means no replay dedupe and no tamper signal — the property that makes a re-run distinguishable from an original (F5.2) is thrown away
- Throws out `queries.ts`'s honest `{state, value, reason}` vocabulary — the thing that prevents fabricated zeros — which would then be rewritten worse
- Optimizes the cheap half (writing files) and leaves the expensive half (contract) for later, which is the shape of every deferred-integration failure in the audit

**Doctrine fit:** Satisfies D12-L2 minimally and honors D14 ordering. Fails D6 'linkable to later results' (no hash, no resolvable-ref check) and D4 'one reality'. Fails D16's 'the company learns from each cycle and makes the learning available to the next' by discarding a working asset the audit explicitly flagged for reuse.

## Recommendation

**C — Two tiers, one envelope (git for org kinds, TiDB for runtime kinds)**

C is the only option whose ceiling is not structural. A cannot ever reach production artifacts — not for effort reasons but because the Railway container has no push credentials, an ephemeral filesystem, and a push to main is a deploy; that permanently excludes crons, grading, provenance, and spend, which is the audit's headline finding. B reaches them but pays a schema change, a db-push run, and a deploy before the first artifact exists, inverting D14's explicit order, and it puts artifacts in a place invisible to the working mode Prez and every agent actually use — recreating F1 as a table nobody queries. D is cheapest and is the honest YAGNI answer, but it discards a primitive that VERIFIABLY works today (standalone `tsc` exit 0; 32/32 tests green) and guarantees the runtime contract gets invented separately, which is the precise mechanism by which the 2026-07-28 program's excellent work became unusable.

The decisive property is cost of enforcement. `shared/**/*.test.ts` and `scripts/**/*.test.ts` are already inside vitest's include globs, and "Vitest" is already one of exactly four REQUIRED checks on main. So the entire enforcement surface — envelope validation, hash integrity, resolvable links, incident-number density, header immutability, and staleness — is two test files that inherit a merge-blocking gate that already exists. No new workflow, no new service, no new vendor, no fifth required check to configure. Against the hard constraint that Prez is one human and anything needing sustained manual effort will not survive, this is the cheapest available mechanism that makes its own neglect loud: in a repo merging ~13×/day, an overdue ruling turns the next merge red within hours rather than sitting silent for eight days, which is exactly and only how the last program died.

And it defers the expensive half correctly. The `loop_artifacts` table is fully specified here so DR-005 implements rather than re-designs it, but no schema change is authorized today — keeping the deploy law and Incident 43's ordering lesson off the critical path, while the one envelope guarantees the deferred tier can never become a second reality.

**Grafted from the runners-up**

- From A: commit NO chain file. A hash-chained `index.jsonl` conflicts on every one of ~13 daily parallel merges and cannot be auto-merged, because chain hashes depend on append order. Git's own Merkle DAG already provides the chain; `LoopLedger.verifyIntegrity()` is used as a CI verifier rebuilt from the sorted artifact set, not as a committed artifact.
- From B: adopt its exact `loop_artifacts` column list and `db.transaction` append path verbatim as the written runtime-tier spec, so DR-005 is an implementation task with no design left in it.
- From B, inverted: drop the prev-hash chain in SQL. Tamper evidence is unachievable against anyone holding DB write access, and a chain that breaks whenever both Railway services append concurrently teaches everyone to ignore a red integrity check. Keep `seq` for order and `contentHash` for replay dedupe — the guarantee that actually pays.
- From D: its ruthlessness about ceremony. Front matter is eight keys, not twenty; everything derivable (`contentHash`, `os/index/incidents.jsonl`) is generated by `pnpm os:seal` and never hand-typed, and the failing test prints the correct value.

## Requested ruling

Approve the two-tier artifact substrate: git holds the 7 org artifact kinds under a tracked `/os/` tree, TiDB `loop_artifacts` will hold the 11 runtime kinds, both under one extended `shared/loop/envelope.ts` (v2), with ALL enforcement riding the existing required "Vitest" check (no new workflow, no fifth required check), and INCIDENTS.md linked only through a derived index that never mutates it. Yes / No / Amend.

A "yes" commits Prez to five things:

1. **Committing `shared/loop/` (4 files) and a tracked `/os/` tree to `main`** — which is a production deploy under §19 deploy law. Runtime behaviour is unchanged: VERIFIED that `shared/loop/*` is imported by nothing shipped, and that the three source files typecheck standalone (`tsc --noEmit --strict` exit 0) independently of the broken `server/_core/aiCostMeter.ts:20` import. This depends on DR-003 authorizing the commit of the untracked program.

2. **Accepting that an overdue or stale `/os/` artifact turns a REQUIRED check red and blocks all merges** until an artifact resolves it. This is the mechanism, not a side effect: the escape hatch is a committed decision_record extending the deadline, so neglect costs an artifact rather than a flag. Prez should say explicitly whether he wants the initial grace period at 3, 7, or 14 days.

3. **Accepting `## Incident N` header lines in INCIDENTS.md as immutable and append-after-last-only**, enforced by a CI diff gate. Body text and `Status:` line edits inside an existing section remain legal, matching current practice (F6.7). The file is never moved, never renumbered, never rewritten.

4. **Deferring the `loop_artifacts` table and its `db-push.yml` run until DR-005 names the first loop.** This ruling authorizes NO schema change and NO production data write.

5. **Backfilling the AI-native program's three unfiled incidents as new numbers 62/63/64**, not reclaiming 41–43 from the Trace v1 workstream that legitimately holds them.

## Depends on

- DR-003 — HARD BLOCKER: authorizes pushing `local/audit-mlb-model-2026` and committing the untracked AI-native program. Nothing in this record can be built until `shared/loop/` may legally enter git. If DR-003 is denied, this record collapses to Option D by force.
- DR-005 — SEQUENCING: first-loop selection determines when the runtime tier's `loop_artifacts` table is built and which of the 11 loop kinds it must carry on day one. This record specifies that table; DR-005 triggers it.
- DR-004 — SUBSTRATE COMPATIBILITY: the orchestration-spine ruling. This record assumes the spine stays git + GitHub Actions + the existing in-process schedulers. If DR-004 adopts a durable-execution engine, the runtime tier's append path is that engine's concern and the git tier is unaffected — but the boundary rule must be re-checked against it.

## Open unknowns

- Whether `/os/` should live in this repo or a separate one. The recommendation assumes this repo so that CODEOWNERS, branch protection, and the four required checks apply with zero new setup — but it means every `/os/` commit is a production deploy under §19. Resolves via: a Prez preference statement; a separate repo would need its own protection and would break the single-required-check enforcement story.
- Steady-state git-tier file volume. Six cron `job_run` artifacts per day would be ~2,200 files/year, which git handles fine; per-game kinds would not. The type→tier rule is the guard, but its adequacy is untested. Resolves via: one month of operation with a file-count assertion in `scripts/os-artifacts.test.ts`.
- Whether TiDB's `json` column type via drizzle-mysql `json()` round-trips the envelope's `unknown` payload losslessly at the sizes a full projection reaches. Resolves via: one `db-query.yml` probe with a representative payload before DR-005 builds `artifactStore.ts`.
- Whether both Railway services would append to `loop_artifacts` concurrently. Project memory records the two-service topology with the single-writer choice still pending. Dropping the SQL chain makes this non-fatal either way, but ordering semantics under two writers are unconfirmed. Resolves via: the same DR that settles the two-service topology, plus a read of which service actually runs the schedulers.
- Whether front-matter hash discipline survives contact with agents that edit `os/` files without re-sealing. The mitigation is a failure message that prints the correct hash, but the real answer is behavioural. Resolves via: watching the first two weeks of red checks; if the seal step is a persistent papercut, move the hash into a derived `os/index/artifacts.jsonl` regenerated by CI instead of stored per-file.
- Whether PR #362 merges before this work. Its `08-contract-and-data-integrity.yml` already runs a governed-manifest SHA256 re-verify and an immutable-migration-history diff gate — the same two idioms this record needs. If #362 lands first, the INCIDENTS.md header-immutability gate belongs there rather than in a vitest file, and this record's enforcement should be re-homed. Resolves via: the ruling on #362's merge.
- Whether the working-tree typecheck break must be fixed as part of this. VERIFIED that `shared/loop/{envelope,ledger,queries}.ts` are independent of `server/_core/aiCostMeter.ts:20` and its missing `aiWorkflowCosts` export, so the git tier can ship without touching it — but `server/loop/projectionLoop.ts` pulls in `server/mlbBacktestAuditCore` and belongs to DR-005's scope, not this one. Resolves via: a scoped `tsc --noEmit` on the exact commit set before the PR opens.

