import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import chokidar, { FSWatcher } from 'chokidar';
import {
  ChangeReport,
  ChangeReportSession,
  SmokeCheckResult,
  SourceLocation,
  WatchStatus,
  WorkspaceConfig,
} from '@livelab/protocol';
import { SessionManager } from '../browser/manager';
import { ArtifactStore } from '../artifacts/store';
import { ReportStore } from '../reports/store';
import { VisualBaselines } from '../testing/visual';
import { quickAccessibilityFindings } from '../testing/axe';
import { resolveLocator } from '../browser/locators';
import { newId } from '../util/ids';
import { Logger } from '../util/logger';

interface SessionBaseline {
  cursor: number;
  errorKeys: Set<string>;
}

type SourceLocationT = ReturnType<typeof extractSourceLocations>[number];

/** Pull file:line:col hints from stack traces, mapped to workspace-relative paths when possible. */
function extractSourceLocations(stacks: string[], workspaceRoot: string): Array<SourceLocation & { file: string }> {
  const out: Array<{ file: string; line?: number; column?: number; fromStack: boolean }> = [];
  const seen = new Set<string>();
  const frameRe = /(?:at\s+.*?\(?|@)((?:https?:\/\/[^\s)]+?|[^\s():]+?))(?::(\d+))(?::(\d+))?\)?$/;
  for (const stack of stacks) {
    for (const line of stack.split('\n').slice(0, 12)) {
      const match = line.trim().match(frameRe);
      if (!match) continue;
      let file = match[1]!;
      try {
        const url = new URL(file);
        file = url.pathname.replace(/^\//, '');
        // Vite-style paths often mirror the workspace layout.
        if (file.startsWith('@fs/')) file = file.slice(4);
      } catch {
        if (path.isAbsolute(file)) {
          const rel = path.relative(workspaceRoot, file);
          if (!rel.startsWith('..')) file = rel;
        }
      }
      if (file.includes('node_modules') || file.startsWith('chrome-extension')) continue;
      const key = `${file}:${match[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        file,
        line: match[2] ? Number(match[2]) : undefined,
        column: match[3] ? Number(match[3]) : undefined,
        fromStack: true,
      });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function gitCommit(workspaceRoot: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--short', 'HEAD'],
      { cwd: workspaceRoot, timeout: 3000 },
      (err, stdout) => resolve(err ? undefined : stdout.trim()),
    );
  });
}

/**
 * Agent watch pipeline (spec §7): file change → HMR settle → per-viewport
 * evidence → one bounded structured report. Frames stay on disk; only paths
 * and digests are surfaced.
 */
export class WatchCoordinator {
  private watcher: FSWatcher | null = null;
  private active = false;
  private startedAt: number | undefined;
  private include: string[] = [];
  private exclude: string[] = [];
  private pendingChanges = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private processing = false;
  private rerunQueued = false;
  private lastReportId: string | undefined;
  private baselines = new Map<string, SessionBaseline>();
  private opts: { quietWindowMs: number; maxSettleMs: number; fullPageScreenshot: boolean; visualCompare: boolean };
  private reportListeners = new Set<(report: ChangeReport) => void>();

  constructor(
    private readonly sessions: SessionManager,
    private readonly artifacts: ArtifactStore,
    private readonly reports: ReportStore,
    private readonly visual: VisualBaselines,
    private readonly configProvider: () => WorkspaceConfig,
    private readonly log: Logger,
  ) {
    const config = configProvider();
    this.opts = {
      quietWindowMs: config.watch.quietWindowMs,
      maxSettleMs: config.watch.maxSettleMs,
      fullPageScreenshot: config.watch.fullPageScreenshot,
      visualCompare: config.watch.visualCompare,
    };
  }

  onReport(listener: (report: ChangeReport) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  start(overrides: {
    include?: string[];
    exclude?: string[];
    quietWindowMs?: number;
    maxSettleMs?: number;
    fullPageScreenshot?: boolean;
    visualCompare?: boolean;
  } = {}): WatchStatus {
    if (this.active) return this.status();
    const config = this.configProvider();
    this.include = overrides.include ?? config.watch.include;
    this.exclude = overrides.exclude ?? config.watch.exclude;
    this.opts = {
      quietWindowMs: overrides.quietWindowMs ?? config.watch.quietWindowMs,
      maxSettleMs: overrides.maxSettleMs ?? config.watch.maxSettleMs,
      fullPageScreenshot: overrides.fullPageScreenshot ?? config.watch.fullPageScreenshot,
      visualCompare: overrides.visualCompare ?? config.watch.visualCompare,
    };

    // chokidar v4 dropped glob support: watch the workspace root and filter paths ourselves.
    const root = this.sessions.workspaceRoot;
    const includeMatchers = this.include.map((g) => globToRegExp(g));
    const excludeMatchers = this.exclude.map((g) => globToRegExp(g));
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      ignored: (candidate: string) => {
        const rel = path.relative(root, candidate).split(path.sep).join('/');
        if (rel === '') return false;
        if (rel.startsWith('.git/') || rel.includes('node_modules') || rel.startsWith('.livelab')) return true;
        return excludeMatchers.some((re) => re.test(rel));
      },
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    this.watcher.on('all', (_event, filePath) => {
      const rel = path.relative(root, filePath).split(path.sep).join('/');
      if (!includeMatchers.some((re) => re.test(rel))) return;
      // Only record changed paths — unrelated files are never read.
      this.pendingChanges.add(rel);
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => void this.processBatch(), 350);
    });
    this.active = true;
    this.startedAt = Date.now();
    this.captureBaselines();
    this.log.info(`Agent watch started (include: ${this.include.join(', ')})`);
    return this.status();
  }

  async stop(): Promise<WatchStatus> {
    this.active = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    await this.watcher?.close().catch(() => {});
    this.watcher = null;
    this.pendingChanges.clear();
    return this.status();
  }

  status(): WatchStatus {
    return {
      active: this.active,
      startedAt: this.startedAt,
      watchedRoot: this.active ? this.sessions.workspaceRoot : undefined,
      include: this.include,
      exclude: this.exclude,
      pendingChanges: this.pendingChanges.size,
      processing: this.processing,
      lastReportId: this.lastReportId,
      reportCount: this.reports.count,
    };
  }

  /** Snapshot current error state so reports contain only NEW errors. */
  private captureBaselines(): void {
    for (const session of this.sessions.all()) {
      this.baselines.set(session.sessionId, {
        cursor: session.cursor,
        errorKeys: this.currentErrorKeys(session.sessionId),
      });
    }
  }

  private currentErrorKeys(sessionId: string): Set<string> {
    const session = this.sessions.maybeGet(sessionId);
    const keys = new Set<string>();
    if (!session) return keys;
    for (const item of session.queryConsole({ since: 0, limit: 500, levels: ['error'] }).items) {
      keys.add(item.type === 'console' ? `c:${item.text.slice(0, 200)}` : `p:${item.message.slice(0, 200)}`);
    }
    return keys;
  }

  async processBatch(explicitFiles?: string[]): Promise<ChangeReport | null> {
    if (this.processing) {
      this.rerunQueued = true;
      return null;
    }
    const changedFiles = explicitFiles ?? [...this.pendingChanges];
    this.pendingChanges.clear();
    if (changedFiles.length === 0) return null;
    const sessions = this.sessions.all().filter((s) => s.state === 'ready');
    if (sessions.length === 0) {
      this.log.warn('Watch: change detected but no active sessions to evaluate');
      return null;
    }

    this.processing = true;
    const reportId = newId('chg');
    const startedAt = Date.now();
    const log = this.log.child({ reportId });
    log.info(`Watch: evaluating ${changedFiles.length} changed file(s): ${changedFiles.slice(0, 5).join(', ')}${changedFiles.length > 5 ? '…' : ''}`);

    try {
      const config = this.configProvider();
      // 2. Wait for dev server + HMR to settle (use the first session as the settle probe, then confirm each).
      const settleResults = await Promise.all(
        sessions.map((s) => s.waitForSettle(this.opts.quietWindowMs, this.opts.maxSettleMs)),
      );
      const settle = {
        settled: settleResults.every((r) => r.settled),
        waitedMs: Math.max(...settleResults.map((r) => r.waitedMs)),
        timedOut: settleResults.some((r) => r.timedOut),
        unresolvedActivity: [...new Set(settleResults.flatMap((r) => r.unresolvedActivity))],
      };

      const sessionReports: ChangeReportSession[] = [];
      for (const session of sessions) {
        const baseline = this.baselines.get(session.sessionId) ?? { cursor: 0, errorKeys: new Set<string>() };

        // 4–6. New console errors/warnings, page errors, network failures since baseline cursor.
        const consoleItems = session.queryConsole({ since: baseline.cursor, limit: 200 });
        const newConsoleErrors: string[] = [];
        const newConsoleWarnings: string[] = [];
        const newPageErrors: string[] = [];
        const stacks: string[] = [];
        for (const item of consoleItems.items) {
          if (item.type === 'console') {
            if (item.level === 'error') {
              newConsoleErrors.push(item.text.slice(0, 300));
              if (item.stack) stacks.push(item.stack);
              else if (item.url) stacks.push(`at ${item.url}:${item.line ?? 0}:${item.column ?? 0}`);
            } else if (item.level === 'warn') {
              newConsoleWarnings.push(item.text.slice(0, 300));
            }
          } else {
            newPageErrors.push(item.message.slice(0, 300));
            if (item.stack) stacks.push(item.stack);
          }
        }
        const networkFailures = session
          .queryNetwork({ since: baseline.cursor, limit: 200, failedOnly: true })
          .items.filter((i) => i.type === 'network')
          .map((i) => (i.type === 'network' ? `${i.method} ${i.url} → ${i.status ?? i.failureText}` : ''))
          .slice(0, 20);

        // Resolved errors: in the pre-change set but absent now.
        const currentKeys = this.currentErrorKeys(session.sessionId);
        const resolvedErrors = [...baseline.errorKeys]
          .filter((k) => !currentKeys.has(k))
          .map((k) => k.slice(2, 202))
          .slice(0, 10);

        // 7–8. Screenshots.
        let screenshotPath: string | undefined;
        let fullPagePath: string | undefined;
        try {
          const buf = await session.screenshot({ format: 'png' });
          const reserved = this.artifacts.reserve('screenshot', '.png', {
            sessionId: session.sessionId,
            subdir: path.join('watch', reportId),
          });
          fs.writeFileSync(reserved.absolutePath, buf);
          screenshotPath = this.artifacts.commit(reserved, 'screenshot', {
            sessionId: session.sessionId,
            reportId,
            device: session.device.id,
            engine: session.engine,
            url: session.lastUrl,
            label: `watch ${session.device.label}`,
          }).path;
          if (this.opts.fullPageScreenshot) {
            const fullBuf = await session.screenshot({ format: 'png', fullPage: true });
            const fullReserved = this.artifacts.reserve('fullpage-screenshot', '.png', {
              sessionId: session.sessionId,
              subdir: path.join('watch', reportId),
            });
            fs.writeFileSync(fullReserved.absolutePath, fullBuf);
            fullPagePath = this.artifacts.commit(fullReserved, 'fullpage-screenshot', {
              sessionId: session.sessionId,
              reportId,
              device: session.device.id,
              engine: session.engine,
              label: `watch full-page ${session.device.label}`,
            }).path;
          }
        } catch (err) {
          log.warn(`Watch screenshot failed: ${String(err)}`, { sessionId: session.sessionId });
        }

        // 9. Compressed accessibility + visible DOM summary.
        let domSummaryPath: string | undefined;
        try {
          const [aria, digest] = await Promise.all([
            session.ariaSnapshot(8000),
            session.visibleTextDigest(),
          ]);
          const reserved = this.artifacts.reserve('dom-snapshot', '.json', {
            sessionId: session.sessionId,
            subdir: path.join('watch', reportId),
          });
          fs.writeFileSync(
            reserved.absolutePath,
            JSON.stringify({ url: session.lastUrl, ariaSnapshot: aria.snapshot, visibleText: digest }, null, 2),
          );
          domSummaryPath = this.artifacts.commit(reserved, 'dom-snapshot', {
            sessionId: session.sessionId,
            reportId,
            device: session.device.id,
            engine: session.engine,
          }).path;
        } catch {}

        const accessibilityFindings = await quickAccessibilityFindings(session);

        // 10. Configured smoke assertions.
        const failedAssertions: SmokeCheckResult[] = [];
        for (const assertion of config.smoke.assertions) {
          try {
            const page = session.currentPage;
            let ok = true;
            if (assertion.kind === 'elementVisible') {
              const loc = assertion.selector
                ? page.locator(assertion.selector)
                : resolveLocator(page, { strategy: 'text', value: assertion.text ?? '' });
              ok = await loc.first().isVisible({ timeout: 3000 }).catch(() => false);
            } else if (assertion.kind === 'noSelector' && assertion.selector) {
              ok = (await page.locator(assertion.selector).count()) === 0;
            } else if (assertion.kind === 'urlMatches' && assertion.pattern) {
              ok = new RegExp(assertion.pattern).test(page.url());
            }
            if (!ok) {
              failedAssertions.push({
                id: assertion.id,
                title: assertion.description ?? assertion.id,
                status: 'fail',
                detail: undefined,
                evidence: [],
              });
            }
          } catch (err) {
            failedAssertions.push({
              id: assertion.id,
              title: assertion.description ?? assertion.id,
              status: 'fail',
              detail: String(err),
              evidence: [],
            });
          }
        }

        // 11. Visual comparison when enabled.
        let visualResult;
        if (this.opts.visualCompare && session.lastUrl) {
          try {
            const route = new URL(session.lastUrl).pathname || '/';
            visualResult = await this.visual.compare(session, route, config, reportId);
          } catch (err) {
            log.warn(`Visual compare failed: ${String(err)}`, { sessionId: session.sessionId });
          }
        }

        const suggestedSources = extractSourceLocations(stacks, this.sessions.workspaceRoot) as SourceLocationT[];

        const status: ChangeReportSession['status'] =
          newPageErrors.length > 0 ||
          newConsoleErrors.length > 0 ||
          failedAssertions.length > 0 ||
          visualResult?.status === 'fail'
            ? 'fail'
            : newConsoleWarnings.length > 0 || networkFailures.length > 0 || settle.timedOut
              ? 'warn'
              : 'pass';

        sessionReports.push({
          sessionId: session.sessionId,
          device: session.device.id,
          engine: session.engine,
          url: session.lastUrl,
          status,
          newConsoleErrors: newConsoleErrors.slice(0, 20),
          newConsoleWarnings: newConsoleWarnings.slice(0, 20),
          resolvedErrors,
          newPageErrors: newPageErrors.slice(0, 20),
          networkFailures,
          screenshot: screenshotPath,
          fullPageScreenshot: fullPagePath,
          domSummaryPath,
          accessibilityFindings: accessibilityFindings.slice(0, 10),
          visual: visualResult,
          failedAssertions,
          suggestedSources,
          eventCursor: session.cursor,
        });

        // Advance the per-session baseline for the next cycle.
        this.baselines.set(session.sessionId, { cursor: session.cursor, errorKeys: currentKeys });
      }

      const report: ChangeReport = {
        reportId,
        kind: 'change',
        startedAt,
        completedAt: Date.now(),
        changedFiles: changedFiles.slice(0, 50),
        url: sessions[0]?.lastUrl,
        commit: await gitCommit(this.sessions.workspaceRoot),
        status: sessionReports.some((s) => s.status === 'fail')
          ? 'fail'
          : sessionReports.some((s) => s.status === 'warn')
            ? 'warn'
            : 'pass',
        settle,
        sessions: sessionReports,
      };
      this.reports.save(report);
      this.lastReportId = reportId;
      for (const listener of this.reportListeners) {
        try {
          listener(report);
        } catch {}
      }
      return report;
    } finally {
      this.processing = false;
      if (this.rerunQueued) {
        this.rerunQueued = false;
        if (this.pendingChanges.size > 0) {
          setTimeout(() => void this.processBatch(), 100);
        }
      }
    }
  }
}

/** Minimal glob→regex for include/exclude filters (supports **, *, ?). */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}
