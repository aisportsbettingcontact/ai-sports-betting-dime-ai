import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function bundle({ entry, outfile, platform = 'node', external = [], format = 'cjs', minify = false, define = {} }) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform,
    format,
    target: platform === 'node' ? 'node20' : 'es2022',
    sourcemap: true,
    minify,
    external,
    define,
    logLevel: 'warning',
  });
  return result;
}
