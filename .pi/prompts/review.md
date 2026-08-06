---
description: Review uncommitted or branch changes against repo conventions
argument-hint: "[scope: staged | branch | <path>]"
---
Use the code-review-excellence skill to review: ${@:-all uncommitted changes (`git status`, `git diff`)}.

Repo conventions to enforce (from CLAUDE.md):
- TypeScript strict; `npx tsc --noEmit` must pass.
- UI changes obey Dime brand law in `design-system/dime-ai/MASTER.md` (+ `design-system/dime-ai/pages/*.md` overrides): one-accent mint `#45E0A8` (`#0FA36B` mint text on light), Familjen Grotesk + IBM Plex Mono, 160ms motion, no gradients/purple/neon-green/gold.
- Projections-feed data contracts in `design-system/dime-ai/pages/ai-model-projections.md` must not be violated.
- No secrets in the diff. Responsible-gaming language (21+, 1-800-GAMBLER) stays on marketing surfaces.

Triage findings by severity, verify each against the actual code before reporting, and end with a merge/fix-first recommendation.
