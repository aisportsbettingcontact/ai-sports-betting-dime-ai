# LiveLab Security Model

LiveLab runs browsers against your own code on your own machine. The threat model below covers every surface the spec requires, the control applied, and where it is enforced/tested.

## Threats and controls

| Threat | Control | Enforcement |
|---|---|---|
| **Malicious webview messages** | Extension host type-checks every message; unknown types are logged and ignored, never executed. Webview→runtime traffic is schema-validated (`ClientMessageSchema`) and token-gated. | `panel.ts#onMessage`, `api/ws.ts`; tested in MCP/integration suites for the runtime side |
| **Malicious page content** | Page output (console text, DOM, network bodies) is data: rendered via `textContent` in the webview, size-sliced and redacted in the runtime. Injected page scripts are read-only observers. | `session.ts`, `pageScripts.ts`, `webview main.ts` |
| **Prompt injection rendered inside the tested app** | MCP server instructions declare all page-derived content untrusted; tool outputs label evidence provenance. Nothing from a page ever becomes a command, script name, or URL without allowlist validation. | `server.ts` instructions; allowlists at every entry |
| **Arbitrary command execution** | No arbitrary command textbox anywhere. Only npm script *names* matching `^[a-zA-Z0-9:_-]+$` AND present on the user-editable allowlist run — always `spawn(npm, ['run', name], {shell:false})`. | `security/allowlist.ts`, `devserver/manager.ts`; unit + integration tested |
| **Localhost exposure** | Runtime binds `127.0.0.1` only (never `0.0.0.0`); the discovery schema rejects any other host. All routes except `GET /health` require the bearer token (constant-time compare). | `daemon.ts`, `discovery.ts` schema, `core.ts#checkToken`; integration-tested (401) |
| **Runtime-token theft** | 32-byte random token per runtime, stored in `.livelab/runtime.json` chmod 0600, gitignored by a generated `.livelab/.gitignore`, never logged (log redaction scrubs bearer/token shapes). | `ids.ts#newToken`, `paths.ts#writeFileOwnerOnly`, `config.ts#ensureGitignore`; unit-tested (0600) |
| **Path traversal** | Every user/agent-supplied path resolves through `resolveInside(root, p)` which rejects `..` escapes after resolving the deepest existing ancestor. | `util/paths.ts`; unit + integration tested (`storageStatePath: ../../etc/passwd` → 403 `PATH_NOT_ALLOWED`) |
| **Symlink traversal** | `resolveInside` realpath-resolves before the containment check; symlinks pointing outside the root are rejected. | unit-tested with a real symlink |
| **Artifact exfiltration** | No arbitrary file reads over MCP or HTTP. Artifact access goes through the metadata index; content is served only for ids the store created, from paths confined to `.livelab/`. | `artifacts/store.ts`, `resources.ts`; MCP contract test |
| **Secret-bearing URLs and headers** | Configurable redaction (headers: authorization, cookie, set-cookie, x-api-key, …; query params: token, key, api_key, access_token, …) applied at capture time — before persistence, before logs, before MCP output. Free text additionally scrubbed for bearer/JWT/API-key shapes. | `protocol/redaction.ts`; unit + integration + MCP tested |
| **Browser storage leakage** | One isolated `BrowserContext` per session; contexts are closed with the session; storage/cookies/service-worker clearing exposed as explicit actions. Auth state comes only from a user-owned storage-state file, path-confined. | `session.ts` |
| **Workspace trust** | Untrusted workspaces cannot start dev servers, run scripts, or watch files: gated in the extension (UI), and independently in the runtime (`assertTrusted` — daemon is only started `--trusted` when VS Code reports trust). | `extension/commands.ts`, `core.ts#assertTrusted`; extension test asserts `limited` declaration |
| **MCP tool permissions** | Server is project-scoped (explicit `.mcp.json` / `.codex/config.toml`); every tool validates input; script/URL/path allowlists apply identically to agent calls. Claude Code additionally prompts per-tool by default. | `tools.ts`, runtime allowlists |
| **DoS from unbounded logs/frames** | Ring buffers (console 500 / network 1000 / lifecycle 200, configurable), 1MB HTTP body cap, 256KB WS payload cap, WS frame drop above 2MB backpressure, fps clamp, artifact size budget with oldest-first pruning, report count cap (200), JSON log size cap. | throughout; unit-tested ring bounds + artifact pruning |
| **Cross-workspace runtime attachment** | Discovery records embed the absolute workspace root; clients refuse records whose root differs; workspace lock prevents duplicate runtimes; protocol-major mismatch refuses attach (`PROTOCOL_MISMATCH`). | `discovery.ts`, `client.ts`; unit + integration tested |
| **Dependency compromise** | Committed `package-lock.json`; CI runs `npm audit` (high+) and the repo's existing gitleaks secret scanning covers this tree; pinned `playwright-core`. | `.github/workflows/livelab-ci.yml` |
| **Remote URLs** | Default deny: only localhost/127.0.0.1/[::1] plus explicitly allowlisted hostnames (exact match — no implicit subdomains); http/https only. | `security/allowlist.ts`; tested at unit, integration (403), and MCP layers |

## Webview hardening

- CSP: `default-src 'none'`; scripts require a per-load nonce; styles/images restricted to the extension origin (+`data:` for frames); `connect-src` limited to `http://127.0.0.1:*` and `ws://127.0.0.1:*`.
- `localResourceRoots` limited to the extension `media/` directory.
- Captured page HTML is never injected into the webview — the preview is a rendered bitmap (screencast), and inspector output renders as text.

## Reporting

Local project — report issues via the repository issue tracker. Do not include captured artifacts in reports without checking them for secrets first; redaction is defense-in-depth, not a guarantee.
