import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventRing } from '../src/util/ring';
import { globToRegExp } from '../src/watch/coordinator';
import { assertScriptAllowed, assertUrlAllowed } from '../src/security/allowlist';
import { resolveInside } from '../src/util/paths';
import { acquireLock, readDiscovery, writeDiscovery } from '../src/discovery';
import { ArtifactStore } from '../src/artifacts/store';
import { ReportStore } from '../src/reports/store';
import { loadWorkspaceConfig, ensureGitignore } from '../src/config';
import { Logger } from '../src/util/logger';
import { LiveLabError, PROTOCOL_VERSION, SmokeReport } from '@livelab/protocol';

const log = new Logger();
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-unit-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Rec {
  seq: number;
  value: string;
}

describe('EventRing', () => {
  it('bounds entries and reports eviction as truncation', () => {
    const ring = new EventRing<Rec>(3);
    for (let i = 1; i <= 5; i++) ring.push({ seq: i, value: `v${i}` });
    expect(ring.size).toBe(3);
    expect(ring.cursor).toBe(5);
    const all = ring.query(0, 10);
    expect(all.items.map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(all.truncated).toBe(true); // seq 1–2 evicted
  });

  it('supports cursor-based delta queries with limits', () => {
    const ring = new EventRing<Rec>(100);
    for (let i = 1; i <= 10; i++) ring.push({ seq: i, value: `v${i}` });
    const page1 = ring.query(0, 4);
    expect(page1.items.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(page1.truncated).toBe(true);
    const page2 = ring.query(page1.cursor, 4);
    expect(page2.items.map((r) => r.seq)).toEqual([5, 6, 7, 8]);
    const page3 = ring.query(page2.cursor, 4);
    expect(page3.items.map((r) => r.seq)).toEqual([9, 10]);
    expect(page3.truncated).toBe(false);
    // Delta after everything: empty, cursor stable.
    const page4 = ring.query(page3.cursor, 4);
    expect(page4.items).toEqual([]);
    expect(page4.cursor).toBe(10);
  });

  it('applies filters without breaking pagination counts', () => {
    const ring = new EventRing<Rec>(100);
    for (let i = 1; i <= 6; i++) ring.push({ seq: i, value: i % 2 ? 'odd' : 'even' });
    const odds = ring.query(0, 10, (r) => r.value === 'odd');
    expect(odds.items.map((r) => r.seq)).toEqual([1, 3, 5]);
    expect(odds.totalMatched).toBe(3);
  });
});

describe('globToRegExp', () => {
  it('handles **, *, and ? correctly', () => {
    expect(globToRegExp('src/**').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/**').test('lib/a.ts')).toBe(false);
    expect(globToRegExp('**/*.css').test('a/b/style.css')).toBe(true);
    expect(globToRegExp('**/*.css').test('style.css')).toBe(true);
    expect(globToRegExp('*.html').test('index.html')).toBe(true);
    expect(globToRegExp('*.html').test('sub/index.html')).toBe(false);
    expect(globToRegExp('file?.js').test('file1.js')).toBe(true);
    expect(globToRegExp('**/node_modules/**').test('a/node_modules/x/y.js')).toBe(true);
  });
});

describe('URL allowlisting', () => {
  it('allows local hosts by default and about:blank', () => {
    expect(assertUrlAllowed('http://localhost:3000/x', []).hostname).toBe('localhost');
    expect(assertUrlAllowed('http://127.0.0.1:5199', []).port).toBe('5199');
    expect(assertUrlAllowed('about:blank', []).href).toBe('about:blank');
  });
  it('blocks remote hosts by default (default-deny)', () => {
    expect(() => assertUrlAllowed('https://example.com', [])).toThrowError(/not on the allowlist/);
    expect(() => assertUrlAllowed('https://evil.example.com', ['example.com'])).toThrow(); // no implicit subdomains
  });
  it('allows explicitly allowlisted remote hosts', () => {
    expect(assertUrlAllowed('https://staging.myapp.dev/page', ['staging.myapp.dev']).hostname).toBe('staging.myapp.dev');
  });
  it('blocks non-http protocols', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd', [])).toThrowError(/Protocol/);
    expect(() => assertUrlAllowed('javascript:alert(1)', [])).toThrow();
  });
});

describe('script allowlisting', () => {
  it('accepts allowlisted names and rejects everything else', () => {
    expect(() => assertScriptAllowed('dev', ['dev', 'build'])).not.toThrow();
    expect(() => assertScriptAllowed('deploy', ['dev'])).toThrowError(/allowlist/);
  });
  it('rejects shell metacharacters outright', () => {
    for (const evil of ['dev; rm -rf /', 'dev && curl', 'dev|x', '../dev', 'dev$(x)']) {
      expect(() => assertScriptAllowed(evil, ['dev']), evil).toThrow(LiveLabError);
    }
  });
});

describe('path confinement', () => {
  it('resolves paths inside the root', () => {
    const inside = resolveInside(tmp, 'sub/file.txt');
    expect(inside.startsWith(fs.realpathSync(tmp))).toBe(true);
  });
  it('rejects .. traversal', () => {
    expect(() => resolveInside(tmp, '../../etc/passwd')).toThrowError(/escapes/);
    expect(() => resolveInside(tmp, 'a/../../b')).toThrow();
  });
  it('rejects symlink escape', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-outside-'));
    try {
      fs.symlinkSync(outside, path.join(tmp, 'link'));
      expect(() => resolveInside(tmp, 'link/secret.txt')).toThrowError(/escapes/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('runtime discovery + locking', () => {
  it('acquires and releases the lock; blocks a second live holder', () => {
    const release = acquireLock(tmp);
    expect(release).toBeTypeOf('function');
    expect(acquireLock(tmp)).toBeNull(); // this process holds it and is alive
    release!();
    const again = acquireLock(tmp);
    expect(again).toBeTypeOf('function');
    again!();
  });
  it('steals a stale lock from a dead pid', () => {
    fs.mkdirSync(path.join(tmp, '.livelab'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.livelab', 'runtime.lock'), '999999999');
    const release = acquireLock(tmp);
    expect(release).toBeTypeOf('function');
    release!();
  });
  it('round-trips discovery and rejects dead-pid records', () => {
    writeDiscovery({
      protocolVersion: PROTOCOL_VERSION,
      runtimeVersion: '0.1.0',
      runtimeId: 'rt_test',
      workspaceId: 'ws',
      workspaceRoot: tmp,
      pid: process.pid,
      host: '127.0.0.1',
      port: 43210,
      token: 'f'.repeat(64),
      startedAt: Date.now(),
      owner: 'headless',
    });
    expect(readDiscovery(tmp)?.port).toBe(43210);
    // Owner-only permissions where supported.
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(tmp, '.livelab', 'runtime.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    writeDiscovery({
      protocolVersion: PROTOCOL_VERSION,
      runtimeVersion: '0.1.0',
      runtimeId: 'rt_test',
      workspaceId: 'ws',
      workspaceRoot: tmp,
      pid: 999999999,
      host: '127.0.0.1',
      port: 43210,
      token: 'f'.repeat(64),
      startedAt: Date.now(),
      owner: 'headless',
    });
    expect(readDiscovery(tmp)).toBeNull();
  });
});

describe('ArtifactStore', () => {
  it('reserves, commits, lists, and confines paths', () => {
    const store = new ArtifactStore(tmp, 10_000_000, log);
    const reserved = store.reserve('screenshot', '.png', { sessionId: 's1' });
    fs.writeFileSync(reserved.absolutePath, Buffer.alloc(100));
    const meta = store.commit(reserved, 'screenshot', { sessionId: 's1' });
    expect(meta.path.startsWith('.livelab/')).toBe(true);
    expect(store.get(meta.artifactId).bytes).toBe(100);
    expect(store.list({ sessionId: 's1' })).toHaveLength(1);
    expect(() => store.get('art_nope')).toThrowError(/Unknown artifact/);
  });
  it('prunes oldest artifacts beyond the size budget', () => {
    const store = new ArtifactStore(tmp, 1_000_000, log);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const reserved = store.reserve('screenshot', '.png', {});
      fs.writeFileSync(reserved.absolutePath, Buffer.alloc(400_000));
      ids.push(store.commit(reserved, 'screenshot', {}).artifactId);
    }
    expect(store.list()).toHaveLength(2); // 4×400KB with a 1MB budget → oldest pruned
    expect(() => store.get(ids[0]!)).toThrow();
  });
});

describe('ReportStore aggregation', () => {
  it('persists, orders, filters by kind, and pages with sinceReportId', () => {
    const artifacts = new ArtifactStore(tmp, 10_000_000, log);
    const store = new ReportStore(artifacts, log);
    const mkSmoke = (id: string): SmokeReport => ({
      reportId: id,
      kind: 'smoke',
      startedAt: 1,
      completedAt: 2,
      status: 'pass',
      results: [],
      artifacts: [],
    });
    store.save(mkSmoke('a'));
    store.save(mkSmoke('b'));
    store.save(mkSmoke('c'));
    expect(store.latest()?.reportId).toBe('c');
    expect(store.list({ limit: 10 }).map((r) => r.reportId)).toEqual(['a', 'b', 'c']);
    expect(store.list({ sinceReportId: 'a', limit: 10 }).map((r) => r.reportId)).toEqual(['b', 'c']);
    expect(store.get('b').reportId).toBe('b');
    // Reload from disk.
    const store2 = new ReportStore(artifacts, log);
    expect(store2.count).toBe(3);
  });
});

describe('workspace config load', () => {
  it('returns defaults for a missing file and invalid JSON', () => {
    expect(loadWorkspaceConfig(tmp, log).routes).toEqual(['/']);
    fs.mkdirSync(path.join(tmp, '.livelab'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.livelab', 'config.json'), '{not json');
    expect(loadWorkspaceConfig(tmp, log).routes).toEqual(['/']);
  });
  it('returns defaults (not a crash) for schema-invalid config', () => {
    fs.mkdirSync(path.join(tmp, '.livelab'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.livelab', 'config.json'), JSON.stringify({ routes: ['bad'] }));
    expect(loadWorkspaceConfig(tmp, log).routes).toEqual(['/']);
  });
  it('parses valid config with custom values', () => {
    fs.mkdirSync(path.join(tmp, '.livelab'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.livelab', 'config.json'),
      JSON.stringify({ version: 1, routes: ['/', '/pricing'], watch: { quietWindowMs: 800 } }),
    );
    const config = loadWorkspaceConfig(tmp, log);
    expect(config.routes).toEqual(['/', '/pricing']);
    expect(config.watch.quietWindowMs).toBe(800);
  });
  it('writes a protective .gitignore for .livelab', () => {
    ensureGitignore(tmp);
    const content = fs.readFileSync(path.join(tmp, '.livelab', '.gitignore'), 'utf8');
    expect(content).toContain('runtime.json');
    expect(content).toContain('artifacts/');
  });
});
