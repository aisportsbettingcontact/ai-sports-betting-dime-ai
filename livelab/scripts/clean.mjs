import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './esbuild-common.mjs';

const targets = [
  'packages/protocol/dist',
  'packages/runtime/dist',
  'packages/mcp-server/dist',
  'packages/webview-ui/dist',
  'packages/cli/dist',
  'packages/test-app/dist',
  'apps/vscode-extension/out',
  'apps/vscode-extension/dist',
  'apps/vscode-extension/media/webview.js',
  'apps/vscode-extension/media/webview.js.map',
  'apps/vscode-extension/media/webview.css',
  'artifacts/staging',
];
for (const target of targets) {
  const absolute = path.join(repoRoot, target);
  fs.rmSync(absolute, { recursive: true, force: true });
}
// tsbuildinfo files
for (const dir of ['packages/protocol', 'packages/runtime', 'packages/mcp-server', 'packages/webview-ui', 'packages/cli', 'apps/vscode-extension']) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of fs.readdirSync(abs)) {
    if (file.endsWith('.tsbuildinfo')) fs.rmSync(path.join(abs, file), { force: true });
  }
}
console.log('[clean] done');
