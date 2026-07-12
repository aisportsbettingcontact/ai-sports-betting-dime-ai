# Changelog

## 0.1.0 — 2026-07-12

Initial release.

- Side-by-side interactive Chromium device previews inside VS Code (CDP screencast with screenshot-poll fallback).
- Ten restrained device presets (phone/tablet/laptop/desktop) + workspace-defined presets in `.livelab/config.json`.
- Dev-server detection (Vite, Next.js, Astro, Remix, Nuxt, SvelteKit, generic npm scripts), managed start/stop and attach-only mode with script allowlisting.
- Console, page-error, network, WebSocket, and lifecycle telemetry with bounded ring buffers, sequence cursors, dedup counts, and secret redaction.
- Element inspector with stable locator candidates (role → label → placeholder → text → testId → css) and layout-issue detection.
- Screenshot, full-page screenshot, Playwright trace, DOM outline, accessibility (ARIA + on-demand Axe) capture.
- Responsive smoke suite; visual baselines with explicit approval, metadata invalidation, and pixelmatch diffs.
- Agent watch pipeline: file change → HMR settle → per-viewport evidence → bounded change report.
- Local stdio MCP server (36 tools, 5 resources) shared by Claude Code and Codex; headless mode without VS Code.
- `livelab` CLI: start/stop/status/open/devices/screenshot/smoke/report/doctor/install-mcp.
- Playwright WebKit verification mode (explicitly labeled) and capability-gated macOS iOS Simulator adapter.
