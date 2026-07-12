import { bundle, repoRoot } from './esbuild-common.mjs';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const pkg = path.join(repoRoot, 'packages/webview-ui');
const mediaDir = path.join(repoRoot, 'apps/vscode-extension/media');
fs.mkdirSync(mediaDir, { recursive: true });

await bundle({
  entry: path.join(pkg, 'src/main.ts'),
  outfile: path.join(mediaDir, 'webview.js'),
  platform: 'browser',
  format: 'iife',
  minify: true,
});
fs.copyFileSync(path.join(pkg, 'src/webview.css'), path.join(mediaDir, 'webview.css'));

// Performance budget: webview bundle under 500KB compressed (spec §17).
const raw = fs.readFileSync(path.join(mediaDir, 'webview.js'));
const compressed = zlib.gzipSync(raw).length;
console.log(`[bundle-webview] webview.js ${(raw.length / 1024).toFixed(1)}KB raw, ${(compressed / 1024).toFixed(1)}KB gzip`);
if (compressed > 500 * 1024) {
  throw new Error(`webview bundle exceeds the 500KB compressed budget: ${compressed} bytes`);
}
