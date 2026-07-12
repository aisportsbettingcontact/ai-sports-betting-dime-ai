import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { DEVICE_PRESETS } from '@livelab/protocol';
import { RuntimeManager } from './runtime';
import { LiveLabPanel } from './panel';
import { SessionsTree, DiagnosticsTree } from './trees';

interface Deps {
  context: vscode.ExtensionContext;
  runtime: RuntimeManager;
  output: vscode.OutputChannel;
  workspaceRoot: string;
  sessionsTree: SessionsTree;
  diagnosticsTree: DiagnosticsTree;
  statusBar: vscode.StatusBarItem;
}

function requireTrust(action: string): boolean {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage(
      `LiveLab: workspace trust is required to ${action}. Trust this workspace first (Workspaces: Manage Workspace Trust).`,
    );
    return false;
  }
  return true;
}

export function registerCommands(deps: Deps): void {
  const { context, runtime, output, workspaceRoot } = deps;
  const register = (id: string, handler: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          return await handler(...args);
        } catch (err) {
          const message = String((err as Error).message ?? err);
          output.appendLine(`[command ${id}] ${message}`);
          void vscode.window.showErrorMessage(`LiveLab: ${message}`);
        }
      }),
    );
  };

  const refreshTrees = () => {
    deps.sessionsTree.refresh();
    deps.diagnosticsTree.refresh();
  };

  register('livelab.open', async () => {
    const panel = await LiveLabPanel.createOrShow(context, runtime, output);
    deps.statusBar.text = '$(device-mobile) LiveLab';
    deps.statusBar.show();
    setTimeout(refreshTrees, 1500);
    return panel;
  });

  register('livelab.startServer', async () => {
    if (!requireTrust('start a development server')) return;
    const { servers } = await runtime.api<{ servers: Array<{ framework: string; script: string; packageDir: string; defaultUrl: string }> }>('GET', '/server/detect');
    if (servers.length === 0) {
      void vscode.window.showInformationMessage('LiveLab: no dev-server scripts detected in this workspace.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      servers.map((s) => ({
        label: `${s.framework}: npm run ${s.script}`,
        description: s.packageDir,
        server: s,
      })),
      { placeHolder: 'Start which development server?' },
    );
    if (!pick) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `LiveLab: starting npm run ${pick.server.script}…` },
      async () => {
        const res = await runtime.api<{ url?: string }>('POST', '/server/start', {
          script: pick.server.script,
          packageDir: pick.server.packageDir,
        });
        if (res.url) {
          LiveLabPanel.current?.post({ type: 'navigate', url: res.url });
          void vscode.window.showInformationMessage(`LiveLab: server running at ${res.url}`);
        }
      },
    );
    refreshTrees();
  });

  register('livelab.attachUrl', async () => {
    const url = await vscode.window.showInputBox({
      prompt: 'URL of the running development server',
      value: vscode.workspace.getConfiguration('livelab').get<string>('defaultUrl') ?? 'http://localhost:3000',
      validateInput: (value) => {
        try {
          new URL(value);
          return null;
        } catch {
          return 'Enter a full URL, e.g. http://localhost:3000';
        }
      },
    });
    if (!url) return;
    await runtime.api('POST', '/server/attach', { url });
    LiveLabPanel.current?.post({ type: 'navigate', url });
    refreshTrees();
  });

  register('livelab.stopServer', async () => {
    await runtime.api('POST', '/server/stop', {});
    refreshTrees();
  });

  register('livelab.addDevice', async () => {
    const pick = await vscode.window.showQuickPick(
      DEVICE_PRESETS.map((d) => ({
        label: d.label,
        description: `${d.width}×${d.height} · ${d.kind}${d.simulationFidelity === 'descriptor' ? ' · exact Playwright descriptor' : ' · viewport preset'}`,
        id: d.id,
      })),
      { placeHolder: 'Add which device preview?' },
    );
    if (!pick) return;
    if (!LiveLabPanel.current) await vscode.commands.executeCommand('livelab.open');
    LiveLabPanel.current?.post({ type: 'addDevice', device: pick.id });
    setTimeout(refreshTrees, 1000);
  });

  register('livelab.removeDevice', async () => {
    const { sessions } = await runtime.api<{ sessions: Array<{ sessionId: string; device: { label: string } }> }>('GET', '/sessions');
    if (sessions.length === 0) return;
    const pick = await vscode.window.showQuickPick(
      sessions.map((s) => ({ label: s.device.label, description: s.sessionId, sessionId: s.sessionId })),
      { placeHolder: 'Remove which device?' },
    );
    if (!pick) return;
    await runtime.api('DELETE', `/sessions/${pick.sessionId}`);
    LiveLabPanel.current?.post({ type: 'removeDevice', sessionId: pick.sessionId });
    refreshTrees();
  });

  register('livelab.reloadAll', async () => {
    await runtime.api('POST', '/reload-all', {});
  });

  register('livelab.toggleInspect', () => {
    LiveLabPanel.current?.post({ type: 'toggleInspect' });
  });

  register('livelab.captureScreenshots', () => {
    LiveLabPanel.current?.post({ type: 'captureScreenshots' });
  });

  const firstSessionId = async (): Promise<string | null> => {
    const { sessions } = await runtime.api<{ sessions: Array<{ sessionId: string }> }>('GET', '/sessions');
    return sessions[0]?.sessionId ?? null;
  };

  register('livelab.startTrace', async () => {
    const sessionId = await firstSessionId();
    if (!sessionId) throw new Error('no active session');
    await runtime.api('POST', `/sessions/${sessionId}/trace/start`, {});
    void vscode.window.showInformationMessage('LiveLab: trace recording started.');
  });

  register('livelab.stopTrace', async () => {
    const sessionId = await firstSessionId();
    if (!sessionId) throw new Error('no active session');
    const res = await runtime.api<{ artifact: { path: string } }>('POST', `/sessions/${sessionId}/trace/stop`, {});
    void vscode.window.showInformationMessage(`LiveLab: trace saved to ${res.artifact.path} (open with npx playwright show-trace).`);
  });

  register('livelab.runSmoke', async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'LiveLab: running responsive smoke suite…' },
      async () => {
        const report = await runtime.api<{ reportId: string; status: string; results: unknown[] }>('POST', '/smoke', {});
        const summary = `Smoke ${report.status.toUpperCase()} — ${report.results.length} route×device run(s) (${report.reportId})`;
        LiveLabPanel.current?.post({ type: 'smokeResult', summary });
        const action = await vscode.window.showInformationMessage(`LiveLab: ${summary}`, 'Open report');
        if (action === 'Open report') await vscode.commands.executeCommand('livelab.openLatestReport', report.reportId);
      },
    );
  });

  register('livelab.approveBaseline', async () => {
    const sessionId = await firstSessionId();
    if (!sessionId) throw new Error('no active session');
    const route = await vscode.window.showInputBox({ prompt: 'Route key for this baseline', value: '/' });
    if (route === undefined) return;
    const res = await runtime.api<{ baselinePath: string }>('POST', '/visual/approve', { sessionId, route });
    void vscode.window.showInformationMessage(`LiveLab: baseline approved at ${res.baselinePath}`);
  });

  register('livelab.compareBaseline', async () => {
    const sessionId = await firstSessionId();
    if (!sessionId) throw new Error('no active session');
    const route = await vscode.window.showInputBox({ prompt: 'Route key to compare', value: '/' });
    if (route === undefined) return;
    const res = await runtime.api<{ status: string; diffRatio?: number; diffPath?: string; reason?: string }>('POST', '/visual/compare', { sessionId, route });
    if (res.status === 'pass') {
      void vscode.window.showInformationMessage(`LiveLab: visual comparison PASSED (diff ratio ${(res.diffRatio ?? 0).toFixed(5)}).`);
    } else if (res.status === 'fail') {
      const action = await vscode.window.showWarningMessage(
        `LiveLab: visual comparison FAILED (diff ratio ${(res.diffRatio ?? 0).toFixed(5)}).`,
        'Open diff image',
      );
      if (action === 'Open diff image' && res.diffPath) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(workspaceRoot, res.diffPath)));
      }
    } else {
      void vscode.window.showWarningMessage(`LiveLab: ${res.status} — ${res.reason ?? ''}`);
    }
  });

  register('livelab.openLatestReport', async (reportId?: unknown) => {
    const res =
      typeof reportId === 'string' && /^[a-zA-Z0-9_-]+$/.test(reportId)
        ? await runtime.api<{ report: unknown }>('GET', `/reports/${reportId}`)
        : await runtime.api<{ report: unknown }>('GET', '/reports/latest');
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(res.report, null, 2),
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Active });
  });

  register('livelab.openDiagnostics', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.livelab');
    refreshTrees();
  });

  register('livelab.startWatch', async () => {
    if (!requireTrust('watch project files')) return;
    await runtime.api('POST', '/watch/start', {});
    LiveLabPanel.current?.post({ type: 'watchStateChanged', active: true });
    void vscode.window.showInformationMessage('LiveLab: agent watch started — change reports will accumulate in .livelab/reports.');
    refreshTrees();
  });

  register('livelab.stopWatch', async () => {
    await runtime.api('POST', '/watch/stop', {});
    LiveLabPanel.current?.post({ type: 'watchStateChanged', active: false });
    refreshTrees();
  });

  register('livelab.configureMcp', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Claude Code + Codex', flag: '--all' },
        { label: 'Claude Code only (.mcp.json)', flag: '--claude' },
        { label: 'Codex only (.codex/config.toml)', flag: '--codex' },
      ],
      { placeHolder: 'Write project-scoped MCP configuration for which agents?' },
    );
    if (!pick) return;
    const cliPath = context.asAbsolutePath(path.join('dist', 'runtime', 'cli.cjs'));
    if (!fs.existsSync(cliPath)) throw new Error(`bundled CLI missing at ${cliPath}`);
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [cliPath, 'install-mcp', pick.flag, '--workspace', workspaceRoot],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LIVELAB_MCP_PATH: context.asAbsolutePath(path.join('dist', 'runtime', 'mcp-server.cjs')) } },
        (err, stdout, stderr) => {
          output.appendLine(stdout);
          if (stderr) output.appendLine(stderr);
          if (err) reject(new Error(stderr || String(err)));
          else resolve();
        },
      );
    });
    void vscode.window.showInformationMessage('LiveLab: MCP configuration written. Restart Claude Code / Codex sessions to pick it up.');
  });

  register('livelab.doctor', async () => {
    const cliPath = context.asAbsolutePath(path.join('dist', 'runtime', 'cli.cjs'));
    output.show(true);
    output.appendLine('--- LiveLab doctor ---');
    await new Promise<void>((resolve) => {
      execFile(
        process.execPath,
        [cliPath, 'doctor', '--workspace', workspaceRoot],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (_err, stdout, stderr) => {
          output.appendLine(stdout);
          if (stderr) output.appendLine(stderr);
          resolve();
        },
      );
    });
  });

  register('livelab.resetRuntime', async () => {
    await runtime.stop();
    const stale = path.join(workspaceRoot, '.livelab', 'runtime.json');
    try {
      fs.unlinkSync(stale);
    } catch {}
    try {
      fs.unlinkSync(path.join(workspaceRoot, '.livelab', 'runtime.lock'));
    } catch {}
    void vscode.window.showInformationMessage('LiveLab: runtime reset. Open LiveLab again to restart it.');
    refreshTrees();
  });

  register('livelab.webkitVerify', async () => {
    const { url } = await runtime.api<{ url?: string }>('GET', '/server/status');
    const target = url ?? (await vscode.window.showInputBox({ prompt: 'URL to verify in Playwright WebKit', value: 'http://localhost:3000' }));
    if (!target) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'LiveLab: running Playwright WebKit verification…' },
      async () => {
        const res = await runtime.api<{ available: boolean; reason?: string; screenshot?: string; engineLabel: string }>('POST', '/webkit/verify', {
          url: target,
          device: 'iphone-16',
        });
        if (!res.available) {
          void vscode.window.showWarningMessage(`LiveLab: ${res.reason}`);
        } else {
          void vscode.window.showInformationMessage(`LiveLab: ${res.engineLabel} complete — screenshot at ${res.screenshot}`);
        }
      },
    );
  });
}
