/**
 * Clean-profile installation proof (spec §26 steps 19–22):
 * 1. Install the packaged VSIX into a fresh VS Code profile (empty user-data
 *    and extensions dirs) using the real VS Code CLI.
 * 2. Verify the extension is listed.
 * 3. Launch that VS Code with the INSTALLED extension (no development path)
 *    and run the open → attach → screenshot flow inside the extension host.
 * 4. Prove headless MCP screenshot capture with VS Code closed.
 */
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Headless Linux → wrap in xvfb-run once.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.LIVELAB_XVFB_WRAPPED) {
  const probe = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error('[clean-profile] no DISPLAY and no xvfb-run');
    process.exit(1);
  }
  execFileSync('xvfb-run', ['--auto-servernum', process.execPath, fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, LIVELAB_XVFB_WRAPPED: '1' },
  });
  process.exit(0);
}

const vsix = fs
  .readdirSync(path.join(repoRoot, 'artifacts'))
  .filter((f) => /^livelab-.*\.vsix$/.test(f))
  .map((f) => path.join(repoRoot, 'artifacts', f))
  .sort()
  .pop();
if (!vsix) {
  console.error('[clean-profile] no VSIX in artifacts/ — run npm run package first');
  process.exit(1);
}
console.log(`[clean-profile] VSIX: ${vsix}`);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-clean-profile-'));
const userDataDir = path.join(profile, 'user-data');
const extensionsDir = path.join(profile, 'extensions');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

const vscodeExecutablePath = await downloadAndUnzipVSCode();
const [cliPath, ...cliBaseArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
const profileArgs = [`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`];

// 1. Install into the clean profile.
console.log('[clean-profile] installing VSIX into a fresh profile…');
execFileSync(cliPath, [...cliBaseArgs, ...profileArgs, '--install-extension', vsix], { stdio: 'inherit' });

// 2. Verify it is listed.
const listed = execFileSync(cliPath, [...cliBaseArgs, ...profileArgs, '--list-extensions', '--show-versions'], {
  encoding: 'utf8',
});
console.log(`[clean-profile] installed extensions:\n${listed.trim()}`);
if (!/^livelab\.livelab@/m.test(listed)) {
  console.error('[clean-profile] FAIL: livelab.livelab not listed after install');
  process.exit(1);
}

// 3. Run the open → attach → screenshot flow against the INSTALLED extension.
//    extensionDevelopmentPath points at an empty stub so only the installed
//    VSIX provides LiveLab.
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-stub-ext-'));
fs.writeFileSync(
  path.join(stub, 'package.json'),
  JSON.stringify({
    name: 'livelab-clean-profile-probe',
    publisher: 'livelab-test',
    version: '0.0.1',
    engines: { vscode: '*' },
    main: './extension.js',
  }),
);
fs.writeFileSync(path.join(stub, 'extension.js'), 'exports.activate = () => {}; exports.deactivate = () => {};');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'livelab-clean-ws-'));
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'clean-ws', version: '1.0.0' }));

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: stub,
    extensionTestsPath: path.join(here, 'clean-profile-suite.cjs'),
    launchArgs: [
      workspace,
      ...profileArgs,
      '--disable-workspace-trust',
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
  console.log('[clean-profile] installed-extension flow PASS');
} catch (err) {
  console.error('[clean-profile] FAILED', err);
  process.exit(1);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(stub, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log('[clean-profile] PASS');
