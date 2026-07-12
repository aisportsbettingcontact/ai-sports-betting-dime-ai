import * as vscode from 'vscode';
import { SessionInfo, RuntimeStatus } from '@livelab/protocol';
import { RuntimeManager } from './runtime';

class SimpleItem extends vscode.TreeItem {
  constructor(label: string, description?: string, icon?: vscode.ThemeIcon, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.tooltip = tooltip;
  }
}

/** Activity-bar Sessions tree: one row per device session. */
export class SessionsTree implements vscode.TreeDataProvider<SimpleItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event as vscode.Event<SimpleItem | undefined | null | void>;

  constructor(private readonly runtime: RuntimeManager) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: SimpleItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SimpleItem[]> {
    if (!this.runtime.current) {
      return [new SimpleItem('Runtime not running', 'run LiveLab: Open', new vscode.ThemeIcon('circle-slash'))];
    }
    try {
      const { sessions } = await this.runtime.api<{ sessions: SessionInfo[] }>('GET', '/sessions');
      if (sessions.length === 0) return [new SimpleItem('No sessions', 'add a device in the panel')];
      return sessions.map(
        (s) =>
          new SimpleItem(
            `${s.device.label} (${s.device.width}×${s.device.height})`,
            `${s.state}${s.url ? ` · ${s.url}` : ''}`,
            new vscode.ThemeIcon(
              s.state === 'ready' ? 'device-mobile' : s.state === 'crashed' ? 'error' : 'loading~spin',
            ),
            `${s.sessionId}\n${s.engine} · ${s.streamMode}\nerrors: ${s.counters.consoleErrors + s.counters.pageErrors} · failed requests: ${s.counters.failedRequests}`,
          ),
      );
    } catch (err) {
      return [new SimpleItem('Runtime unreachable', String((err as Error).message), new vscode.ThemeIcon('warning'))];
    }
  }
}

/** Activity-bar Diagnostics tree: runtime health, dev server, watch, capabilities. */
export class DiagnosticsTree implements vscode.TreeDataProvider<SimpleItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event as vscode.Event<SimpleItem | undefined | null | void>;

  constructor(private readonly runtime: RuntimeManager) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: SimpleItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SimpleItem[]> {
    if (!this.runtime.current) {
      return [new SimpleItem('Runtime not running', undefined, new vscode.ThemeIcon('circle-slash'))];
    }
    try {
      const status = await this.runtime.api<RuntimeStatus>('GET', '/status');
      return [
        new SimpleItem('Runtime', `up ${Math.round(status.uptimeMs / 1000)}s · pid owner ${status.owner}`, new vscode.ThemeIcon('pulse')),
        new SimpleItem('Dev server', `${status.devServer.state}${status.devServer.url ? ` · ${status.devServer.url}` : ''}`, new vscode.ThemeIcon('server-process')),
        new SimpleItem('Agent watch', status.watch.active ? `active · ${status.watch.reports} report(s)` : 'off', new vscode.ThemeIcon('eye')),
        new SimpleItem('Sessions', String(status.sessions), new vscode.ThemeIcon('device-mobile')),
        new SimpleItem('Memory', `${Math.round(status.diagnostics.rssBytes / 1024 / 1024)}MB rss`, new vscode.ThemeIcon('dashboard')),
        new SimpleItem('Dropped frames', String(status.diagnostics.droppedFrames), new vscode.ThemeIcon('debug-step-over')),
        new SimpleItem(
          'Capture latency',
          status.diagnostics.lastCaptureLatencyMs === null ? 'n/a' : `${status.diagnostics.lastCaptureLatencyMs}ms`,
          new vscode.ThemeIcon('watch'),
        ),
        new SimpleItem('Engines', status.capabilities.engines.join(', ') || 'none', new vscode.ThemeIcon('browser')),
        new SimpleItem('WebKit verification', status.capabilities.webkitVerification ? 'available' : 'not installed', new vscode.ThemeIcon('beaker')),
        new SimpleItem('iOS Simulator', status.capabilities.iosSimulator ? 'available' : 'unavailable (macOS + Xcode only)', new vscode.ThemeIcon('device-mobile')),
      ];
    } catch (err) {
      return [new SimpleItem('Runtime unreachable', String((err as Error).message), new vscode.ThemeIcon('warning'))];
    }
  }
}
