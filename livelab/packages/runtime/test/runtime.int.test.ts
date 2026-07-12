import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startDaemon, RunningDaemon } from '../src/daemon';
import { startFixtureServer, makeTmpWorkspace, rmDir } from '../../../test/helpers';

let daemon: RunningDaemon;
let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let workspace: string;
let base: string;

async function api<T = any>(method: string, apiPath: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token ?? daemon.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

beforeAll(async () => {
  workspace = makeTmpWorkspace();
  fixture = await startFixtureServer();
  daemon = await startDaemon({ workspaceRoot: workspace, owner: 'headless', workspaceTrusted: true, jsonLogs: false });
  base = `http://127.0.0.1:${daemon.port}`;
}, 60_000);

afterAll(async () => {
  await daemon?.close();
  await fixture?.close();
  rmDir(workspace);
});

describe('runtime lifecycle', () => {
  it('answers /health without auth but rejects /status without the token', async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const unauthorized = await fetch(`${base}/status`);
    expect(unauthorized.status).toBe(401);
    const wrongToken = await api('GET', '/status', undefined, 'f'.repeat(64));
    expect(wrongToken.status).toBe(401);
  });

  it('writes an owner-only discovery record and enforces one runtime per workspace', async () => {
    const discPath = path.join(workspace, '.livelab', 'runtime.json');
    expect(fs.existsSync(discPath)).toBe(true);
    await expect(
      startDaemon({ workspaceRoot: workspace, owner: 'headless', workspaceTrusted: true, jsonLogs: false }),
    ).rejects.toThrowError(/already serving/);
  });
});

describe('browser sessions', () => {
  let sessionId: string;

  it('launches Chromium and creates a session', async () => {
    const started = Date.now();
    const res = await api('POST', '/sessions', { device: 'iphone-16', engine: 'chromium', url: `${fixture.url}/` });
    expect(res.status).toBe(201);
    sessionId = res.json.session.sessionId;
    expect(res.json.session.state).toBe('ready');
    expect(res.json.session.device.width).toBe(393);
    // Spec §17: first session ready within 5s once browsers are installed (warm allowance for cold CI).
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('navigates, goes back, and goes forward', async () => {
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/second` });
    let info = await api('GET', `/sessions/${sessionId}`);
    expect(info.json.session.url).toContain('/second');
    const back = await api('POST', `/sessions/${sessionId}/back`, {});
    expect(back.json.moved).toBe(true);
    info = await api('GET', `/sessions/${sessionId}`);
    expect(info.json.session.url).not.toContain('/second');
    const forward = await api('POST', `/sessions/${sessionId}/forward`, {});
    expect(forward.json.moved).toBe(true);
  });

  it('rejects navigation to remote hosts (default-deny)', async () => {
    const res = await api('POST', `/sessions/${sessionId}/navigate`, { url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('dispatches click input and the page state actually changes', async () => {
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/` });
    await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 200, maxSettleMs: 5000 });
    const click = await api('POST', `/sessions/${sessionId}/click`, {
      locator: { strategy: 'testId', value: 'counter' },
    });
    expect(click.status).toBe(200);
    const dom = await api('POST', `/sessions/${sessionId}/dom`, { selector: 'main' });
    // The counter's span now reads "1" (DOM outline keeps own-text separate from child text).
    expect(JSON.stringify(dom.json.snapshot)).toContain('"tag":"span","text":"1"');
  });

  it('types into an input via locator', async () => {
    const type = await api('POST', `/sessions/${sessionId}/type`, {
      locator: { strategy: 'placeholder', value: 'Type here' },
      text: 'hello livelab',
      clear: true,
    });
    expect(type.status).toBe(200);
    const inspect = await api('POST', `/sessions/${sessionId}/inspect`, {
      locator: { strategy: 'placeholder', value: 'Type here' },
    });
    expect(inspect.json.element.attributes.id).toBe('field');
  });

  it('captures console errors with cursor pagination', async () => {
    const before = (await api('GET', `/sessions/${sessionId}/console?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/console-error` });
    await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 300, maxSettleMs: 5000 });
    const errors = await api('GET', `/sessions/${sessionId}/console?since=${before}&levels=error`);
    expect(errors.json.items.some((i: any) => i.text.includes('fixture console error'))).toBe(true);
    const warnings = await api('GET', `/sessions/${sessionId}/console?since=${before}&levels=warn`);
    expect(warnings.json.items.some((i: any) => i.text.includes('fixture warning'))).toBe(true);
  });

  it('captures uncaught page errors', async () => {
    const before = (await api('GET', `/sessions/${sessionId}/errors?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/page-error` });
    await new Promise((r) => setTimeout(r, 500));
    const errors = await api('GET', `/sessions/${sessionId}/errors?since=${before}`);
    expect(errors.json.items.some((i: any) => i.message.includes('fixture uncaught'))).toBe(true);
  });

  it('captures failed requests with failedOnly filtering', async () => {
    const before = (await api('GET', `/sessions/${sessionId}/network?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/network-fail` });
    await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 300, maxSettleMs: 5000 });
    const failed = await api('GET', `/sessions/${sessionId}/network?since=${before}&failedOnly=true`);
    const miss = failed.json.items.find((i: any) => i.url.includes('/api/missing'));
    expect(miss).toBeDefined();
    expect(miss.status).toBe(404);
    expect(miss.ok).toBe(false);
  });

  it('redacts sensitive request headers before persistence', async () => {
    const before = (await api('GET', `/sessions/${sessionId}/network?limit=1`)).json.cursor as number;
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/secret-headers` });
    await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 300, maxSettleMs: 5000 });
    const network = await api('GET', `/sessions/${sessionId}/network?since=${before}&urlFilter=/api/echo`);
    const echo = network.json.items.find((i: any) => i.url.includes('/api/echo'));
    expect(echo).toBeDefined();
    const serialized = JSON.stringify(echo);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('key-abcdef');
    expect(echo.requestHeaders.authorization).toBe('[REDACTED]');
  });

  it('captures a screenshot artifact on disk', async () => {
    const res = await api('POST', `/sessions/${sessionId}/screenshot`, { format: 'png' });
    expect(res.status).toBe(200);
    const absolute = path.join(workspace, res.json.artifact.path);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(fs.statSync(absolute).size).toBeGreaterThan(1000);
  });

  it('records and saves a trace', async () => {
    await api('POST', `/sessions/${sessionId}/trace/start`, {});
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/` });
    const res = await api('POST', `/sessions/${sessionId}/trace/stop`, {});
    expect(res.status).toBe(200);
    const absolute = path.join(workspace, res.json.artifact.path);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(res.json.artifact.path.endsWith('.zip')).toBe(true);
  });

  it('waits for settle and reports unresolved activity on busy pages', async () => {
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/slow` });
    const res = await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 600, maxSettleMs: 1500 });
    expect(res.json.timedOut).toBe(true);
    expect(res.json.unresolvedActivity.length).toBeGreaterThan(0);
  });

  it('supports multiple concurrent sessions with isolation', async () => {
    const second = await api('POST', '/sessions', { device: 'desktop-1440', engine: 'chromium', url: `${fixture.url}/` });
    expect(second.status).toBe(201);
    const list = await api('GET', '/sessions');
    expect(list.json.sessions.length).toBeGreaterThanOrEqual(2);
    // Isolation: the second session has no console errors from the first session's journey.
    const other = await api('GET', `/sessions/${second.json.session.sessionId}/console?levels=error`);
    expect(other.json.items).toHaveLength(0);
    await api('DELETE', `/sessions/${second.json.session.sessionId}`);
  });

  it('recovers a crashed session in place', async () => {
    // CDP Page.crash / chrome://crash kill the renderer with a CORE-DUMPING
    // signal; on kernels where core_pattern pipes to a handler (GitHub's
    // Ubuntu images pipe to apport), the renderer cannot exit until the
    // multi-hundred-MB core is drained, so Playwright's 'crash' event (which
    // requires full process exit) arrives seconds-to-minutes late. SIGKILL
    // produces no core dump and fires 'crash' within milliseconds on every
    // Chromium build tested (headless shell 145, full 145, full 141), even
    // under an adversarial piped core_pattern. So: pid-diff the browser's
    // renderer processes around victim-session creation and SIGKILL only the
    // new renderer(s).
    const browser = await daemon.core.sessions.engines.get('chromium');
    const browserCdp = await browser.newBrowserCDPSession();
    const rendererPids = async (): Promise<number[]> => {
      const info = (await browserCdp.send('SystemInfo.getProcessInfo')) as {
        processInfo: Array<{ type: string; id: number }>;
      };
      return info.processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
    };
    const before = await rendererPids();
    const crash = await api('POST', '/sessions', { device: 'desktop-1440', engine: 'chromium', url: `${fixture.url}/` });
    const crashId = crash.json.session.sessionId;
    try {
      expect(crash.json.session.state).toBe('ready');
      const fresh = (await rendererPids()).filter((pid) => !before.includes(pid));
      expect(fresh.length, 'victim session must own at least one new renderer').toBeGreaterThan(0);
      for (const pid of fresh) process.kill(pid, 'SIGKILL');

      // Crash event delivery is asynchronous; poll instead of a fixed sleep.
      const deadline = Date.now() + 20_000;
      while (daemon.core.sessions.maybeGet(crashId)?.state !== 'crashed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(daemon.core.sessions.maybeGet(crashId)?.state).toBe('crashed');
      const recovered = await api('POST', `/sessions/${crashId}/recover`, {});
      expect(recovered.json.recovered).toBe(true);
      const after = await api('GET', `/sessions/${crashId}`);
      expect(after.json.session.state).toBe('ready');
    } finally {
      // Never leak a possibly-wedged session into later tests.
      await api('DELETE', `/sessions/${crashId}`);
      await browserCdp.detach().catch(() => {});
    }
  });

  it('exports a sanitized HAR', async () => {
    const res = await api('GET', `/sessions/${sessionId}/har`);
    expect(res.json.log.version).toBe('1.2');
    expect(JSON.stringify(res.json)).not.toContain('super-secret-token');
  });

  it('rejects malformed bodies and unknown routes with structured errors', async () => {
    const badBody = await api('POST', `/sessions/${sessionId}/click`, { locator: { strategy: 'nope', value: 'x' } });
    expect(badBody.status).toBe(400);
    expect(badBody.json.error.code).toBe('INVALID_INPUT');
    const unknown = await api('GET', '/definitely-not-a-route');
    expect(unknown.status).toBe(400);
    const missingSession = await api('GET', '/sessions/sess_missing/console');
    expect(missingSession.status).toBe(404);
    expect(missingSession.json.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('rejects disallowed scripts and storage-state path traversal', async () => {
    const script = await api('POST', '/scripts/run', { script: 'not-allowlisted' });
    expect(script.status).toBe(403);
    expect(script.json.error.code).toBe('SCRIPT_NOT_ALLOWED');
    const traversal = await api('POST', '/sessions', {
      device: 'iphone-16',
      engine: 'chromium',
      storageStatePath: '../../etc/passwd',
    });
    expect(traversal.status).toBe(403);
    expect(traversal.json.error.code).toBe('PATH_NOT_ALLOWED');
  });

  it('runs the smoke suite against the fixture and finds the broken route', async () => {
    const res = await api('POST', '/smoke', {
      baseUrl: fixture.url,
      routes: ['/', '/console-error'],
      sessionIds: [sessionId],
    });
    expect(res.status).toBe(200);
    const healthy = res.json.results.find((r: any) => r.route === '/');
    const broken = res.json.results.find((r: any) => r.route === '/console-error');
    expect(healthy.checks.find((c: any) => c.id === 'console-errors').status).toBe('pass');
    expect(broken.checks.find((c: any) => c.id === 'console-errors').status).toBe('fail');
    expect(res.json.status).toBe('fail');
  });

  it('visual baseline: approve → pass → viewport change invalidates', async () => {
    await api('POST', `/sessions/${sessionId}/navigate`, { url: `${fixture.url}/` });
    await api('POST', `/sessions/${sessionId}/settle`, { quietWindowMs: 300, maxSettleMs: 5000 });
    const approve = await api('POST', '/visual/approve', { sessionId, route: '/' });
    expect(approve.status).toBe(200);
    const compare = await api('POST', '/visual/compare', { sessionId, route: '/' });
    expect(compare.json.status).toBe('pass');
    // Change the viewport → baseline must be invalidated, not silently replaced.
    await api('POST', `/sessions/${sessionId}/viewport`, { width: 500, height: 900 });
    const invalidated = await api('POST', '/visual/compare', { sessionId, route: '/' });
    expect(invalidated.json.status).toBe('baseline-invalidated');
    await api('POST', `/sessions/${sessionId}/viewport`, { width: 393, height: 852 });
  });

  it('watch trigger produces a bounded change report', async () => {
    const res = await api('POST', '/watch/trigger', { files: ['src/main.js'] });
    expect(res.status).toBe(200);
    const report = res.json.report;
    expect(report.kind).toBe('change');
    expect(report.changedFiles).toEqual(['src/main.js']);
    expect(report.sessions.length).toBeGreaterThan(0);
    expect(report.sessions[0].eventCursor).toBeGreaterThan(0);
    const fetched = await api('GET', `/reports/${report.reportId}`);
    expect(fetched.json.report.reportId).toBe(report.reportId);
  });

  it('cleans up sessions on close', async () => {
    await api('DELETE', `/sessions/${sessionId}`);
    const list = await api('GET', '/sessions');
    expect(list.json.sessions.find((s: any) => s.sessionId === sessionId)).toBeUndefined();
  });
});

describe('symlinked workspace root (macOS tmpdir topology)', () => {
  it.skipIf(process.platform === 'win32')(
    'daemon canonicalizes the root: clean artifact paths + discovery matches through the symlink',
    async () => {
      const real = makeTmpWorkspace('livelab-symreal-');
      const linkParent = makeTmpWorkspace('livelab-symlink-');
      const link = path.join(linkParent, 'ws');
      fs.symlinkSync(real, link);
      // Start the daemon through the SYMLINKED path, like macOS /var/folders.
      const symDaemon = await startDaemon({
        workspaceRoot: link,
        owner: 'headless',
        workspaceTrusted: true,
        jsonLogs: false,
      });
      try {
        const call = async (method: string, apiPath: string, body?: unknown) => {
          const res = await fetch(`http://127.0.0.1:${symDaemon.port}${apiPath}`, {
            method,
            headers: {
              authorization: `Bearer ${symDaemon.token}`,
              ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          return { status: res.status, json: (await res.json()) as any };
        };
        // Discovery record readable via BOTH the symlinked and canonical paths,
        // and carries the canonical root.
        const viaLink = JSON.parse(fs.readFileSync(path.join(link, '.livelab', 'runtime.json'), 'utf8'));
        expect(fs.realpathSync(viaLink.workspaceRoot)).toBe(viaLink.workspaceRoot);

        // The exact failing CI path: screenshot with a session subdir.
        const session = await call('POST', '/sessions', { device: 'iphone-16', engine: 'chromium', url: `${fixture.url}/` });
        expect(session.status).toBe(201);
        const shot = await call('POST', `/sessions/${session.json.session.sessionId}/screenshot`, { format: 'png' });
        expect(shot.status).toBe(200);
        expect(shot.json.artifact.path).toMatch(/^\.livelab\/artifacts\//);
        expect(fs.existsSync(path.join(link, shot.json.artifact.path))).toBe(true);
        expect(fs.existsSync(path.join(real, shot.json.artifact.path))).toBe(true);
      } finally {
        await symDaemon.close();
        rmDir(real);
        rmDir(linkParent);
      }
    },
  );
});

describe('untrusted workspace', () => {
  it('cannot launch project commands, run scripts, or watch files', async () => {
    const untrustedWs = makeTmpWorkspace('livelab-untrusted-');
    fs.writeFileSync(path.join(untrustedWs, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'node -e ""' } }));
    const untrusted = await startDaemon({
      workspaceRoot: untrustedWs,
      owner: 'headless',
      workspaceTrusted: false,
      jsonLogs: false,
    });
    const call = async (apiPath: string, body: unknown) => {
      const res = await fetch(`http://127.0.0.1:${untrusted.port}${apiPath}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${untrusted.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as any };
    };
    try {
      for (const [apiPath, body] of [
        ['/server/start', { script: 'dev' }],
        ['/scripts/run', { script: 'dev' }],
        ['/watch/start', {}],
      ] as const) {
        const res = await call(apiPath, body);
        expect(res.status, apiPath).toBe(403);
        expect(res.json.error.code, apiPath).toBe('WORKSPACE_UNTRUSTED');
      }
    } finally {
      await untrusted.close();
      rmDir(untrustedWs);
    }
  });
});
