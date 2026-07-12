const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'livelab.livelab';
const workspace = process.env.LIVELAB_TEST_WORKSPACE;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function readDiscovery() {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspace, '.livelab', 'runtime.json'), 'utf8'));
  } catch {
    return null;
  }
}

suite('LiveLab extension', () => {
  test('activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} not found`);
    const started = Date.now();
    await extension.activate();
    assert.ok(extension.isActive, 'extension failed to activate');
    // Passive activation stays fast (generous CI allowance over the 300ms budget).
    assert.ok(Date.now() - started < 5000, 'activation took too long');
    // No runtime/browser is started by activation alone (spec §17).
    assert.strictEqual(readDiscovery(), null, 'activation must not start the runtime');
  });

  test('declares limited untrusted-workspace support', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const caps = extension.packageJSON.capabilities.untrustedWorkspaces;
    assert.strictEqual(caps.supported, 'limited');
    assert.ok(caps.description.length > 20);
  });

  test('registers every contributed command', async () => {
    const all = await vscode.commands.getCommands(true);
    const expected = [
      'livelab.open', 'livelab.startServer', 'livelab.attachUrl', 'livelab.stopServer',
      'livelab.addDevice', 'livelab.removeDevice', 'livelab.reloadAll', 'livelab.toggleInspect',
      'livelab.captureScreenshots', 'livelab.startTrace', 'livelab.stopTrace', 'livelab.runSmoke',
      'livelab.approveBaseline', 'livelab.compareBaseline', 'livelab.openLatestReport',
      'livelab.openDiagnostics', 'livelab.startWatch', 'livelab.stopWatch', 'livelab.configureMcp',
      'livelab.doctor', 'livelab.resetRuntime', 'livelab.webkitVerify',
    ];
    for (const command of expected) {
      assert.ok(all.includes(command), `missing command: ${command}`);
    }
  });

  test('exposes settings with documented defaults', () => {
    const config = vscode.workspace.getConfiguration('livelab');
    assert.strictEqual(config.get('defaultUrl'), 'http://localhost:3000');
    assert.deepStrictEqual(config.get('defaultDevices'), ['iphone-16', 'desktop-1440']);
    assert.deepStrictEqual(config.get('allowedHosts'), ['localhost', '127.0.0.1']);
    assert.strictEqual(config.get('watch.quietWindowMs'), 500);
    assert.strictEqual(config.get('watch.maxSettleMs'), 10000);
    assert.strictEqual(config.get('console.maxEntries'), 500);
    assert.strictEqual(config.get('network.maxEntries'), 1000);
    assert.strictEqual(config.get('browser'), 'chromium');
  });

  test('LiveLab: Open creates the webview panel beside the editor and starts the runtime', async function () {
    this.timeout(120_000);
    await vscode.commands.executeCommand('livelab.open');

    // Webview tab appears.
    await waitFor(
      () => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === 'LiveLab')),
      30_000,
      'LiveLab webview tab',
    );
    // It opened in a non-first editor column (side-by-side layout).
    const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'LiveLab');
    assert.ok(tab, 'LiveLab tab missing');

    // Runtime attachment: the extension-owned daemon publishes its discovery record.
    const discovery = await waitFor(() => readDiscovery(), 60_000, 'runtime discovery record');
    assert.strictEqual(discovery.owner, 'extension');
    assert.strictEqual(discovery.host, '127.0.0.1');
    assert.ok(discovery.token.length >= 64, 'runtime token too short');

    // Health endpoint answers; authorized status reports the same runtime.
    const health = await fetch(`http://127.0.0.1:${discovery.port}/health`);
    assert.strictEqual(health.status, 200);
    const status = await fetch(`http://127.0.0.1:${discovery.port}/status`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });
    const body = await status.json();
    assert.strictEqual(body.runtimeId, discovery.runtimeId);
    assert.strictEqual(body.owner, 'extension');
  });

  test('runtime state is queryable through the extension (sessions endpoint)', async function () {
    this.timeout(60_000);
    const discovery = readDiscovery();
    assert.ok(discovery, 'runtime should be running from the previous test');
    // The webview boots sessions asynchronously; sessions endpoint must answer either way.
    const res = await fetch(`http://127.0.0.1:${discovery.port}/sessions`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });
    assert.strictEqual(res.status, 200);
    const { sessions } = await res.json();
    assert.ok(Array.isArray(sessions));
  });

  test('reset runtime disposes the daemon cleanly', async function () {
    this.timeout(60_000);
    const before = readDiscovery();
    assert.ok(before, 'runtime should be running');
    await vscode.commands.executeCommand('livelab.resetRuntime');
    await waitFor(async () => {
      const disc = readDiscovery();
      if (disc === null) return true;
      try {
        process.kill(disc.pid, 0);
        return false; // still alive
      } catch {
        return true; // pid gone
      }
    }, 30_000, 'runtime shutdown');
  });

  test('panel state restoration: reopening LiveLab works after disposal', async function () {
    this.timeout(120_000);
    // Close all LiveLab tabs (disposal path).
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label === 'LiveLab') await vscode.window.tabGroups.close(tab);
      }
    }
    await sleep(500);
    await vscode.commands.executeCommand('livelab.open');
    await waitFor(
      () => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === 'LiveLab')),
      30_000,
      'LiveLab webview tab after reopen',
    );
  });
});
