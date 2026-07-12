import * as http from 'node:http';
import * as fs from 'node:fs';
import { z } from 'zod';
import {
  AccessibilitySnapshotRequestSchema,
  AttachServerRequestSchema,
  AxeScanRequestSchema,
  ClearRequestSchema,
  ClickRequestSchema,
  CreateSessionRequestSchema,
  DomSnapshotRequestSchema,
  ERROR_CODES,
  EventQuerySchema,
  HoverRequestSchema,
  InputEventSchema,
  InspectRequestSchema,
  LiveLabError,
  NavigateRequestSchema,
  PressRequestSchema,
  PROTOCOL_VERSION,
  RunScriptRequestSchema,
  ScreenshotRequestSchema,
  ScrollRequestSchema,
  SelectRequestSchema,
  SetViewportRequestSchema,
  SettleRequestSchema,
  StartServerRequestSchema,
  TypeRequestSchema,
  WatchChangesQuerySchema,
  WatchStartRequestSchema,
} from '@livelab/protocol';
import type { RuntimeCore } from '../core';

const MAX_BODY_BYTES = 1024 * 1024;

const VisualRequestSchema = z.object({
  sessionId: z.string(),
  route: z.string().max(500).default('/'),
});

const SyncRequestSchema = z.object({
  navigation: z.boolean().optional(),
  scroll: z.boolean().optional(),
  interaction: z.boolean().optional(),
});

const SmokeRequestSchema = z.object({
  baseUrl: z.string().max(2048).optional(),
  routes: z.array(z.string().max(500)).max(50).optional(),
  sessionIds: z.array(z.string()).max(12).optional(),
  devices: z.array(z.string().max(64)).max(12).optional(),
  quietWindowMs: z.number().int().min(50).max(10_000).optional(),
  maxSettleMs: z.number().int().min(500).max(60_000).optional(),
});

const WebKitVerifySchema = z.object({
  url: z.string().max(2048),
  device: z.string().max(64).default('iphone-16'),
  route: z.string().max(500).optional(),
});

const IosSchema = z.object({ udid: z.string().max(64), url: z.string().max(2048).optional() });

function statusFor(err: LiveLabError): number {
  switch (err.code) {
    case ERROR_CODES.UNAUTHORIZED:
      return 401;
    case ERROR_CODES.SESSION_NOT_FOUND:
    case ERROR_CODES.ARTIFACT_NOT_FOUND:
    case ERROR_CODES.REPORT_NOT_FOUND:
      return 404;
    case ERROR_CODES.HOST_NOT_ALLOWED:
    case ERROR_CODES.SCRIPT_NOT_ALLOWED:
    case ERROR_CODES.PATH_NOT_ALLOWED:
    case ERROR_CODES.WORKSPACE_UNTRUSTED:
      return 403;
    case ERROR_CODES.INVALID_INPUT:
    case ERROR_CODES.LIMIT_EXCEEDED:
      return 400;
    case ERROR_CODES.PROTOCOL_MISMATCH:
      return 409;
    case ERROR_CODES.RUNTIME_UNAVAILABLE:
    case ERROR_CODES.RUNTIME_STARTING:
      return 503;
    default:
      return err.kind === 'application' ? 422 : 500;
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new LiveLabError(ERROR_CODES.LIMIT_EXCEEDED, 'Request body exceeds 1MB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new LiveLabError(ERROR_CODES.INVALID_INPUT, 'Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new LiveLabError(
      ERROR_CODES.INVALID_INPUT,
      `Validation failed: ${result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}

function queryOf(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (value === 'true') out[key] = true;
    else if (value === 'false') out[key] = false;
    else if (/^\d+$/.test(value)) out[key] = Number(value);
    else if (key === 'levels') out[key] = value.split(',');
    else out[key] = value;
  }
  return out;
}

/**
 * The runtime's HTTP API. Bound to 127.0.0.1 only; every route except
 * GET /health requires the per-workspace bearer token; every body is
 * schema-validated before use.
 */
export function createHttpHandler(core: RuntimeCore) {
  return async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      res.end(body);
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, {
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          runtimeId: core.runtimeId,
          workspaceId: core.workspaceId,
          uptimeMs: Date.now() - core.startedAt,
        });
      }

      // ---- authentication ----
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
      if (!token || !core.checkToken(token)) {
        throw new LiveLabError(ERROR_CODES.UNAUTHORIZED, 'Missing or invalid runtime token');
      }

      const method = req.method ?? 'GET';
      const parts = url.pathname.split('/').filter(Boolean);

      // ---- runtime ----
      if (method === 'GET' && url.pathname === '/status') return send(200, await core.status());
      if (method === 'POST' && url.pathname === '/shutdown') {
        send(200, { ok: true, message: 'shutting down' });
        setTimeout(() => void core.shutdown('api request'), 50);
        return;
      }

      // ---- sessions ----
      if (url.pathname === '/sessions' && method === 'GET') return send(200, { sessions: core.sessions.list() });
      if (url.pathname === '/sessions' && method === 'POST') {
        const body = parse(CreateSessionRequestSchema, await readBody(req));
        const session = await core.sessions.createSession(body);
        return send(201, { session: session.info() });
      }

      if (parts[0] === 'sessions' && parts[1]) {
        const sessionId = parts[1];
        const rest = parts.slice(2).join('/');

        if (method === 'DELETE' && !rest) {
          await core.sessions.closeSession(sessionId);
          return send(200, { ok: true });
        }
        if (method === 'GET' && !rest) {
          const session = core.sessions.get(sessionId);
          return send(200, { session: { ...session.info(), title: await session.title() } });
        }

        if (method === 'POST') {
          const body = await readBody(req);
          switch (rest) {
            case 'navigate': {
              const { url: target } = parse(NavigateRequestSchema, body);
              await core.sessions.navigate(sessionId, target);
              return send(200, { ok: true, url: core.sessions.get(sessionId).lastUrl });
            }
            case 'reload':
              await core.sessions.reload(sessionId);
              return send(200, { ok: true });
            case 'back':
              return send(200, { ok: true, moved: await core.sessions.goBack(sessionId) });
            case 'forward':
              return send(200, { ok: true, moved: await core.sessions.goForward(sessionId) });
            case 'viewport': {
              const v = parse(SetViewportRequestSchema, body);
              await core.sessions.get(sessionId).setViewport(v.width, v.height, v.deviceScaleFactor);
              return send(200, { ok: true });
            }
            case 'rotate':
              await core.sessions.get(sessionId).rotate();
              return send(200, { ok: true, orientation: core.sessions.get(sessionId).orientation });
            case 'emulation': {
              const emulation = parse(z.object({}).passthrough(), body);
              const result = await core.sessions.get(sessionId).applyEmulation(emulation as never);
              return send(200, result);
            }
            case 'clear': {
              const clear = parse(ClearRequestSchema, body);
              await core.sessions.get(sessionId).clearState(clear);
              return send(200, { ok: true });
            }
            case 'input': {
              const input = parse(InputEventSchema, body);
              await core.sessions.dispatchInput(sessionId, input);
              return send(200, { ok: true });
            }
            case 'click':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).click(parse(ClickRequestSchema, body)) });
            case 'hover':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).hover(parse(HoverRequestSchema, body)) });
            case 'type':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).type(parse(TypeRequestSchema, body)) });
            case 'press':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).press(parse(PressRequestSchema, body)) });
            case 'select':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).select(parse(SelectRequestSchema, body)) });
            case 'scroll':
              return send(200, { ok: true, action: await core.sessions.get(sessionId).scroll(parse(ScrollRequestSchema, body)) });
            case 'settle': {
              const settle = parse(SettleRequestSchema, body);
              return send(200, await core.sessions.get(sessionId).waitForSettle(settle.quietWindowMs, settle.maxSettleMs));
            }
            case 'screenshot': {
              const opts = parse(ScreenshotRequestSchema, body);
              return send(200, await core.captureScreenshot(sessionId, opts));
            }
            case 'trace/start':
              await core.sessions.get(sessionId).startTrace();
              return send(200, { ok: true, tracing: true });
            case 'trace/stop':
              return send(200, await core.stopTrace(sessionId));
            case 'inspect': {
              const args = parse(InspectRequestSchema, body);
              const info = await core.sessions.get(sessionId).inspect(args);
              return send(200, { element: info });
            }
            case 'dom': {
              const args = parse(DomSnapshotRequestSchema, body);
              return send(200, { snapshot: await core.sessions.get(sessionId).domSnapshot(args) });
            }
            case 'aria': {
              const args = parse(AccessibilitySnapshotRequestSchema, body);
              const result = await core.sessions.get(sessionId).ariaSnapshot(args.maxNodes * 40);
              return send(200, result);
            }
            case 'axe': {
              const args = parse(AxeScanRequestSchema, body);
              return send(200, await core.runAxe(sessionId, args.selector));
            }
            case 'recover':
              return send(200, { recovered: await core.sessions.get(sessionId).recover() });
            default:
              throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `Unknown session action: ${rest}`);
          }
        }

        if (method === 'GET') {
          const query = parse(EventQuerySchema, queryOf(url));
          const session = core.sessions.get(sessionId);
          switch (rest) {
            case 'console':
              return send(200, session.queryConsole(query));
            case 'errors':
              return send(200, session.queryPageErrors(query));
            case 'network':
              return send(200, session.queryNetwork(query));
            case 'lifecycle':
              return send(200, session.queryLifecycle(query));
            case 'har':
              return send(200, core.exportHar(sessionId));
            default:
              throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `Unknown session query: ${rest}`);
          }
        }
      }

      // ---- dev server ----
      if (url.pathname === '/server/detect' && method === 'GET') return send(200, { servers: core.devServer.detect() });
      if (url.pathname === '/server/status' && method === 'GET') return send(200, core.devServer.status());
      if (url.pathname === '/server/start' && method === 'POST') {
        core.assertTrusted('start a development server');
        const body = parse(StartServerRequestSchema, await readBody(req));
        return send(200, await core.devServer.start(body));
      }
      if (url.pathname === '/server/attach' && method === 'POST') {
        const body = parse(AttachServerRequestSchema, await readBody(req));
        return send(200, await core.devServer.attach(body.url));
      }
      if (url.pathname === '/server/stop' && method === 'POST') return send(200, await core.devServer.stop());
      if (url.pathname === '/scripts/run' && method === 'POST') {
        core.assertTrusted('run a project script');
        const body = parse(RunScriptRequestSchema, await readBody(req));
        return send(200, await core.devServer.runScript(body));
      }

      // ---- testing ----
      if (url.pathname === '/smoke' && method === 'POST') {
        const body = parse(SmokeRequestSchema, await readBody(req));
        return send(200, await core.runSmokeSuite(body));
      }
      if (url.pathname === '/visual/approve' && method === 'POST') {
        const body = parse(VisualRequestSchema, await readBody(req));
        return send(200, await core.visual.approve(core.sessions.get(body.sessionId), body.route));
      }
      if (url.pathname === '/visual/compare' && method === 'POST') {
        const body = parse(VisualRequestSchema, await readBody(req));
        return send(200, await core.visual.compare(core.sessions.get(body.sessionId), body.route, core.sessions.config));
      }
      if (url.pathname === '/webkit/verify' && method === 'POST') {
        const body = parse(WebKitVerifySchema, await readBody(req));
        return send(200, await core.webkitVerify(body));
      }

      // ---- watch ----
      if (url.pathname === '/watch/status' && method === 'GET') return send(200, core.watch.status());
      if (url.pathname === '/watch/start' && method === 'POST') {
        core.assertTrusted('watch project files');
        const body = parse(WatchStartRequestSchema, await readBody(req));
        return send(200, core.watch.start(body));
      }
      if (url.pathname === '/watch/stop' && method === 'POST') return send(200, await core.watch.stop());
      if (url.pathname === '/watch/trigger' && method === 'POST') {
        const body = parse(z.object({ files: z.array(z.string().max(500)).min(1).max(100) }), await readBody(req));
        const report = await core.watch.processBatch(body.files);
        return send(200, { report });
      }
      if (url.pathname === '/watch/changes' && method === 'GET') {
        const query = parse(WatchChangesQuerySchema, queryOf(url));
        return send(200, { reports: core.reports.list({ ...query, kind: 'change' }).map((r) => core.summarizeReport(r)) });
      }

      // ---- reports & artifacts ----
      if (parts[0] === 'reports' && method === 'GET') {
        if (parts[1] === 'latest') {
          const kind = url.searchParams.get('kind') as 'smoke' | 'change' | null;
          const report = core.reports.latest(kind ?? undefined);
          if (!report) throw new LiveLabError(ERROR_CODES.REPORT_NOT_FOUND, 'No reports yet');
          return send(200, { report });
        }
        if (parts[1]) return send(200, { report: core.reports.get(parts[1]) });
      }
      if (url.pathname === '/artifacts' && method === 'GET') {
        const q = queryOf(url) as { sessionId?: string; reportId?: string; type?: string; limit?: number };
        const list = core.artifacts.list({ sessionId: q.sessionId, reportId: q.reportId, type: q.type as never });
        return send(200, { artifacts: list.slice(0, Math.min(q.limit ?? 50, 200)) });
      }
      if (parts[0] === 'artifacts' && parts[1] && parts[2] === 'metadata' && method === 'GET') {
        return send(200, { artifact: core.artifacts.get(parts[1]) });
      }
      if (parts[0] === 'artifacts' && parts[1] && parts[2] === 'content' && method === 'GET') {
        const meta = core.artifacts.get(parts[1]);
        const absolute = core.artifacts.absolutePathFor(meta);
        const stat = fs.statSync(absolute);
        res.writeHead(200, {
          'content-type': meta.contentType,
          'content-length': stat.size,
          'cache-control': 'no-store',
        });
        fs.createReadStream(absolute).pipe(res);
        return;
      }

      // ---- sync ----
      if (url.pathname === '/sync' && method === 'POST') {
        const body = parse(SyncRequestSchema, await readBody(req));
        if (body.navigation !== undefined) core.sessions.sync.navigation = body.navigation;
        if (body.scroll !== undefined) core.sessions.sync.scroll = body.scroll;
        if (body.interaction !== undefined) core.sessions.sync.interaction = body.interaction;
        return send(200, { sync: core.sessions.sync });
      }
      if (url.pathname === '/sync' && method === 'GET') return send(200, { sync: core.sessions.sync });
      if (url.pathname === '/reload-all' && method === 'POST') {
        await core.sessions.reloadAll();
        return send(200, { ok: true });
      }

      // ---- iOS simulator (macOS only, capability-gated) ----
      if (url.pathname === '/ios/simulators' && method === 'GET') {
        return send(200, { availability: await core.ios.available(), simulators: await core.ios.listSimulators() });
      }
      if (parts[0] === 'ios' && method === 'POST') {
        const body = parse(IosSchema, await readBody(req));
        if (parts[1] === 'boot') return send(200, await core.ios.boot(body.udid));
        if (parts[1] === 'open') {
          if (!body.url) throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'url required');
          return send(200, await core.ios.openUrl(body.udid, body.url));
        }
        if (parts[1] === 'screenshot') return send(200, await core.ios.screenshot(body.udid));
      }

      throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `No route: ${method} ${url.pathname}`);
    } catch (err) {
      const llError =
        err instanceof LiveLabError
          ? err
          : new LiveLabError(ERROR_CODES.INTERNAL, `Unhandled runtime error: ${String(err)}`);
      if (llError.code === ERROR_CODES.INTERNAL) {
        core.log.error(`${req.method} ${url.pathname} failed after ${Date.now() - started}ms: ${llError.message}`);
      }
      send(statusFor(llError), { error: llError.toJSON() });
    }
  };
}
