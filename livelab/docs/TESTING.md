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

## Regression test scenarios (CI incident 2026-07-12, PR #78)

Formal scenarios for the two CI regressions; each maps to an executable test that now runs on every push.

### Scenario R1: Dependency audit gate stays clean at high severity

**Test Objective:** Verify the dependency tree contains no high/critical advisories and that mocha functions on the overridden transitive versions (`serialize-javascript ≥7.0.5`, `diff ≥8.0.3`).

**Starting Conditions:**
- Fresh clone; `npm ci` from the committed `livelab/package-lock.json`
- `overrides` present in `livelab/package.json`

**User Role:** CI (every push/PR touching `livelab/**`) or any developer

**Test Steps:**
1. `npm ci` → installs without lockfile drift errors
2. `npm ls serialize-javascript diff` → both report `overridden`, versions ≥7.0.5 / ≥8.0.3
3. `npm audit --audit-level=high` → exit 0, "found 0 vulnerabilities"
4. `npm run test:extension` → mocha executes the 8-test suite (proves the overridden deps don't break mocha's runtime)

**Expected Outcomes:**
- Audit exit code 0 on every OS leg
- Extension suite passes (mocha reporter + runner intact)
- Any future advisory in the tree fails the ubuntu leg loudly (gate intentionally blocking there)

**Edge cases covered:** `npm audit fix` no-op when patched versions sit outside a dependent's semver range (the original failure mode) — remediated via `overrides`, which `npm ci` enforces deterministically.

**Executable form:** CI steps "Dependency audit (high+)" + "Extension tests"; verified locally 2026-07-12 (0 vulnerabilities; 8/8 extension tests).

### Scenario R2: Artifact paths remain workspace-relative under a symlinked workspace root

**Test Objective:** Verify every artifact `path` is a clean `.livelab/...` workspace-relative path even when the workspace root is reached through a symlink (macOS `os.tmpdir()`: `/var/folders → /private/var/folders`), and that runtime discovery identity matches across symlinked/canonical spellings of the same workspace.

**Starting Conditions:**
- A real directory plus a symlink pointing at it (test creates both; on macOS CI, `os.tmpdir()` provides the topology naturally)
- Runtime daemon started **through the symlinked path**

**User Role:** Runtime daemon + any client (MCP agent, CLI, extension)

**Test Steps:**
1. Start the daemon with `workspaceRoot = <symlink>` → discovery record's `workspaceRoot` is canonical (`realpath` of itself equals itself)
2. Create a Chromium session and capture a screenshot (exercises the `subdir` branch through `resolveInside`) → returned `artifact.path` matches `^\.livelab/artifacts/`
3. Resolve `path.join(<symlink>, artifact.path)` and `path.join(<realdir>, artifact.path)` → file exists via both spellings
4. `ArtifactStore.absolutePathFor(meta)` → resolves inside `.livelab`, no traversal rejection
5. MCP `RuntimeClient` constructed with the **symlinked** path → attaches to the running daemon (identity compare passes)

**Expected Outcomes:**
- No `../` segments or absolute prefixes in any artifact metadata path
- Discovery identity check never refuses the same workspace spelled two ways
- Windows unaffected (scenario skipped where unprivileged symlink creation is unavailable; `realpathSync` also normalizes 8.3 short names)

**Edge cases covered:** subdir vs non-subdir reserve branches; store constructed directly vs via daemon; cross-client identity (daemon canonical vs client symlinked).

**Executable form:** unit `ArtifactStore under a symlinked workspace root` + integration `symlinked workspace root (macOS tmpdir topology)`; macOS CI additionally re-exercises the original failing MCP contract test end-to-end.
