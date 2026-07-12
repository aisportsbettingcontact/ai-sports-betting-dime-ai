# LiveLab + Codex

## Installation

1. Build LiveLab once: `cd livelab && npm install && npm run build`
2. Register the MCP server:

```bash
node livelab/packages/cli/dist/cli.cjs install-mcp --codex --workspace .
```

This writes/merges `.codex/config.toml` in the project:

```toml
[mcp_servers.livelab]
command = "node"
args = ["<absolute path>/livelab/packages/mcp-server/dist/mcp-server.cjs"]
```

Manual alternative (same compiled server):

```bash
codex mcp add livelab -- node "$(pwd)/livelab/packages/mcp-server/dist/mcp-server.cjs"
```

## IDE extension setup

The Codex IDE extension shares MCP configuration with the CLI. With the project config in place (or the server added via `codex mcp add`), the `livelab` server and its tools appear in both environments. If your Codex version only reads the global `~/.codex/config.toml`, run the `codex mcp add` command above — it registers globally and works for every project (pass `--workspace` in args to pin one project).

## CLI setup

`codex` picks up the same configuration; verify with:

```bash
codex mcp list
```

## Model neutrality

No model name is hardcoded anywhere — you select the model in the Codex client, and the integration keeps working across model changes. Codex and Claude Code point at the **same** compiled server binary and therefore inspect the same live browser sessions (proven by the shared-session e2e test).

## Tool list

See [MCP.md](MCP.md).

## Example prompts

- "Use livelab_runtime_status, then list sessions and screenshot the desktop viewport."
- "Navigate the phone session to /pricing, wait for settle, and report any console errors since the last cursor."
- "Run livelab_run_smoke on '/' and '/checkout' and fix the first failing check."

## Troubleshooting

| Problem | Fix |
|---|---|
| Server not listed | `codex mcp list`; re-run install-mcp; check TOML syntax in `.codex/config.toml` |
| `RUNTIME_UNAVAILABLE` | `livelab_start` tool, `livelab start` in a terminal, or open LiveLab in VS Code |
| Node not found | ensure `node` ≥ 20 is on PATH for the Codex process |

## Security model

Identical to Claude Code's: loopback-only runtime, per-workspace token, allowlisted scripts/hosts/paths, redaction before output. Details: [SECURITY.md](SECURITY.md).

## Disabling

Delete the `[mcp_servers.livelab]` block from `.codex/config.toml` (or `codex mcp remove livelab`). Stop a running headless daemon with `livelab stop`.
