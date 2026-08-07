---
name: design-federation
description: Use when starting UI or design work on a Dime surface — building, restyling, or redesigning a page or component, picking an aesthetic direction, adding or changing motion, generating a design system with uipro, or before claiming UI work is complete. Also use when more than one design skill could plausibly apply (taste family, ui-ux-pro-max, frontend-design, emil skills, impeccable) and the routing is not already decided.
---

# Design Federation

## Overview

Six specialized departments — uipro (research), frontend-design (art direction), the taste family (expressive specialist), emil (motion), impeccable (design ops), and the browser (evidence) — under one law: **any system may advise a decision; exactly one system owns it.** This skill routes and demands evidence; it holds no design knowledge of its own.

Skip it for: backend-only work, pure copy fixes, bug fixes with no visual change.

## Authority chain

1. Owner/user direction and dated owner directives.
2. Dime brand law, in its own reading order: `design-system/dime-ai/pages/<page>.md` (overrides, when the file exists) → `design-system/dime-ai/MASTER.md`, with `dime-ai/THREE-COLOR-LAW.md` winning wherever it and MASTER.md disagree (MASTER.md's own supersede note — this includes the Law's v3 owner-approved motion rules for interactive projections controls, not just color), and `design-system/dime-ai/TYPOGRAPHY.md` owning size/rhythm/measure/wrap orthogonally. Read these files; never work from a summary of them.
3. This routing.
4. The routed skill's own guidance.
5. Generic defaults.

`design-system/dime-ai/**` and `dime-ai/THREE-COLOR-LAW.md` are owner territory: propose changes via PR with a decision note; never edit them as a side effect of a build.

## The loop

Every federated job produces three artifacts: a **brief**, a **Lead declaration** (inside the brief), and an **evidence bundle**.

1. **Brief** — fill `references/brief-template.yaml` before touching code. Attach it to the PR.
2. **Research** — uipro searches (`--domain`, `--stack`) as evidence, terminal-only by default. Persisting is governed by the conditionals below.
3. **Direction** — declare the Lead: exactly one row from the routing table, written in the brief's `lead:` field. The Lead makes every aesthetic call. Every other design skill is an advisor or read-only critic; record advisors in the brief. Produce a design plan before code (frontend-design's plan-then-critique passes, or the taste Design Read + dials).
4. **Build** — one writer. Use the existing `/ui-*` commands; reuse existing components and tokens before introducing anything.
5. **Observe** — rendered proof via the `verify` skill (production build + boot + smoke) and screenshots at **the MASTER.md Pre-Delivery Checklist widths: 375 / 768 / 1024 / 1440**, dark and light, plus a reduced-motion pass. Do not shoot fewer: step 8 declares done as "that checklist passes", and its responsive item names those four — two viewports cannot satisfy it. Exact pixel heights and the before/after rule for redesigns: `references/evidence-bundle.md`. `/sp-verify` is command-output evidence (tsc/tests/build) — it never substitutes for rendered proof. Against armed-edge production, headless capture needs `EDGE_AGENT_BYPASS_KEY`, or Cloudflare 403s it as a bot.
6. **Audit** — `/impeccable critique` or `/impeccable audit` on the surface, plus the deterministic detector for CI-shaped findings. Motion diffs additionally take the motion gate (conditional below).
7. **Repair** — fix in order: functional → accessibility → responsive → content → system consistency → motion → decoration. Bounded passes: one batched fix round, at most one confirm round, stop.
8. **Stop** — done when MASTER.md's own Pre-Delivery Checklist passes and the evidence bundle (`references/evidence-bundle.md`) is complete.

## Routing

| Surface / situation | Lead | Notes |
| --- | --- | --- |
| Landing, marketing, campaign | `frontend-design` **or** one taste specialist — never both | frontend-design loads via Read (`.claude/skills/frontend-design/SKILL.md`); it is not in the Skill roster |
| Expressive/editorial one-off (portfolio-grade) | one of the taste family | taste v2 scopes itself to landing/portfolio/redesigns and refuses product UI |
| Product UI: feed, chat, auth, settings, dashboards | `impeccable` (Lead), `ui-ux-pro-max:ui-ux-pro-max` as research advisor | taste v2 is out of scope here by its own Section 13 |
| In-place refinement of an existing surface | `impeccable` (`shape`/`critique`/`audit`/`polish`) | `redesign-skill` for audit-first overhauls |
| Motion build/polish | `emil-design-eng` (`apple-design` for gesture/spring work) | craft budgets capped by the brand motion law |
| Motion audit before merge | `review-animations` via Read | not model-invocable; ends in Block/Approve |
| "What's that effect called?" | `animation-vocabulary` | naming only |

Exact invocation surfaces (skill IDs, Read paths, CLI flags, dial spellings): `references/routing.md`. Pins, licenses, scopes: `references/registry.md`.

## Conditionals

- **If the diff touches `transition`, `animation`, `transform`, keyframes, or motion tokens** → run the `review-animations` gate (Read its SKILL.md + STANDARDS.md) before declaring done; its Block/Approve verdict goes in the evidence bundle.
- **If running uipro `--design-system --persist`** → the project slug must not be `dime-ai`, and when the surface already has a governing contract (a `design-system/dime-ai/pages/<page>.md` exists, or MASTER.md governs it), do not persist a tree at all: keep generator output terminal-only and fold accepted findings into a PR proposing changes to the governed files. One canonical contract per surface.
- **If two design skills both claim a surface** → the brief's `lead:` field decides; the other becomes a named critic.
- **If a plugin-namespaced skill is absent** (cold session before plugin bootstrap) → fall back to the flat `.claude/skills/` copy or its Read path, and say so in the bundle.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Stacking taste + soft + emil + impeccable as co-authors on one hero | One Lead in the brief; the rest critique read-only |
| Persisting `design-system/<other-slug>/` for a surface `dime-ai` law already governs | Terminal-only research; PR against the governed files |
| Shipping a motion diff after tsc + screenshots only | review-animations gate, verdict in the bundle |
| Treating `/sp-verify` as visual verification | verify skill for rendered proof; `/sp-verify` for command output |
| Inventing dial names (`LAYOUT_VARIANCE`, `ANIM_LEVEL`) | Only `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` (taste, conversational) and `--variance/--motion/--density` (uipro CLI, only with `--design-system`) |
