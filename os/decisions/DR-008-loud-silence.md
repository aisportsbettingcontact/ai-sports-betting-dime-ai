# DR-008 — Making silence loud — the ageing and escalation mechanism for open /os/ items (F2)

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**Doctrine:** §5 The closed loop (D5) — 'an open loop fails silently when inputs shift'. F2 is the canonical instance; this record supplies the missing Outcome and Evaluation components for every owner-gated item, and the 48h heartbeat supplies them for the mechanism itself. · §5 nine-question interrogation, Q6 'What happened afterward?' and Q8 'What changed because of the evaluation?' — the two questions no /os/ artifact could answer on 2026-08-05. · §6 The queryable company (D6) — artifact law and the seven required properties. Every renewal, override, and ruling is a git-visible artifact carrying what/when/who/goal; the standing issue makes neglect DURATION queryable after CI logs expire at 30 days (F7.5). · §6 'Minimize invisible consequential state' — an owner-gated item with no expiry is invisible consequential state by definition. · §8 L2 Artifact system — append-only enforcement rather than convention; the INCIDENTS.md adapter links to it without moving or rewriting it, as L2 requires. · §8 L3 Queryable context — 'Currency beats completeness: flag staleness.' The clock is the staleness flag, applied to /os/ itself. · §8 L6 Evaluation — 'a completed action is not a reached objective.' A ruled decision with nothing shipped ages at 14 days precisely to catch this. · §8 L7 Memory + improvement — 'lessons attach to the process.' The clock attaches the deadline to the artifact rather than to a registry, which is why it cannot drift the way loop-registry.yaml and operating-brief.md did. · §8 L8 Human governance — the audit's finding that governance exists as prose in files no machine reads. This is the first executable governance surface in the /os/ tree. · §14 The fifteen-stage sequence (D14) — 'Visibility before autonomy. Evaluation before scale.' This record adds zero autonomy and zero scale; it is stage 4/5 work (map the open loop, create artifacts until the process is legible). · §15 Failure modes (D15) — #2 open-loop automation, #3 unqueryable work, #9 generated output mistaken for completion, and #15 prototype theater ('prototypes live inside closed loops with observed results' — the 2026-07-28 slice did not). · §17 Certification and cadence — monthly recertification and the D15 diagnostic both become `kind: commitment` items with `observe_by` dates, so the cadence itself is aged rather than remembered. · §19 Standing Dime rules — evidence taxonomy (an overdue item is a VERIFIED claim with a date, not a vibe) and deploy law (merge to main IS a production deploy, which is what gives rung 2 its force). · Repo lesson `os/memory/lessons/owner-gated-is-not-a-terminal-state.md` — this record is the executable form of all three of its 'How to apply' clauses. · Repo lesson `os/memory/lessons/gates-must-be-required-to-be-gates.md` — the reason OI-0001 exists and the reason an indefinite advisory period is rejected.

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

What mechanism ages open /os/ items, escalates them on a threshold, and reaches Prez without him remembering to look — a push channel (scheduled job → GitHub issue), a blocking channel (required CI check), both plus the session channel, or a DB-backed watchdog with a dashboard tile?

## Why this is contested

The obvious answer — "add a scheduled job that alerts" — is exactly the class of mechanism that already failed here, twice over. The 2026-07-28 program had a queue file and Discord alerts; five owner-gated items sat 8 days and nothing noticed. F7.3 records that this repo's own crons under-fire and every under-run reports success, and F1.6 records that Discord is write-only (GatewayIntentBits.Guilds — the bot cannot read a message back, so no code can confirm anyone saw anything). A push channel that Prez is free to ignore satisfies the letter of "escalate" and none of the requirement.

The opposite answer — make it a required status check — is the only channel in this repo with proven binding force (branch protection on `main` has `enforce_admins: true`, `strict: true`, 4 required contexts, and merge to main IS a production deploy, so a red required check literally stops the company shipping). But it is also the channel with the highest bypass pressure: removing a context from `main-protection` is one owner API call that leaves no artifact, and the repo already has two gates (DB Tests, Build & Preview Gate) that were demoted to advisory exactly that way (F6.1, and the repo's own lesson file `gates-must-be-required-to-be-gates.md`). A mechanism whose first genuine conflict with an urgent hotfix gets it deleted is worse than none, because it also destroys the lesson.

The third live tension is the noise budget. There are 781 open checkboxes in todo.md, 61 incidents, 9 loops, and 5 stale queue items on day one. Any design that ages all of it goes permanently red on the first run and gets disabled within a day. Choosing what the clock does NOT cover is as load-bearing as the escalation ladder.

And the fourth: whatever is built has the same mortality as everything else here. A daily scheduled workflow can be silently dropped by GitHub (this repo measured a ~93-minute median delivery on a `*/10` schedule and documented it in cron-bet-grade.yml), can be disabled after inactivity, or can be quietly renamed. The watchman needs a watchman, and the only surface in this repo that cannot silently stop is the one that runs on every PR — because if it stops, nothing merges.

## Options

### A — Push only: daily workflow + one standing GitHub issue

**Effort:** S · **Risk:** medium

`scripts/check-os-clock.mjs` (zero-dependency Node; no `yaml` package exists in package.json, so a ~40-line front-matter parser) walks `os/**/*.md`, reads YAML front matter (`id`, `kind`, `dri`, `status`, `opened`, `observe_by`, `observed_at`), computes age, and emits a table. `.github/workflows/os-clock.yml` runs it on `schedule: "0 15 * * *"` (08:00 PT) + `workflow_dispatch` + `push: [main]`, with `permissions: {contents: read, issues: write}`. It creates or updates exactly ONE issue, `os-clock` label, titled `OS clock — N overdue`, body = the overdue table with per-item age and DRI; it closes the issue when nothing is overdue. Escalation = a `os-clock:critical` label plus an @-mention when any item is >7 days past `observe_by`, and a redundant POST to the existing Discord webhook. An INCIDENTS.md adapter parses `Status: OPEN` blocks (they sit at column 0, grep-clean) so incidents 21 and 39 age too. Nothing blocks; CI is untouched; branch protection is untouched.

**Pros**

- Zero merge friction and zero deadlock risk — cannot ever stop a hotfix, so it will never be deleted in anger.
- Smallest surface in the option set: one script, one workflow, one label. Nothing to rot except the workflow itself.
- The standing issue is a genuinely good artifact: it has a timeline, is queryable by `gh issue view`, survives the 30-day CI-log expiry (F7.5), and is a durable record of exactly how long silence lasted — which is the evidence F2 is missing.
- Opens the repo's first-ever GitHub issue, which incidentally starts closing F1.4 (zero issues in 366 PRs) and gives the /os/ tree a real inbox that agents can read.
- Effort is genuinely small and it can ship inside one PR with no ruleset change and no owner action.

**Cons**

- It is passively ignorable, which is the one requirement the brief names as mandatory. Prez has opened zero issues across 366 PRs in 28 days; there is no behavioral evidence he reads the Issues tab, and this design's entire theory of action is that he starts.
- It is the same CLASS of mechanism that already failed: a file that says something is blocked, plus a write-only alert. 2026-07-28 had both and produced 8 days of silence.
- The scheduled job can silently stop — dropped firings (measured ~93-minute median on `*/10` in this repo), workflow rename, GitHub inactivity disablement — and nothing would notice, reproducing F7.3 inside the mechanism built to fix F7.3.
- Discord adds the appearance of escalation with none of the substance: the bot has `GatewayIntentBits.Guilds` only and cannot read messages, so receipt is structurally unconfirmable (F1.6).
- No consequence differentiates rung 1 from rung 3 — a louder label is not an escalation, it is a louder notification.

**Doctrine fit:** Satisfies D6 (the issue is a durable, linkable artifact with time, owner, and goal) and D12-L2. Fails D5 head-on: an open loop that fails silently is not closed by adding a notification nobody is obliged to observe — the Outcome component is still missing, since nothing observes whether the alert changed anything. Fails the D14 test in spirit: this is visibility that carries no obligation. D15 #9 (generated output mistaken for completion) applies to the mechanism itself.

### B — Blocking only: a required "OS Clock" status check

**Effort:** S · **Risk:** medium

Same `scripts/check-os-clock.mjs`, wired as a new job `os-clock` / `name: OS Clock` inside `.github/workflows/ci.yml` alongside the existing `security-audit` / `typecheck` / `test` / `db-tests` / `build` jobs, then added to `main-protection` (ruleset 18701573) as a fifth required context beside `Security Audit`, `TypeScript Check`, `Vitest`, `Secret Scan (gitleaks)`. The check evaluates the PR's head tree: any `/os/` artifact whose `observe_by` has passed fails the job with a `::error::` naming the item, its age, its DRI, and what would close it. No issue, no hook, no scheduled job. Because the check reads the head tree, the one PR that can always merge while overdue is the PR that resolves or re-dates the overdue item.

**Pros**

- This is the only channel in the repo with proven binding force. `enforce_admins: true`, `strict: true`, ~13 merges/day, and merge to main IS a production deploy — so unattended neglect stops shipping within hours, automatically, with no human in the notification path.
- Structurally cannot silently stop. If the check breaks or the job disappears, PRs stop going green; the failure of the watchman is itself loud. This is the property every other mechanism in this repo lacks.
- No new infrastructure: one script and one job in a workflow that already runs on every PR. No daemon, no table, no vendor, no schedule to be dropped.
- The head-tree evaluation gives a clean, self-resolving escape: the fix for a red OS Clock is to rule on the item or re-date it with a reason, both of which are commits — so escaping the gate produces the artifact D6 wants.
- Directly honours the repo's own recorded lesson (`gates-must-be-required-to-be-gates.md`) and PR #362's fail-closed posture, rather than adding a ninth advisory signal.

**Cons**

- No warning rung. The first signal is a red PR on unrelated work at merge time — late, surprising, and maximally annoying, which is precisely the emotional profile that gets a check demoted. Removing a required context is one `gh api` call and leaves no artifact behind.
- Nothing reaches Prez at the start of the day or the start of a session; the mechanism only speaks when he is trying to do something else.
- No durable record of the neglect period. CI logs expire in 30 days and are gitignored (F7.5), so "this sat for 11 days" leaves no evidence — which is the exact evidentiary gap F2 describes.
- Bootstrapping is hostile: on day one there are already 5 stale queue items, 2 open incidents, and a `loop-registry.yaml` last observed 2026-07-28. Turned on required immediately, it blocks every PR on day one and the first thing that happens is that it gets turned off.
- Ages nothing that is not in the PR's diff-adjacent mental model — it will feel like the gate is punishing the wrong PR, because it is.

**Doctrine fit:** Strongest option on D5 (the loop actually closes — silence produces a consequence, not a message), D8 (a probabilistic-satisfaction-style acceptance criterion that is genuinely binding), and D12-L6/L8 (a real policy enforcement surface rather than prose in files no machine reads, per the L8 finding). Weak on D6/D12-L2: the neglect itself leaves no durable artifact once CI logs expire. Weak on D12-L3 currency: nothing surfaces the state until merge time.

### C — The clock ladder: front-matter clock + required check + standing issue + SessionStart capsule ✅ **RECOMMENDED**

**Effort:** M · **Risk:** medium

One clock, three surfaces, graduated consequences.

CLOCK (source of truth, no registry to drift): every `/os/` artifact that represents an open commitment carries front matter — `id`, `kind` (decision|observation|loop|goal|state|commitment), `dri`, `status`, `opened`, `observe_by`, `observed_at`, `renewals: []`. `scripts/check-os-clock.mjs` (zero-dep Node, ~250 lines + vitest suite, no pnpm install needed) walks `os/**/*.md` plus an INCIDENTS.md `Status: OPEN` adapter, and enforces the anti-neglect invariant: an open item with no `observe_by` is itself a failure. You cannot create a blocked item without declaring the date its silence becomes a defect. Overdue windows per kind: decision awaiting ruling 7d from `opened`; decision ruled-but-unimplemented 14d; `kind: observation` (Incident 40's "trust pending post-deploy observation") — mandatory explicit `observe_by`, no default, blocks first; `os/loops/LOOP-*.md` 30d since `last_observed`; `os/goals/GR-*.md` 30d since `last_reviewed`; `os/STATE.md` 7d since `as_of`; INCIDENTS.md OPEN entries 14d since that block last changed. `os/audits/**` is point-in-time and never aged. todo.md's 781 checkboxes are explicitly OUT of scope and are represented by exactly one item: "todo.md is unowned — triage into /os/ or declare dead by <date>".

LADDER (each rung does something different): GREEN → listed in the session capsule only. WARN (`observe_by` passed, ≤3d) → check still passes but emits `::warning::` + a job-summary table; the daily job opens/updates the issue; the session capsule promotes it to the top. BLOCK (>3d, or immediately at `observe_by`+3 for `kind: observation`) → the required check FAILS; no merge, therefore no deploy. CRITICAL (blocking >7d, or the daily job has not succeeded in 48h) → issue relabelled `os-clock:critical`, and the check's message names the doctrine violation and cites this DR.

SURFACE 1 — blocking: job `os-clock` / `name: OS Clock` in `.github/workflows/ci.yml`, added to `main-protection` as a fifth required context. Head-tree evaluation, so the resolving PR always merges.
SURFACE 2 — push/record: `.github/workflows/os-clock.yml`, daily `0 15 * * *` + `workflow_dispatch` + `push: [main]`, `issues: write`, maintaining ONE standing issue (created, updated, and closed by the same script). Redundant Discord POST, documented in the workflow as unconfirmable and never load-bearing.
SURFACE 3 — ambient: `.claude/scripts/os-clock-capsule.sh` added as a third `SessionStart` hook in `.claude/settings.json` (two already exist), timeout 10s, `exit 0` always per the existing fail-open hook law, printing ≤15 lines. Since Claude Code is the primary harness, every session in this repo opens by being told what is overdue.

RENEWAL IS BOUNDED AND RECORDED: `observe_by` may only move forward by appending to `renewals:` with a reason; the check enforces ≤14d per renewal, ≤2 renewals, and a non-filler reason ≥20 chars. Every snooze is a git diff — an artifact — and snoozes run out.
EMERGENCY VALVE: a PR may include `os/overrides/<YYYY-MM-DD>-<slug>.md` naming the item and the reason; the check then passes. The override expires 24h after its date, so it cannot become permanent, and the override IS the artifact — no bot write required.
WATCHMAN'S WATCHMAN: in CI mode the check queries `gh run list --workflow=os-clock.yml` (`actions: read` on GITHUB_TOKEN) and fails if the last success is >48h old — so if the scheduled job silently dies, PRs go red.
SELF-DEMONSTRATING BOOTSTRAP: the adoption PR's first tracked item, OI-0001, is "make OS Clock a required status check", `observe_by: adoption+7d`. The mechanism's first job is to age its own activation.

**Pros**

- Combines the only channel with binding force (required check) with the only channel Prez demonstrably lives in (Claude Code SessionStart) and the only channel that produces a durable record of the silence (the standing issue) — each covering the others' exact failure mode.
- The escalation is real: rung 2 changes what is possible, not what is displayed. Neglect stops deploys. Nothing about it depends on Prez remembering anything, on process memory (erased ~13x/day), or on anyone confirming receipt.
- The clock lives on the artifact, not in a registry — so there is no second copy to drift, which is precisely how `loop-registry.yaml` and `operating-brief.md` went stale (F2.2, F2.3). Doctrine L7's "lessons attach to the process" applied to deadlines.
- Mandatory `observe_by` on open items is the direct, mechanical kill for the 2026-07-28 failure: "owner-gated" can no longer be written without an expiry date. The lesson file already says this; this makes it executable.
- The two escapes — bounded renewal and 24h-expiring override — are what stop the gate from being deleted in anger, and both produce artifacts instead of destroying the record.
- Self-observing (48h heartbeat) and self-demonstrating (OI-0001 is its own activation), so the mechanism's own death is loud and its adoption is proven by the mechanism itself.
- Reuses everything: existing ci.yml job pattern, existing SessionStart hook array, existing cron-workflow shape, existing `scripts/check-*.mjs` gate convention. Adds no service, no daemon, no vendor, no table, no schema change.

**Cons**

- Four surfaces is genuinely more to build and more to rot than one. The SessionStart capsule in particular is the piece most likely to be silently broken by a future settings.json edit and least likely to be noticed — it is the one part of this design with no watchman.
- It is a merge-blocking gate, so the frustration risk of Option B is inherited, only mitigated. If Prez uses the override three times in a week, the mechanism is dead in practice while still green in principle.
- Front matter must be added to every /os/ artifact and kept correct; the INCIDENTS.md adapter parses hand-written markdown and will need maintenance when the file's shape drifts (it has no enforced structure — F6.7).
- Requires an owner action outside the repo (adding the required context to ruleset 18701573), which is exactly the class of open item that historically never gets done — hence OI-0001, but that is a mitigation, not a guarantee.
- The per-kind window table is a set of judgment calls (7/14/30 days) with no evidence behind them yet; the first month will be miscalibrated in some direction and will need tuning, which is itself an open item.

**Doctrine fit:** The only option that closes the loop on itself. D5: Outcome and Evaluation are present — the mechanism observes whether the item moved, not merely that a message was sent, and the 48h heartbeat evaluates the mechanism's own liveness. D6: every state transition (renewal, override, ruling) is a git-visible artifact with time, owner, and the goal it links to; the standing issue makes neglect duration queryable after CI logs expire. D12-L2 (artifact enforcement rather than convention), L6 (a binding acceptance criterion), L8 (an actual policy enforcement surface, answering the audit's finding that governance is prose no machine reads). D14: pure visibility infrastructure with zero new autonomy — correct first move under visibility-before-autonomy. D15 #2 (open-loop automation) and #3 (unqueryable work) both addressed. §19 deploy law is honoured by construction: the consequence of neglect is that a deploy cannot happen.

### D — In-app watchdog: `os_open_items` table + cron endpoint + founder-dashboard tile

**Effort:** L · **Risk:** high

A new Drizzle table `os_open_items` (id, kind, title, artifact_path, dri, opened_at, observe_by, observed_at, status) plus `job_runs` for cadence, shipped via the manual `db-push.yml` workflow first per deploy law. A new `/api/cron/os-clock` endpoint (shared-secret authed, matching the six existing `cron-*.yml` workflows) recomputes ageing on a schedule, writes a run record — closing F7.1 in passing — and raises a Discord alert plus a tile on the existing `/admin` dashboard showing overdue items, with the same tile later carrying cron health, deploy health, and AI cost. `scripts/check-os-clock.mjs` becomes an ingester that syncs `/os/` front matter into the table on push to main.

**Pros**

- The one option that also pays down F7.1 (no `job_runs` table exists anywhere) and gives F9's absent founder dashboard its first real tile, so the same infrastructure serves several gaps.
- State becomes SQL-queryable and joinable to the things that actually matter — model runs, Stripe events, cron cadence — which is the D6 dashboard vision ("revenue to the customers producing it") rather than a markdown file.
- Fits the existing operational idiom exactly: six `cron-*.yml` workflows already POST to shared-secret `/api/cron/*` endpoints, and there is a real admin dashboard with 14 destinations and versioned metric definitions to hang this on.
- Scales past markdown: 781 todo checkboxes, per-market publication verdicts, and per-loop observations are all row-shaped, and a table handles them where front matter would not.

**Cons**

- It reproduces the exact anatomy of every mechanism that already rotted here. `CronJobRunner.lastResult` is process memory wiped by ~13 redeploys/day (F7.2); declared cadence is fiction and every under-run reports success (F7.3); `/api/cron/status` is already structurally useless. Building the anti-neglect mechanism on that substrate is building it on the fault.
- A dashboard tile is a surface Prez must remember to visit — the precise dependency the requirement forbids. `/admin` is owner-only and there is no evidence of a daily-visit habit; a red tile on an unvisited page is indistinguishable from no tile.
- It splits reality in two. The item's truth would live in TiDB while the artifact it describes lives in git, and they will disagree — a direct D4 violation ("specialized agents share one source of truth; they may never maintain incompatible realities"). Every other option keeps one reality.
- It requires a schema change, which is owner-gated and db-push-first — so the mechanism for un-blocking owner-gated work is itself blocked on owner-gated work. That is the 2026-07-28 deadlock re-created at the root.
- Highest cost against the explicit constraint that a design adding a service or a data path is far more expensive here than one adding a file format or a CI job. Nothing about ageing needs a database.
- Still has no binding channel — the tile and the Discord post can both be ignored indefinitely, so the core requirement is unmet even after paying L-sized effort.

**Doctrine fit:** Serves D12-L3 (queryable context) and D13-Operations attractively on paper, and would help D6's dashboard requirement. But it fails D4's one-reality rule by splitting item state across git and TiDB, fails D14 by adding infrastructure before the visibility it is supposed to provide actually binds, and fails the D15 #1 correction (examine information flow, not tool count) — it adds a tool where the missing thing is an obligation. It is the option most likely to become the next `docs/ai-native/`: excellent, uncommitted-in-spirit, unobserved.

## Recommendation

**C — The clock ladder: front-matter clock + required check + standing issue + SessionStart capsule**

Because it is the only option in which neglect has a consequence rather than a notification, and the only one whose own death is loud.

Against A: the requirement is 'impossible to ignore passively'. A is entirely passive. Prez has opened zero GitHub issues in 366 PRs; betting the mechanism on a habit that has never once been exhibited is the same bet 2026-07-28 made on a queue file and Discord, and it lost by 8 days. C keeps A's best asset — the single standing issue as a durable, timeline-bearing record of exactly how long silence lasted, which survives the 30-day CI-log expiry — but demotes it from the enforcement channel to the evidence channel, which is what it is actually good at.

Against B: B is right about where the force is and wrong about the sequencing of the force. Its first contact with Prez is a red check on unrelated work, with no prior warning and no relief valve, and removing a required context from ruleset 18701573 is one API call that leaves no trace — this repo has already demoted two gates that way (F6.1). C keeps B's entire enforcement core unchanged and adds the three things that make it survivable: a WARN rung that speaks before it blocks, a bounded renewal path where snoozing costs a permanent git-visible reason and runs out after two, and a 24h-expiring override file so a genuine 2am hotfix never has to choose between shipping and deleting the gate. The escapes are the reason the gate lives.

Against D: D is the instinct to build an ops system, and it is the most expensive way to be ignored. It needs a schema change to un-block owner-gated work — the deadlock it exists to break — it depends on a cron path whose own cadence is documented fiction (F7.3), it puts item state in TiDB while the artifact lives in git (two realities, D4), and after L-sized effort the output is still a tile on a page nobody is obliged to open. Its genuine wins (a `job_runs` table, a founder dashboard) are real and should be built — later, by the F7 record, not smuggled in here.

The two properties that decide it. First, head-tree evaluation means the only PR that can merge while something is overdue is the PR that resolves or re-dates it — so the gate is self-clearing and the escape route produces exactly the artifact doctrine wants. Second, the 48h heartbeat: the blocking check verifies that the scheduled job has succeeded recently, so if the daily workflow is silently dropped — the single most likely way this mechanism dies, and the documented behaviour of GitHub cron in this very repo — PRs go red. Every other design here can die quietly. This one cannot.

And the mandatory `observe_by` field is the actual fix for F2, narrowly stated: it makes it structurally impossible to write down 'blocked on owner' without also writing down the date at which that silence becomes a defect. The lesson file already says 'owner-gated is a loop stage, not a terminal state.' This is the first version of that sentence a machine can enforce.

**Grafted from the runners-up**

- From A: the single standing GitHub issue — created, updated, and CLOSED by the same script, never a stream of new issues. Adopted wholesale as the evidence/push channel, and it opens the repo's first-ever issue, starting to close F1.4 in passing.
- From A: the redundant Discord POST, kept but explicitly demoted in the workflow comment to 'unconfirmable, never load-bearing' (the bot has GatewayIntentBits.Guilds only and cannot read a message back — F1.6), so nobody later mistakes it for the escalation.
- From A: the INCIDENTS.md `Status: OPEN` adapter, so Incidents 21 and 39 age on the same clock as /os/ items without INCIDENTS.md having to move or be rewritten (D12-L2 forbids moving it).
- From B: head-tree evaluation and the required-context wiring in ruleset 18701573 — taken unchanged; B is right that this is the only binding surface in the repo.
- From B: putting the job inside .github/workflows/ci.yml next to the four contexts already required, rather than a standalone numbered workflow, so it inherits the existing concurrency, permissions, and naming posture.
- From D: the run-record idea, but narrowed to its cheapest useful form — the `os-clock.yml` workflow-run history IS the run record, read back by the 48h heartbeat. No `job_runs` table, no endpoint, no schema change. The real `job_runs` table stays with the F7 record where it belongs.

## Requested ruling

Ruling requested on three things, as one yes/no with two parameters.

THE QUESTION: Do you approve Option C — an `observe_by` clock on every open /os/ artifact, enforced by a new required status check "OS Clock" on `main`, with a daily workflow maintaining one standing GitHub issue and a third SessionStart hook printing overdue items into every Claude Code session?

A YES COMMITS YOU TO:

1. A merge-blocking gate on yourself. `main-protection` has `enforce_admins: true`, so when an item goes >3 days past its `observe_by`, YOU cannot merge — and since merge to main IS a production deploy, you cannot ship. The intended behaviour is that unattended neglect stops the company shipping. You are agreeing that this is correct and not something to be waived the first week it bites.

2. One owner action outside the repo, within 7 days of merge: adding the context `OS Clock` to ruleset 18701573 (`gh api -X PUT repos/aisportsbettingcontact/ai-sports-betting-dime-ai/branches/main/protection/required_status_checks` with the fifth context, or Settings → Rules → main-protection). Until you do, the check runs advisory and the repo's own lesson `gates-must-be-required-to-be-gates.md` is not satisfied. This action is itself tracked as OI-0001 with `observe_by: adoption+7d` — the mechanism's first job is to age its own activation, and if you do not do it, the mechanism says so loudly. That is deliberate.

3. Writing `observe_by` on every future blocked item. From merge onward, "owner-gated", "pending review", or "awaiting observation" without a date fails the check. There is no way to record a blocked item without recording when its silence becomes a defect.

TWO PARAMETERS I NEED YOU TO SET (my defaults in brackets — say "defaults" to accept):

P1 — The block threshold. How many days past `observe_by` before the check goes from WARN to BLOCK? [3 days, except `kind: observation` which blocks at +3 with no default window and no renewal, because that is the exact Incident-40 failure.]

P2 — The renewal budget. How many times may an item's `observe_by` be pushed forward, and by how much each time, before it is permanently blocking until resolved? [2 renewals, ≤14 days each, each requiring a written reason ≥20 characters that is a git-visible diff.]

ONE THING I NEED YOU TO EXPLICITLY ACCEPT OR REJECT: the emergency valve. A PR may bypass the gate by including `os/overrides/<date>-<slug>.md` naming the overdue item and the reason; it expires 24 hours after its date and cannot be renewed. I recommend accepting it — without an escape the gate gets deleted the first time it collides with a 2am hotfix, and this escape produces an artifact instead of destroying one. If you reject it, the gate has no bypass at all and you should expect that to be tested within the month.

WHAT I AM NOT ASKING FOR: any autonomy, any agent authority, any production data touch, any schema change, any new service, and no change to what the crons or the model path do. This record is pure visibility infrastructure, which is what D14 requires to come first.

## Depends on

- DR-003 — HARD DEPENDENCY. Authorizes pushing `local/audit-mlb-model-2026` and committing the AI-native program. Until the `/os/` tree is in git, there is nothing for the clock to read: `os/` does not exist in the repo today (`ls -d os` → No such file or directory; `git ls-files os` → empty). This DR is unbuildable before DR-003, and both must land in the same wave, because a durability fix without an ageing fix is what produced 2026-07-28.
- DR-005 — SOFT. First-loop selection. The chosen loop's `os/loops/LOOP-*.md` becomes the first `kind: loop` item on the clock (30-day re-observation window). If no loop is selected, the clock still runs on decisions, observations, and STATE.md, but the F2.3 defect it is meant to fix (loop statuses asserted once, never re-observed) has no subject.
- DR-004 — SOFT / NON-CONFLICT. The orchestration-spine question. This record deliberately adds no orchestration: no Temporal, no durable-execution engine, no new runtime. It is a file format plus a CI job plus a hook, and it must remain compatible with whatever DR-004 rules — if a durable spine is later adopted, the clock's heartbeat source moves from `gh run list` to that spine's run history and nothing else changes.
- DR-001 and DR-002 — CONSUMERS, not blockers. Both are owner rulings that are currently ageing with no clock. On adoption they become the first two `kind: decision` items (`observe_by: opened+7d`), which is the fastest honest test of whether this mechanism actually works on a real Prez decision.
- PR #362 (`ci/verification-framework`) — SEQUENCING, not a DR. It adds 11 numbered workflows and a documented Wave-based graduation for required checks. The `OS Clock` job should be sequenced against that rollout so two ruleset edits do not race, and its ROLLOUT.md wave pattern is the precedent for OI-0001's 7-day activation window.

## Open unknowns

- The exact DR ids for the F1 durability family. STATE.md §4 enumerates DR-001 through DR-005 only; DR-006 and DR-007 are presumably the F1 records in this same Stage-2 batch but I could not verify them from here — `os/decisions/` is empty. RESOLVES VIA: reading the Stage-2 decision set once written; if F1 durability landed under a different id, substitute it for DR-003 in the hard dependency above. The dependency is on the CAPABILITY (the /os/ tree in git), not the number.
- Whether the per-kind windows (7/14/30 days) are calibrated. They are judgment calls with no evidence behind them — chosen so that the 2026-07-28 queue would have blocked on day 8, which it should have, and so that a normal week of work never trips the gate. RESOLVES VIA: one month of operation, then a review item on the clock itself; the first tuning PR is expected and should not be read as the mechanism failing.
- Whether the SessionStart capsule actually reaches Prez, or is swallowed. The existing hooks fail open by law (`exit 0` always, degrade to nothing), which is correct for not wedging a session and terrible for confirming delivery — the capsule is the one surface in this design with no watchman. RESOLVES VIA: not instrumenting it (that would need a write path); instead, accept it as the redundant third channel and let the required check carry the obligation. If evidence later shows the capsule is the channel that works, it can be promoted.
- How many pre-existing items exist on day one and whether that count is tolerable. Known: 5 stale queue items in `docs/ai-native/execution-state.json`, 2 OPEN incidents (21, 39), 9 loops last observed 2026-07-28, Incident 40's unrecorded observation, 1 todo.md umbrella item, plus DR-001..DR-005 — roughly 20. RESOLVES VIA: a dry run of `check-os-clock.mjs` against the /os/ tree in the adoption PR, with the count printed in the PR body. If it exceeds ~25, the adoption PR should set staggered `observe_by` dates rather than a single cliff.
- Whether `gh run list --workflow=os-clock.yml` is reliably readable from within the PR check. It needs `actions: read` on GITHUB_TOKEN, which is available, and there are no forks — but PR #362 added a fail-closed WRITE_APPROVALS map to `scripts/check-github-actions-security.mjs` and any new permission must be declared and justified there or the Security Audit check fails. RESOLVES VIA: reading that map and adding the justified entry in the same PR. Fallback if it proves awkward: the daily job writes `os/.clock-heartbeat` on main and the check reads its timestamp from git history — no API call at all.
- Whether `os/overrides/` should be permitted at all, or whether an override must instead carry a co-signature. With `required_approving_review_count: 1` and a documented two-account review geometry, a second account already approves every merge — so an override is never truly unilateral. I have not modelled whether that geometry survives an emergency at 2am, which is exactly when the valve matters. RESOLVES VIA: Prez's answer to the accept/reject question above, informed by whether the second account is reachable under emergency conditions.
- Whether `INCIDENTS.md` can be parsed reliably enough to age. Its `Status:` lines sit at column 0 and grep cleanly across all 61 entries, but the file has zero mechanical structure enforcement (F6.7) and Status lines are mutated in place, so 'last changed' must be derived from `git log -L` per block rather than from the file. RESOLVES VIA: writing the adapter against the current file and pinning its behaviour with a vitest fixture; if it proves brittle, incidents drop to the push channel only and stay off the blocking channel.

