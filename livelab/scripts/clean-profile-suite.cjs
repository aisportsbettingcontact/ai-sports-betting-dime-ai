/**
 * Runs inside the extension host of a clean-profile VS Code where LiveLab was
 * installed from the VSIX (not in development mode). Proves: activate → open →
 * runtime attach → screenshot, all through the installed extension.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function run() {
  const vscode = require('vscode');
  const workspace = process.env.LIVELAB_TEST_WORKSPACE;

  const extension = vscode.extensions.getExtension('livelab.livelab');
  assert.ok(extension, 'installed livelab.livelab extension not found in clean profile');
  assert.ok(!extension.extensionPath.includes('stub'), 'must load from the installed VSIX');
  await extension.activate();
  assert.ok(extension.isActive, 'installed extension failed to activate');

  // Open LiveLab (spawns the packaged runtime from the VSIX payload).
  await vscode.commands.executeCommand('livelab.open');

  const deadline = Date.now() + 60_000;
  let discovery = null;
  while (Date.now() < deadline) {
    try {
      discovery = JSON.parse(fs.readFileSync(path.join(workspace, '.livelab', 'runtime.json'), 'utf8'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  assert.ok(discovery, 'runtime discovery record never appeared (installed daemon failed to start)');

  const api = async (method, apiPath, body) => {
    const res = await fetch(`http://127.0.0.1:${discovery.port}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${discovery.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  // Attach + open a session on a page served by the runtime host itself (health endpoint page is JSON;
  // use about:blank navigation + data-free flow: create session, navigate to the runtime's own /health).
  const session = await api('POST', '/sessions', { device: 'iphone-16', engine: 'chromium' });
  assert.strictEqual(session.status, 201, `session create failed: ${JSON.stringify(session.json)}`);
  const sessionId = session.json.session.sessionId;

  const attach = await api('POST', '/server/attach', { url: `http://127.0.0.1:${discovery.port}/health` });
  assert.strictEqual(attach.status, 200, `attach failed: ${JSON.stringify(attach.json)}`);

  const nav = await api('POST', `/sessions/${sessionId}/navigate`, {
    url: `http://127.0.0.1:${discovery.port}/health`,
  });
  assert.strictEqual(nav.status, 200, `navigate failed: ${JSON.stringify(nav.json)}`);

  const shot = await api('POST', `/sessions/${sessionId}/screenshot`, { format: 'png' });
  assert.strictEqual(shot.status, 200, `screenshot failed: ${JSON.stringify(shot.json)}`);
  const absolute = path.join(workspace, shot.json.artifact.path);
  assert.ok(fs.existsSync(absolute), 'screenshot artifact missing on disk');
  assert.ok(fs.statSync(absolute).size > 500, 'screenshot artifact suspiciously small');
  console.log(`[clean-profile-suite] screenshot from installed extension: ${shot.json.artifact.path}`);

  await api('POST', '/shutdown');
};
