# QM — multiplayer agent orchestration (yc-software/qm)

[QM](https://github.com/yc-software/qm) is the org-level layer above this repo's agent
stack: a multiplayer harness for work — Slack + web workspaces where every person and
room gets its own scoped memory, files, keychain view, crons, permissions, and a durable
sandbox. A central core drives interchangeable harnesses (Pi, Claude Code, OpenCode,
Codex) over Postgres, with three security postures (Strict / Auto / Dangerous) and a
predeclared command policy that applies in all of them. Reference clone: `~/src/qm`.

Fork lineage note: QM pins a security-patched pi build published from `yc-software/pi`
(`qm-pi-coding-agent-*-security.*` releases) — that fork is QM's hardened pi channel,
which is why it diverges from upstream `earendil-works/pi`.

## How this repo plugs into QM

QM's pi harness runs **SDK-embedded in isolated temp dirs** — it does NOT inherit a
repo checkout's context automatically. This repo integrates through two seams:

### 1. Skill pack (the whole arsenal, importable)

QM imports skill packs from git repositories: a pack is a git URL plus a config of
`skillGlobs` / `exclude` / `fieldOverrides`, scanned for Agent Skills–standard
`SKILL.md` files — exactly the format this repo already carries. Canonical pack config
for this repo:

```json
{
  "url": "https://github.com/tailered-ai/dime-ai",
  "config": {
    "skillGlobs": [".agents/skills/**", ".claude/skills/**"],
    "exclude": [
      ".claude/skills/ui-ux-pro-max/**",
      ".claude/skills/design/**",
      ".claude/skills/design-system/**",
      ".claude/skills/ui-styling/**",
      ".claude/skills/brand/**",
      ".claude/skills/banner-design/**",
      ".claude/skills/slides/**"
    ]
  }
}
```

The excludes drop the 7 flat uipro copies superseded by the vendored v2.11.0 build
(same dedup the pi CLI wiring uses — SKILLS.md). QM detects name collisions at ingest
(`skill-collision`), audits pack commits, and scopes imported skills by grant. The repo
is private: the pack import needs a repo-scoped credential with the path allow-list
covering `/aisportsbettingcontact/`.

### 2. Sandbox (repo work inside a scope)

Each scope's durable sandbox is where repo engineering happens: clone this repo there
and the full in-repo wiring applies — `AGENTS.md` context, `.pi/settings.json`,
dime-guard, `pnpm pi:*` entry points, `pnpm pi:audit`. Treat a QM sandbox like any new
machine: the trust prompt (`-a` headless) activates project resources and auto-installs
the declared pi packages.

## Laws that carry into QM (LLM.md/AGENTS.md apply unchanged)

- **Models**: current generation only — claude-fable-5 / claude-opus-5 / gpt-5.6-sol.
- **Credits**: the funded `ANTHROPIC_API_KEY` is for Dime Chat surfaces and pi-share-hf
  reviews ONLY. Never wire it into QM's keychain, org config, or harness credentials —
  QM harness auth uses subscription-class credentials, and any QM-side model spend is
  its own owner-approved decision.
- **Security posture**: run **Auto** (default) or stricter. The command policy's hard
  denials complement dime-guard; they do not replace repo law.
- Brand law, deploy law, and data contracts govern any dime-ai work done from a QM
  sandbox exactly as they do locally.

## Deployment (owner-gated — not yet executed)

QM deploys from a **deployment directory**, not a source checkout:

```bash
npm exec --yes --package=@yc-software/qm@latest -- \
  qm init . --org <slug> --target <fly|aws>
```

`qm init` materializes `deployment.md` + a `deploy-qm` agent skill that walks
infrastructure, email-gated web onboarding (Resend key or SMTP + verified sender +
admin address), optional connectors and Slack, live checks, and returns operational
URLs. Decisions only the owner can make, in order:

1. **Hosting target**: `docker` (local/self-managed), Fly.io, or AWS (Railway is NOT a
   supported target; cloud targets run in their own account, separate from the product
   deploy). `--model-provider anthropic|openai|openrouter` sets the base model provider
   — its **API key is a deployment secret**, which makes model spend an explicit owner
   decision under the credit law: never the Dime Chat key; use a separate key/org (or
   OpenRouter credits) provisioned for QM.
2. **Org slug** (local name, e.g. `dime-ai`).
3. **Sign-in**: built-in `auth` broker (admin email + verified sender + Resend/SMTP) or
   an external IdP.
4. **Slack**: optional; generated manifest, workspace install.
5. **Billing**: the deployment runs in the operator's own cloud account; model spend
   per the credit law above.

Alternative for deep customization: a **private fork** (`<org>/qm-private`) seeded by
mirror-pushing `yc-software/qm`, with everything org-specific under
`deploy/layers/<org>/` and core kept identical to upstream.

## Skill-pack contract (automated)

`qm.pack.json` at the repo root is the machine-readable pack config — QM admins import
the repo URL with exactly that config. `pnpm qm:pack:verify`
(`scripts/qm-pack-verify.ts`) validates the corpus against it deterministically —
frontmatter completeness, post-exclude name uniqueness (verified: 107 skills, 107
unique names), glob shape — and runs inside `pnpm pi:audit` (its qm-pack layer) and
therefore in CI on every PR. One corpus, two consumers, one gate. `/qm` (a
`.claude/commands` template, so it loads in Claude Code AND pi) routes QM work through
this runbook and the contract.

## Local evaluation

The source repo carries `npm run dev-instance` (+ `:status` / `:down`) and
`local/Dockerfile`. Verified 2026-08-01: the supervisor runs from a fresh clone
(`npm install --ignore-scripts`, 0 vulnerabilities) but waits on a configured pool app —
local instances need a `poolN.env` (deployment env incl. secrets), which is the same
owner-gate as the model-provider key. See `docs/getting-started.md` and
`deployment.md` in the clone.
