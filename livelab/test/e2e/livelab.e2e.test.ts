import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startDaemon, RunningDaemon } from '@livelab/runtime';
import { REPO_ROOT } from '../helpers';

const TEST_APP = path.join(REPO_ROOT, 'packages/test-app');
const STYLE_FILE = path.join(TEST_APP, 'src/style.css');
const MCP_BUNDLE = path.join(REPO_ROOT, 'packages/mcp-server/dist/mcp-server.cjs');

let daemon: RunningDaemon;
let baseUrl: string;
let originalStyle: string;
let phone: string;
let desktop: string;

async function api<T = any>(method: string, apiPath: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`http://127.0.0.1:${daemon.port}${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${daemon.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function buttonColor(sessionId: string): Promise<string> {
  const res = await api('POST', `/sessions/${sessionId}/inspect`, {
    locator: { strategy: 'testId', value: 'counter' },
  });
  return res.json.element?.backgroundColor ?? '';
}

beforeAll(async () => {
  originalStyle = fs.readFileSync(STYLE_FILE, 'utf8');
  fs.rmSync(path.join(TEST_APP, '.livelab'), { recursive: true, force: true });
  daemon = await startDaemon({ workspaceRoot: TEST_APP, owner: 'headless', workspaceTrusted: true, jsonLogs: false });

  // Managed dev-server start through the runtime (real Vite, real HMR).
  const started = await api('POST', '/server/start', { script: 'dev', readyTimeoutMs: 120_000 });
  expect(started.status, JSON.stringify(started.json)).toBe(200);
  baseUrl = started.json.url;
  expect(baseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):5199/);
}, 180_000);

afterAll(async () => {
  fs.writeFileSync(STYLE_FILE, originalStyle);
  await daemon?.close();
  fs.rmSync(path.join(TEST_APP, '.livelab'), { recursive: true, force: true });
}, 60_000);

describe('LiveLab end-to-end on the Vite test app', () => {
  it('loads the app in two simultaneous device sessions', async () => {
    const p = await api('POST', '/sessions', { device: 'iphone-16', engine: 'chromium', url: baseUrl });
    const d = await api('POST', '/sessions', { device: 'desktop-1440', engine: 'chromium', url: baseUrl });
    phone = p.json.session.sessionId;
    desktop = d.json.session.sessionId;
    expect(p.json.session.state).toBe('ready');
    expect(d.json.session.state).toBe('ready');
    for (const id of [phone, desktop]) {
      const settle = await api('POST', `/sessions/${id}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
      expect(settle.json.settled).toBe(true);
      const dom = await api('POST', `/sessions/${id}/dom`, {});
      expect(JSON.stringify(dom.json.snapshot)).toContain('LiveLab Test App');
    }
  }, 60_000);

  it('live session input drives real page state (button + text input)', async () => {
    await api('POST', `/sessions/${phone}/click`, { locator: { strategy: 'testId', value: 'counter' } });
    await api('POST', `/sessions/${phone}/click`, { locator: { strategy: 'testId', value: 'counter' } });
    const dom = await api('POST', `/sessions/${phone}/dom`, { selector: '[data-testid="counter"]' });
    expect(JSON.stringify(dom.json.snapshot)).toContain('"text":"2"');

    await api('POST', `/sessions/${phone}/type`, {
      locator: { strategy: 'placeholder', value: 'Type here' },
      text: 'live input works',
    });
    const echo = await api('POST', `/sessions/${phone}/dom`, { selector: '[data-testid="echo-output"]' });
    expect(JSON.stringify(echo.json.snapshot)).toContain('live input works');
  }, 60_000);

  it('captures diagnostics from the deliberate error routes', async () => {
    const before = (await api('GET', `/sessions/${desktop}/console?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${desktop}/navigate`, { url: `${baseUrl}/console-error` });
    await api('POST', `/sessions/${desktop}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
    const consoleErrors = await api('GET', `/sessions/${desktop}/console?since=${before}&levels=error`);
    expect(consoleErrors.json.items.some((i: any) => i.text.includes('deliberate console error'))).toBe(true);

    await api('POST', `/sessions/${desktop}/navigate`, { url: `${baseUrl}/exception` });
    await new Promise((r) => setTimeout(r, 800));
    const pageErrors = await api('GET', `/sessions/${desktop}/errors?since=${before}`);
    expect(pageErrors.json.items.some((i: any) => i.message.includes('deliberate uncaught exception'))).toBe(true);
    expect(pageErrors.json.items.some((i: any) => /unhandled rejection/i.test(i.message))).toBe(true);

    const netBefore = (await api('GET', `/sessions/${desktop}/network?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${desktop}/navigate`, { url: `${baseUrl}/network-fail` });
    await api('POST', `/sessions/${desktop}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
    const failures = await api('GET', `/sessions/${desktop}/network?since=${netBefore}&failedOnly=true`);
    expect(failures.json.items.some((i: any) => i.url.includes('definitely-missing-endpoint') && i.status === 404)).toBe(true);
    await api('POST', `/sessions/${desktop}/navigate`, { url: baseUrl });
  }, 90_000);

  it('captures screenshots from both viewports', async () => {
    for (const id of [phone, desktop]) {
      const res = await api('POST', `/sessions/${id}/screenshot`, { format: 'png' });
      expect(res.status).toBe(200);
      expect(fs.existsSync(path.join(TEST_APP, res.json.artifact.path))).toBe(true);
    }
  }, 30_000);

  it('smoke suite: healthy route passes, broken route produces the expected findings', async () => {
    const res = await api('POST', '/smoke', {
      baseUrl,
      routes: ['/', '/broken'],
      sessionIds: [phone],
    });
    const healthy = res.json.results.find((r: any) => r.route === '/');
    expect(healthy.status).not.toBe('fail');
    expect(healthy.checks.find((c: any) => c.id === 'landmark').status).toBe('pass');
    expect(healthy.checks.find((c: any) => c.id === 'overflow').status).toBe('pass');
    expect(healthy.checks.find((c: any) => c.id === 'focus').status).toBe('pass');

    const broken = res.json.results.find((r: any) => r.route === '/broken');
    expect(broken.status).toBe('fail');
    expect(broken.checks.find((c: any) => c.id === 'overflow').status).toBe('fail');
    expect(broken.checks.find((c: any) => c.id === 'console-errors').status).toBe('fail');
    expect(broken.checks.find((c: any) => c.id === 'sticky-coverage').status).toBe('fail');
  }, 120_000);

  it('HMR + watch: a style edit produces a settled bounded change report and a failing visual diff, restoring passes', async () => {
    // Return to home and approve the visual baseline.
    await api('POST', `/sessions/${phone}/navigate`, { url: baseUrl });
    await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
    const approve = await api('POST', '/visual/approve', { sessionId: phone, route: '/' });
    expect(approve.status).toBe(200);
    const pass1 = await api('POST', '/visual/compare', { sessionId: phone, route: '/' });
    expect(pass1.json.status).toBe('pass');

    // Start agent watch.
    const watch = await api('POST', '/watch/start', {});
    expect(watch.json.active).toBe(true);
    const colorBefore = await buttonColor(phone);

    // Edit a visible style — Vite HMR should apply it without reload.
    fs.writeFileSync(STYLE_FILE, originalStyle.replace('--accent: #2563eb;', '--accent: #dc2626;'));

    // HMR reflected: computed background color changes in the live session.
    await waitFor(async () => (await buttonColor(phone)) !== colorBefore, 20_000, 'HMR color change');

    // Watch produced a bounded change report for the edit.
    const report = await waitFor(async () => {
      const res = await api('GET', '/watch/changes?limit=10');
      return res.json.reports.find((r: any) => r.changedFiles?.some?.((f: string) => f.includes('style.css')))
        ?? res.json.reports[res.json.reports.length - 1];
    }, 30_000, 'watch change report');
    const full = await api('GET', `/reports/${report.reportId}`);
    expect(full.json.report.kind).toBe('change');
    expect(full.json.report.changedFiles.join(',')).toContain('style.css');
    expect(full.json.report.sessions.length).toBeGreaterThan(0);
    expect(full.json.report.sessions[0].screenshot).toBeDefined();
    expect(full.json.report.sessions[0].eventCursor).toBeGreaterThan(0);
    // Bounded: serialized report stays small enough for agent context.
    expect(JSON.stringify(full.json.report).length).toBeLessThan(60_000);

    // Visual diff identifies the controlled change.
    const fail = await api('POST', '/visual/compare', { sessionId: phone, route: '/' });
    expect(fail.json.status).toBe('fail');
    expect(fail.json.diffPath).toBeDefined();
    expect(fs.existsSync(path.join(TEST_APP, fail.json.diffPath))).toBe(true);

    // Restore the UI and prove it passes again.
    fs.writeFileSync(STYLE_FILE, originalStyle);
    await waitFor(async () => (await buttonColor(phone)) === colorBefore, 20_000, 'HMR revert');
    await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 500, maxSettleMs: 10_000 });
    const pass2 = await api('POST', '/visual/compare', { sessionId: phone, route: '/' });
    expect(pass2.json.status).toBe('pass');
    await api('POST', '/watch/stop', {});
  }, 180_000);

  it('MCP client inspects the very same sessions (shared agent access)', async () => {
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [MCP_BUNDLE, '--workspace', TEST_APP] }),
    );
    try {
      const list = (await client.callTool({ name: 'livelab_list_sessions', arguments: {} })) as {
        structuredContent?: { sessions: Array<{ sessionId: string }> };
      };
      const ids = list.structuredContent!.sessions.map((s) => s.sessionId);
      expect(ids).toContain(phone);
      expect(ids).toContain(desktop);

      // Shared state proof: two clicks through the extension-facing HTTP API,
      // then one through MCP — the SAME page must show 3.
      await api('POST', `/sessions/${phone}/navigate`, { url: baseUrl });
      await api('POST', `/sessions/${phone}/settle`, { quietWindowMs: 400, maxSettleMs: 10_000 });
      await api('POST', `/sessions/${phone}/click`, { locator: { strategy: 'testId', value: 'counter' } });
      await api('POST', `/sessions/${phone}/click`, { locator: { strategy: 'testId', value: 'counter' } });
      await client.callTool({
        name: 'livelab_click',
        arguments: { sessionId: phone, locator: { strategy: 'testId', value: 'counter' } },
      });
      const dom = await api('POST', `/sessions/${phone}/dom`, { selector: '[data-testid="counter"]' });
      expect(JSON.stringify(dom.json.snapshot)).toContain('"text":"3"');

      const shot = (await client.callTool({
        name: 'livelab_screenshot',
        arguments: { sessionId: phone, inline: false },
      })) as { structuredContent?: { artifact: { path: string } } };
      expect(fs.existsSync(path.join(TEST_APP, shot.structuredContent!.artifact.path))).toBe(true);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('accessibility snapshot and axe scan run on demand', async () => {
    const aria = await api('POST', `/sessions/${phone}/aria`, {});
    expect(aria.json.snapshot).toContain('button');
    const axe = await api('POST', `/sessions/${phone}/axe`, {});
    expect(axe.json.findings ?? axe.json.unavailable).toBeDefined();
    if (axe.json.findings) {
      // Axe ran; result shape matches the protocol.
      for (const finding of axe.json.findings) {
        expect(finding.rule).toBeDefined();
        expect(finding.locator).toBeDefined();
      }
    }
  }, 60_000);
});
