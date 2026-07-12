import { bundle, repoRoot } from './esbuild-common.mjs';
import path from 'node:path';

const pkg = path.join(repoRoot, 'packages/cli');
await bundle({
  entry: path.join(pkg, 'src/cli-entry.ts'),
  outfile: path.join(pkg, 'dist/cli.cjs'),
  external: ['playwright-core'], // only used by doctor via optional require
});
console.log('[bundle-cli] dist/cli.cjs ready');
