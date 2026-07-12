/**
 * VSIX packaging: build everything, stage a self-contained extension folder
 * (bundles + playwright-core as the only real dependency), then `vsce package`
 * into artifacts/livelab-<version>.vsix.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { repoRoot } from './esbuild-common.mjs';

const run = (cmd, cwd = repoRoot) => {
  console.log(`[package] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

run('node scripts/build.mjs');

const app = path.join(repoRoot, 'apps/vscode-extension');
const staging = path.join(repoRoot, 'artifacts/staging/livelab-extension');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// 1. Extension payload.
fs.cpSync(path.join(app, 'dist'), path.join(staging, 'dist'), { recursive: true });
fs.cpSync(path.join(app, 'media'), path.join(staging, 'media'), { recursive: true });

// 2. Manifest: strip workspace-only fields; declare the real runtime dependency.
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const pwVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'node_modules/playwright-core/package.json'), 'utf8'),
).version;
delete manifest.private;
delete manifest.devDependencies;
manifest.dependencies = { 'playwright-core': pwVersion };
manifest.scripts = { 'vscode:prepublish': 'echo prepackaged' };
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));

// 3. Docs required by vsce.
const docsMap = [
  ['docs/EXTENSION_README.md', 'README.md'],
  ['CHANGELOG.md', 'CHANGELOG.md'],
  ['LICENSE', 'LICENSE'],
];
for (const [from, to] of docsMap) {
  const src = path.join(repoRoot, from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, to));
}

// 4. Real node_modules for playwright-core (assets prevent bundling it).
run('npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts', staging);

// 5. Keep the VSIX lean but complete.
fs.writeFileSync(
  path.join(staging, '.vscodeignore'),
  [
    '**/*.map',
    'node_modules/.package-lock.json',
    'node_modules/playwright-core/lib/vite/**', // recorder/trace-viewer UIs are not used headlessly
    'node_modules/.bin/**',
  ].join('\n') + '\n',
);

// 6. Package.
const outDir = path.join(repoRoot, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `livelab-${manifest.version}.vsix`);
fs.rmSync(outFile, { force: true });
const vsce = path.join(repoRoot, 'node_modules/.bin/vsce');
run(`"${vsce}" package --out "${outFile}" --allow-missing-repository --skip-license`, staging);

const bytes = fs.statSync(outFile).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
console.log(`\n[package] ${outFile}`);
console.log(`[package] ${(bytes / 1024 / 1024).toFixed(2)} MB · sha256 ${sha}`);
console.log(`[package] install with: code --install-extension ${path.relative(process.cwd(), outFile)}`);
