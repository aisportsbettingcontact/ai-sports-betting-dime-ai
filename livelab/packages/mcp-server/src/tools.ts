import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  LiveLabError,
  LocatorSchema,
  RuntimeStatus,
  SessionInfo,
} from '@livelab/protocol';
import { RuntimeClient } from './client';

const MAX_JSON_CHARS = 30_000;

function boundedJson(data: unknown): { text: string; truncated: boolean } {
  const full = JSON.stringify(data, null, 1) ?? 'null';
  if (full.length <= MAX_JSON_CHARS) return { text: full, truncated: false };
  return { text: full.slice(0, MAX_JSON_CHARS) + '\n…[truncated]', truncated: true };
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(summary: string, data?: Record<string, unknown>, image?: { data: string; mimeType: string }): ToolResult {
  const content: ToolResult['content'] = [{ type: 'text', text: summary }];
  if (data !== undefined) {
    const bounded = boundedJson(data);
    content.push({ type: 'text', text: bounded.text });
    if (bounded.truncated) {
      content.push({ type: 'text', text: 'Output truncated — use filters/limits or cursors to fetch details incrementally.' });
    }
  }
  if (image) content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
  return { content, structuredContent: data };
}

function fail(err: unknown): ToolResult {
  const shaped =
    err instanceof LiveLabError
      ? err.toJSON()
      : { code: 'INTERNAL', kind: 'infrastructure' as const, message: String((err as Error)?.message ?? err) };
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${shaped.kind === 'application' ? 'Application error' : shaped.kind === 'validation' ? 'Request rejected' : 'LiveLab infrastructure error'} [${shaped.code}]: ${shaped.message}`,
      },
    ],
    structuredContent: { error: shaped },
  };
}

const sessionArg = { sessionId: z.string().describe('Session id from livelab_list_sessions / livelab_start') };
const cursorArgs = {
  since: z.number().int().nonnegative().optional().describe('Event cursor: return only events with seq > since. Defaults to 0 (all buffered). Use the cursor from the previous call for deltas.'),
  limit: z.number().int().min(1).max(500).optional().describe('Max records (default 100)'),
};
const locatorArg = LocatorSchema.optional().describe('Stable element locator (preferred over coordinates)');

/**
 * Registers every livelab_* MCP tool. All tools are model-neutral, return a
 * one-line summary + bounded JSON + structuredContent, and surface runtime
 * errors as structured, non-fabricated failures.
 */
export function registerTools(server: McpServer, client: RuntimeClient): void {
  const tool = (
    name: string,
    description: string,
    inputSchema: z.ZodRawShape,
    handler: (args: any) => Promise<ToolResult>,
  ) => {
    server.registerTool(name, { description, inputSchema }, (async (args: unknown) => {
      try {
        return await handler(args ?? {});
      } catch (err) {
        return fail(err);
      }
    }) as never);
  };

  // ------------------------------------------------------------ lifecycle
  tool(
    'livelab_runtime_status',
    'Health, capabilities, session count, dev-server state, and diagnostics of the LiveLab runtime for this workspace. Call this first.',
    {},
    async () => {
      if (!(await client.connected())) {
        return ok('Runtime not running. Use livelab_start to launch it (headless) or open LiveLab in VS Code.', {
          running: false,
          workspaceRoot: client.workspaceRoot,
        });
      }
      const status = await client.request<RuntimeStatus>('GET', '/status');
      return ok(
        `Runtime ${status.runtimeId} up ${Math.round(status.uptimeMs / 1000)}s · ${status.sessions} session(s) · dev server ${status.devServer.state}${status.devServer.url ? ` @ ${status.devServer.url}` : ''} · watch ${status.watch.active ? 'active' : 'off'}`,
        status as unknown as Record<string, unknown>,
      );
    },
  );

  tool(
    'livelab_start',
    'Ensure the LiveLab runtime is running (starts it headless if needed), optionally attach to a dev-server URL or start an allowlisted npm script, and open device sessions. Reuses existing sessions when devices already match.',
    {
      url: z.string().optional().describe('Attach to this local URL (e.g. http://localhost:3000)'),
      script: z.string().optional().describe('Allowlisted npm script to start the dev server (e.g. "dev")'),
      packageDir: z.string().optional().describe('Package directory for the script, relative to workspace root'),
      devices: z.array(z.string()).max(6).optional().describe('Device preset ids (default: ["iphone-16","desktop-1440"]) — only used when no session exists yet'),
    },
    async (args: { url?: string; script?: string; packageDir?: string; devices?: string[] }) => {
      await client.ensure(true);
      let serverInfo: unknown;
      if (args.script) {
        serverInfo = await client.request('POST', '/server/start', {
          script: args.script,
          packageDir: args.packageDir,
        });
      } else if (args.url) {
        serverInfo = await client.request('POST', '/server/attach', { url: args.url });
      }
      const { sessions: existing } = await client.request<{ sessions: SessionInfo[] }>('GET', '/sessions');
      const created: SessionInfo[] = [];
      if (existing.length === 0) {
        const targetUrl = (serverInfo as { url?: string })?.url ?? args.url;
        for (const device of args.devices ?? ['iphone-16', 'desktop-1440']) {
          const res = await client.request<{ session: SessionInfo }>('POST', '/sessions', {
            device,
            engine: 'chromium',
            url: targetUrl,
          });
          created.push(res.session);
        }
      }
      const sessions = [...existing, ...created];
      return ok(
        `Runtime ready · ${sessions.length} session(s)${created.length ? ` (${created.length} created)` : ' (reused)'}${serverInfo ? ` · server ${(serverInfo as { state?: string }).state} @ ${(serverInfo as { url?: string }).url ?? '?'}` : ''}`,
        { sessions, server: serverInfo ?? null } as Record<string, unknown>,
      );
    },
  );

  tool(
    'livelab_stop',
    'Close device sessions; optionally shut the whole runtime down.',
    {
      sessionIds: z.array(z.string()).optional().describe('Sessions to close (default: all)'),
      runtime: z.boolean().optional().describe('Also shut down the runtime daemon (default false)'),
    },
    async (args: { sessionIds?: string[]; runtime?: boolean }) => {
      const { sessions } = await client.request<{ sessions: SessionInfo[] }>('GET', '/sessions');
      const targets = args.sessionIds ?? sessions.map((s) => s.sessionId);
      for (const id of targets) await client.request('DELETE', `/sessions/${id}`);
      if (args.runtime) {
        await client.request('POST', '/shutdown');
        return ok(`Closed ${targets.length} session(s) and shut the runtime down.`, { closed: targets, runtimeStopped: true });
      }
      return ok(`Closed ${targets.length} session(s).`, { closed: targets, runtimeStopped: false });
    },
  );

  // ------------------------------------------------------------ sessions
  tool('livelab_list_sessions', 'List active device sessions with device, URL, state, and diagnostics counters.', {}, async () => {
    const { sessions } = await client.request<{ sessions: SessionInfo[] }>('GET', '/sessions');
    const summary =
      sessions.length === 0
        ? 'No active sessions. Create one with livelab_create_session or livelab_start.'
        : sessions
            .map((s) => `${s.sessionId} · ${s.device.label} (${s.device.width}×${s.device.height}) · ${s.url ?? 'blank'} · ${s.counters.pageErrors + s.counters.consoleErrors} error(s)`)
            .join('\n');
    return ok(summary, { sessions } as Record<string, unknown>);
  });

  tool(
    'livelab_create_session',
    'Create a new device session (real Chromium page). Device presets: iphone-13-mini, iphone-16, iphone-16-plus, android-compact, android-standard, ipad-mini-portrait, ipad-landscape, laptop-1366, desktop-1440, desktop-1728.',
    {
      device: z.string().describe('Device preset id or workspace-defined device id'),
      url: z.string().optional().describe('Initial URL (must be on the allowlist)'),
      engine: z.enum(['chromium', 'webkit', 'firefox']).optional().describe('Browser engine (default chromium; webkit/firefox have no live streaming)'),
      colorScheme: z.enum(['light', 'dark']).optional(),
      reducedMotion: z.boolean().optional(),
      locale: z.string().optional(),
      timezoneId: z.string().optional(),
    },
    async (args: { device: string; url?: string; engine?: string; colorScheme?: string; reducedMotion?: boolean; locale?: string; timezoneId?: string }) => {
      await client.ensure(true);
      const res = await client.request<{ session: SessionInfo }>('POST', '/sessions', {
        device: args.device,
        engine: args.engine ?? 'chromium',
        url: args.url,
        emulation: {
          colorScheme: args.colorScheme,
          reducedMotion: args.reducedMotion ? 'reduce' : undefined,
          locale: args.locale,
          timezoneId: args.timezoneId,
        },
      });
      return ok(`Created ${res.session.sessionId} (${res.session.device.label}, ${res.session.engine}).`, res as unknown as Record<string, unknown>);
    },
  );

  tool('livelab_close_session', 'Close one device session and release its browser context.', sessionArg, async (args: { sessionId: string }) => {
    await client.request('DELETE', `/sessions/${args.sessionId}`);
    return ok(`Closed ${args.sessionId}.`, { closed: args.sessionId });
  });

  // ------------------------------------------------------------ navigation
  tool('livelab_navigate', 'Navigate a session to a URL (allowlisted hosts only). Mirrors to peer sessions when navigation sync is on.', { ...sessionArg, url: z.string().describe('Target URL') }, async (args: { sessionId: string; url: string }) => {
    const res = await client.request<{ url?: string }>('POST', `/sessions/${args.sessionId}/navigate`, { url: args.url });
    return ok(`Navigated ${args.sessionId} to ${res.url ?? args.url}.`, res as Record<string, unknown>);
  });
  tool('livelab_reload', 'Reload the current page in a session (mirrors to peers when navigation sync is on).', sessionArg, async (args: { sessionId: string }) => {
    await client.request('POST', `/sessions/${args.sessionId}/reload`, {});
    return ok(`Reloaded ${args.sessionId}.`, { ok: true });
  });
  tool('livelab_go_back', 'Navigate back in the session browser history (like the back button).', sessionArg, async (args: { sessionId: string }) => {
    const res = await client.request<{ moved: boolean }>('POST', `/sessions/${args.sessionId}/back`, {});
    return ok(res.moved ? 'Went back.' : 'No earlier history entry.', res as unknown as Record<string, unknown>);
  });
  tool('livelab_go_forward', 'Navigate forward in the session browser history (like the forward button).', sessionArg, async (args: { sessionId: string }) => {
    const res = await client.request<{ moved: boolean }>('POST', `/sessions/${args.sessionId}/forward`, {});
    return ok(res.moved ? 'Went forward.' : 'No later history entry.', res as unknown as Record<string, unknown>);
  });

  // ------------------------------------------------------------ interaction
  tool(
    'livelab_click',
    'Click an element. Prefer a stable locator (role/label/placeholder/text/testId/css from livelab_inspect); x/y coordinates are an explicit fallback.',
    { ...sessionArg, locator: locatorArg, x: z.number().optional(), y: z.number().optional(), button: z.enum(['left', 'middle', 'right']).optional(), clickCount: z.number().int().min(1).max(3).optional() },
    async (args: { sessionId: string } & Record<string, unknown>) => {
      const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/click`, {
        locator: args.locator,
        x: args.x,
        y: args.y,
        button: args.button ?? 'left',
        clickCount: args.clickCount ?? 1,
      });
      return ok(res.action, res as unknown as Record<string, unknown>);
    },
  );
  tool('livelab_hover', 'Hover an element (locator preferred, x/y fallback).', { ...sessionArg, locator: locatorArg, x: z.number().optional(), y: z.number().optional() }, async (args: { sessionId: string } & Record<string, unknown>) => {
    const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/hover`, { locator: args.locator, x: args.x, y: args.y });
    return ok(res.action, res as unknown as Record<string, unknown>);
  });
  tool(
    'livelab_type',
    'Type text into an element (or the focused element when no locator is given). Set clear=true to replace the existing value.',
    { ...sessionArg, locator: locatorArg, text: z.string().max(10_000), clear: z.boolean().optional(), delayMs: z.number().int().min(0).max(1000).optional() },
    async (args: { sessionId: string; text: string } & Record<string, unknown>) => {
      const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/type`, {
        locator: args.locator,
        text: args.text,
        clear: args.clear ?? false,
        delayMs: args.delayMs ?? 0,
      });
      return ok(res.action, res as unknown as Record<string, unknown>);
    },
  );
  tool('livelab_press', 'Press a key (Playwright key name, e.g. "Enter", "Escape", "ArrowDown", "Control+a").', { ...sessionArg, locator: locatorArg, key: z.string().max(64) }, async (args: { sessionId: string; key: string } & Record<string, unknown>) => {
    const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/press`, { locator: args.locator, key: args.key });
    return ok(res.action, res as unknown as Record<string, unknown>);
  });
  tool('livelab_select', 'Select option(s) in a <select> element.', { ...sessionArg, locator: LocatorSchema.describe('Locator of the select element'), values: z.array(z.string()).min(1).max(50) }, async (args: { sessionId: string; locator: unknown; values: string[] }) => {
    const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/select`, { locator: args.locator, values: args.values });
    return ok(res.action, res as unknown as Record<string, unknown>);
  });
  tool(
    'livelab_scroll',
    'Scroll: to an element (locator), to a percentage of the page (yPercent 0..1), or by deltaY pixels.',
    { ...sessionArg, locator: locatorArg, yPercent: z.number().min(0).max(1).optional(), deltaY: z.number().optional(), x: z.number().optional(), y: z.number().optional() },
    async (args: { sessionId: string } & Record<string, unknown>) => {
      const res = await client.request<{ action: string }>('POST', `/sessions/${args.sessionId}/scroll`, {
        locator: args.locator,
        yPercent: args.yPercent,
        deltaY: args.deltaY,
        x: args.x,
        y: args.y,
      });
      return ok(res.action, res as unknown as Record<string, unknown>);
    },
  );

  tool(
    'livelab_wait_for_settle',
    'Wait until the page is quiet (no in-flight requests, DOM mutations, or console output for quietWindowMs). ALWAYS call this after actions or code changes before judging the UI.',
    { ...sessionArg, quietWindowMs: z.number().int().min(50).max(10_000).optional(), maxSettleMs: z.number().int().min(500).max(60_000).optional() },
    async (args: { sessionId: string; quietWindowMs?: number; maxSettleMs?: number }) => {
      const res = await client.request<{ settled: boolean; waitedMs: number; timedOut: boolean; unresolvedActivity: string[] }>(
        'POST',
        `/sessions/${args.sessionId}/settle`,
        { quietWindowMs: args.quietWindowMs ?? 500, maxSettleMs: args.maxSettleMs ?? 10_000 },
      );
      return ok(
        res.settled
          ? `Settled after ${res.waitedMs}ms.`
          : `NOT settled after ${res.waitedMs}ms — unresolved: ${res.unresolvedActivity.join('; ')}`,
        res as unknown as Record<string, unknown>,
      );
    },
  );

  // ------------------------------------------------------------ evidence
  tool(
    'livelab_inspect',
    'Inspect the element at coordinates or by locator: tag, role, accessible name, computed styles, visibility issues, and ranked stable locator candidates (role > label > placeholder > text > testId > css).',
    { ...sessionArg, x: z.number().optional(), y: z.number().optional(), locator: locatorArg },
    async (args: { sessionId: string } & Record<string, unknown>) => {
      const res = await client.request<{ element: { tag?: string; issues?: unknown[] } | null }>('POST', `/sessions/${args.sessionId}/inspect`, {
        x: args.x,
        y: args.y,
        locator: args.locator,
      });
      if (!res.element) return ok('No element at that point.', { element: null });
      return ok(
        `<${res.element.tag}> · ${(res.element.issues?.length ?? 0)} issue(s) found`,
        res as unknown as Record<string, unknown>,
      );
    },
  );

  tool(
    'livelab_dom_snapshot',
    'Compact visible-DOM outline (tags, ids, roles, test ids, trimmed text) — token-efficient alternative to raw HTML.',
    { ...sessionArg, selector: z.string().optional().describe('Root selector (default body)'), maxDepth: z.number().int().min(1).max(40).optional(), maxNodes: z.number().int().min(10).max(5000).optional() },
    async (args: { sessionId: string; selector?: string; maxDepth?: number; maxNodes?: number }) => {
      const res = await client.request('POST', `/sessions/${args.sessionId}/dom`, {
        selector: args.selector ?? 'body',
        maxDepth: args.maxDepth ?? 12,
        maxNodes: args.maxNodes ?? 800,
        includeText: true,
      });
      return ok('DOM snapshot captured.', res as Record<string, unknown>);
    },
  );

  tool(
    'livelab_accessibility_snapshot',
    'Accessibility tree snapshot (ARIA) of the page. Set axe=true for a full Axe rule scan with impact-ranked findings.',
    { ...sessionArg, axe: z.boolean().optional().describe('Run a full Axe scan instead of the tree snapshot'), selector: z.string().optional() },
    async (args: { sessionId: string; axe?: boolean; selector?: string }) => {
      if (args.axe) {
        const res = await client.request<{ findings?: unknown[]; unavailable?: string }>('POST', `/sessions/${args.sessionId}/axe`, { selector: args.selector });
        if (res.unavailable) return ok(`Axe scan unavailable: ${res.unavailable}`, res as Record<string, unknown>);
        return ok(`Axe scan: ${res.findings?.length ?? 0} finding(s).`, res as Record<string, unknown>);
      }
      const res = await client.request<{ snapshot: string; truncated: boolean }>('POST', `/sessions/${args.sessionId}/aria`, {});
      return ok(`Accessibility snapshot${res.truncated ? ' (truncated)' : ''}:\n${res.snapshot}`, res as unknown as Record<string, unknown>);
    },
  );

  tool(
    'livelab_screenshot',
    'Capture a screenshot. Persists to .livelab/artifacts and returns the path; inline=true also returns the image content (viewport captures only).',
    { ...sessionArg, fullPage: z.boolean().optional(), inline: z.boolean().optional().describe('Return the image inline for direct viewing (default true)'), label: z.string().max(120).optional() },
    async (args: { sessionId: string; fullPage?: boolean; inline?: boolean; label?: string }) => {
      const res = await client.request<{ artifact: { artifactId: string; path: string; bytes: number }; inlineBase64?: string }>(
        'POST',
        `/sessions/${args.sessionId}/screenshot`,
        { fullPage: args.fullPage ?? false, inline: args.inline ?? true, format: 'png', label: args.label },
      );
      return ok(
        `Screenshot saved: ${res.artifact.path} (${Math.round(res.artifact.bytes / 1024)}KB)`,
        { artifact: res.artifact } as Record<string, unknown>,
        res.inlineBase64 ? { data: res.inlineBase64, mimeType: 'image/png' } : undefined,
      );
    },
  );

  const eventSummary = (kind: string, items: unknown[], cursor: number, truncated: boolean) =>
    `${items.length} ${kind} record(s)${truncated ? ' (more available)' : ''} · next cursor: ${cursor}`;

  tool(
    'livelab_console',
    'Console records (log/info/warn/error + page exceptions) with dedup counts. Use `since` (cursor from the last call) to fetch only new records.',
    { ...sessionArg, ...cursorArgs, levels: z.array(z.enum(['log', 'info', 'warn', 'error', 'debug'])).optional() },
    async (args: { sessionId: string; since?: number; limit?: number; levels?: string[] }) => {
      const params = new URLSearchParams();
      if (args.since !== undefined) params.set('since', String(args.since));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      if (args.levels) params.set('levels', args.levels.join(','));
      const res = await client.request<{ items: unknown[]; cursor: number; truncated: boolean }>('GET', `/sessions/${args.sessionId}/console?${params}`);
      return ok(eventSummary('console', res.items, res.cursor, res.truncated), res as unknown as Record<string, unknown>);
    },
  );

  tool('livelab_page_errors', 'Uncaught exceptions and unhandled rejections with stacks. Cursor-paginated.', { ...sessionArg, ...cursorArgs }, async (args: { sessionId: string; since?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (args.since !== undefined) params.set('since', String(args.since));
    if (args.limit !== undefined) params.set('limit', String(args.limit));
    const res = await client.request<{ items: unknown[]; cursor: number; truncated: boolean }>('GET', `/sessions/${args.sessionId}/errors?${params}`);
    return ok(eventSummary('page-error', res.items, res.cursor, res.truncated), res as unknown as Record<string, unknown>);
  });

  tool(
    'livelab_network',
    'Network records (sanitized URLs, redacted headers). failedOnly=true returns only failures/4xx/5xx. Cursor-paginated.',
    { ...sessionArg, ...cursorArgs, failedOnly: z.boolean().optional(), urlFilter: z.string().max(200).optional() },
    async (args: { sessionId: string; since?: number; limit?: number; failedOnly?: boolean; urlFilter?: string }) => {
      const params = new URLSearchParams();
      if (args.since !== undefined) params.set('since', String(args.since));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      if (args.failedOnly) params.set('failedOnly', 'true');
      if (args.urlFilter) params.set('urlFilter', args.urlFilter);
      const res = await client.request<{ items: unknown[]; cursor: number; truncated: boolean }>('GET', `/sessions/${args.sessionId}/network?${params}`);
      return ok(eventSummary('network', res.items, res.cursor, res.truncated), res as unknown as Record<string, unknown>);
    },
  );

  tool('livelab_start_trace', 'Start a Playwright trace (screenshots + DOM snapshots) for a session.', sessionArg, async (args: { sessionId: string }) => {
    await client.request('POST', `/sessions/${args.sessionId}/trace/start`, {});
    return ok('Trace started. Reproduce the behavior, then call livelab_stop_trace.', { tracing: true });
  });
  tool('livelab_stop_trace', 'Stop the trace and persist the .zip (open with: npx playwright show-trace <path>).', sessionArg, async (args: { sessionId: string }) => {
    const res = await client.request<{ artifact: { path: string } }>('POST', `/sessions/${args.sessionId}/trace/stop`, {});
    return ok(`Trace saved: ${res.artifact.path}`, res as unknown as Record<string, unknown>);
  });

  // ------------------------------------------------------------ testing
  tool(
    'livelab_run_smoke',
    'Run the responsive smoke suite (load, errors, network, landmark, overflow, focus, coverage, screenshots + configured assertions) across sessions/routes. Returns a structured report with evidence paths.',
    {
      baseUrl: z.string().optional().describe('Base URL (defaults to the attached dev server)'),
      routes: z.array(z.string()).max(50).optional().describe('Routes to check (defaults to .livelab/config.json routes)'),
      devices: z.array(z.string()).max(6).optional().describe('Device presets when no sessions exist'),
    },
    async (args: { baseUrl?: string; routes?: string[]; devices?: string[] }) => {
      await client.ensure(true);
      const report = await client.request<{ status: string; reportId: string; results: Array<{ route: string; device: string; status: string }> }>('POST', '/smoke', args);
      const counts = report.results.reduce(
        (acc, r) => ({ ...acc, [r.status]: ((acc as Record<string, number>)[r.status] ?? 0) + 1 }),
        {} as Record<string, number>,
      );
      return ok(
        `Smoke ${report.status.toUpperCase()} (${report.reportId}): ${report.results.length} route×device run(s) — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`,
        report as unknown as Record<string, unknown>,
      );
    },
  );

  tool(
    'livelab_run_playwright',
    "Run the project's own Playwright (or other) test suite via an allowlisted npm script and return the tail of its output.",
    {
      script: z.string().describe('Allowlisted npm script, e.g. "test:e2e"'),
      packageDir: z.string().optional(),
      timeoutMs: z.number().int().min(1000).max(1_800_000).optional(),
    },
    async (args: { script: string; packageDir?: string; timeoutMs?: number }) => {
      const res = await client.request<{ exitCode: number | null; timedOut: boolean; durationMs: number }>('POST', '/scripts/run', {
        script: args.script,
        packageDir: args.packageDir,
        timeoutMs: args.timeoutMs ?? 600_000,
      });
      return ok(
        res.timedOut ? `Script timed out after ${res.durationMs}ms.` : `Script exited ${res.exitCode} in ${res.durationMs}ms.`,
        res as unknown as Record<string, unknown>,
      );
    },
  );

  tool(
    'livelab_visual_compare',
    'Compare a session against its approved visual baseline (mode="compare"), or approve the current state as the new baseline (mode="approve"). Baselines are never replaced automatically.',
    { ...sessionArg, route: z.string().optional().describe('Route key for the baseline (default "/")'), mode: z.enum(['compare', 'approve']).optional() },
    async (args: { sessionId: string; route?: string; mode?: 'compare' | 'approve' }) => {
      const route = args.route ?? '/';
      if (args.mode === 'approve') {
        const res = await client.request<{ baselinePath: string }>('POST', '/visual/approve', { sessionId: args.sessionId, route });
        return ok(`Baseline approved: ${res.baselinePath}`, res as unknown as Record<string, unknown>);
      }
      const res = await client.request<{ status: string; diffRatio?: number; diffPath?: string; reason?: string }>('POST', '/visual/compare', {
        sessionId: args.sessionId,
        route,
      });
      const summary =
        res.status === 'pass'
          ? `Visual PASS (diff ratio ${(res.diffRatio ?? 0).toFixed(5)}).`
          : res.status === 'fail'
            ? `Visual FAIL (diff ratio ${(res.diffRatio ?? 0).toFixed(5)}) — diff image: ${res.diffPath}`
            : `Visual ${res.status}: ${res.reason}`;
      return ok(summary, res as unknown as Record<string, unknown>);
    },
  );

  // ------------------------------------------------------------ watch
  tool('livelab_watch_status', 'Agent-watch pipeline state: active, pending changes, last report id.', {}, async () => {
    const res = await client.request<{ active: boolean; pendingChanges: number; lastReportId?: string }>('GET', '/watch/status');
    return ok(
      res.active ? `Watch active · ${res.pendingChanges} pending change(s) · last report: ${res.lastReportId ?? 'none'}` : 'Watch is off. Start it with livelab_watch_start.',
      res as unknown as Record<string, unknown>,
    );
  });
  tool('livelab_watch_start', 'Start the agent watch pipeline (file changes → settle → per-viewport evidence → change report).', {
    visualCompare: z.boolean().optional(),
    fullPageScreenshot: z.boolean().optional(),
  }, async (args: { visualCompare?: boolean; fullPageScreenshot?: boolean }) => {
    const res = await client.request('POST', '/watch/start', args);
    return ok('Agent watch started.', res as Record<string, unknown>);
  });
  tool('livelab_watch_stop', 'Stop the agent watch pipeline.', {}, async () => {
    const res = await client.request('POST', '/watch/stop', {});
    return ok('Agent watch stopped.', res as Record<string, unknown>);
  });

  tool(
    'livelab_watch_changes',
    'Change-report summaries since a report id (newest last). Each includes status, new error counts, and screenshot paths.',
    { sinceReportId: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    async (args: { sinceReportId?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (args.sinceReportId) params.set('sinceReportId', args.sinceReportId);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await client.request<{ reports: unknown[] }>('GET', `/watch/changes?${params}`);
      return ok(`${res.reports.length} change report(s).`, res as unknown as Record<string, unknown>);
    },
  );

  tool('livelab_get_change_report', 'Full change report by id: new/resolved errors, network failures, screenshots, visual diff, assertions, suggested source locations, event cursors.', { reportId: z.string() }, async (args: { reportId: string }) => {
    const res = await client.request<{ report: { status: string; kind: string } }>('GET', `/reports/${args.reportId}`);
    return ok(`Report ${args.reportId}: ${res.report.status.toUpperCase()} (${res.report.kind}).`, res as unknown as Record<string, unknown>);
  });

  tool(
    'livelab_generate_report',
    'Generate a fresh change report of the CURRENT state of all sessions (same pipeline as watch mode, triggered on demand).',
    {},
    async () => {
      const res = await client.request<{ report: { reportId: string; status: string } | null }>('POST', '/watch/trigger', {
        files: ['(on-demand report)'],
      });
      if (!res.report) return ok('No sessions to evaluate — create sessions first.', { report: null });
      return ok(`Report ${res.report.reportId}: ${res.report.status.toUpperCase()}.`, res as unknown as Record<string, unknown>);
    },
  );

  tool(
    'livelab_run_approved_script',
    'Run an allowlisted npm script to completion (lint, typecheck, build, tests). Rejects anything not on the managed-scripts allowlist.',
    { script: z.string().max(64), packageDir: z.string().optional(), timeoutMs: z.number().int().min(1000).max(1_800_000).optional() },
    async (args: { script: string; packageDir?: string; timeoutMs?: number }) => {
      const res = await client.request<{ exitCode: number | null; timedOut: boolean; durationMs: number; stdoutTail: string[]; stderrTail: string[] }>(
        'POST',
        '/scripts/run',
        { script: args.script, packageDir: args.packageDir, timeoutMs: args.timeoutMs ?? 600_000 },
      );
      return ok(
        res.timedOut ? `"${args.script}" timed out after ${res.durationMs}ms.` : `"${args.script}" exited ${res.exitCode} in ${res.durationMs}ms.`,
        res as unknown as Record<string, unknown>,
      );
    },
  );
}
