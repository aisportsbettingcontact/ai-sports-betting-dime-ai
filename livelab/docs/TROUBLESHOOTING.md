# Troubleshooting LiveLab

Every LiveLab error states **what failed**, **whether the application or LiveLab failed** (`kind: infrastructure | validation | application`), the likely corrective action, and where evidence lives (`.livelab/`).

## Runtime

| Symptom | Cause → Fix |
|---|---|
| `BROWSER_NOT_INSTALLED` | Playwright Chromium missing → `npx playwright install chromium`. In containers set `PLAYWRIGHT_BROWSERS_PATH` or `LIVELAB_CHROMIUM_PATH`. |
| `RUNTIME_UNAVAILABLE` | No daemon for this workspace → `livelab start`, `livelab_start` (MCP), or **LiveLab: Open**. |
| "already serving this workspace" | One runtime per workspace by design → attach to it, or `livelab stop` / **LiveLab: Reset Runtime** first. |
| Stale lock after a crash | `LiveLab: Reset Runtime` (removes `runtime.json`/`runtime.lock` for dead pids automatically). |
| `PROTOCOL_MISMATCH` | Old runtime vs new client after an upgrade → stop the old runtime; it will restart on the new version. |
| High CPU while idle | Should not happen (streaming stops with the last subscriber). Check Diagnostics tree → dropped frames / active pages; file an issue with `.livelab/logs/runtime.jsonl`. |

## Dev server

| Symptom | Cause → Fix |
|---|---|
| `DEV_SERVER_FAILED … did not become ready` | Wrong script or port → check the captured `logTail` in the error details; try attach mode with the exact URL. |
| `SCRIPT_NOT_ALLOWED` | Script isn't on the allowlist → add it to `livelab.managedScripts` or `.livelab/config.json#scripts`. |
| URL not auto-detected | Framework prints an unusual URL → pass `expectedUrl` / use attach mode. |

## Preview

| Symptom | Cause → Fix |
|---|---|
| `HOST_NOT_ALLOWED` | Remote hosts are default-denied → add the exact hostname to `livelab.allowedHosts`. |
| Frame says `poll` instead of `live` | CDP screencast unavailable (non-Chromium or CDP failure) → functionality is identical at lower frame rate; see runtime log for the cause. |
| Session `crashed` | Renderer crash (application-side) → the frame shows crashed state; recover via reload (runtime recreates the page) — evidence in lifecycle events. |
| Input lands in the wrong place | Zoom/scale mismatch → report with device + zoom level; workaround: `fit` zoom. |

## Testing / evidence

| Symptom | Cause → Fix |
|---|---|
| `BASELINE_MISSING` | No approved baseline for that route/device → **Approve Visual Baseline** first. |
| `baseline-invalidated` | Viewport/engine changed since approval (by design, never auto-replaced) → re-approve deliberately. |
| Axe scan `unavailable` | `axe.min.js` asset missing from the install → rebuild (`npm run build`) or reinstall the VSIX. |
| `SETTLE_TIMEOUT` / `timedOut: true` | The app never went quiet (polling, animations) → raise `maxSettleMs`, or treat the named unresolved activity as the finding. |

## Extension

| Symptom | Cause → Fix |
|---|---|
| Commands show "open a folder first" | LiveLab needs a workspace folder. |
| "workspace trust is required" | Trust the workspace; untrusted mode only allows read-only attach previews. |
| Panel opens but stays blank | Check the LiveLab Output channel for daemon errors; run **LiveLab: Run Doctor**. |

## MCP

| Symptom | Cause → Fix |
|---|---|
| Tools missing in Claude Code/Codex | Config not loaded → re-run `livelab install-mcp --all`, restart the agent session, check `claude mcp list` / `codex mcp list`. |
| Headless start fails | `daemon.cjs` not found → build first, or set `LIVELAB_DAEMON_PATH`. |

## Diagnostics you can gather

- **LiveLab: Run Doctor** (or `livelab doctor --json`) — node/vscode/browser/runtime/ports/trust/URL/MCP-config/artifact-permission checks.
- `.livelab/logs/runtime.jsonl` — structured, redacted runtime log with correlation ids (workspace/runtime/session/navigation/report).
- Diagnostics tree — memory, active pages, dropped frames, capture latency.
