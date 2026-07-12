# LiveLab Architecture

```text
livelab/                       npm-workspaces monorepo (self-contained)
├── packages/
│   ├── protocol/              single source of truth: zod schemas, device presets,
│   │                          error codes, redaction, protocol version negotiation
│   ├── runtime/               local Node daemon: Playwright sessions, HTTP+WS API,
│   │                          telemetry rings, artifacts, smoke/visual/watch engines
│   ├── mcp-server/            stdio MCP server (36 tools, 5 resources) → runtime HTTP
│   ├── webview-ui/            vanilla-TS webview bundle (device grid, drawer, toolbar)
│   ├── cli/                   `livelab` CLI → runtime HTTP (+ install-mcp writers)
│   └── test-app/              Vite app with healthy + deliberately broken routes
├── apps/vscode-extension/     activation, commands, trees, panel, runtime lifecycle
├── scripts/                   build/bundle/package/clean-profile-test orchestration
├── docs/                      this documentation set
└── artifacts/                 packaged VSIX output
```

## Why each package exists

**protocol** — every boundary (HTTP body, WS message, MCP tool input, config file, discovery record) validates against these zod schemas. One package prevents drift between the extension, webview, runtime, CLI, and MCP server.

**runtime** — the source of truth. One daemon per workspace owns the shared Playwright browser (one Chromium process; one isolated `BrowserContext` per device session). It exposes:

- `HTTP 127.0.0.1:<random>` — sessions, navigation, input, evidence, smoke, visual, watch, dev-server control, artifacts, reports. Bearer-token auth on everything except `GET /health`.
- `WS /ws` — screencast frames (CDP `Page.startScreencast`, JPEG, ack-driven, fps-clamped, backpressure-dropped) + live event digests + validated input events.
- Discovery record `.livelab/runtime.json` (0600) + `runtime.lock` — one compatible runtime per workspace; clients verify pid liveness, protocol major, and workspace identity before attaching.

Two ownership modes: **extension-owned** (VS Code spawns it with `--parent-pid`, orphan watchdog exits when VS Code dies) and **headless** (MCP server or CLI spawns it detached when VS Code is closed).

**mcp-server** — model-neutral bridge. No model-specific logic exists anywhere in the runtime; Claude Code and Codex consume identical tools. Auto-starts a headless runtime on demand. Bounded output: one-line summary + ≤30KB JSON + cursors for deltas.

**webview-ui** — 6.4KB gzip vanilla-TS bundle. Connects *directly* to the runtime WS (CSP `connect-src` restricted to `127.0.0.1`) using the token the extension hands over at init, so screencast frames do not double-hop through the extension host. Coordinate mapping (canvas scale → page CSS pixels) happens here before input dispatch. All page-derived text renders via `textContent`.

**cli** — `livelab start/stop/status/open/devices/screenshot/smoke/report/doctor/install-mcp`; reuses the same runtime, `--json` everywhere, meaningful exit codes (0 ok / 1 failure / 2 validation).

**vscode-extension** — passive activation (<300ms, no browser). `LiveLab: Open` spawns the packaged daemon (`dist/runtime/daemon.cjs`) via `ELECTRON_RUN_AS_NODE`, opens the panel in ViewColumn.Two, and hands the webview the runtime port + token. Trees poll `/status`; commands map to runtime endpoints; workspace trust gates dev-server/script/watch operations.

## Event model

Each session has one monotonically increasing sequence counter shared across three bounded rings (console+pageError, network+websocket, lifecycle). Every query returns `{items, cursor, truncated, totalMatched}`; clients pass `since=cursor` for deltas. Consecutive identical console records fold into `count` without losing occurrence totals.

## Settle coordination

A session tracks `lastActivityAt` (bumped by console/network/lifecycle events, in-flight requests, and DOM mutations reported by a context-level `MutationObserver` binding) plus an in-flight request counter. `waitForSettle(quietWindowMs, maxSettleMs)` resolves when both are quiet, or reports `timedOut` with named unresolved activity. Vite/Next HMR WebSocket frames are recognized and recorded as `hmr` lifecycle events.

## Watch pipeline

chokidar (v4, path-filtered by include/exclude globs) → 350ms debounce batch → settle all sessions → per session: error/network deltas since the previous cycle's cursor, resolved-error diff, screenshot (+optional full-page), ARIA + visible-text digest, quick a11y findings, configured assertions, optional visual compare, stack-trace→source mapping → one `ChangeReport` persisted to `.livelab/reports/` and announced to listeners. Reports are bounded (counts capped, strings sliced) — frames stay on disk, only paths travel to agents.

## Build pipeline

`tsc -b` (project references, strict) for typechecking + library dist, then esbuild single-file bundles: `daemon.cjs` (external: playwright-core), `mcp-server.cjs`, `cli.cjs`, `webview.js` (iife, minified, 500KB-gzip budget enforced), `extension.js` (external: vscode). `npm run package` stages the extension with a real `node_modules/playwright-core` and runs `vsce package` → `artifacts/livelab-<version>.vsix`.
