/** Orchestrated production build: typecheck (project references) then per-package bundles. */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from './esbuild-common.mjs';

const run = (cmd, cwd = repoRoot) => {
  console.log(`\n[build] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

const watch = process.argv.includes('--watch');
if (watch) {
  console.log('[build] dev mode: building once, then watching TypeScript');
}

// 1. Compile all TS project references (emits dist/ for protocol + runtime libs, out/ for extension).
run('npx tsc -b tsconfig.json');

// 2. Bundles + assets.
run('node scripts/bundle-runtime.mjs');
run('node scripts/bundle-mcp.mjs');
run('node scripts/bundle-cli.mjs');
run('node scripts/bundle-webview.mjs');
run('node scripts/bundle-extension.mjs');

if (watch) {
  run('npx tsc -b tsconfig.json --watch');
}
console.log('\n[build] complete');
