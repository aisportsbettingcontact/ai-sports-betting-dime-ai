# LiveLab + Claude Code

## Installation

1. Build LiveLab once: `cd livelab && npm install && npm run build`
2. Register the MCP server (project-scoped):

```bash
node livelab/packages/cli/dist/cli.cjs install-mcp --claude --workspace .
# or from VS Code: “LiveLab: Configure MCP”
```

This merges a `livelab` entry into `.mcp.json` at the project root (existing servers preserved):

```json
{
  "mcpServers": {
    "livelab": {
      "command": "node",
      "args": ["livelab/packages/mcp-server/dist/mcp-server.cjs"],
      "env": {}
    }
  }
}
```

Manual alternative (registers the same compiled server):

```bash
claude mcp add livelab --scope project -- node "$(pwd)/livelab/packages/mcp-server/dist/mcp-server.cjs"
```

Restart your Claude Code session; approve the project-scoped server when prompted.

## Project-scoped setup notes

- The server resolves its workspace from the process cwd (Claude Code launches project servers at the project root). For out-of-tree use pass `--workspace <dir>` in the args.
- Only required environment is inherited; no API keys are read or needed.

## Permission guidance

- Tools that only read evidence (`livelab_console`, `livelab_network`, `livelab_screenshot`, `livelab_inspect`, …) are safe to allow broadly.
- `livelab_run_approved_script` / `livelab_run_playwright` execute allowlisted npm scripts — review the allowlist (`livelab.managedScripts` + `.livelab/config.json#scripts`) before granting standing approval.
- `livelab_start`/`livelab_stop` manage a local daemon bound to 127.0.0.1.

## Tool list

See [MCP.md](MCP.md) — 36 tools + 5 resources; identical for every MCP client.

## Example prompts

- "Check the runtime status, then screenshot the iPhone 16 session and tell me if the nav overlaps the logo."
- "Run the smoke suite on `/checkout` and summarize failures with evidence paths."
- "Start watch mode, then fix the overflow on mobile — use the change reports to prove the fix."
- "Compare the visual baseline for `/` and show me the diff ratio."

## Optional skill

`.claude/skills/livelab/SKILL.md` (installed at the repo root) teaches Claude Code the evidence-first flow: status → reuse sessions → settle → deltas → screenshot-when-needed → smallest test → focused change → re-verify → report proof. No Claude hooks are required or installed.

## Troubleshooting

| Problem | Fix |
|---|---|
| Tools missing in Claude Code | restart the session; check `.mcp.json` was approved; `claude mcp list` |
| `RUNTIME_UNAVAILABLE` | call `livelab_start`, or run `livelab start` in a terminal, or open LiveLab in VS Code |
| `HOST_NOT_ALLOWED` | add the host to `livelab.allowedHosts` (or CLI `--allowed-hosts`) |
| Server exits immediately | `node livelab/packages/mcp-server/dist/mcp-server.cjs` manually and read stderr |

## Security model

The server talks only to the loopback runtime with a per-workspace token; page content is treated as untrusted data; scripts/URLs/paths are allowlist-gated; secrets are redacted before any output reaches the model. Details: [SECURITY.md](SECURITY.md).

## Disabling

Remove the `livelab` entry from `.mcp.json` (or `claude mcp remove livelab`). Stop a running headless daemon with `livelab stop`.
