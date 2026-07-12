/**
 * VS Code extension test runner: downloads a real VS Code build, launches it
 * with this extension in development mode against a scratch workspace, and
 * runs the Mocha suite inside the extension host. Re-execs under xvfb-run on
 * headless Linux.
 */
import { runTests } from '@vscode/test-electron';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = path.resolve(here, '..');
const extensionTestsPath = path.resolve(here, 'suite', 'index.cjs');

// Headless Linux → wrap in xvfb-run once.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.LIVELAB_XVFB_WRAPPED) {
  const probe = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
  if (probe.status === 0) {
    console.log('[extension-tests] no DISPLAY: re-running under xvfb-run');
    execFileSync('xvfb-run', ['--auto-servernum', process.execPath, fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, LIVELAB_XVFB_WRAPPED: '1' },
    });
    process.exit(0);
  } else {
    console.error('[extension-tests] no DISPLAY and no xvfb-run available');
    process.exit(1);
  }
}

// Scratch workspace with a minimal web project.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-ext-ws-'));
fs.writeFileSync(
  path.join(workspace, 'package.json'),
  JSON.stringify({ name: 'ext-test-app', version: '1.0.0', scripts: { dev: 'node server.mjs' } }, null, 2),
);
fs.writeFileSync(path.join(workspace, 'index.html'), '<main><h1>ext test</h1></main>');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspace,
      '--disable-workspace-trust', // test host: trusted workspace (trust UI cannot be scripted)
      '--disable-gpu',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    extensionTestsEnv: {
      LIVELAB_TEST_WORKSPACE: workspace,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '',
      LIVELAB_CHROMIUM_PATH: process.env.LIVELAB_CHROMIUM_PATH ?? '',
    },
  });
  console.log('[extension-tests] PASS');
} catch (err) {
  console.error('[extension-tests] FAILED', err);
  process.exit(1);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
