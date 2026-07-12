import { bundle, repoRoot } from './esbuild-common.mjs';
import path from 'node:path';
import fs from 'node:fs';

const pkg = path.join(repoRoot, 'packages/runtime');

// Single-file daemon; playwright-core stays external (real dependency with assets).
await bundle({
  entry: path.join(pkg, 'src/daemon-entry.ts'),
  outfile: path.join(pkg, 'dist/daemon.cjs'),
  external: ['playwright-core'],
});

// Ship axe-core's source next to the bundle for on-demand injection.
const axe = path.join(repoRoot, 'node_modules/axe-core/axe.min.js');
if (fs.existsSync(axe)) {
  fs.copyFileSync(axe, path.join(pkg, 'dist/axe.min.js'));
} else {
  console.warn('[bundle-runtime] axe-core not found; accessibility scans will be unavailable');
}
console.log('[bundle-runtime] dist/daemon.cjs ready');
