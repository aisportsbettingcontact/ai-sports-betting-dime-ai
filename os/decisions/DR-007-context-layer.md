# DR-007 — The Queryable Context Layer (L3): how Dime retrieves company context by goal, owner, and outcome

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**Doctrine:** D6 §6 — the queryable company / artifact law: seven required artifact properties, semantic connections, preserve reasoning not only conclusions, minimize invisible consequential state, context parity (sufficient, current, goal-retrieved — not maximal) · D12 L3 §8 — queryable context: retrieval by goal/customer/project/owner/time/outcome, never tool-by-tool; the seven questions the layer must answer; 'currency beats completeness — flag staleness' · D12 L2 §8 — artifact system: `INCIDENTS.md` remains the append-only single source of truth, link to it, never move or rewrite it (the index reads it, synthesizes `INC-<n>` rows, and writes nothing back) · D14 §14 — the fifteen-stage sequence: visibility before autonomy, evaluation before scale; stages 5 (create artifacts until the process is legible) and 6 (provide employee-level context; the agent names what is missing) · D15 §15 — failure modes 3 (unqueryable work), 4 (data collection without meaning), 5 (insufficient context), 6 (context overload) · D16 §16 — 'organizational state stays current because it updates continuously'; the moat is cumulative connected artifacts · D4 §4 — one reality: specialized agents share one source of truth and may never maintain incompatible realities (the reason for the vocabulary graft from `shared/loop/queries.ts`) · D5 §5 — 'an action is not an outcome' (the `outcome:` frontmatter field); open loops fail silently (the nightly staleness issue) · §19 — evidence taxonomy (VERIFIED/INFERRED/UNKNOWN, enforced nowhere today per F6.9) and deploy law (merge to main IS a production deploy — the reason the nightly workflow commits nothing)

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

What is Dime's retrieval layer — where do work items live (GitHub Issues vs PRs + /os/ markdown), what indexes /os/ so an agent can fetch by goal/owner/loop/time/outcome, how does a session load the right context automatically, and how is staleness made loud?

## Why this is contested

Three things pull in opposite directions and no default resolves them.

(1) **The obvious answer is probably wrong.** "Start using GitHub Issues" is what every playbook says, and Dime has 366 PRs / 28 days and literally zero issues ever opened. But GitHub is where the *work* already is; issues would add a second write for every item, for one human, with no schema enforcement — and the 2026-07-28 program died precisely from a discipline no machine checked. Adopting Issues could be the single highest-leverage move (GitHub's notification engine is free ageing, which F2 desperately needs) or the exact repeat of the last failure.

(2) **The best primitive in the repo argues for the most expensive option.** `shared/loop/ledger.ts` + `queries.ts` (adversarially tested, 32/32) already implements a real queryable context surface with an honest `{state, value, reason, evidence}` contract — and it is imported by nothing, never persisted, and would need a db-push-gated schema change plus emitters everywhere to answer one question. D14 says visibility before autonomy; building the service before the file layer is legible inverts that.

(3) **Every enforcement mechanism is a footgun in a one-founder repo.** A CI gate that blocks merges on staleness would wedge unrelated PRs. A nightly bot commit to `main` **is a production deploy** under deploy law. The mechanism that makes neglect loud must not be able to break shipping — and that constraint eliminates the most natural implementations of all four options.

## Options

### A — The OS Index: frontmatter + committed os/INDEX.json + query script + a third SessionStart hook ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

Every `/os/**/*.md` artifact carries YAML frontmatter with 11 fields: `id` (`^(GR|LOOP|DR|CH|LES|AUD)-`), `kind` (goal|loop|decision|charter|lesson|audit|state), `title`, `owner`, `status` (proposed|awaiting-prez|active|blocked|done|superseded), `goal` (the GR id it serves — required for every kind except goal), `loop`, `evidence[]` (ids, repo paths, or `ext:` refs), `supersedes`, `review_by` (ISO date), `outcome` (null until observed — D5's 'an action is not an outcome' made a field).

`scripts/os-index.mjs` (+ `scripts/os-index.test.ts`, mirroring the existing `check-bundle-budget.mjs` + `.test.ts` gate pattern) walks `os/`, parses `INCIDENTS.md`'s `## Incident N — YYYY-MM-DD — title` + `Status:` lines into synthetic `INC-<n>` rows, derives `last_touched` per artifact from `git log -1 --format=%cI -- <path>` (currency is DERIVED, never asserted), and writes `os/INDEX.json` (rows + reverse edges + counts) and `os/INDEX.md` (human table with a banner: `STALE: n · AWAITING-PREZ: n (oldest N days)`). `--check` mode rebuilds in memory and exits 1 on: unknown/missing frontmatter field, duplicate id, dangling `goal`/`evidence`/`supersedes` reference, or `os/INDEX.json` out of date. It deliberately does NOT fail on staleness.

`scripts/os-query.mjs` reads `os/INDEX.json` and answers the seven L3 questions: `--goal GR-0002`, `--owner prez`, `--loop LOOP-mlb-projection-evaluation`, `--status awaiting-prez`, `--since 14d`, `--stale`, `--id DR-007 --graph` (walks edges both directions), `--pack` (token-bounded context pack — context parity, sufficient not maximal). Return shape is exactly `QueryPoint {state, value, reason, evidence}` copied from `shared/loop/queries.ts`, so `not_measured` never masquerades as zero.

Delivery: a THIRD `SessionStart` hook `.claude/scripts/os-context.sh` (matcher `startup|resume|clear`, timeout 15, never exits non-zero) joining the two already in `.claude/settings.json`. It prints STATE.md §4, the INDEX banner, the top 5 awaiting-prez rows by age, any row past `review_by + 14d`, and the `OPERATING-RULES.md` §Claims block — which finally makes that file load (F6.9: it says 'read at every session start' and nothing loads it). One sentence added to `.claude/scripts/prompt-capsule.sh`.

Enforcement without footguns: `ci.yml` gains an `os-context` job running `os-index.mjs --check` (check name 'OS Context Index'; added to main's required checks via PR #362's `docs/verification/RULESETS.md` Wave 1). Staleness escalates OUT of CI: `.github/workflows/os-nightly.yml` (cron) opens and updates exactly ONE GitHub Issue, `OS staleness report`, label `os-staleness`, and posts its one-line summary to the existing Discord webhook. It commits nothing — a bot commit to `main` would be a production deploy. GitHub PR↔artifact edges are cached, gitignored, at `.os-cache/pr-index.jsonl`, refreshed on demand by `os-query --refresh` when `gh` is authenticated; the durable link stays the id written into the PR body (the existing `pull_request_template.md` 'Linked incident / finding' section is retightened to require an OS id or explicit `none`).

**Pros**

- Works from a bare checkout with no network, no auth, no database — the exact condition a fresh-context verifier and every subagent runs in.
- Neglect is loud in two independent channels that cannot both rot: CI goes red on the next PR (the repo merges ~13/day, so max index staleness is hours), and the nightly issue + Discord ping nags without touching main.
- Discipline is enforced by the only mechanism that has demonstrably survived at Dime: a blocking CI check. gitleaks is the proof — one of 4 required checks, no suppression, still working.
- The index is itself a durable artifact under D6: citable, diffable, reviewable, and its answers carry `evidence` ids.
- Reuses the repo's established shapes verbatim — `check-*.mjs` + `.test.ts` gate pattern, `QueryPoint` honesty contract, SessionStart hook slot, the existing PR template section. Adds one file format and one CI job: the cheapest category in the constraint list.
- Semantic edges (`goal`, `loop`, `evidence`, `supersedes`) are validated, so 'a task links to its goal' is machine-true, not convention.
- Bounded, honest answer to the Issues question: one bot-owned issue, not a work-item migration.

**Cons**

- Covers file-based context only. TiDB, Stripe, Railway, and the 3,136 `console.*` calls stay outside until a later DR bridges them; 'what happened after' is answerable only insofar as an artifact's `outcome:` field was written.
- Frontmatter is a discipline. CI catches structural rot but cannot catch a semantically wrong `goal:` pointer or an `outcome:` left null forever.
- `os/INDEX.json` is a generated file committed to git — it will conflict on concurrent branches (mechanical, resolved by regenerating, but it is friction).
- The `review_by` date is hand-set. A founder who sets every date to +365d defeats the staleness signal; only the derived `last_touched` resists that.
- The Wave-1 required-check addition is an owner action outside this DR's control; until it lands the gate is advisory — the exact failure mode as 'DB Tests' and 'Build & Preview Gate' (F6.1).

**Doctrine fit:** D12-L3 head on: retrieval by goal/owner/loop/time, never tool-by-tool. D6 seven artifact properties all satisfiable (what/when/who/goal-link/accessible/comprehensible/linkable). D6 'currency beats completeness' satisfied by deriving currency from git rather than trusting a typed field, and by `QueryPoint.state` refusing to fabricate. D14 clean — this is pure visibility, zero autonomy, and it is the prerequisite the sequence names. D15 corrections #3 (shared durable records linked to goals), #4 (semantic relationships not a bigger archive), #5 (employee-level context, names what is missing), #6 (goal-based retrieval, `--pack` caps volume). D16 'organizational state stays current' becomes mechanical. §19 deploy law explicitly respected: nothing commits to main.

### B — GitHub Issues as the work-item spine, /os/ demoted to linked documents

**Effort:** S · **Risk:** medium

Adopt GitHub Issues as the canonical store for goals, loops, decisions, and findings. `.github/ISSUE_TEMPLATE/goal.yml`, `decision.yml`, `loop.yml`, `finding.yml` define the fields; a GitHub Projects v2 board carries `owner`, `status`, `goal`, `loop` as typed fields. The 96 open loops from `os/audits/gap-map.md` and the 5 items in `docs/ai-native/execution-state.json` `next_action_queue` are opened as issues on day one. New labels beyond the untouched default set: `goal`, `loop`, `decision`, `prez-gate`, `stale`.

Retrieval is `gh issue list --label ... --json` and `gh search issues`, wrapped by `scripts/os-context.mjs` which builds the SessionStart capsule from live GitHub state. Semantic edges come free: `Closes #N` in PR bodies auto-links work to releases, sub-issues give goal→task hierarchy, and the timeline records who changed what when. Staleness and escalation come free too — `.github/workflows/os-age-queue.yml` (daily cron) comments on any `prez-gate` issue untouched for >3 days and escalates to Discord, and GitHub's own notification/email machinery nags without any code at all. `/os/*.md` survives only for long-form reasoning, linked from the issue that owns it.

**Pros**

- Single universe: the 366 PRs already live in GitHub, so work, review, release, and work-item all become queryable from one place with automatic cross-links — exactly the 'semantic connections' D6 asks for, for free.
- Survives laptop loss the day it lands. Directly attacks U3/F1 dark state with no new code.
- The ageing/escalation problem (F2, the audit's defining gap) is solved by infrastructure Dime already pays for, not by a mechanism Dime must maintain.
- Cheapest to build of the real options — templates, labels, and one cron workflow.
- `gh` is already authenticated and already used by the existing `bootstrap-dime-context.sh` capsule.

**Cons**

- Context becomes unreadable from a checkout. Every subagent, every fresh-context verifier, every offline session loses the company's state — and the repo's own doctrine wants a fresh-context verifier to sign certification.
- Issue templates are suggestions, not gates. There is no CI equivalent of `--check`: nothing can fail when a goal issue has no owner or points at a nonexistent parent. The 2026-07-28 program failed at exactly this — good discipline, zero enforcement.
- D6 says preserve reasoning, not only conclusions. Issue bodies and comments are editable in place with no diff review; a markdown file in git is versioned, reviewable, and tamper-evident by default.
- Doubles the write surface for one human: an artifact must now exist as both a document and an issue, or the reasoning and the work-item drift apart.
- Rate limits and auth make retrieval fail in exactly the environments that most need it, and `gh` failures in a SessionStart hook degrade to no context at all.
- Zero current adoption means this is a pure new-habit bet — the constraint list says anything requiring sustained manual human effort will not survive.

**Doctrine fit:** Strong on D6 semantic connections and on D5's 'open loops fail silently' (notifications are real escalation). Weak on D6 'comprehensible after the original participants are gone' and 'preserve reasoning' — mutable comment threads are the weakest form of decision record. Fails the D15 #3 correction in spirit: it creates shared records but they are not durable in the git sense and not linked to goals by anything enforced. Fails context parity for any agent without network. D14-neutral.

### C — Persist the loop ledger to TiDB and expose a context router

**Effort:** XL · **Risk:** high

Salvage the strongest primitive Dime owns. Commit `shared/loop/envelope.ts` + `ledger.ts` + `queries.ts`, add a `loop_artifacts` table (append-only: `artifactId` PK, `seq`, `prevChainHash`, `chainHash`, `artifactType`, `producer`, `entityRefs` JSON, `sources` JSON, `payload` JSON, `createdAtMs`) via the manual `db-push.yml` workflow, and wire the JSONL writer that is implemented, tested, and never called. Emit artifacts from the six `cron-*.yml` endpoints (closing F7.1 — no cron writes a run record today), from PR merge via a workflow, and from session end.

Retrieval becomes a tRPC router `server/routers/os.ts` with `byGoal`, `byOwner`, `byLoop`, `sinceMs`, `outcomeFor` procedures returning the existing `QueryPoint` shape, plus an owner-only `/admin/os` page under `design-system/dime-ai/MASTER.md`. Sessions retrieve by calling the deployed API. First fix required: `server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts` from `drizzle/dime.schema`, which has no such export — the tree does not typecheck.

**Pros**

- Unifies governance state with runtime state in one store, so 'what happened after' is genuinely answerable — the outcome data (grading records, cron runs, Stripe events) is in the same place as the intention.
- The primitive is real, adversarially tested (32/32), tamper-evident with a prev-hash chain, and refuses fabricated hashes and unresolved citations. It is the only Level-4-quality asset the audit found.
- Kills F1.5 as a side effect: cron runs and job outcomes stop being ephemeral Railway stdout.
- Scales to volumes a markdown index cannot (millions of grading records).
- Rescues work that would otherwise be lost, which is the U3/F1 remediation the audit says must come first.

**Cons**

- Answers nothing until emitters exist everywhere. It is an infrastructure project whose first useful query is many steps away — the precise shape of the 2026-07-28 failure, at larger scale.
- Requires a schema change (owner-gated, db-push-first) before it can store one row, and a deploy before it can answer one question.
- Couples the company's memory to production availability and `DATABASE_URL`. A fresh-context agent, a subagent, or an offline session gets nothing — and governance context should not have a production dependency.
- The working tree does not typecheck today, so step zero is repair work before any design value appears.
- Adds a durable moving part that can rot unobserved, against the explicit YAGNI constraint.
- Doctrine D14 violation risk: this is building a capability before the visibility that would catch it failing.

**Doctrine fit:** Best possible fit on D6's 'linkable to later results' and on D12-L2 artifact integrity — the prev-hash chain is genuinely better than anything else available. But it inverts D14: the sequence is explicit that visibility comes first, and this spends the whole build before producing any. Fails D15 #6 in practice (retrieval requires infrastructure, so agents will keep grepping instead). The right answer eventually; the wrong answer now.

### D — On-demand derived context, no schema, no committed index, no gate

**Effort:** XS · **Risk:** medium

Add exactly one file: `scripts/os-context.mjs`. On invocation it parses `os/**/*.md` headings, `INCIDENTS.md` `## Incident N` blocks, `git log --since` over `os/` and `docs/`, and (when `gh` is authenticated) `gh pr list --json`, caching to a gitignored `.os-cache/`. It infers owner and status from conventional heading text and heuristics rather than declared fields. Sessions call it from a SessionStart hook; agents call it ad hoc. Nothing is committed, nothing is validated, no CI job exists, no frontmatter is required.

**Pros**

- Literally cannot go stale — it is rebuilt from source on every call, which is the strongest possible answer to 'currency beats completeness'.
- Zero maintenance burden and zero adoption cost: no new convention any human must follow, no gate that can block a merge, no generated file that can conflict.
- Smallest possible surface — one script — so the thing that could rot barely exists.
- Immediately useful against today's untracked corpus without waiting on any authorization.

**Cons**

- Nothing can fail. A dangling reference, an artifact with no goal, or a decision with no owner is invisible — the failure mode that killed the last program, reproduced exactly.
- Cannot flag staleness in the sense L3 means it: 'past its review date' requires a declared review date, and there is no place to declare one.
- The answer is not an artifact. It is not citable, not reproducible, not reviewable, and not comprehensible after the fact — a direct D6 violation.
- Heuristic owner/status inference will be wrong silently, which is worse than absent: agents will act on a confidently wrong retrieval.
- No semantic edges. 'Which evidence caused this to be prioritized' is unanswerable because nothing records it in a machine-readable place.

**Doctrine fit:** Satisfies D6 currency and D15 #6 (goal-based, bounded retrieval) and nothing else. Fails D6's artifact law outright — the retrieval layer produces no durable evidence. Fails D12-L3's requirement to flag staleness. Fails D15 #3: work remains unqueryable in any enforced sense. Its one genuine doctrinal contribution — derive currency, never assert it — is worth stealing.

## Recommendation

**A — The OS Index**

A wins on the one criterion that has actually predicted survival in this repo: it is enforced by a blocking CI check, and it works from a bare checkout.

Against B: B's context cannot be read without network and auth, which disqualifies it for subagents, offline sessions, and the fresh-context verifier that doctrine §17 requires to sign certification. Worse, GitHub issue templates are suggestions — there is no `--check`. The 2026-07-28 program had rigorous discipline and no machine checking it, and it died in eight days. Adopting Issues as the work-item store bets the entire L3 layer on a habit, for a founder who has opened zero issues in 366 PRs. B's genuine advantage is escalation, and that is separable — so A steals it.

Against C: C is the right destination and the wrong first move. It cannot answer a single question until a schema change ships, emitters are wired across six cron endpoints, and the tree typechecks again. D14 is law here: visibility before autonomy. Building the ledger service before the file layer is legible repeats the exact failure the audit names as the mission's central lesson — and it puts the company's memory behind a production dependency, so a broken deploy would also blind the operating system.

Against D: D's neglect is silent. It cannot fail, which sounds like a virtue and is the defect — a dangling goal reference, an artifact with no owner, an `outcome:` never observed all pass invisibly. And it produces no artifact, so its answers cannot be cited in the certification evidence that Stage 6 demands.

A is also the smallest thing that satisfies all seven L3 questions the doctrine enumerates: `evidence[]` answers which evidence caused prioritization; `supersedes` answers which decisions changed the plan; `status` answers which tasks remain incomplete; the PR-body id plus `outcome:` answer which release attempted the fix and what happened after; a `lesson` artifact with `supersedes` answers which assumptions were disproved; `owner` answers who owns the next action. Nothing else on the list answers all seven without adding a service.

**Grafted from the runners-up**

- From B — GitHub's notification engine as the escalation channel, bounded to one issue. `.github/workflows/os-nightly.yml` opens and updates exactly one issue titled `OS staleness report` (label `os-staleness`) listing stale and awaiting-prez rows, and posts its summary line to the existing Discord webhook. This is the honest, bounded answer to 'does Dime start using GitHub Issues': yes, for one bot-owned nag, not as the work-item store. It commits nothing, because a bot commit to main is a production deploy under §19.
- From B — the PR↔artifact edge. `.github/pull_request_template.md`'s existing 'Linked incident / finding' section is retightened to require an OS id (`GR-`/`LOOP-`/`DR-`/`INC-`) or an explicit `none`, and `os-index.mjs --check` reads the PR body from `$GITHUB_EVENT_PATH`. Graduated per PR #362's ROLLOUT: WARNING for one clean week, then blocking. This is what makes 'which release attempted the fix' answerable from git alone.
- From D — currency is derived, never asserted. `last_touched` comes from `git log -1 --format=%cI -- <path>`, not from a hand-typed `updated:` field, so a stale artifact cannot lie about its own freshness. A `currency: "mtime-fallback"` flag marks the degraded case rather than hiding it.
- From D — the on-demand refresh path. `.os-cache/pr-index.jsonl` is gitignored and rebuilt by `os-query --refresh` when `gh` is available, so live GitHub state accelerates queries without ever becoming a committed thing that can rot.
- From C — vocabulary alignment so the eventual merge is free. The frontmatter `kind` enum and the `QueryPoint {state, value, reason, evidence}` return shape are taken verbatim from `shared/loop/envelope.ts` and `shared/loop/queries.ts`. When the ledger is finally persisted, `os-query.mjs` gains a `--ledger` source and both answer in one vocabulary behind one surface. This is a bridge, not a build — zero cost today, and it prevents the two-incompatible-realities failure D4 forbids.

## Requested ruling

**Ruling requested:** Adopt Option A — the OS Index — as Dime's L3 retrieval layer, and reject GitHub Issues as the work-item store.

Concretely, approve: (1) mandatory YAML frontmatter on every `/os/**/*.md` artifact with the 11 declared fields; (2) `scripts/os-index.mjs` generating a committed `os/INDEX.json` + `os/INDEX.md`, with `--check` wired as a new `os-context` job in `.github/workflows/ci.yml`; (3) `scripts/os-query.mjs` as the retrieval interface, returning the `QueryPoint` honesty shape; (4) a third `SessionStart` hook `.claude/scripts/os-context.sh` registered in `.claude/settings.json`, plus one sentence added to `.claude/scripts/prompt-capsule.sh`; (5) `.github/workflows/os-nightly.yml` maintaining exactly one GitHub Issue (`OS staleness report`) and one Discord line — committing nothing; (6) retightening the `Linked incident / finding` section of `.github/pull_request_template.md` to require an OS id or explicit `none`.

**A yes commits you to five things:**

1. **Every new `/os/` artifact carries valid frontmatter, or CI goes red.** Structural errors only — schema violations, duplicate ids, dangling `goal`/`evidence`/`supersedes` references, and an out-of-date `os/INDEX.json`. Staleness never blocks a merge.
2. **Adding `OS Context Index` to `main`'s required status checks** during PR #362's Wave 1 ruleset update (one owner action; the check is advisory and therefore toothless until you do — the same defect as `DB Tests` and `Build & Preview Gate` today).
3. **A bot-maintained GitHub Issue that will nag you** every night with the count of stale and awaiting-prez items, plus a Discord line. This is the mechanism; muting it defeats the DR.
4. **NOT migrating work items to GitHub Issues.** PRs plus `/os/` markdown remain the work record. Issues are used for exactly one bot-owned report.
5. **Setting a real `review_by` date on every artifact you author.** A blanket +365d silently disables the staleness half of this layer; only the git-derived `last_touched` resists it.

**A no requires you to pick the alternative**, because L3 cannot be deferred: it is the prerequisite the audit's own sequencing names, and every artifact created before it exists becomes more dark state.

## Depends on

- DR-003 — HARD BLOCKER. Authorization to push `local/audit-mlb-model-2026` and commit the AI-native program and the `/os/` tree into git. `/os/` does not exist in the live repo today (verified: `ls /Users/danielwalker/src/ai-sports-betting-dime-ai/os` → No such file or directory); it lives only in the mission scratchpad. There is nothing durable to index until DR-003 lands. Everything in DR-007 is inert without it.
- DR-006 — the L2 artifact-system record. DR-007's frontmatter `kind` enum and its required-field set must be exactly the record types DR-006 defines. If DR-006 lands a different vocabulary, this DR's schema follows it rather than the reverse — the index describes the artifact system, it does not define it.
- DR-005 — first-loop selection. Determines which `LOOP-*` ids exist, and therefore what the first real `os-query --loop` invocations return. Until DR-005 rules, the `loop` frontmatter field is structurally valid and semantically empty.
- DR-004 — the orchestration-spine ruling. DR-007 assumes the 'substitute with repo-native mechanisms' answer. If Prez adopts the externally-named stack instead, retrieval may need to move to that system's context surface and this DR should be re-argued rather than layered on top.

## Open unknowns

- Whether `main`'s ruleset can accept a new required check without disturbing PR #362's staged Wave 1/2 rollout. PR #362's own open items say ruleset changes are Wave 1 and owner-gated, and that merge queue enablement follows. UNKNOWN whether adding `OS Context Index` now conflicts with that sequence. *Resolves via:* `gh api repos/aisportsbettingcontact/ai-sports-betting-dime-ai/rulesets` plus a read of `docs/verification/RULESETS.md` on branch `ci/verification-framework`.
- Whether the ageing/escalation mechanism belongs to DR-007 at all. F2 ('silence is invisible') is rated HIGHEST priority in the gap map and is plausibly the subject of a sibling decision record. If it is, the `os-nightly.yml` staleness issue and the Discord line move there, and DR-007 keeps only the `review_by` field, the derived `last_touched`, and the INDEX banner as that DR's inputs. *Resolves via:* Prez confirming the Stage 2 DR roster and which record owns escalation.
- Whether `.github/workflows/os-nightly.yml` can call the Discord webhook at all. F1.6 verified the bot holds `GatewayIntentBits.Guilds` only and is write-only — adequate for posting, but nothing can read back whether the message was seen or acted on, so the Discord half of the escalation is unobservable by construction. *Resolves via:* accepting the GitHub Issue as the observable channel and Discord as best-effort, or wiring a read path (out of scope here).
- The `INCIDENTS.md` id derivation is fragile. Incident 1 is unnumbered (`## 2026-07-11 — …`), 2–61 use `## Incident N — YYYY-MM-DD — title`, and F6.8 verified two concurrent sessions both allocated 41–43 with no allocation mechanism. The index will therefore key on `inc-<date>-<slug>` and emit a duplicate-number WARNING rather than trusting N. UNKNOWN whether Prez wants the index to become the allocator (it could reserve the next free number in `--check`), which would make it load-bearing for incident filing. *Resolves via:* a ruling on whether number allocation is in scope.
- Whether `os/INDEX.json` merge conflicts will be tolerable at ~13 merged PRs/day. It is a generated file, so resolution is mechanical (`node scripts/os-index.mjs` and re-commit), but at this throughput it will happen often. Mitigation not yet chosen between: sorting rows by id for minimal diffs, splitting the index per `kind`, or generating it in CI and committing from the PR branch. *Resolves via:* measuring conflict frequency over the first week and picking then — deliberately deferred rather than guessed.
- Whether the SessionStart hook budget is already spent. Two `SessionStart` hooks exist (`bootstrap-plugins.sh` at 300s, `bootstrap-dime-context.sh` at 45s). A third adds latency to every session start; the index read itself is milliseconds, but the `git log` calls per artifact are not free at scale. UNKNOWN what row count makes it noticeable. *Resolves via:* caching `last_touched` in `os/INDEX.json` at generation time (CI does the `git log` work) so the hook only reads JSON — this is the intended implementation and should be verified under load before the hook is registered.

