# DR-011 — The founder dashboard: a CI-generated artifact with GitHub-native escalation, not a React route

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**Doctrine:** §13 D13 — Function loops, Founder/company level: state derived from underlying artifacts, never summaries-of-summaries; surfaces contradictions · §13 D13 — Revenue: the dashboard never shows a number without explanation · §6 D6 — The queryable company: artifact law, seven artifact properties, semantic connections, dashboards as structured queryable state, context parity and gap-reporting · §8 D12-L2 — Artifact system: no critical organizational state exists only in memory · §8 D12-L3 — Queryable context: retrieval by goal/owner/outcome; currency beats completeness, flag staleness · §8 D12-L6 — Evaluation: a generated artifact is not success · §8 D12-L7 — Memory: lessons attach to the process, retrieved automatically · §5 D5 — The closed loop: an open loop fails silently when inputs shift; generation is the beginning of execution, never proof of success · §14 D14 — Visibility before autonomy, evaluation before scale (stages 4, 5, 7) · §11 D10 — Token-maxing economics: the six ledger questions · §15 D15 — Failure modes 2 (open-loop automation), 3 (unqueryable work), 9 (generated output mistaken for completion) · §19 — Standing Dime rules: evidence taxonomy, design system (design-system/dime-ai/MASTER.md), deploy law (merge to main IS a production deploy)

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

Where does the founder dashboard live and what regenerates it — a new route in the existing React admin app, a generated artifact in /os/, a CI-published static page, or a published Artifact page — and what does it show in v1?

## Why this is contested

Both sides have real arguments and the repo has already lost this decision once. FOR the admin app: it is the only surface that already has owner auth (RequireOwner + ownerProcedure), locked brand law, chart theming, and — uniquely in this repo — a shipped anti-fabricated-zero metric contract (server/analytics/metricDefinitions.ts, MetricState = ok|not_measured|incomplete|stale|unknown). A founder actually looks at a page; nobody browses to a markdown file. AGAINST it: the founder loop's inputs mostly do NOT live in TiDB. Priority-vs-activity lives in git and the GitHub API; cadence-vs-observed lives in Actions run history; gate posture lives in production DB; price coherence lives in source files. A React panel would need a server-side GitHub token and new production endpoints, and every change to it is a production deploy on a surface with exactly one user. FOR a generated artifact: it is diffable (git log of company state), readable by every agent with no auth, and adds a file format plus a CI job rather than a service. AGAINST it: docs/ai-native/operating-brief.md is EXACTLY this idea, declared itself "regenerable from canonical artifacts," had no generator, and is now 8 days stale with a wrong item 3. A generated artifact with no generator and no reader is how the 2026-07-28 program died. So the real contested question is not "page or file" — it is "what mechanism makes the dashboard's own neglect loud," and each option answers that differently.

## Options

### A — Panel: new React route /admin/os in the existing admin app

**Effort:** L · **Risk:** medium

Add {key:"os", path:"/admin/os", group:"System"} to client/src/pages/admin/adminNav.ts, a new client/src/pages/admin/OsDashboard.tsx wrapped in AdminShell + RequireOwner (App.tsx route), and a new server/routers/os.ts of ownerProcedures feeding 8 panels. Panels return the existing MetricPoint {state,value,reason} shape from server/analytics/metricDefinitions.ts so no number can render as a fabricated zero. Reuses StatTile.tsx, SectionHeader.tsx, chartTheme.ts and the locked tokens (#000000 base, mint #45E0A8 sole accent, Familjen Grotesk + IBM Plex Mono, 160ms motion) from design-system/dime-ai/MASTER.md. Repo/CI facts (PR ages, required-check status, cron run history) require a new server-side GitHub token env var and an octokit call path; Railway deploy state requires a Railway API token in production env.

**Pros**

- Reuses the four things this repo already has and nothing else does: owner auth at route AND data layer, brand law, chart theme, and the anti-fabricated-zero metric contract
- Live DB reads are trivial — revenue, publish_* verdicts, graded rows, CLV-NULL counts are all one Drizzle query away with no new secret
- A founder plausibly opens it; it is one click from /admin, which he already uses
- Panel-level tests fit the existing MetricsPanel.test.ts / adminNav conventions

**Cons**

- Rots fastest and rots silently. A panel whose query breaks renders an empty card; nothing anywhere goes red. That is the failure mode this whole mission exists to kill
- Every dashboard change is a merge to main and therefore a PRODUCTION DEPLOY of the customer-facing app, for a surface with one user
- Not agent-queryable. An agent cannot read a React page; the founder dashboard becomes the one company artifact the intelligent layer cannot retrieve — a direct D6 violation
- Requires putting a GitHub token AND a Railway token into production Railway env to see repo/CI/deploy state. CLAUDE.md's shared-agent-access law explicitly forbids placing Railway variables into agent-reachable environments, and it widens the production attack surface for a read-only convenience
- No history. A page shows now; it cannot answer "what changed about the company since Tuesday"
- Highest effort by a wide margin, and the effort is in the least durable layer (JSX)

**Doctrine fit:** D6 dashboards: PARTIAL — structured and connected, but not accessible to the intelligent system. D13 founder loop: WEAK — cannot see engineering activity or CI without new production tokens. D14 visibility-before-autonomy: FAILS the spirit — the visibility surface itself has no visibility into its own health. §19 design system: STRONG (inherits MASTER.md natively).

### B — Brief: generator + os/BRIEF.md artifact, no delivery mechanism

**Effort:** M · **Risk:** medium

scripts/os/generate-brief.mjs reads four source adapters (scripts/os/sources/{repo,github,liveApp,db}.mjs), runs pure check modules in scripts/os/checks/, and renders os/state/company-state.json + os/BRIEF.md. .github/workflows/os-brief.yml runs it daily and on workflow_dispatch and commits the output. Checks are pure functions over a facts object, unit-tested with fixtures exactly like metricDefinitions.ts is today.

**Pros**

- Agent-queryable by construction — every Claude Code / pi session can cat one file and know company state
- Diffable: git log os/BRIEF.md is a real time series of company state, derived from artifacts rather than summaries
- Adds a file format and a CI job, not a service, a daemon, or a vendor — the cheapest possible shape under the YAGNI constraint
- Zero production code, zero schema change, zero new secret if the DB source is deferred
- The generator existing at all closes F2.2 — the exact defect where operating-brief.md claimed to be regenerable with no generator

**Cons**

- This is 90% of what already died. A markdown file nobody is obliged to open is precisely how five owner-gated items sat untouched for 8 days while 350 commits landed elsewhere
- No mechanism makes its own staleness loud. If the generator breaks, the last good brief sits there looking authoritative — worse than no brief
- If it commits to main, every run is a Railway production deploy and it must dodge its own push trigger; if it commits elsewhere, discoverability drops further
- Contradictions get computed and then, like the ~2,500 lines of dead evaluation tooling and mlbPublicationGate's SAFE_TO_PUBLISH verdict, authorize nothing
- No pretty view; no charts

**Doctrine fit:** D6 artifact law: STRONG. D12-L3 queryable context: STRONG. D5 closed loop: FAILS at Outcome — generation is the beginning of execution, never proof of success, and this option stops at generation. D13 surfaces contradictions: computes them, does not surface them.

### C — Brief + Bell: generated artifact on an orphan os-state branch, GitHub-issue escalation, and a freshness check with teeth ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

Option B's generator and pure-check modules, plus three things that give it consequences. (1) SINK: the run pushes only to an ORPHAN branch os-state (git push origin HEAD:os-state) holding BRIEF.md, company-state.json, contradictions.json — Railway watches main, so zero deploys, zero interference with the 4 required checks, and full git history of company state. Agents read it with `git fetch origin os-state && git show os-state:BRIEF.md`, aliased as `pnpm os:brief` and named in CLAUDE.md/AGENTS.md. (2) BELL: every CONTRADICTED check opens or updates one GitHub issue labeled os:contradiction, assigned to Prez (the first issues ever opened in this repo, closing F1.4); the daily run re-comments at day 3 and retitles [AGED Nd] at day 7; a one-line Discord webhook post reuses the existing write-only alert path. (3) TEETH: scripts/os/check-brief-fresh.mjs fails when os-state's company-state.json is older than 36h; it joins ci.yml advisory for two weeks, then graduates to a required check on main per the ROLLOUT wave pattern PR #362 already establishes. A broken generator therefore turns Prez's merges red — binding the dashboard's liveness to the one thing he does 13 times a day. Each brief is also appended to os-state:ledger.jsonl through shared/loop/ledger.ts as an evaluation_report artifact built by shared/loop/envelope.ts makeArtifact, giving that tamper-evident, adversarially-tested, never-called primitive its first production caller; because contentHash excludes createdAtMs, an unchanged brief DEDUPLICATES, so ledger length equals the number of real company-state changes.

**Pros**

- Solves the actual failure mode: neglect becomes loud automatically, through GitHub's own notification machinery, with no new service and no sustained human effort
- The freshness gate makes the dashboard un-ignorable without requiring Prez to remember anything — the only enforcement lever proven to work on him is a red check on a PR
- Orphan-branch sink means the hourly/daily bot commits never touch main, never deploy, never conflict, and never re-trigger themselves
- Turns shared/loop/envelope.ts + ledger.ts from the repo's best dead code into shipped infrastructure — and the dedupe property makes 'company state did not change today' a first-class, cheap fact
- Every panel and every check is a pure function over a facts object, unit-testable with fixtures, no DB, matching the metricDefinitions.ts pattern the repo already trusts
- Fully agent-queryable and fully diffable; adds one workflow, one orphan branch, and ~9 script files
- Opens the door for a v2 renderer at /admin/os that is a dumb JSON reader with zero query logic — earned by evidence, not assumed

**Cons**

- Three moving parts instead of one: a workflow, an orphan branch, and an escalation path. Each can rot, though the freshness gate is designed to catch the first two
- Requires GitHub issues to actually be read. Zero issues have ever been opened here; this is a behavioral bet, not a technical one
- A required freshness check is real friction — if the generator is flaky it blocks merges. Mitigated by failing only on artifact staleness, never on source-fetch failures (those render as unknown with a reason), plus the two-week advisory wave
- Markdown/JSON only in v1 — no charts, no visual hierarchy beyond headings
- Revenue and model panels ship as honest not_measured until a scheduled read-only DB read is authorized (that authorization is the second half of the ruling)
- The orphan branch is slightly unusual and needs one line of documentation so nobody looks for the brief on main

**Doctrine fit:** D13 founder loop: STRONG — connects strategy (goal records), execution (GitHub API), operations (cron cadence), revenue and model posture (DB, gated), and agent economics, and mechanically surfaces contradictions across them. D6: STRONG — durable, linked, agent-accessible, every number carries its source and evidence ids. D5: CLOSES — computation produces an issue, an assignee, an age, and an escalation, so evaluation reaches action. D14: CORRECT ORDER — pure visibility, zero autonomy, zero new agent authority. D12-L7: lessons attach to the process because contradiction ids persist across runs with a real since-date.

### D — Published page: brand-law HTML rendered by CI, or a published Artifact

**Effort:** S · **Risk:** high

The same generator emits a self-contained HTML page styled from design-system/dime-ai/MASTER.md (pure black, mint accent, Familjen Grotesk + IBM Plex Mono, no gradients), published either as a workflow-run artifact, to GitHub Pages, or — for a hand-run version — via the Artifact tool as a private claude.ai page.

**Pros**

- Prettiest per unit effort; charts and hierarchy are free once you are writing HTML
- No production deploy, no app route, no server code, no auth plumbing
- A workflow-artifact HTML costs almost nothing to add on top of any generator

**Cons**

- GitHub Pages on this repo is a leak surface: it would publish revenue, model publication verdicts, and blocked-decision state to a public URL. Disqualifying as a primary sink
- A workflow-run artifact must be downloaded from a run page — strictly worse discoverability than a file or an issue
- The Artifact tool cannot be driven from CI. It needs a session and an agent to republish, which is sustained manual effort — the exact thing the constraints say will not survive; it also puts the company's state artifact outside git, recreating the dark state F1 exists to end
- HTML is markedly worse than markdown/JSON as agent context
- No history, no diff, no dedupe

**Doctrine fit:** D6: FAILS on accessibility-to-the-intelligent-system and on durability if published out-of-repo. §19 design system: STRONG. D13: neutral — the contradiction logic is identical; only the sink is worse. Salvageable only as a secondary render, never as the system of record.

## Recommendation

**C — Brief + Bell: generated artifact on an orphan os-state branch, GitHub-issue escalation, and a freshness check with teeth**

The dashboard's hard problem here is not rendering, it is consequence. Option A is the prettiest and the one whose breakage is invisible; Option B is the one this company already built, already shipped as a claim, and already let go stale for 8 days; Option D puts company state outside git or on a public URL. C is the only option whose failure mode is loud: if the generator stops, os-state stops moving, check-brief-fresh goes red, and Prez's next merge — one of roughly 13 that day — tells him. That binds the visibility layer to the single behavior that is empirically constant at this company, which is the only kind of mechanism that survives a one-founder org. C also happens to be the cheapest durable option: one workflow, one orphan branch, ~9 pure script files, zero production code, zero schema change, zero new service or vendor, and it retires two live defects on the way (F2.2's generator-that-does-not-exist and F1.4's zero-issues-ever). Its second-order payoff is that it gives shared/loop/envelope.ts and ledger.ts — the best primitives in the repo, adversarially tested, imported by nothing — a real production caller, with the contentHash dedupe turning 'nothing changed' into a cheap first-class fact instead of an indistinguishable rewrite. V1 SHOWS NINE PANELS, in this order. (1) CONTRADICTIONS, oldest first — the six live checks: C1 priority-vs-activity (a P0 goal record in os/goals/GR-*.md whose declared paths glob was touched by 0 of the last 14 days of merged PRs, from gh pr list --json files); C2 verdict-vs-published (mlb_calibration_constants publish_* = BACKTEST_ONLY intersected with the markets the live feed actually serves — the U1 exposure, DB-gated); C3 declared-vs-observed cadence (each .github/workflows/cron-*.yml schedule expression versus gh run list counts for the last 24h and 7d — F7.3, free, no secret); C4 blocked-queue ageing (every os/decisions/DR-*.md with status awaiting-ruling and every owner-gated loop next-action, with real age in days carried forward from the prior run's contradictions.json, never recomputed as today — F2); C5 generated-claim integrity (any os/ artifact whose front-matter declares generated_by must have that generator present and have run inside its max_age_hours — the mechanized version of the operating-brief.md defect); C6 price coherence (client/src/pages/dime/landing/landing-content.ts checkout tiers vs the objections copy on the same page vs the schema.org JSON-LD in server/landingPrerender.ts — U2, pure file parse). Plus two declared-but-not-measured: C7 spend-vs-outcome and C8 recurring-objection-the-plan-omits, each naming the exact action that would make it measurable. (2) BLOCKED ON PREZ — open decision records with age and what each ruling unblocks. (3) GOALS — each goal record's outcome, DRI, target metric, current value from the source that metric names, and days since the value last moved. (4) EXECUTION — merged/open PRs, age of the oldest open PR, required-vs-advisory check inventory (DB Tests and Build & Preview Gate flagged advisory until they are not), deploy-smoke pass history. (5) OPERATIONS — per-cron declared vs observed, last success, plus the live /api/cron/status snapshot via the existing CRON_SECRET. (6) MODEL & PUBLICATION POSTURE and (7) REVENUE — DB-gated; in v1 they render not_measured with the exact reason and the exact unblocking action. (8) AGENT ECONOMICS — not_measured, reason 'ai_workflow_costs table absent; db-push.yml not run; server/_core/aiCostMeter.ts does not currently typecheck'. (9) PROVENANCE FOOTER — generator commit sha, run id, per-source fetch time and staleness, and every source that FAILED to read, never silently dropped. Every panel value is a QueryPoint {state, value, reason, evidence[]} reusing the vocabulary already shipped in server/analytics/metricDefinitions.ts and shared/loop/queries.ts, which is how D6's 'never a number without explanation' is enforced mechanically rather than by discipline. CONTRADICTION-SURFACING MECHANICS, precisely: each check is a pure module exporting {id, question, severity, slaDays, evaluate(facts)} returning {verdict: HOLDS | CONTRADICTED | not_measured, sides:[{claim, source, value}], detail, evidence[]}. A contradiction is always two named sides from two different sources that a stated rule says cannot both be true — never a vibe. contradictions.json carries firstSeen per id so age is real; the workflow exits nonzero and opens/updates the issue when any CONTRADICTED check exceeds slaDays. TRIGGERS: schedule 12:00 UTC daily, workflow_dispatch, and pull_request when os/** changes (dry-run, rendered into the check summary, no push). A weekly os-brief-deep run adds the read-only DB source behind a fixed query allowlist modeled on the existing db-query.yml (no free-text SQL, read-only, never selects customer rows).

**Grafted from the runners-up**

- From A: the {state, value, reason} anti-fabricated-zero contract from server/analytics/metricDefinitions.ts becomes the JSON schema of every panel value in company-state.json — the honesty primitive travels, the React does not.
- From A: defer, do not delete, the route. V2 adds one line to client/src/pages/admin/adminNav.ts and a client/src/pages/admin/OsDashboard.tsx that fetches company-state.json and renders it with StatTile/SectionHeader/chartTheme under MASTER.md — a dumb renderer with zero query logic, so the generated artifact stays the single source of truth. Shipping it should require evidence Prez opens the brief, not an assumption that he will.
- From D: have the same generator emit an optional self-contained brand-law HTML render attached to the workflow run (scripts/os/render-html.mjs, --html flag). Costs almost nothing, gives a pretty view on demand, and is never the system of record.
- From B: nothing extra — B is a strict subset of C, which is exactly why C's added parts are the whole argument.

## Requested ruling

Ruling requested on two coupled questions. (1) Do we build the founder dashboard as a CI-generated artifact — os/BRIEF.md + company-state.json + contradictions.json on a new orphan branch os-state, produced by scripts/os/generate-brief.mjs via .github/workflows/os-brief.yml, escalating through GitHub issues labeled os:contradiction assigned to you — with NO React admin route in v1? (2) Do you authorize a scheduled, read-only, fixed-query-allowlist production TiDB read (weekly os-brief-deep.yml, same pattern as the existing db-query.yml: no free-text SQL, no customer rows selected) so the revenue and model-publication panels carry real numbers instead of not_measured? A YES commits you to: (a) the hand-authored os/ records — goals, loops, decision records — landing on main, which depends on DR-003; (b) one new workflow, one orphan branch, ~9 new script files, and unit tests — zero production code, zero schema change, zero new service or vendor, zero Railway variable movement; (c) GitHub issues going live for the first time in this repo, with contradiction issues auto-assigned to you and re-notifying at day 3 and day 7 — you will get pinged, and silencing a contradiction will require closing it with a reason that the next run reads; (d) scripts/os/check-brief-fresh.mjs joining ci.yml as ADVISORY for two weeks and then, per the PR #362 ROLLOUT graduation pattern, becoming the fifth REQUIRED status check on main — meaning a broken brief generator will block your merges, which is the deliberate teeth of this design and the part to say no to if you do not want it; (e) on question 2 specifically, a scheduled workflow holding the DATABASE_URL secret on a recurring rather than manual trigger — if you say no, panels 6 and 7 ship as not_measured with the exact reason and the brief says so out loud; (f) no /admin/os route in v1 — it is deferred to v2 as a dumb renderer of the same JSON, and shipping it requires evidence you actually read the brief.

## Depends on

- DR-001
- DR-002
- DR-003
- DR-005

## Open unknowns

- UNKNOWN: whether Railway's deploy watch is strictly branch main. The entire zero-deploy property of the os-state orphan branch rests on it. Resolves via one read-only Railway MCP get-service-config on both services in project stunning-creativity BEFORE the first automated push; if either service watches all branches, the sink must change to a workflow artifact plus issue body and the design loses its git-diff history.
- UNKNOWN: whether TiDB Cloud can issue a read-only user scoped to the fact queries. If not, the weekly deep run holds the full-privilege DATABASE_URL on a recurring schedule rather than the current manual-dispatch-only exposure. Resolves via one TiDB console check; if no, recommend deferring question 2 and leaving panels 6/7 not_measured rather than widening standing credential exposure.
- UNKNOWN, and behavioral not technical: whether GitHub issue notifications actually reach Prez. Zero issues have ever been opened in this repo across 366 PRs. Resolves by instrumenting it — the brief records time-to-first-acknowledgement per contradiction issue, so within two weeks the escalation channel is evaluated by the same artifact it feeds. If the answer is no, the escalation moves to a PR-blocking check or a Discord ping and the brief records that it moved and why.
- UNKNOWN: the exact front-matter field names for os/goals/GR-*.md and os/loops/LOOP-*.md. Checks C1 and C4 parse them (priority, paths glob, target metric, status, owner-gated flag, since-date), so they cannot be written until the record-schema decision record lands. That sibling Stage-2 record is not yet numbered; C1/C4 are the only two checks blocked on it — C3, C5, C6 ship without it.
- UNKNOWN: whether v1's contradiction set is the right six. C1 (priority-vs-activity) is the one most likely to produce false positives, because a paths glob is a crude proxy for whether work served a goal. Proposal: C1 launches at severity WARNING with no SLA for the first two weeks and graduates only after its precision is reviewed against actual merged work — mirroring the calibration discipline PR #362 already applied to its 41 noisy semgrep findings.
- CANNOT BE ANSWERED IN V1: D13's 'a recurring objection the plan omits.' There is no customer-evidence corpus to mine — Discord is write-only (bot has GatewayIntentBits.Guilds only, F1.6), there are zero GitHub issues, and support conversations produce no artifacts. C8 therefore ships as not_measured naming exactly that. Closing it depends on the support/GTM loop decision record, not on this one.
- CONSTRAINT TO CONFIRM: the freshness gate as a fifth required check cuts against the current deliberate minimalism of four required checks on main, and it interacts with PR #362's own Wave-1 ruleset changes. Sequencing recommendation is to graduate os-brief-fresh only AFTER #362's Wave 1 has been stable for a week, so a red check is never ambiguous about which framework caused it.
- PRE-WORK: the working tree does not typecheck (server/_core/aiCostMeter.ts:20 imports aiWorkflowCosts from drizzle/dime.schema, which has no such export). That is the reason panel 8 reads not_measured in v1, and it must be fixed before any spend number in this dashboard can become real.

