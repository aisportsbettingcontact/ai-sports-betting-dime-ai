import { bundle, repoRoot } from './esbuild-common.mjs';
import path from 'node:path';

const pkg = path.join(repoRoot, 'packages/mcp-server');
await bundle({
  entry: path.join(pkg, 'src/mcp-entry.ts'),
  outfile: path.join(pkg, 'dist/mcp-server.cjs'),
  external: [], // SDK + zod bundle cleanly; no runtime deps needed at install time
});
console.log('[bundle-mcp] dist/mcp-server.cjs ready');
