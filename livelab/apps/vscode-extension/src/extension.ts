import * as vscode from 'vscode';
import { RuntimeManager } from './runtime';
import { SessionsTree, DiagnosticsTree } from './trees';
import { registerCommands } from './commands';

/**
 * Activation is passive: register commands/trees/status bar only. No browser
 * launches, no daemon spawn, no filesystem watching until the user runs
 * `LiveLab: Open` (spec §17: activation < 300ms, no browser on activation).
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('LiveLab');
  context.subscriptions.push(output);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    // Commands still register so the user gets a helpful error instead of "command not found".
    for (const id of [
      'livelab.open', 'livelab.startServer', 'livelab.attachUrl', 'livelab.stopServer',
      'livelab.addDevice', 'livelab.removeDevice', 'livelab.reloadAll', 'livelab.toggleInspect',
      'livelab.captureScreenshots', 'livelab.startTrace', 'livelab.stopTrace', 'livelab.runSmoke',
      'livelab.approveBaseline', 'livelab.compareBaseline', 'livelab.openLatestReport',
      'livelab.openDiagnostics', 'livelab.startWatch', 'livelab.stopWatch', 'livelab.configureMcp',
      'livelab.doctor', 'livelab.resetRuntime', 'livelab.webkitVerify',
    ]) {
      context.subscriptions.push(
        vscode.commands.registerCommand(id, () =>
          vscode.window.showWarningMessage('LiveLab: open a folder or workspace first.'),
        ),
      );
    }
    return;
  }

  const runtime = new RuntimeManager(context, workspaceRoot, output);
  context.subscriptions.push(runtime);

  const sessionsTree = new SessionsTree(runtime);
  const diagnosticsTree = new DiagnosticsTree(runtime);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('livelab.sessions', sessionsTree),
    vscode.window.registerTreeDataProvider('livelab.diagnostics', diagnosticsTree),
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.name = 'LiveLab';
  statusBar.command = 'livelab.open';
  statusBar.text = '$(device-mobile) LiveLab';
  statusBar.tooltip = 'Open LiveLab device previews';
  context.subscriptions.push(statusBar);

  registerCommands({ context, runtime, output, workspaceRoot, sessionsTree, diagnosticsTree, statusBar });

  // First-run onboarding, permanently dismissible.
  if (!context.globalState.get<boolean>('livelab.onboarded')) {
    void vscode.window
      .showInformationMessage(
        'LiveLab: side-by-side live device previews with agent access for Claude Code and Codex. Open a web project and run "LiveLab: Open".',
        'Open LiveLab',
        "Don't show again",
      )
      .then((choice) => {
        if (choice === 'Open LiveLab') void vscode.commands.executeCommand('livelab.open');
        if (choice === "Don't show again") void context.globalState.update('livelab.onboarded', true);
      });
  }

  // Periodic tree refresh only while the panel is open (kept cheap).
  const interval = setInterval(() => {
    if (runtime.current) {
      sessionsTree.refresh();
      diagnosticsTree.refresh();
    }
  }, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  output.appendLine(`LiveLab activated for ${workspaceRoot} (trusted: ${vscode.workspace.isTrusted})`);
}

export function deactivate(): void {
  // RuntimeManager.dispose() shuts the daemon down via context.subscriptions.
}
