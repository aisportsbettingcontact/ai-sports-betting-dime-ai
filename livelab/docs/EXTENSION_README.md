# LiveLab

Live multi-device browser laboratory for VS Code.

LiveLab puts real, interactive Chromium sessions beside your code: concurrent phone/tablet/laptop/desktop viewports with live refresh from Vite, Next.js, and other local dev servers; console/network/error diagnostics; screenshots, traces, and visual regression; and a local MCP server that gives Claude Code and Codex structured access to the **same** browser sessions you see.

## Quick start

1. Open a web project.
2. Run **LiveLab: Open** from the command palette.
3. Pick a detected dev server (or **LiveLab: Attach to URL**).
4. Build — previews refresh live; diagnostics stream into the details drawer.

## Agent access

Run **LiveLab: Configure MCP** to write project-scoped configuration for Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`). Both agents talk to the same runtime the extension uses, so they can inspect exactly what you see. The MCP server also works headlessly when VS Code is closed.

## Notes

- The interactive live-preview engine is Chromium. Playwright WebKit runs as a separate, explicitly-labeled verification pass — it is not Safari parity. A capability-gated iOS Simulator adapter is available on macOS with Xcode tools.
- Evidence (screenshots, traces, reports, logs) is stored under `.livelab/` in your workspace and is gitignored by default.
- LiveLab requires workspace trust to start dev servers, run allowlisted npm scripts, or watch files. Remote URLs are blocked unless you allowlist the host in `livelab.allowedHosts`.

Full documentation: see the `docs/` directory of the LiveLab source tree (ARCHITECTURE, SECURITY, CONFIGURATION, MCP, CLAUDE_CODE, CODEX, TESTING, TROUBLESHOOTING).
