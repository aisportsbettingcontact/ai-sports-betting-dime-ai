# LiveLab

**A live multi-device browser laboratory inside VS Code, with a shared agent bridge for Claude Code and Codex.**

LiveLab puts real, interactive Chromium sessions beside your code: concurrent phone / tablet / laptop / desktop viewports with live refresh from Vite, Next.js, and other local dev servers; console, network, and error diagnostics; screenshots, Playwright traces, and visual regression; and a local MCP server that gives Claude Code and Codex structured access to the **same** browser sessions you see in the editor.

## What LiveLab is

- A **VS Code extension** — side-by-side device panel, commands, settings, diagnostics trees, dev-server controls.
- A **Playwright runtime daemon** — owns the actual Chromium sessions, inputs, screenshots, traces, console/network events, and responsive viewports. Live frames stream over CDP `Page.startScreencast` (screenshot-polling fallback).
- A **local MCP server** (stdio) — 36 model-neutral tools + 5 resources over the same runtime, usable by Claude Code and Codex, including headlessly when VS Code is closed.
- An **agent watch pipeline** — detects code changes, waits for HMR to settle, checks every selected viewport, captures bounded evidence, runs smoke assertions, and reports regressions.

## What LiveLab is not

- **Not an iframe mockup.** Every visible device frame maps to a real Playwright Chromium page; the browser runtime is the source of truth.
- **Not Safari parity.** Chromium is the interactive live-preview engine. Playwright WebKit runs as a separate, explicitly labeled verification pass. A capability-gated iOS Simulator adapter (real `xcrun simctl`) exists on macOS with Xcode tools.
- **Not a cloud service.** Everything binds to `127.0.0.1` with a per-workspace bearer token. No model API keys are embedded; no telemetry leaves your machine.

## Requirements

- Node.js ≥ 20
- VS Code ≥ 1.96 (for the extension; the runtime, CLI, and MCP server work standalone)
- Playwright Chromium (`npx playwright install chromium`) — auto-detected via `PLAYWRIGHT_BROWSERS_PATH` in pre-provisioned containers

## Build and install from source

```bash
cd livelab
npm install
npm run build
npm test          # unit + runtime integration + MCP contract suites
npm run package   # → artifacts/livelab-<version>.vsix
code --install-extension ./artifacts/livelab-*.vsix
```

Additional verification suites:

```bash
npm run test:extension          # real VS Code host via @vscode/test-electron (Xvfb on Linux)
npm run test:e2e                # full Vite test-app: HMR, watch, visual diff, MCP shared access
node scripts/clean-profile-test.mjs  # installs the VSIX into a fresh VS Code profile and re-proves the flow
```

## First use

1. Open a web project in VS Code.
2. Run **LiveLab: Open** — the panel opens beside your code with the default devices (iPhone 16 + Desktop 1440).
3. Pick a detected dev server and press **start**, or type a URL and press **attach**.
4. Build. Previews refresh live; console/network/error diagnostics stream into the details drawer.

### Starting and attaching to a server

- **start** runs an allowlisted npm script (`livelab.managedScripts`) with `shell: false`, captures its output, discovers the URL, and health-polls until ready. Vite, Next.js, Astro, Remix, Nuxt, SvelteKit, and generic `dev`/`start` scripts are detected automatically.
- **attach** points LiveLab at an already-running server without managing its process.

### Adding devices

**LiveLab: Add Device** or the **+ device** toolbar button. Presets: iPhone 13 mini, iPhone 16, iPhone 16 Plus, compact/standard Android, iPad mini portrait, iPad landscape, laptop 1366, desktop 1440, large desktop 1728. Workspace-specific presets go in `.livelab/config.json`.

### Running tests

- **LiveLab: Run Responsive Smoke Test** — loads each configured route in each session and checks: page loads, no page errors, no console errors (with ignores), no failed critical requests, visible landmark, horizontal overflow, reachable controls, focus indicators, fixed/sticky coverage, screenshot capture, plus your own assertions from `.livelab/config.json`.
- **LiveLab: Approve / Compare Visual Baseline** — explicit-approval baselines with browser/viewport metadata; diffs via pixelmatch; baselines are invalidated (never silently replaced) when the viewport or engine changes.
- **LiveLab: Start Agent Watch** — every source change produces one bounded change report (new errors only, resolved errors, network failures, screenshots, a11y findings, suggested source locations, event cursors) under `.livelab/reports/`.

## Connecting Claude Code

```bash
npx livelab install-mcp --claude      # or: LiveLab: Configure MCP from VS Code
```

Writes a project-scoped `.mcp.json` entry that launches the compiled MCP server. See [docs/CLAUDE_CODE.md](docs/CLAUDE_CODE.md).

## Connecting Codex

```bash
npx livelab install-mcp --codex
```

Writes `.codex/config.toml` pointing at the **same** compiled server (Codex IDE extension and CLI share this config). See [docs/CODEX.md](docs/CODEX.md).

Both agents can inspect the same active sessions the extension displays — the proof is automated in `test/e2e/livelab.e2e.test.ts` ("MCP client inspects the very same sessions").

## Security and privacy

- Default-deny remote hosts; only allowlisted hosts can be previewed.
- Per-workspace random bearer token; discovery file written `0600`; loopback binding only.
- Sensitive headers/query parameters redacted before persistence and before any agent output.
- Only allowlisted npm scripts run, always `shell: false`; workspace trust gates all project execution.
- Page content is treated as untrusted data — never as agent instructions.

Full threat model: [docs/SECURITY.md](docs/SECURITY.md).

## Browser accuracy limitations

Device presets emulate viewport, DPR, touch, and user agent. They are **not** exact physical-device simulations except where a Playwright device descriptor exists (labeled in the picker). WebKit verification is Playwright's WebKit build — close to, but not identical to, a shipping Safari. The only true-iOS path is the macOS-only iOS Simulator adapter.

## Common failures

| Symptom | Fix |
|---|---|
| "chromium is not installed" | `npx playwright install chromium` |
| Remote URL blocked | add the host to `livelab.allowedHosts` |
| "workspace is not trusted" | trust the workspace (Manage Workspace Trust) |
| Runtime port conflict / stale state | **LiveLab: Reset Runtime**, then reopen |
| Extension tests can't download VS Code | check proxy/firewall; see docs/TESTING.md |

More: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Uninstall and cleanup

```bash
code --uninstall-extension livelab.livelab
rm -rf .livelab                 # per-workspace evidence, reports, runtime state
rm -f .mcp.json .codex/config.toml   # or remove just the livelab entries
```

The runtime daemon exits automatically when its owning process disappears; `livelab stop` shuts a headless runtime down explicitly.

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [CONFIGURATION](docs/CONFIGURATION.md) · [MCP](docs/MCP.md) · [CLAUDE_CODE](docs/CLAUDE_CODE.md) · [CODEX](docs/CODEX.md) · [TESTING](docs/TESTING.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md) · [IMPLEMENTATION_LEDGER](docs/IMPLEMENTATION_LEDGER.md)
