# Testing LiveLab

Five suites; no test depends on an external production website (fixtures are local HTTP servers and the bundled Vite test app).

| Suite | Command | What it proves |
|---|---|---|
| Unit (45 tests) | `npm run test:unit` | protocol schemas, version negotiation, redaction, URL/script allowlists, coordinate-free ring + cursor pagination, glob matching, path/symlink confinement, discovery locking, artifact budget, report aggregation, config defaults/migration, install-mcp writers |
| Runtime integration (23) | `npm run test:integration` | real daemon + real Chromium: launch, sessions, navigation, console/page-error/failed-request capture, redaction at capture, screenshot, trace, locator input dispatch, settle timeout reporting, multi-session isolation, crash recovery, HAR export, auth (401), malformed input (400), traversal (403), smoke pass/fail, visual approve/compare/invalidate, watch trigger, cleanup |
| MCP contract (17) | `npm run test:mcp` | stdio init, 34-tool discovery, resources, schema + value-level rejection, runtime-unavailable behavior, cursor pagination, redaction, session isolation, artifact constraints, structured errors, smoke via MCP |
| VS Code extension (8) | `npm run test:extension` | real VS Code (downloaded by `@vscode/test-electron`, Xvfb on Linux): activation (passive, no runtime spawn), untrusted-workspace declaration, all 22 commands registered, settings defaults, `LiveLab: Open` → webview panel + extension-owned daemon with 0600 discovery + authorized status, disposal via Reset Runtime, panel state restoration |
| End-to-end (8) | `npm run test:e2e` | bundled Vite app through the managed dev-server path: two simultaneous devices, real input driving page state, deliberate error routes captured, screenshots, smoke healthy-vs-broken findings, **HMR settle → watch change report → visual diff fail → restore → pass**, Claude/Codex-style MCP client inspecting the same sessions, ARIA + Axe |

`npm test` = unit + integration + MCP (the suites that need no display). Extension/e2e run separately and in CI.

## Clean-profile installation test

```bash
npm run package
node scripts/clean-profile-test.mjs
```

Installs the VSIX into a fresh VS Code profile (`--user-data-dir`/`--extensions-dir` in a temp dir), verifies `livelab.livelab` is listed, then launches that VS Code with **only the installed extension** (development path is an empty stub) and re-proves activate → open → runtime attach → navigate → screenshot.

## Writing smoke assertions for your app

Add entries to `.livelab/config.json#smoke.assertions` (`elementVisible`, `elementText`, `urlMatches`, `noSelector`). They run in every smoke pass and every watch cycle.

## CI

`.github/workflows/livelab-ci.yml` (repo root, scoped to `livelab/**`) runs on Ubuntu, macOS, and Windows: install → playwright chromium install → typecheck → lint → unit → integration → MCP → extension tests (Xvfb via the runner script) → build → VSIX packaging → artifact upload, plus `npm audit` for dependency scanning. gitleaks already scans the whole repository in the existing workflow.
