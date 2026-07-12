import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ArtifactMetadata,
  ERROR_CODES,
  LiveLabError,
  PROTOCOL_VERSION,
  Report,
  RuntimeOptions,
  RuntimeStatus,
  ScreenshotRequest,
  WorkspaceConfig,
} from '@livelab/protocol';
import { SessionManager } from './browser/manager';
import { DevServerManager } from './devserver/manager';
import { ArtifactStore } from './artifacts/store';
import { ReportStore } from './reports/store';
import { VisualBaselines } from './testing/visual';
import { WatchCoordinator } from './watch/coordinator';
import { runSmoke } from './testing/smoke';
import { runAxeScan } from './testing/axe';
import { runWebKitVerification } from './testing/webkit';
import { IosSimulatorAdapter } from './testing/iosSimulator';
import { loadWorkspaceConfig, ensureGitignore } from './config';
import { newId, workspaceIdFor } from './util/ids';
import { Logger } from './util/logger';

export const RUNTIME_VERSION = '0.1.0';

export interface RuntimeCoreInit {
  options: RuntimeOptions;
  token: string;
  owner: 'extension' | 'headless';
  /** Whether the owning client asserted workspace trust. Headless CLI/MCP implies trust of the CWD the user launched in. */
  workspaceTrusted: boolean;
  log: Logger;
}

/** Aggregates every runtime subsystem behind one object the API layer calls. */
export class RuntimeCore {
  readonly runtimeId = newId('rt');
  readonly startedAt = Date.now();
  readonly workspaceId: string;
  readonly sessions: SessionManager;
  readonly devServer: DevServerManager;
  readonly artifacts: ArtifactStore;
  readonly reports: ReportStore;
  readonly visual: VisualBaselines;
  readonly watch: WatchCoordinator;
  readonly ios: IosSimulatorAdapter;
  readonly log: Logger;
  readonly owner: 'extension' | 'headless';
  private workspaceConfig: WorkspaceConfig;
  private readonly token: string;
  private workspaceTrusted: boolean;
  private shutdownHooks: Array<() => void | Promise<void>> = [];
  private shuttingDown = false;

  constructor(init: RuntimeCoreInit) {
    const { options } = init;
    this.workspaceId = workspaceIdFor(options.workspaceRoot);
    this.token = init.token;
    this.owner = init.owner;
    this.workspaceTrusted = init.workspaceTrusted;
    this.log = init.log.child({ workspaceId: this.workspaceId, runtimeId: this.runtimeId });

    ensureGitignore(options.workspaceRoot);
    this.workspaceConfig = loadWorkspaceConfig(options.workspaceRoot, this.log);
    this.artifacts = new ArtifactStore(options.workspaceRoot, options.maxArtifactBytes, this.log);
    this.sessions = new SessionManager(options, this.workspaceConfig, this.log);
    this.devServer = new DevServerManager(
      options.workspaceRoot,
      () => [...new Set([...options.managedScripts, ...this.workspaceConfig.scripts])],
      () => options.allowedHosts,
      this.log,
    );
    this.reports = new ReportStore(this.artifacts, this.log);
    this.visual = new VisualBaselines(this.artifacts, options.workspaceRoot, this.log);
    this.watch = new WatchCoordinator(
      this.sessions,
      this.artifacts,
      this.reports,
      this.visual,
      () => this.workspaceConfig,
      this.log,
    );
    this.ios = new IosSimulatorAdapter(this.artifacts, () => options.allowedHosts, this.log);
  }

  checkToken(candidate: string): boolean {
    // Constant-time-ish comparison; tokens are same length when valid.
    if (candidate.length !== this.token.length) return false;
    let mismatch = 0;
    for (let i = 0; i < this.token.length; i++) {
      mismatch |= candidate.charCodeAt(i) ^ this.token.charCodeAt(i);
    }
    return mismatch === 0;
  }

  setWorkspaceTrusted(trusted: boolean): void {
    this.workspaceTrusted = trusted;
  }

  assertTrusted(action: string): void {
    if (!this.workspaceTrusted) {
      throw new LiveLabError(
        ERROR_CODES.WORKSPACE_UNTRUSTED,
        `Workspace is not trusted; refusing to ${action}. Trust the workspace in VS Code first.`,
      );
    }
  }

  reloadWorkspaceConfig(): WorkspaceConfig {
    this.workspaceConfig = loadWorkspaceConfig(this.sessions.workspaceRoot, this.log);
    this.sessions.updateWorkspaceConfig(this.workspaceConfig);
    return this.workspaceConfig;
  }

  async status(): Promise<RuntimeStatus> {
    const diag = this.sessions.diagnostics();
    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      runtimeId: this.runtimeId,
      workspaceId: this.workspaceId,
      workspaceRoot: this.sessions.workspaceRoot,
      owner: this.owner,
      uptimeMs: Date.now() - this.startedAt,
      sessions: this.sessions.list().length,
      watch: { active: this.watch.status().active, reports: this.reports.count },
      devServer: (() => {
        const s = this.devServer.status();
        return { state: s.state, url: s.url, script: s.script, pid: s.pid };
      })(),
      capabilities: {
        engines: (['chromium', 'webkit', 'firefox'] as const).filter((e) => this.sessions.engines.isInstalled(e)),
        cdpScreencast: this.sessions.engines.isInstalled('chromium'),
        webkitVerification: this.sessions.engines.isInstalled('webkit'),
        iosSimulator: (await this.ios.available()).available,
        networkThrottle: this.sessions.engines.isInstalled('chromium'),
      },
      diagnostics: {
        rssBytes: process.memoryUsage().rss,
        activePages: diag.activePages,
        droppedFrames: diag.droppedFrames,
        lastCaptureLatencyMs: diag.lastCaptureLatencyMs,
      },
    };
  }

  async captureScreenshot(
    sessionId: string,
    opts: ScreenshotRequest,
  ): Promise<{ artifact: ArtifactMetadata; inlineBase64?: string }> {
    const session = this.sessions.get(sessionId);
    const buf = await session.screenshot({
      fullPage: opts.fullPage,
      format: opts.format,
      quality: opts.quality,
    });
    const ext = opts.format === 'jpeg' ? '.jpg' : '.png';
    const reserved = this.artifacts.reserve(opts.fullPage ? 'fullpage-screenshot' : 'screenshot', ext, {
      sessionId,
      subdir: path.join('sessions', sessionId),
    });
    fs.writeFileSync(reserved.absolutePath, buf);
    const artifact = this.artifacts.commit(reserved, opts.fullPage ? 'fullpage-screenshot' : 'screenshot', {
      sessionId,
      url: session.lastUrl,
      device: session.device.id,
      engine: session.engine,
      label: opts.label,
    });
    return {
      artifact,
      // Inline is bounded: only non-fullPage, and only when small enough to be token-sane.
      inlineBase64: opts.inline && !opts.fullPage && buf.length < 2 * 1024 * 1024 ? buf.toString('base64') : undefined,
    };
  }

  async stopTrace(sessionId: string): Promise<{ artifact: ArtifactMetadata }> {
    const session = this.sessions.get(sessionId);
    const reserved = this.artifacts.reserve('trace', '.zip', {
      sessionId,
      subdir: path.join('sessions', sessionId),
    });
    await session.stopTrace(reserved.absolutePath);
    const artifact = this.artifacts.commit(reserved, 'trace', {
      sessionId,
      url: session.lastUrl,
      device: session.device.id,
      engine: session.engine,
      label: 'trace',
    });
    return { artifact };
  }

  async runAxe(sessionId: string, selector?: string): Promise<unknown> {
    return runAxeScan(this.sessions.get(sessionId), this.log, selector);
  }

  async runSmokeSuite(args: {
    baseUrl?: string;
    routes?: string[];
    sessionIds?: string[];
    devices?: string[];
    quietWindowMs?: number;
    maxSettleMs?: number;
  }): Promise<Report> {
    const baseUrl = args.baseUrl ?? this.devServer.currentUrl();
    if (!baseUrl) {
      throw new LiveLabError(
        ERROR_CODES.INVALID_INPUT,
        'No baseUrl: pass one explicitly or start/attach a dev server first',
      );
    }
    let sessions = args.sessionIds
      ? args.sessionIds.map((id) => this.sessions.get(id))
      : this.sessions.all().filter((s) => s.state === 'ready' && s.engine === 'chromium');
    const ephemeral: string[] = [];
    if (sessions.length === 0) {
      const devices = args.devices ?? ['iphone-16', 'desktop-1440'];
      for (const device of devices) {
        const session = await this.sessions.createSession({ device, engine: 'chromium' } as never);
        ephemeral.push(session.sessionId);
        sessions = [...sessions, session];
      }
    }
    try {
      const report = await runSmoke(
        {
          baseUrl,
          routes: args.routes,
          sessions,
          config: this.workspaceConfig,
          quietWindowMs: args.quietWindowMs,
          maxSettleMs: args.maxSettleMs,
        },
        this.artifacts,
        this.log,
      );
      this.reports.save(report);
      return report;
    } finally {
      for (const id of ephemeral) await this.sessions.closeSession(id).catch(() => {});
    }
  }

  async webkitVerify(args: { url: string; device: string; route?: string }): Promise<unknown> {
    return runWebKitVerification(this.sessions, this.artifacts, this.workspaceConfig, args, this.log);
  }

  /** Basic HAR 1.2 export assembled from the session's network ring. */
  exportHar(sessionId: string): unknown {
    const session = this.sessions.get(sessionId);
    const entries = session
      .queryNetwork({ since: 0, limit: 500 })
      .items.filter((i) => i.type === 'network')
      .map((i) =>
        i.type === 'network'
          ? {
              startedDateTime: new Date(i.timestamp).toISOString(),
              time: i.durationMs ?? 0,
              request: {
                method: i.method,
                url: i.url,
                httpVersion: 'HTTP/1.1',
                headers: Object.entries(i.requestHeaders ?? {}).map(([name, value]) => ({ name, value })),
                queryString: [],
                cookies: [],
                headersSize: -1,
                bodySize: -1,
              },
              response: {
                status: i.status ?? 0,
                statusText: i.failureText ?? '',
                httpVersion: 'HTTP/1.1',
                headers: Object.entries(i.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
                cookies: [],
                content: { size: i.transferSize ?? -1, mimeType: 'x-unknown' },
                redirectURL: '',
                headersSize: -1,
                bodySize: i.transferSize ?? -1,
              },
              cache: {},
              timings: { send: 0, wait: i.durationMs ?? 0, receive: 0 },
            }
          : null,
      )
      .filter(Boolean);
    return {
      log: {
        version: '1.2',
        creator: { name: 'LiveLab', version: RUNTIME_VERSION },
        pages: [],
        entries,
        comment: 'Sanitized: sensitive headers and query parameters are redacted at capture time.',
      },
    };
  }

  summarizeReport(report: Report): unknown {
    if (report.kind === 'change') {
      return {
        reportId: report.reportId,
        kind: report.kind,
        status: report.status,
        completedAt: report.completedAt,
        changedFiles: report.changedFiles.slice(0, 10),
        sessions: report.sessions.map((s) => ({
          device: s.device,
          status: s.status,
          newErrors: s.newConsoleErrors.length + s.newPageErrors.length,
          networkFailures: s.networkFailures.length,
          screenshot: s.screenshot,
        })),
      };
    }
    return {
      reportId: report.reportId,
      kind: report.kind,
      status: report.status,
      completedAt: report.completedAt,
      results: report.results.map((r) => ({ route: r.route, device: r.device, status: r.status })),
    };
  }

  onShutdown(hook: () => void | Promise<void>): void {
    this.shutdownHooks.push(hook);
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log.info(`Runtime shutting down: ${reason}`);
    await this.watch.stop().catch(() => {});
    await this.sessions.closeAll().catch(() => {});
    await this.devServer.stop().catch(() => {});
    for (const hook of this.shutdownHooks) {
      try {
        await hook();
      } catch {}
    }
  }
}

export function defaultStateDir(): string {
  return path.join(os.homedir(), '.livelab');
}
