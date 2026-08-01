# Design: pi as secondary coding harness

Date: 2026-08-01
Status: implemented same-day (autonomous session; design decisions recorded here in lieu of
interactive approval)

## Goal

Adopt pi (`@earendil-works/pi-coding-agent`) as a coding harness for this repo without
duplicating the existing Claude Code arsenal, per pi's philosophy: adapt pi via project
config, never fork internals.

## Decisions

1. **Runtime = published npm package, globally installed with `--ignore-scripts`.**
   The org fork (`yc-software/pi`, clone at `~/src/pi`) has diverged from upstream
   (~27k-line delta, local `durable-agent-harness` design work) and stays an R&D/reference
   checkout, not the runtime. Rejected: running from the fork via `pi-test.sh` (stale vs
   upstream, dev-loop friction); vendoring pi into the repo (heavy, unnecessary).

2. **Reuse, don't copy.** Pi natively auto-loads `CLAUDE.md` and `.agents/skills/`, and its
   prompt templates use the same `$ARGUMENTS` substitution as `.claude/commands`. So:
   - `.pi/settings.json` `skills` array cherry-picks 6 skill dirs from `.claude/skills/`
     (verify, livelab, intended-vs-implemented, code-review-excellence, stop-slop,
     ui-ux-pro-max). Paths resolve relative to `.pi/` (verified in pi source:
     `resolveLocalEntries` → `resolvePathFromBase(p, baseDir)` with project baseDir
     `<cwd>/.pi`; a dir containing `SKILL.md` loads as a single skill without recursion).
   - `.pi/settings.json` `prompts` array reuses `.claude/commands/{ship,stripe,ui-build}.md`
     verbatim — they are self-contained or reference only skills pi can load.
   - One pi-native template, `.pi/prompts/review.md`, encodes repo review conventions.
   Rejected: pointing pi at all of `.claude/skills/` (~100 skills; every skill's
   name+description enters every system prompt); symlinks/copies (drift).

3. **Excluded from pi:** superpowers/`sp-*` and `pm-*` chains (Claude Code plugin
   machinery), MCP-dependent commands (`gh-fix`, figma, railway MCP). Pi is no-MCP by
   design; `gh`/`railway` CLIs cover those paths via bash.

4. **Hygiene:** `.pi/npm/` and `.pi/git/` gitignored (project-local pi package installs);
   `.pi/settings.json` and `.pi/prompts/` are committed config. Docs: runbook at
   `references/pi-harness.md` + one arsenal-table row in CLAUDE.md.

## Trust model

Project resources load only after trust: interactive `/trust`, or `-a/--approve` per
non-interactive run. Documented in the runbook.

## Verification

- `pi --version` → 0.83.0; `pi --list-models` shows Anthropic catalog (ANTHROPIC_API_KEY set).
- `pi -p -a` smoke prompt from repo root confirms: CLAUDE.md context loaded, all 6
  cherry-picked skills + `.agents/skills` visible, `/ship` `/stripe` `/ui-build` `/review`
  templates registered.

## Addendum (same day): embedded pi-agent-core runtime

Second integration layer: `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`
(^0.83.0) as server dependencies (repo is pnpm-managed — `pnpm add --ignore-scripts`; npm
crashes on the `.pnpm` tree). Integration module `server/_core/piAgent.ts` sits beside
`dimeAgent.ts` as the in-process counterpart to the subprocess-based Claude Agent SDK
runner.

Decisions:

- **Gateway routing per model, credentials via env.** pi-ai's Anthropic provider already
  resolves `ANTHROPIC_AUTH_TOKEN` (Bearer) before `ANTHROPIC_API_KEY` — identical order to
  `anthropicClient.ts` — so credentials need no plumbing. `resolvePiAgentModel()` spreads
  the catalog model with `baseUrl` = `ANTHROPIC_BASE_URL` when set (verified: `Model`
  carries `baseUrl`, checked in node_modules types, not guessed from README).
- **Result parity.** `runPiAgent()` returns the same shape as `runDimeAgent()`
  (`result/isError/numTurns/totalCostUsd/durationMs`) so call sites can swap runtimes.
- **Not wired into production chat.** `POST /api/dime/chat` and `DIME_CHAT_LLM_PROVIDER`
  are untouched; this is an available runtime, adoption is a separate decision.
- **No SQLite session backend** (`pi-storage-sqlite-node`) — in-memory suffices; add only
  when durable sessions are needed (YAGNI).

Verification: `npx tsc --noEmit` clean; live smoke via tsx — streamed
`message_update` deltas ("STREAM-OK") and `runPiAgent` completion
(`{result: "RUN-OK", isError: false, numTurns: 1, totalCostUsd: 0.000056}`) against
claude-haiku-4-5.

## Addendum 2 (same day): maximal integration

Scope change by owner directive: maximize all three packages, load the full skill corpus,
enforce a current-generation model policy, and build out the harness-neutral context-file
suite.

- **Skills maxed**: `.pi/settings.json` loads `.claude/skills` (99, `!`-excluding the 7
  uipro flats superseded by the newer vendored v2.11.0 build), vendored `pm-skills` (70),
  `dime-vendored` (31), `railway-skills` (1), plus auto `.agents/skills` (16); external
  packages `badlogic/pi-skills` and `anthropics/skills` recorded in `packages` (installed
  to gitignored `.pi/git/`, auto-installed on trust). All 27 `.claude/commands` load as
  prompt templates. Vendored `taste-skill` skipped (exact duplicates of flat copies).
- **Model policy** (`LLM.md`, authoritative): claude-fable-5 (default) / claude-opus-5 /
  openai-codex `gpt-5.6-sol` only — id verified in pi-ai's openai-codex catalog JSON.
  Enforced via settings (`defaultModel`, `enabledModels`) and
  `PI_AGENT_APPROVED_MODELS` in piAgent.ts (throws; `DIME_ALLOW_LEGACY_MODELS=1` escape
  hatch). openai + openai-codex providers registered in the embedded runtime.
- **Context files**: root `AGENTS.md` (universal root — NOTE: pi loads it INSTEAD of
  CLAUDE.md, first-match, so it carries the laws inline), `HARNESS.md`, `SKILLS.md`,
  `LLM.md`, `CODEX.md`; CLAUDE.md cross-references them.

## Addendum 3 (same day): pi as shipping backend — every surface exercised

Remaining pi surfaces wired and validated:

- **Extension** `.pi/extensions/dime-guard.ts`: mechanical law enforcement at the
  tool-call layer — blocks destructive git (force push, `reset --hard`, `clean -fd`,
  `checkout .`, `--no-verify`), blocks writes to `dime-ai/design-bundle/uploads/` and
  `.env*`, warns on `drizzle/**` (schema law). Live-verified: pi with Fable 5 attempted
  `git reset --hard HEAD~0` and the guard blocked it before execution.
- **Theme** `.pi/themes/dime.json`: dark base with brand-law substitutions (mint
  `#45E0A8` accent; purple `customMessageLabel` and gold `mdHeading` removed). Selected
  via `theme: "dime"` in settings.
- **System append** `.pi/APPEND_SYSTEM.md`: skill-triggering rule, model policy, ship
  law, verification rule — loader-verified as injected (mentions db-push.yml: true).
- **Ship entry points** (package.json): `pnpm run pi`, `pi:ship [PR#]` (interactive —
  /ship's authorization gates need a human), `pi:review` (headless), `pi:rpc`, `pi:json`.
- **RPC mode** live-verified: LF-JSONL `prompt` request → `{"success":true}` response →
  full agent event stream → assistant replied `RPC-OK`.
- **Loader audit** (deterministic, via pi's own DefaultResourceLoader): 227 skills /
  33 prompts / theme `dime` / 1 extension, zero duplicate names, zero load errors.

Operational note: the Anthropic API key ran out of credits at the end of this session's
validation (final APPEND_SYSTEM live check 400'd on billing; the deterministic loader
check covered it instead). Top up before relying on `pi:review`/`pi:ship`.

## Addendum 4 (same day): production chat through pi + session sharing

Owner direction: "wire these fully" — the two surfaces previously left out.

- **Dime Chat unfrozen onto pi.** `DIME_CHAT_LLM_PROVIDER` = `"pi"` (new provider value;
  the constant is deliberately hardcoded, so this IS the explicit owner-directed code
  change the freeze comment demands — it ends the 2026-07-12 freeze). The route branches
  to `runPiChat()` (piAgent.ts): embedded pi-agent-core Agent seeded with sanitized
  history, claude-fable-5, per-request token budget, request-scoped sessionId for prompt
  caching, and abort propagation. Everything else is shared with the retained
  `"anthropic"` path: context injection, verdict/certainty validation, cost metering,
  meta→delta→done SSE frames, error mapping. `"dime1"` stays inactive behind
  ml/dime-1.0/docs/RELEASE_GATES.md — it has no trained checkpoint; the gates govern that
  path, not the Claude/pi transport.
  Verified: `tsc --noEmit` clean; `server/_core/piAgent.test.ts` (5 tests) covers the
  model-policy allowlist, legacy-model rejection + override, and runPiChat history
  contract. Live end-to-end blocked only by API credits.
- **Session sharing via pi-share-hf, PRIVATE dataset.** Global `pi-share-hf` 0.5.0 +
  TruffleHog installed; workspace `.pi/hf-sessions/` initialized (gitignored), mapped to
  HF dataset `taileredsports/dime-ai-pi-sessions`. First `collect` processed all 8
  sessions: 0 secret redactions, 0 TruffleHog findings. LLM review failed on the
  exhausted API key → all 8 blocked → 0 uploadable: the fail-closed pipeline working as
  designed. Privacy stance: this is product code, not OSS, so the dataset must be
  PRIVATE; creation of the HF repo was denied by the session's permission layer (external
  resource creation) and is the one manual step:
  `hf repo create taileredsports/dime-ai-pi-sessions --repo-type dataset --private`,
  then `pi-share-hf review AGENTS.md CLAUDE.md SKILLS.md` and `pi-share-hf upload` once
  credits are restored.
