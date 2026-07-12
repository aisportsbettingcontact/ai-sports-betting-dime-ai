import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { RuntimeManager } from './runtime';

/**
 * The main LiveLab webview panel, opened in an editor column beside the code.
 * CSP: no remote origins; scripts require a nonce; network restricted to
 * 127.0.0.1 (the runtime). Messages from the webview are type-checked before
 * acting; nothing from the webview is ever executed as a command line.
 */
export class LiveLabPanel implements vscode.Disposable {
  static current: LiveLabPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private booted = false;

  static async createOrShow(
    context: vscode.ExtensionContext,
    runtime: RuntimeManager,
    output: vscode.OutputChannel,
  ): Promise<LiveLabPanel> {
    if (LiveLabPanel.current) {
      LiveLabPanel.current.panel.reveal(vscode.ViewColumn.Two, false);
      return LiveLabPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'livelab.preview',
      'LiveLab',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    LiveLabPanel.current = new LiveLabPanel(panel, context, runtime, output);
    return LiveLabPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly runtime: RuntimeManager,
    private readonly output: vscode.OutputChannel,
  ) {
    this.panel = panel;
    panel.webview.html = this.html();
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, this.disposables);
    this.disposables.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.panel.webview.postMessage({ type: 'trustChanged', trusted: true });
      }),
    );
    vscode.commands.executeCommand('setContext', 'livelab.active', true);
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `connect-src http://127.0.0.1:* ws://127.0.0.1:*`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>LiveLab</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null || typeof (raw as { type?: unknown }).type !== 'string') {
      this.output.appendLine('[panel] rejected malformed webview message');
      return;
    }
    const msg = raw as { type: string } & Record<string, unknown>;
    try {
      switch (msg.type) {
        case 'ready': {
          const disc = await this.runtime.ensure();
          const config = vscode.workspace.getConfiguration('livelab');
          await this.panel.webview.postMessage({
            type: 'init',
            runtime: { port: disc.port, token: disc.token },
            settings: {
              defaultUrl: config.get<string>('defaultUrl') ?? 'http://localhost:3000',
              defaultDevices: config.get<string[]>('defaultDevices') ?? ['iphone-16', 'desktop-1440'],
              syncNavigation: config.get<boolean>('syncNavigation') ?? true,
              syncScroll: config.get<boolean>('syncScroll') ?? false,
              syncInteraction: config.get<boolean>('syncInteraction') ?? false,
              frameRate: config.get<number>('frameRate') ?? 10,
            },
            workspaceTrusted: vscode.workspace.isTrusted,
          });
          break;
        }
        case 'booted':
          this.booted = true;
          break;
        case 'pickDevice': {
          await vscode.commands.executeCommand('livelab.addDevice');
          break;
        }
        case 'openReport':
          if (typeof msg.reportId === 'string' && /^[a-zA-Z0-9_-]+$/.test(msg.reportId)) {
            await vscode.commands.executeCommand('livelab.openLatestReport', msg.reportId);
          }
          break;
        case 'runSmoke':
          await vscode.commands.executeCommand('livelab.runSmoke');
          break;
        case 'artifactSaved':
          if (typeof msg.path === 'string') {
            this.output.appendLine(`[artifact] ${msg.path}`);
          }
          break;
        default:
          this.output.appendLine(`[panel] ignored unknown webview message type: ${msg.type}`);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`LiveLab: ${String((err as Error).message)}`);
    }
  }

  post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  get isBooted(): boolean {
    return this.booted;
  }

  dispose(): void {
    LiveLabPanel.current = null;
    vscode.commands.executeCommand('setContext', 'livelab.active', false);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    try {
      this.panel.dispose();
    } catch {}
  }
}
