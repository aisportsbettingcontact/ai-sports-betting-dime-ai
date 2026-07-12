import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startDaemon, RunningDaemon } from '@livelab/runtime';
import { startFixtureServer, makeTmpWorkspace, rmDir, REPO_ROOT } from '../../../test/helpers';

const SERVER_BUNDLE = path.join(REPO_ROOT, 'packages/mcp-server/dist/mcp-server.cjs');

let workspace: string;
let bareWorkspace: string;
let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
let daemon: RunningDaemon;
let client: Client;
let bareClient: Client;

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: Record<string, any>;
  isError?: boolean;
};

async function call(name: string, args: Record<string, unknown> = {}, c: Client = client): Promise<ToolResult> {
  return (await c.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  expect(fs.existsSync(SERVER_BUNDLE), 'run npm run build first').toBe(true);
  workspace = makeTmpWorkspace('livelab-mcp-');
  bareWorkspace = makeTmpWorkspace('livelab-mcp-bare-');
  fixture = await startFixtureServer();
  daemon = await startDaemon({ workspaceRoot: workspace, owner: 'headless', workspaceTrusted: true, jsonLogs: false });

  client = new Client({ name: 'contract-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER_BUNDLE, '--workspace', workspace] }),
  );
  bareClient = new Client({ name: 'contract-test-bare', version: '0.0.0' });
  await bareClient.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER_BUNDLE, '--workspace', bareWorkspace] }),
  );
}, 90_000);

afterAll(async () => {
  await client?.close();
  await bareClient?.close();
  await daemon?.close();
  await fixture?.close();
  rmDir(workspace);
  rmDir(bareWorkspace);
});

describe('MCP initialization & discovery', () => {
  it('initializes and reports server identity', () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe('livelab');
  });

  it('exposes every tool required by the spec contract', async () => {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    const required = [
      'livelab_runtime_status', 'livelab_start', 'livelab_stop', 'livelab_list_sessions',
      'livelab_create_session', 'livelab_close_session', 'livelab_navigate', 'livelab_reload',
      'livelab_go_back', 'livelab_go_forward', 'livelab_click', 'livelab_hover', 'livelab_type',
      'livelab_press', 'livelab_select', 'livelab_scroll', 'livelab_wait_for_settle',
      'livelab_inspect', 'livelab_dom_snapshot', 'livelab_accessibility_snapshot',
      'livelab_screenshot', 'livelab_console', 'livelab_page_errors', 'livelab_network',
      'livelab_start_trace', 'livelab_stop_trace', 'livelab_run_smoke', 'livelab_run_playwright',
      'livelab_visual_compare', 'livelab_watch_status', 'livelab_watch_changes',
      'livelab_get_change_report', 'livelab_generate_report', 'livelab_run_approved_script',
    ];
    for (const name of required) expect(names.has(name), name).toBe(true);
    // Every tool has a non-trivial description.
    for (const tool of tools) expect((tool.description ?? '').length, tool.name).toBeGreaterThan(20);
  });

  it('exposes the required resources', async () => {
    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain('livelab://runtime/status');
    expect(uris).toContain('livelab://sessions');
    const templates = await client.listResourceTemplates();
    const patterns = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(patterns).toContain('livelab://sessions/{sessionId}/current');
    expect(patterns).toContain('livelab://reports/{reportId}');
    expect(patterns).toContain('livelab://artifacts/{artifactId}/metadata');
  });
});

describe('workspace identity across symlinked paths (macOS tmpdir topology)', () => {
  it.skipIf(process.platform === 'win32')(
    'RuntimeClient attaches to the same runtime through symlinked and canonical spellings',
    async () => {
      const { RuntimeClient } = await import('../src/client');
      const real = makeTmpWorkspace('livelab-mcp-symreal-');
      const linkParent = makeTmpWorkspace('livelab-mcp-symlink-');
      const link = path.join(linkParent, 'ws');
      fs.symlinkSync(real, link);
      const symDaemon = await startDaemon({
        workspaceRoot: link,
        owner: 'headless',
        workspaceTrusted: true,
        jsonLogs: false,
      });
      try {
        const viaLink = await new RuntimeClient(link).ensure(false);
        const viaReal = await new RuntimeClient(real).ensure(false);
        expect(viaLink.runtimeId).toBe(symDaemon.core.runtimeId);
        expect(viaReal.runtimeId).toBe(symDaemon.core.runtimeId);
        // Discovery record itself carries the canonical root.
        expect(fs.realpathSync(viaLink.workspaceRoot)).toBe(viaLink.workspaceRoot);
      } finally {
        await symDaemon.close();
        rmDir(real);
        rmDir(linkParent);
      }
    },
  );
});

describe('runtime-unavailable behavior', () => {
  it('reports status gracefully with no runtime', async () => {
    const res = await call('livelab_runtime_status', {}, bareClient);
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain('not running');
    expect(res.structuredContent?.running).toBe(false);
  });

  it('returns a structured infrastructure error for session tools', async () => {
    const res = await call('livelab_console', { sessionId: 'sess_x' }, bareClient);
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('RUNTIME_UNAVAILABLE');
    expect(res.structuredContent?.error?.kind).toBe('infrastructure');
  });
});

describe('tool behavior against a live runtime', () => {
  let sessionId: string;

  it('livelab_start attaches and creates sessions', async () => {
    const res = await call('livelab_start', { url: `${fixture.url}/`, devices: ['iphone-16', 'desktop-1440'] });
    expect(res.isError).toBeFalsy();
    const sessions = res.structuredContent?.sessions as Array<{ sessionId: string; device: { id: string } }>;
    expect(sessions).toHaveLength(2);
    sessionId = sessions[0]!.sessionId;
  }, 60_000);

  it('rejects invalid input at the schema boundary', async () => {
    // Type-level violation → SDK input validation error (never reaches the runtime).
    const schemaViolation = (await client.callTool({
      name: 'livelab_navigate',
      arguments: { sessionId: 123 as never },
    })) as ToolResult;
    expect(schemaViolation.isError).toBe(true);
    expect(schemaViolation.content[0]!.text).toContain('Input validation error');
    // Value-level violation → structured LiveLab error.
    const res = await call('livelab_click', { sessionId, locator: { strategy: 'nonsense', value: 'x' } });
    expect(res.isError).toBe(true);
  });

  it('blocks remote URLs with a structured validation error (never fabricates success)', async () => {
    const res = await call('livelab_navigate', { sessionId, url: 'https://example.com' });
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('HOST_NOT_ALLOWED');
    expect(res.structuredContent?.error?.kind).toBe('validation');
  });

  it('waits for settle and reads console with cursor pagination', async () => {
    await call('livelab_navigate', { sessionId, url: `${fixture.url}/console-error` });
    await call('livelab_wait_for_settle', { sessionId, quietWindowMs: 300 });
    // Full read establishes the tail cursor.
    const full = await call('livelab_console', { sessionId, levels: ['error'], limit: 100 });
    const items = full.structuredContent?.items as Array<{ text: string; seq: number }>;
    expect(items.some((i) => i.text.includes('fixture console error'))).toBe(true);
    const tail = full.structuredContent?.cursor as number;
    expect(tail).toBeGreaterThan(0);
    // Page through one at a time and verify the pages tile the full set.
    const page1 = await call('livelab_console', { sessionId, levels: ['error'], limit: 1 });
    expect((page1.structuredContent?.items as unknown[]).length).toBe(1);
    if (items.length > 1) {
      expect(page1.structuredContent?.truncated).toBe(true);
      const page2 = await call('livelab_console', {
        sessionId,
        since: page1.structuredContent?.cursor as number,
        levels: ['error'],
        limit: 100,
      });
      expect((page2.structuredContent?.items as unknown[]).length).toBe(items.length - 1);
    }
    // Delta after the tail: nothing new.
    const delta = await call('livelab_console', { sessionId, since: tail, levels: ['error'] });
    expect((delta.structuredContent?.items as unknown[]).length).toBe(0);
  });

  it('redacts secrets in network output', async () => {
    await call('livelab_navigate', { sessionId, url: `${fixture.url}/secret-headers` });
    await call('livelab_wait_for_settle', { sessionId, quietWindowMs: 300 });
    const res = await call('livelab_network', { sessionId, urlFilter: '/api/echo' });
    const serialized = JSON.stringify(res.structuredContent);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('super-secret-token');
  });

  it('keeps sessions isolated', async () => {
    const other = await call('livelab_create_session', { device: 'android-standard', url: `${fixture.url}/` });
    const otherId = (other.structuredContent?.session as { sessionId: string }).sessionId;
    const console2 = await call('livelab_console', { sessionId: otherId, levels: ['error'] });
    expect((console2.structuredContent?.items as unknown[]).length).toBe(0);
    // The exact session used is identified in output (traceability).
    expect(JSON.stringify(console2.structuredContent?.items)).not.toContain(sessionId);
    await call('livelab_close_session', { sessionId: otherId });
  });

  it('screenshots return artifact path + inline image content', async () => {
    const res = await call('livelab_screenshot', { sessionId, inline: true });
    expect(res.isError).toBeFalsy();
    const artifact = res.structuredContent?.artifact as { path: string };
    expect(artifact.path).toMatch(/^\.livelab\/artifacts\//);
    expect(fs.existsSync(path.join(workspace, artifact.path))).toBe(true);
    const image = res.content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect((image?.data ?? '').length).toBeGreaterThan(1000);
  });

  it('constrains artifact access to LiveLab-generated evidence', async () => {
    const shot = await call('livelab_screenshot', { sessionId, inline: false });
    const artifactId = (shot.structuredContent?.artifact as { artifactId: string }).artifactId;
    const meta = await client.readResource({ uri: `livelab://artifacts/${artifactId}/metadata` });
    expect(JSON.parse((meta.contents[0] as { text: string }).text).artifact.artifactId).toBe(artifactId);
    // Unknown artifact → error, and there is no path-based read surface at all.
    await expect(client.readResource({ uri: 'livelab://artifacts/art_bogus/metadata' })).rejects.toThrow();
  });

  it('runs the smoke suite and reports the deliberate breakage', async () => {
    const res = await call('livelab_run_smoke', { baseUrl: fixture.url, routes: ['/console-error'] });
    expect(res.structuredContent?.status).toBe('fail');
    expect(res.content[0]!.text).toContain('FAIL');
  }, 60_000);

  it('generates an on-demand change report with evidence', async () => {
    const res = await call('livelab_generate_report', {});
    expect(res.isError).toBeFalsy();
    const report = res.structuredContent?.report as { reportId: string; sessions: Array<{ eventCursor: number }> };
    expect(report.reportId).toBeDefined();
    const fetched = await call('livelab_get_change_report', { reportId: report.reportId });
    expect(fetched.isError).toBeFalsy();
    // Resource path for the same report.
    const resource = await client.readResource({ uri: `livelab://reports/${report.reportId}` });
    expect((resource.contents[0] as { text: string }).text).toContain(report.reportId);
  }, 30_000);

  it('rejects non-allowlisted scripts', async () => {
    const res = await call('livelab_run_approved_script', { script: 'malicious-script' });
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('SCRIPT_NOT_ALLOWED');
  });

  it('reads live session state through the resource template', async () => {
    const res = await client.readResource({ uri: `livelab://sessions/${sessionId}/current` });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text);
    expect(parsed.info.session.sessionId).toBe(sessionId);
  });
});
