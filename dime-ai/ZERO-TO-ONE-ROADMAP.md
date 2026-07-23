# DIME AI — ZERO-TO-ONE ROADMAP

> From assets-in-a-folder to a launched, monetized Dime AI product.
> Form: `roadmap-planning` (5-phase) — outcome-framed epic hypotheses, transparent
> prioritization, dependency-sequenced Now/Next/Later. A plan, not a contract; re-sequence
> as probes report back.
>
> Speedrun doctrine: every epic names its execution chain (see `prez-ai-skills-directory.md` §4)
> and its parallel-agent fan-out. Solo work is the exception.

---

## Phase 1 — Inputs (gathered)

**Business outcome:** launch Dime AI as the rebranded, subscription-monetized face of the
platform. Move: visitor→trial conversion, member activation, MRR.

**Customer problem (validated by the product's own history):** bettors get noise and gut
picks; they lack disciplined, model-priced edges — and honest PASS signals.

**Assets in hand (zero-to-one is assembly, not invention):**
- Proven backend: 24/7 MLB pipeline, Monte Carlo engine, public read APIs (`games.list` et al.)
- Working chat engine: SSE `POST /api/dime/chat` with 14-gate enforcement
- Verified design system: `dime-ai/` kit + `design-system/dime-ai/MASTER.md` law
- Pixel-verified references: chat/home/feed/landing (dark+light)
- Stripe billing live: checkout, webhook (hardened), plan states
- 79-skill arsenal + CI (typecheck green; Vitest blocked only on repo secrets)

**Constraints:** solo-operator team (leverage = subagents); brand law is closed (one-accent
mint); feed data contracts inviolable; responsible-gaming compliance on all marketing
surfaces (21+, 1-800-GAMBLER).

## Phase 2 — Epic hypotheses

| # | Epic | Hypothesis | Success metric |
|---|---|---|---|
| E1 | **Landing test hook** — `/landingpage` React port of the verified design with **whitelabel pricing integrated in-page** | A branded, edge-proof landing with native pricing converts better than a generic page + external pricing hop | Route live; checkout initiable from the page; zero Stripe branding pre-redirect |
| E2 | **Dime Feed Phase A** — shell + AI Model Projections pane on live `games.list` | The Dime shell over real projections is the product's spine | Feed renders in shell at test route; contracts intact |
| E3 | **Dime Chat reskin** — chat page in the shell, SSE core untouched | Chat inside the shell completes the two-surface product | `/chat` in Dime skin; streaming unbroken |
| E4 | **Feed Phases B–C** — token bridge + card redesign | Full mint-discipline feed makes edges legible at a glance | `#39FF14` count in feed code = 0; MASTER checklist green |
| E5 | **Membership surface** — PRO menu, upgrade/cancel, plan states in shell | Self-serve membership in-product lifts conversion & retention | Stripe flows pass `/stripe` review; menu live |
| E6 | **Cutover & launch** — `/` → Dime landing, `/feed` → Dime shell, legacy retired | The rebrand IS the launch | Production on Dime; legacy accents gone; RG language intact |
| E7 | **Deep whitelabel pricing** — embedded Payment Element (no hosted-page hop) | Fully on-site checkout lifts completion | Purchase completes without leaving the domain |
| E8 | **Retention surfaces** — chat persistence, Trends pane | Saved conversations + trends deepen habitual use | Recent Chats survive sessions; Trends tab live |

## Phase 3 — Prioritization (value/effort + strategic fit)

E1, E2 are **Now**: highest strategic fit (launch-blocking), medium effort, zero backend risk.
E3–E5 are **Next**: high value, depend on Now. E6 gates on E1–E5 (it's the launch). E7–E8 are
**Later**: real value, not launch-blocking. Strategic override per the skill: E1 jumps the
score queue because it is the revenue door — priced traffic can start before the full app
rebrand lands.

## Phase 4 — Sequence & dependencies

```
NOW ──────────────► NEXT ─────────────► LAUNCH ────────► LATER
E1 Landing+pricing   E3 Chat reskin      E6 Cutover       E7 Payment Element
E2 Feed Phase A ───► E4 Feed B–C ──────►                  E8 Trends + persistence
     (E2 shell is E3/E4's dependency;  E5 Membership ───► (E5 hardens before E6)
      E1 is independent — ships first)
```

CI secrets (user task) unblock Vitest → required before E6, not before E1–E5.

## Phase 5 — Communicate

This file is the stakeholder artifact. What's deliberately NOT on the roadmap: NHL/NBA feed
revival, mobile apps, new model markets — zero-to-one means one product, launched.

---

## The speedrun layer (how each epic executes fast)

| Epic | Chain | Parallel fan-out |
|---|---|---|
| E1 | C3 (surface) | 2 recon agents (checkout flow · routing conventions) run while roadmap/spec is authored; pricing section built by a dedicated **pricing implementation agent** (the "coding-agent assignment" — done in-arsenal; no `AssignCodingAgent` tool exists in this environment) |
| E2 | C1 via `/sp-plan` → **`/sp-subagents`** | recon agents already produced the feed map (frontend + pipeline); implementers per task, cheap-model transcription tasks, capable-model final review |
| E3 | C3 | parallel read-agents: DimeChat internals · reference-page deltas |
| E4 | C1 | one implementer per component cluster (skeleton/props/lineups → splits/calendar → GameCard → CheatSheet), sequential dispatch, two-stage review each |
| E5 | C4 | `/stripe` reviewer subagent armed with security+billing references on every diff |
| E6 | C5-style verification sweep | parallel smoke agents: routes · RG compliance · legacy-accent grep · Lighthouse |
| E7 | C4 + C1 | Payment Element spike agent before committing |
| E8 | C2 first | discovery agents on usage data before build |

**Standing rules:** dispatch in one response = parallel; never parallel *implementers* on
shared files; briefs travel as files; `/sp-verify` evidence gates every "done."

---

## Platform decision (2026-07-08) — stay on the legacy host through launch (SUPERSEDED 2026-07-11: migrated to Railway)

**Probe result:** the legacy vendor confirmed there is **no publish/deploy API** — the Publish button
is the only deploy mechanism; AGENT crons can pull/checkpoint/notify but not deploy.

**Decision:** Option C — launch on the legacy host; reduce the human step to one pre-staged Publish
click (the legacy agent cron: pull main → build-verify → checkpoint → notify); fold **migration
seams** into E2–E5 as ordinary tasks (LLM behind one client wrapper, storage behind an
adapter, auth behind an interface, no new in-process timers); keep migration as a written
option, not work.

**Migration triggers (any one converts the option into an epic):**
1. Release cadence makes the manual click a real tax (>~5 deploys/week sustained)
2. Any legacy-vendor pricing/reliability/policy event threatening the business
3. Forge LLM credit costs meaningfully exceed direct-API pricing at scale
4. Post-E6 growth work needs infra control the legacy host couldn't provide

Migration, if triggered, is a 4-organ transplant (Forge LLM, legacy OAuth, legacy file storage,
heartbeat crons) + edge-proxy assumptions — full spec → plan → staged rollout, auth cutover
as the riskiest task. Never casually.
