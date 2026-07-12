# LiveLab MCP Server

A local **stdio** MCP server (`packages/mcp-server/dist/mcp-server.cjs`) exposing the LiveLab runtime to any MCP client. Model-neutral by design: Claude Code and Codex consume identical tools; no model names or API keys appear anywhere in the server or runtime.

```bash
node livelab/packages/mcp-server/dist/mcp-server.cjs [--workspace <dir>]
# workspace resolution: --workspace > $LIVELAB_WORKSPACE > cwd
```

If no runtime is serving the workspace, session tools return a structured `RUNTIME_UNAVAILABLE` error and `livelab_start` launches a **headless** daemon — the server works fully with VS Code closed. When the extension is running, the server attaches to the *same* runtime, so agents inspect the very sessions the developer sees.

## Tools (36)

**Lifecycle** — `livelab_runtime_status`, `livelab_start`, `livelab_stop`
**Sessions** — `livelab_list_sessions`, `livelab_create_session`, `livelab_close_session`
**Navigation** — `livelab_navigate`, `livelab_reload`, `livelab_go_back`, `livelab_go_forward`
**Interaction** — `livelab_click`, `livelab_hover`, `livelab_type`, `livelab_press`, `livelab_select`, `livelab_scroll`, `livelab_wait_for_settle`
**Evidence** — `livelab_inspect`, `livelab_dom_snapshot`, `livelab_accessibility_snapshot` (tree or `axe:true` scan), `livelab_screenshot` (artifact path + optional inline image), `livelab_console`, `livelab_page_errors`, `livelab_network`, `livelab_start_trace`, `livelab_stop_trace`
**Testing** — `livelab_run_smoke`, `livelab_run_playwright`, `livelab_visual_compare` (`mode: compare|approve`), `livelab_run_approved_script`
**Watch** — `livelab_watch_status`, `livelab_watch_start`, `livelab_watch_stop`, `livelab_watch_changes`, `livelab_get_change_report`, `livelab_generate_report`

### Output contract

Every tool returns:
1. a one-line human summary,
2. bounded JSON (≤30KB, truncation flagged with guidance to use filters/cursors),
3. the same data as `structuredContent`,
4. for screenshots with `inline:true`, an MCP image content block.

Event tools (`livelab_console`, `livelab_page_errors`, `livelab_network`) are cursor-paginated: pass the returned `cursor` as `since` to get only new records. Console records carry dedup `count`s. Network output is sanitized (redacted headers/query params). Errors are structured `{code, kind, message}` — `kind` distinguishes LiveLab/infrastructure failures from application failures, and success is never fabricated.

## Resources (5)

```text
livelab://runtime/status
livelab://sessions
livelab://sessions/{sessionId}/current      # info + recent errors + recent failed requests
livelab://reports/{reportId}
livelab://artifacts/{artifactId}/metadata
```

There is **no arbitrary file read**: artifact access is limited to LiveLab-generated evidence by id.

## Recommended agent flow

1. `livelab_runtime_status` → is anything running? what capabilities?
2. Reuse sessions from `livelab_list_sessions`; only `livelab_start` when none exist.
3. After any action or code change: `livelab_wait_for_settle` before judging the UI.
4. Start cheap: console/network/page-error **deltas** via cursors.
5. `livelab_screenshot` only when visual confirmation is needed.
6. `livelab_inspect` + `livelab_accessibility_snapshot` for DOM-level evidence.
7. Run the smallest relevant check (`livelab_run_smoke` on one route beats a full sweep).
8. After a fix: re-run the same evidence path and report proof, not assumptions.
