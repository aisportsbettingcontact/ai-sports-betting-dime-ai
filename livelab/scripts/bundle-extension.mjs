import { bundle, repoRoot } from './esbuild-common.mjs';
import path from 'node:path';
import fs from 'node:fs';

const app = path.join(repoRoot, 'apps/vscode-extension');

// Extension host bundle ('vscode' is provided by the host).
await bundle({
  entry: path.join(app, 'src/extension.ts'),
  outfile: path.join(app, 'dist/extension.js'),
  external: ['vscode'],
});

// Co-package the runtime daemon, MCP server, CLI, and axe asset so the VSIX is
// self-contained (playwright-core is staged as a real dependency at package time).
const runtimeOut = path.join(app, 'dist/runtime');
fs.mkdirSync(runtimeOut, { recursive: true });
const copies = [
  ['packages/runtime/dist/daemon.cjs', 'daemon.cjs'],
  ['packages/runtime/dist/daemon.cjs.map', 'daemon.cjs.map'],
  ['packages/runtime/dist/axe.min.js', 'axe.min.js'],
  ['packages/mcp-server/dist/mcp-server.cjs', 'mcp-server.cjs'],
  ['packages/cli/dist/cli.cjs', 'cli.cjs'],
];
for (const [from, to] of copies) {
  const src = path.join(repoRoot, from);
  if (!fs.existsSync(src)) {
    if (from.endsWith('.map')) continue;
    throw new Error(`[bundle-extension] missing ${from} — build order broken`);
  }
  fs.copyFileSync(src, path.join(runtimeOut, to));
}
console.log('[bundle-extension] dist/extension.js + dist/runtime/* ready');
