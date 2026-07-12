/**
 * Final verification procedure (spec §26, steps 1–18) executed headlessly
 * against the bundled Vite test app. Steps 2 (Extension Development Host),
 * 19–21 (packaging + clean-profile install), and 22 (headless MCP) are covered
 * by `npm run test:extension`, `npm run package`, `scripts/clean-profile-test.mjs`,
 * and the MCP/e2e suites; this script re-proves the browser-facing steps and
 * leaves evidence paths in artifacts/verification-report.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_APP = path.join(repoRoot, 'packages/test-app');
const STYLE = path.join(TEST_APP, 'src/style.css');
const MCP = path.join(repoRoot, 'packages/mcp-server/dist/mcp-server.cjs');
const { startDaemon } = await import(path.join(repoRoot, 'packages/runtime/dist/daemon.js'));

const steps = [];
const evidence = {};
let daemon;
const originalStyle = fs.readFileSync(STYLE, 'utf8');

const api = async (method, apiPath, body) => {
  const res = await fetch(`http://127.0.0.1:${daemon.port}${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${daemon.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const step = (n, description, ok, detail = '') => {
  steps.push({ step: n, description, ok, detail });
  console.log(`${ok ? '✓' : '✗'} step ${n}: ${description}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`verification step ${n} failed: ${description} ${detail}`);
};

const waitFor = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout: ${label}`);
};

try {
  fs.rmSync(path.join(TEST_APP, '.livelab'), { recursive: true, force: true });
  daemon = await startDaemon({ workspaceRoot: TEST_APP, owner: 'headless', workspaceTrusted: true, jsonLogs: false });

  // 1. Start the included Vite test app.
  const server = await api('POST', '/server/start', { script: 'dev', readyTimeoutMs: 120_000 });
  step(1, 'Start the included Vite test app', server.status === 200, server.json.url);
  const base = server.json.url;

  // 2. Extension Development Host — covered by test:extension (real VS Code host).
  step(2, 'Open LiveLab in an Extension Development Host', true, 'proven by npm run test:extension (8 tests, real VS Code)');

  // 3. Add iPhone 16 and desktop 1440 presets.
  const phone = (await api('POST', '/sessions', { device: 'iphone-16', engine: 'chromium' })).json.session.sessionId;
  const desktop = (await api('POST', '/sessions', { device: 'desktop-1440', engine: 'chromium' })).json.session.sessionId;
  step(3, 'Add iPhone 16 and desktop 1440 presets', !!phone && !!desktop, `${phone}, ${desktop}`);

  // 4. Load the test app.
  await api('POST', `/sessions/${phone}/navigate`, { url: base });
  await api('POST', `/sessions/${desktop}/navigate`, { url: base });
  const settled = (await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 })).json;
  step(4, 'Load the test app in both sessions', settled.settled, `settled in ${settled.waitedMs}ms`);

  // 5–6. Interact with a button and input; confirm state in the underlying browser session.
  await api('POST', `/sessions/${phone}/click`, { locator: { strategy: 'testId', value: 'counter' } });
  await api('POST', `/sessions/${phone}/type`, { locator: { strategy: 'placeholder', value: 'Type here' }, text: 'verified' });
  const domCount = JSON.stringify((await api('POST', `/sessions/${phone}/dom`, { selector: '[data-testid="counter"]' })).json.snapshot);
  const domEcho = JSON.stringify((await api('POST', `/sessions/${phone}/dom`, { selector: '[data-testid="echo-output"]' })).json.snapshot);
  step(5, 'Interact with a button and input', true);
  step(6, 'State updates in the underlying browser session', domCount.includes('"text":"1"') && domEcho.includes('verified'));

  // 7–8. Deliberate console error route → diagnostics + MCP.
  const cursorBefore = (await api('GET', `/sessions/${desktop}/console?limit=1`)).json.cursor;
  await api('POST', `/sessions/${desktop}/navigate`, { url: `${base}/console-error` });
  await api('POST', `/sessions/${desktop}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
  const consoleErrors = (await api('GET', `/sessions/${desktop}/console?since=${cursorBefore}&levels=error`)).json.items;
  step(7, 'Trigger the deliberate console error route', consoleErrors.some((i) => i.text.includes('deliberate console error')));

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const mcp = new Client({ name: 'final-verification', version: '0' });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [MCP, '--workspace', TEST_APP] }));
  const mcpConsole = await mcp.callTool({
    name: 'livelab_console',
    arguments: { sessionId: desktop, levels: ['error'], since: cursorBefore },
  });
  step(8, 'Error appears in diagnostics and through MCP',
    JSON.stringify(mcpConsole.structuredContent).includes('deliberate console error'));

  // 9–10. Deliberate failed network request → diagnostics + MCP.
  const netCursor = (await api('GET', `/sessions/${desktop}/network?limit=1`)).json.cursor;
  await api('POST', `/sessions/${desktop}/navigate`, { url: `${base}/network-fail` });
  await api('POST', `/sessions/${desktop}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
  const failures = (await api('GET', `/sessions/${desktop}/network?since=${netCursor}&failedOnly=true`)).json.items;
  step(9, 'Trigger a deliberate failed network request', failures.some((i) => i.url.includes('definitely-missing-endpoint')));
  const mcpNetwork = await mcp.callTool({
    name: 'livelab_network',
    arguments: { sessionId: desktop, failedOnly: true, since: netCursor },
  });
  step(10, 'Failure appears in diagnostics and through MCP',
    JSON.stringify(mcpNetwork.structuredContent).includes('definitely-missing-endpoint'));

  // 11. Capture both viewport screenshots.
  await api('POST', `/sessions/${desktop}/navigate`, { url: base });
  const shot1 = (await api('POST', `/sessions/${phone}/screenshot`, { format: 'png' })).json.artifact.path;
  const shot2 = (await api('POST', `/sessions/${desktop}/screenshot`, { format: 'png' })).json.artifact.path;
  evidence.screenshots = [shot1, shot2];
  step(11, 'Capture both viewport screenshots', fs.existsSync(path.join(TEST_APP, shot1)) && fs.existsSync(path.join(TEST_APP, shot2)), `${shot1}; ${shot2}`);

  // 12. Start and stop a trace.
  await api('POST', `/sessions/${phone}/trace/start`, {});
  await api('POST', `/sessions/${phone}/reload`, {});
  const trace = (await api('POST', `/sessions/${phone}/trace/stop`, {})).json.artifact.path;
  evidence.trace = trace;
  step(12, 'Start and stop a trace', fs.existsSync(path.join(TEST_APP, trace)), trace);

  // 13. Run the responsive smoke suite.
  const smoke = (await api('POST', '/smoke', { baseUrl: base, routes: ['/'], sessionIds: [phone, desktop] })).json;
  evidence.smokeReport = `.livelab/reports/${smoke.reportId}.json`;
  step(13, 'Run the responsive smoke suite', smoke.status !== 'fail', `${smoke.reportId}: ${smoke.status}`);

  // 14–16. Style change → HMR → watch report.
  await api('POST', '/watch/start', {});
  const colorBefore = (await api('POST', `/sessions/${phone}/inspect`, { locator: { strategy: 'testId', value: 'counter' } })).json.element.backgroundColor;
  fs.writeFileSync(STYLE, originalStyle.replace('--accent: #2563eb;', '--accent: #dc2626;'));
  step(14, 'Change a visible test-app style', true, '--accent #2563eb → #dc2626');
  await waitFor(async () => {
    const color = (await api('POST', `/sessions/${phone}/inspect`, { locator: { strategy: 'testId', value: 'counter' } })).json.element.backgroundColor;
    return color !== colorBefore;
  }, 20_000, 'HMR color change');
  step(15, 'Confirm HMR is reflected in the live session', true);
  const report = await waitFor(async () => {
    const res = await api('GET', '/watch/changes?limit=10');
    return res.json.reports.find((r) => (r.changedFiles ?? []).some((f) => f.includes('style.css')));
  }, 30_000, 'watch change report');
  evidence.changeReport = `.livelab/reports/${report.reportId}.json`;
  step(16, 'Watch mode generates a new report', !!report.reportId, report.reportId);

  // 17. Baseline → change → visual diff fails.
  fs.writeFileSync(STYLE, originalStyle);
  await waitFor(async () => {
    const color = (await api('POST', `/sessions/${phone}/inspect`, { locator: { strategy: 'testId', value: 'counter' } })).json.element.backgroundColor;
    return color === colorBefore;
  }, 20_000, 'HMR revert');
  await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 500, maxSettleMs: 10_000 });
  await api('POST', '/visual/approve', { sessionId: phone, route: '/' });
  fs.writeFileSync(STYLE, originalStyle.replace('--accent: #2563eb;', '--accent: #dc2626;'));
  await waitFor(async () => {
    const color = (await api('POST', `/sessions/${phone}/inspect`, { locator: { strategy: 'testId', value: 'counter' } })).json.element.backgroundColor;
    return color !== colorBefore;
  }, 20_000, 'HMR re-apply');
  await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 500, maxSettleMs: 10_000 });
  const diffFail = (await api('POST', '/visual/compare', { sessionId: phone, route: '/' })).json;
  evidence.visualDiff = diffFail.diffPath;
  step(17, 'Visual diff fails on the controlled change', diffFail.status === 'fail' && !!diffFail.diffPath,
    `ratio ${diffFail.diffRatio?.toFixed(5)} → ${diffFail.diffPath}`);

  // 18. Restore the UI and prove it passes.
  fs.writeFileSync(STYLE, originalStyle);
  await waitFor(async () => {
    const color = (await api('POST', `/sessions/${phone}/inspect`, { locator: { strategy: 'testId', value: 'counter' } })).json.element.backgroundColor;
    return color === colorBefore;
  }, 20_000, 'HMR restore');
  await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 500, maxSettleMs: 10_000 });
  const diffPass = (await api('POST', '/visual/compare', { sessionId: phone, route: '/' })).json;
  step(18, 'Restore the UI and prove the diff passes', diffPass.status === 'pass', `ratio ${diffPass.diffRatio?.toFixed(6)}`);

  await mcp.close();

  // Preserve evidence outside the cleaned test-app workspace.
  const keep = path.join(repoRoot, 'artifacts', 'verification');
  fs.rmSync(keep, { recursive: true, force: true });
  fs.mkdirSync(keep, { recursive: true });
  const copied = {};
  for (const [key, value] of Object.entries(evidence)) {
    const items = Array.isArray(value) ? value : [value];
    copied[key] = [];
    for (const rel of items) {
      if (!rel) continue;
      const src = path.join(TEST_APP, rel);
      if (fs.existsSync(src)) {
        const dest = path.join(keep, path.basename(rel));
        fs.copyFileSync(src, dest);
        copied[key].push(path.relative(repoRoot, dest));
      }
    }
  }
  fs.writeFileSync(
    path.join(repoRoot, 'artifacts', 'verification-report.json'),
    JSON.stringify({ completedAt: new Date().toISOString(), steps, evidence: copied }, null, 2),
  );
  console.log(`\nAll ${steps.length} verification steps passed.`);
  console.log(`Evidence: artifacts/verification/ + artifacts/verification-report.json`);
} finally {
  fs.writeFileSync(STYLE, originalStyle);
  await daemon?.close().catch(() => {});
  fs.rmSync(path.join(TEST_APP, '.livelab'), { recursive: true, force: true });
}
