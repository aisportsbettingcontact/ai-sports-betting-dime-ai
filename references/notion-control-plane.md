# Notion control plane

Notion holds Dime AI's organizational truth: what the company is trying to accomplish,
what is being built, who owns each result, what was decided and why, and whether outcomes
are moving. External systems keep operational truth and Notion links to them instead of
restating them. This file is the repo-side mirror of the workspace's "Setup & Governance"
page and the pointer agents load before touching Notion.

Workspace: **Tailered Sports** (`a3e96733-13e7-81b4-820f-000342c82d33`).
Root page: **[Dime AI — Operations HQ](https://app.notion.com/p/3b49673313e781569b59ff6f9ea0e4f1)** — carries the
source-of-truth map, the twelve operating laws, and the operating cadence. Built 2026-08-06
over the Notion MCP.

## Source-of-truth map

| Information                                 | Authoritative system                                 |
| ------------------------------------------- | ---------------------------------------------------- |
| Source code and PR state                    | GitHub (`tailered-ai/dime-ai`) |
| CI and test evidence                        | GitHub Actions                                       |
| Runtime and deployment state                | Railway (RunPod only if the ML lane reactivates)     |
| Billing and subscriptions                   | Stripe                                               |
| Product telemetry                           | Analytics stack                                      |
| Credentials and secrets                     | 1Password + device-only Railway broker. Never Notion. |
| Strategy, goals, ownership, decisions, project health | Notion                                     |
| Model and agent governance metadata         | Notion AI Systems Registry, linking to artifacts     |
| Legal originals                             | Controlled legal file store, linked from Notion      |

## Workspace inventory

Sections under the root page (each becomes its own teamspace once teamspaces are set up):

- [Founder Cockpit](https://app.notion.com/p/3b49673313e78114811bf6eed7c20b9c) — decision queue,
  red projects, company scorecard, shipping, customer signal, Founder Inbox. All live views.
- [Product & Engineering](https://app.notion.com/p/3b49673313e781498015d86f4b5a7173) — Projects,
  Tasks, Releases, Incidents, Risks, and the [GitHub Sync](https://app.notion.com/p/3b49673313e781c9ac8bf8df028f5471) page.
- [AI Systems & Model Operations](https://app.notion.com/p/3b49673313e781ae8ea6fb1390a18e14) —
  AI Systems Registry, Evaluation Runs, Market Coverage Matrix.
- [Growth & Customer](https://app.notion.com/p/3b49673313e78135b2d8f51c5d2b21eb) — Product
  Feedback, Experiments.
- [Operations & People](https://app.notion.com/p/3b49673313e7815ab4dde5f75ff788d0) — outline only;
  build hiring/vendor/compliance structure as needed.
- [Leadership & Board](https://app.notion.com/p/3b49673313e7817f8819e8805304f021) — must become a
  private teamspace BEFORE any sensitive content lands there.
- [Setup & Governance](https://app.notion.com/p/3b49673313e781e3b504d67301cba6af) — the manual
  runbook, day-30 acceptance criteria, and the ten record templates.

Databases (16, fully related; every record type carries an auto-increment ID):

| Database | URL | Notes |
| --- | --- | --- |
| Goals | https://app.notion.com/p/b9458ac48a4b49d3a6954d634cd9f768 | Outcomes, not activities; projects roll up |
| Projects | https://app.notion.com/p/888202aaf938497a91075121646e4cb4 | One DRI, health, stage, success metric; hub of most relations |
| Tasks | https://app.notion.com/p/96228d0d4aca436e8527053a27f7472c | Notion's canonical tasks type + DoD/evidence/external-link fields |
| Knowledge | https://app.notion.com/p/694ec08d2e544cc797157a24824bbd1d | Wiki DB; `Authoritative source` links GitHub when the file of record lives there |
| Decisions | https://app.notion.com/p/46ec53110ccc496296a7438203324d21 | Append-only rationale; supersede, never rewrite |
| Meetings | https://app.notion.com/p/655f4914a0444ea19821e72594101c8c | Incomplete until decisions/tasks are extracted |
| Metrics | https://app.notion.com/p/aa2a8d6f0dca46189a7c03b180c76ba9 | Definitions and summaries; time series stay in source systems |
| Releases | https://app.notion.com/p/f86c2987ec7e43dfa71b2dce14664467 | Evidence index: SHA, PRs, CI, deployment, health, rollback |
| Incidents | https://app.notion.com/p/75794618f4af49a8b55c60a811995dae | Per-type templates (app, data feed, model, billing, security) |
| Risks | https://app.notion.com/p/a4a37320164d408c8f0df5dfe7cb2ba1 | Critical open risks surface on the cockpit |
| AI Systems Registry | https://app.notion.com/p/8673b8ac6f424acebc53b6cbf0698251 | Models, agents, datasets, suites, prompts, tools, deployments |
| Evaluation Runs | https://app.notion.com/p/af901594c9424bc1bd3f209fb3350872 | Why each version shipped or got rejected |
| Market Coverage Matrix | https://app.notion.com/p/735812979bbf4d249a77bc9b0e4f1a66 | Sport/league/market/book: freshness, validation, status |
| Product Feedback | https://app.notion.com/p/0c558e78a870470cb84cefabd7de8dcc | Original customer language preserved verbatim |
| Experiments | https://app.notion.com/p/857f53a2e13848649b33b56b289b6d6c | Shipping is not success; the metric moving is |
| Founder Inbox | https://app.notion.com/p/3d4188037c44474c81a28ba882093366 | Capture, then process to zero |

## Conventions that touch this repo

- **PR linking.** The PR template has a "Notion context" section. Paste the Notion project or
  spec URL there (or "none"). Notion's GitHub sync auto-relates a PR to its spec when the
  Notion URL appears in the PR body.
- **Releases.** Every production deploy gets a Release record: exact commit SHA, PRs, CI link,
  deployment, health verification (`node scripts/smoke-deploy.mjs` output), migration state,
  and rollback SHA. A record never says "passed" without those links. Merge to `main` IS a
  production deploy (deploy law unchanged), so the record follows the merge.
- **Decisions.** Owner decisions land in the Decisions database with evidence links. The
  2026-08-04 chat-provider/ML-dormant decision and the 2026-07-11 Railway-only decision are
  recorded there retroactively.
- **No double entry.** GitHub issues are never hand-mirrored into Notion; the synced databases
  surface them. GitHub keeps labels and workflow logic (labels do not sync).
- **No secrets.** Notion never holds keys, tokens, or credential values. The agent-access
  authority stays `config/dime-agent-access.v1.json`; credentials stay in 1Password and the
  device-only Railway broker.
- **Registry honesty.** `ml/dime-1.0` is registered as Dormant / Not approved (no production
  checkpoint); Dime Chat is registered as the production Anthropic-gateway agent. Lifecycle
  changes ride decisions and `ml/dime-1.0/docs/RELEASE_GATES.md`, not registry edits.

## Seeded state (2026-08-06)

Structure, relations, templates, and cockpit views are complete. Seed records came from
documented repo facts: three active projects (rebrand, feed migration, this control plane),
two retroactive decisions, six knowledge pointers (brand law is Verified for 90 days),
ten metric definitions with no invented values, four registry assets, two MLB coverage rows
marked Partial pending confirmation, and one exemplar release record at main head
`be0a1bb7b21d4633a0bc6e6784ea149f7fad4657` (rollback `8507dc2`). Seeded Health values and
coverage details need owner confirmation at the first weekly review.

## Manual completion steps

Each exists as a task in the Tasks database, assigned to the owner:

1. Create the six teamspaces and move the sections in (P0).
2. Create permission groups; give employees "Can edit content" on operational databases (P0).
3. Connect GitHub; create synced PR/issue databases on the GitHub Sync page (P0).
4. Confirm the plan covers AI connectors (page verification already works; connectors need
   Business or above; check the startup program) (P1).
5. Build the intake forms: feedback, incident, founder inbox (P1).
6. Add the nine Layer-2 database automations listed in Setup & Governance (P1).
7. Turn Knowledge into a wiki, set verification on critical docs, migrate the old Document
   Hub, then archive it (P1).
8. Add quick-create buttons for the core databases (P2).
9. Deploy the first two Custom Agents (Chief of Staff, Knowledge Steward) only after each
   passes a defined evaluation set; scoped access, budgets, registry entries (P2).

## Cadence

- **Daily**: founder clears the cockpit (decision queue, red projects, inbox); team updates
  blockers and records decisions as they happen.
- **Weekly**: async functional updates (template in Setup & Governance), then one operating
  review over the consolidated page.
- **Monthly**: metric/portfolio/AI-quality reviews, verification sweep, permission review,
  closeouts.
- **Quarterly**: goals, roadmap, pricing, lineage audit, sensitive-permission and agent audit,
  workspace export.

## Day-30 acceptance criteria

Done when: every active project has an owner, outcome, target date, health, and success
metric; every critical wiki page has an owner and verification date; every major decision is
recorded; every production release links exact evidence; every production model or agent has
a registry record and evaluation history; engineering work is not duplicated between GitHub
and Notion; feedback takes under a minute to submit; leadership reads company status from one
dashboard; new teammates find answers without asking the founder; agents cannot reach
information outside their scope.
