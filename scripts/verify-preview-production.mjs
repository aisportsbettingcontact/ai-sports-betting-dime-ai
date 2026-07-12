/**
 * verify-preview-production.mjs — prove the local preview ACTIVATION
 * capability is dead in production output.
 *
 * What this can and cannot guarantee (learned the hard way — the previous
 * token list reported PASS while `searchParams.set("preview","1")` and the
 * `local-dime-preview` host literal were sitting in the shipped index chunk):
 *
 * - LOAD-BEARING tokens are string literals that survive minification and
 *   exist only inside the preview *activation* path (reading ?preview=1 and
 *   bypassing RequireAuth). `__DIME_PREVIEW_GATE_ACTIVE__` is planted inside
 *   allowsLocalDimePreview for exactly this purpose: production builds fold
 *   the whole function to `false` (callers pass the compile-time constant
 *   import.meta.env.DEV) and the canary vanishes; any change that makes the
 *   gate runtime-decidable keeps the canary alive and fails this scan.
 * - ADVISORY tokens indicate inert preview *plumbing* (URL preservation)
 *   that is unreachable while activation is dead. They are reported, not
 *   failed, so this script never claims more than it proves.
 * - Identifier names are NOT used: the minifier renames them, so their
 *   absence proves nothing.
 *
 * Scans .js/.css/.html and .map files (source maps ship sourcesContent).
 *
 * Usage: node scripts/verify-preview-production.mjs [distDir]
 * Exit codes: 0 clean, 1 load-bearing leak, 2 usage/input error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOAD_BEARING_TOKENS = [
  "__DIME_PREVIEW_GATE_ACTIVE__",
  'get("preview")',
  "get('preview')",
  "preview=1",
];

export const ADVISORY_TOKENS = [
  'set("preview","1")',
  'set("preview", "1")',
  "local-dime-preview",
];

const SCAN_EXTENSIONS = new Set([".css", ".html", ".js", ".map"]);

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath);
    return SCAN_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

export function scanDist(outputRoot) {
  if (!fs.existsSync(outputRoot)) {
    throw new Error(`build output not found: ${outputRoot}`);
  }
  const files = collectFiles(outputRoot);
  // Source maps JSON-escape their embedded sources, so a raw-text scan would
  // miss `get(\"preview\")`. Decode sourcesContent and scan the decoded text
  // alongside the raw file.
  const contentOf = (file) => {
    const raw = fs.readFileSync(file, "utf8");
    if (path.extname(file) !== ".map") return raw;
    try {
      const parsed = JSON.parse(raw);
      const sources = (parsed.sourcesContent ?? []).filter(Boolean).join("\n");
      return `${raw}\n${sources}`;
    } catch {
      return raw;
    }
  };
  const findToken = (token) =>
    files
      .filter((file) => contentOf(file).includes(token))
      .map((file) => path.relative(outputRoot, file));

  return {
    files: files.length,
    loadBearing: LOAD_BEARING_TOKENS.map((token) => ({
      token,
      matches: findToken(token),
    })),
    advisory: ADVISORY_TOKENS.map((token) => ({
      token,
      matches: findToken(token),
    })),
  };
}

function main() {
  const outputRoot = path.resolve(process.argv[2] ?? "dist/public");
  let result;
  try {
    result = scanDist(outputRoot);
  } catch (error) {
    console.error(`[preview-production] ${error.message}`);
    process.exit(2);
  }

  let failed = false;
  for (const { token, matches } of result.loadBearing) {
    console.log(
      `[preview-production] load-bearing ${JSON.stringify(token)}: ${matches.length} matches`
    );
    for (const file of matches) console.log(`  ${file}`);
    failed ||= matches.length > 0;
  }
  for (const { token, matches } of result.advisory) {
    if (matches.length > 0) {
      console.log(
        `[preview-production] advisory ${JSON.stringify(token)}: present in ${matches.length} file(s) — inert plumbing, activation still verified dead`
      );
    }
  }

  if (failed) {
    console.error(
      "[preview-production] FAIL: preview activation capability reached production output"
    );
    process.exit(1);
  }
  console.log(
    `[preview-production] PASS: preview activation is dead in production output (${result.files} files scanned, source maps included)`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
