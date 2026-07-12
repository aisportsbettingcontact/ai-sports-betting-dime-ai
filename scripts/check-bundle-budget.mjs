/**
 * check-bundle-budget.mjs — enforce the /chat critical-path gzip budget.
 *
 * PR #70 shipped DimeChatPage.tsx importing framer-motion directly, which
 * pulled the vendor-motion chunk (40,871 gzip bytes) into the STATIC import
 * graph of every /chat page load — the framer-motion dependency itself is
 * fine (GameCard, ModelProjections, Subscribe* still lazily import it), the
 * defect was making it load-bearing on the chat critical path. This script
 * measures that path and gates it in CI so the regression can't ship again
 * silently (e.g. via a new "just this once" static import).
 *
 * Metric ("chat-critical-path-gzip-bytes"): gzip bytes of
 *   (a) the ENTRY GRAPH — every .js/.css `dist/public/index.html` itself
 *       references via <script type="module" src>, <link rel="modulepreload"
 *       href>, and <link rel="stylesheet" href>
 *   PLUS
 *   (b) the chat route's lazy chunk and its transitive STATIC import
 *       closure — walked via the literal minified-output forms Vite/Rollup
 *       emit, `from"./X.js"` and the bare side-effect form `import"./X.js"`.
 *       Dynamic `import("./X.js")` (a real code-split/lazy boundary, e.g.
 *       how App.tsx reaches that chunk from the entry chunk, or how
 *       GameCard/ModelProjections/Subscribe* reach framer-motion) is
 *       deliberately NOT walked — that's the whole point of the metric.
 *
 *       Which file is "the chat route's lazy chunk" has moved: at the
 *       202,323-byte baseline (7dcbd369, pre-PR#70) and at the 246,834-byte
 *       regression this gate exists to prevent (30cdef2a), /chat's page
 *       component was its own React.lazy() boundary, so Vite named its
 *       chunk `DimeChat-*.js`. PR #70's own Task 2 (unified chat mount,
 *       fixing a remount defect across the 768px breakpoint) subsequently
 *       made DimeChatPage.tsx a plain static import of DimeAppShell.tsx —
 *       App.tsx's `lazy(() => import("./pages/dime-shell/DimeAppShell"))` is
 *       now the boundary that actually gates /chat, so Vite names the chunk
 *       `DimeAppShell-*.js` instead; DimeChatPage's code lives inside it.
 *       findChatRouteChunk() below matches either name so this gate keeps
 *       measuring "whatever loads /chat" rather than one fixed filename.
 * CSS emitted for that chunk is intentionally out of scope (Vite associates
 * it via a runtime preload-hints array, not a static import, and the byte
 * budget here is about JS/vendor weight).
 *
 * gzip: Node's `zlib.gzipSync(buffer)` with NO options override — this is
 * the exact algorithm that reproduces Vite's own build-time gzip column
 * (verified against two known builds: 7dcbd369 -> 202,323 bytes with
 * vendor-motion absent from the closure; 30cdef2a -> 246,834 bytes with it
 * present). `gzip -9` or any other compression level will NOT reproduce
 * these numbers — do not "optimize" this without re-deriving the baseline.
 *
 * Usage: node scripts/check-bundle-budget.mjs [distDir]
 *   Reads ./bundle-budget.json for { baselineBytes, allowanceBytes }.
 *   Writes bundle-budget-report.json next to bundle-budget.json.
 * Exit codes: 0 within budget; 1 over budget; 2 usage/input error.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_CONFIG_PATH = path.join(REPO_ROOT, "bundle-budget.json");
const REPORT_PATH = path.join(REPO_ROOT, "bundle-budget-report.json");

// Static-import forms Vite/Rollup emit in minified output. Both require the
// specifier to start with "./" and be quote-delimited with no whitespace —
// which is also exactly what excludes a dynamic `import("./x.js")` (that has
// a "(" immediately after "import", never a quote).
const STATIC_IMPORT_FROM_RE = /from"(\.\/[^"]+\.js)"/g;
const STATIC_IMPORT_BARE_RE = /\bimport"(\.\/[^"]+\.js)"/g;

function tagAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function findTags(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}

/** Parses dist/public/index.html for the .js/.css files it directly references. */
export function extractEntryGraph(html) {
  const files = new Set();

  for (const tag of findTags(html, "script")) {
    if (!/type="module"/i.test(tag)) continue;
    const src = tagAttr(tag, "src");
    if (src) files.add(src);
  }
  for (const tag of findTags(html, "link")) {
    const rel = tagAttr(tag, "rel");
    if (rel !== "modulepreload" && rel !== "stylesheet") continue;
    const href = tagAttr(tag, "href");
    if (href) files.add(href);
  }

  return [...files];
}

/** Absolute-URL asset ref (e.g. "/assets/x.js") -> path relative to distDir. */
function toDistRelative(assetRef) {
  return assetRef.startsWith("/") ? assetRef.slice(1) : assetRef;
}

// Both names the /chat lazy chunk has been built under — see the module doc.
const CHAT_ROUTE_CHUNK_RE = /^(DimeChat|DimeAppShell)-.*\.js$/;

/** Finds the /chat route's lazy chunk(s) actually present in the build output. */
export function findChatRouteChunks(distDir) {
  const assetsDir = path.join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) return [];
  return fs
    .readdirSync(assetsDir)
    .filter(name => CHAT_ROUTE_CHUNK_RE.test(name))
    .map(name => path.posix.join("assets", name));
}

/** Static (non-dynamic) `.js` import specifiers a built chunk references. */
export function extractStaticImportSpecifiers(jsContent) {
  const specifiers = new Set();
  for (const match of jsContent.matchAll(STATIC_IMPORT_FROM_RE)) {
    specifiers.add(match[1]);
  }
  for (const match of jsContent.matchAll(STATIC_IMPORT_BARE_RE)) {
    specifiers.add(match[1]);
  }
  return [...specifiers];
}

/**
 * BFS over the union of entry-graph files and the chat route chunk(s),
 * following only static `.js` import specifiers. Returns dist-relative
 * paths (posix separators), deduplicated.
 */
export function walkBundleClosure(distDir, seedRelativePaths) {
  const visited = new Set();
  const queue = [...seedRelativePaths];

  while (queue.length > 0) {
    const relPath = queue.shift();
    if (visited.has(relPath)) continue;
    const absPath = path.join(distDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    visited.add(relPath);
    if (!relPath.endsWith(".js")) continue;

    const content = fs.readFileSync(absPath, "utf8");
    const dir = path.posix.dirname(relPath.split(path.sep).join("/"));
    for (const specifier of extractStaticImportSpecifiers(content)) {
      const resolved = path.posix.normalize(path.posix.join(dir, specifier));
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }

  return [...visited];
}

function gzipBytes(absPath) {
  return zlib.gzipSync(fs.readFileSync(absPath)).length;
}

/** Computes the full metric for a build output directory. */
export function computeBundleBudget(distDir) {
  const indexHtmlPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`index.html not found under ${distDir}`);
  }
  const html = fs.readFileSync(indexHtmlPath, "utf8");
  const entryGraph = extractEntryGraph(html).map(toDistRelative);
  const chatRouteChunks = findChatRouteChunks(distDir);
  if (chatRouteChunks.length === 0) {
    throw new Error(
      `no DimeChat-*.js or DimeAppShell-*.js chunk found under ${distDir}/assets`
    );
  }

  const closure = walkBundleClosure(distDir, [
    ...entryGraph,
    ...chatRouteChunks,
  ]).sort();

  const files = closure.map(relPath => {
    const absPath = path.join(distDir, relPath);
    const rawBytes = fs.statSync(absPath).size;
    return { path: relPath, rawBytes, gzipBytes: gzipBytes(absPath) };
  });

  const totalGzipBytes = files.reduce((sum, f) => sum + f.gzipBytes, 0);
  const vendorMotionFiles = files
    .map(f => f.path)
    .filter(p => /vendor-motion-.*\.js$/.test(p));

  return { files, totalGzipBytes, chatRouteChunks, vendorMotionFiles };
}

function loadBudgetConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { baselineBytes, allowanceBytes } = raw;
  if (typeof baselineBytes !== "number" || typeof allowanceBytes !== "number") {
    throw new Error(
      `${configPath} must define numeric baselineBytes and allowanceBytes`
    );
  }
  return { ...raw, ceilingBytes: baselineBytes + allowanceBytes };
}

function formatBytes(n) {
  return n.toLocaleString("en-US");
}

function main() {
  const distDir = path.resolve(process.argv[2] ?? "dist/public");
  let config;
  try {
    config = loadBudgetConfig(BUDGET_CONFIG_PATH);
  } catch (error) {
    console.error(`[bundle-budget] ${error.message}`);
    process.exit(2);
  }

  let result;
  try {
    result = computeBundleBudget(distDir);
  } catch (error) {
    console.error(`[bundle-budget] ${error.message}`);
    process.exit(2);
  }

  const { files, totalGzipBytes, vendorMotionFiles } = result;
  const over = totalGzipBytes > config.ceilingBytes;

  console.log(
    `[bundle-budget] metric: ${config.metric} (baseline ${config.baselineCommit} = ${formatBytes(config.baselineBytes)}B, +${formatBytes(config.allowanceBytes)}B allowance)`
  );
  console.log(`[bundle-budget] file                                         raw B   gzip B`);
  for (const f of files) {
    console.log(
      `[bundle-budget] ${f.path.padEnd(44)} ${String(f.rawBytes).padStart(8)} ${String(f.gzipBytes).padStart(8)}`
    );
  }
  console.log(
    `[bundle-budget] TOTAL gzip: ${formatBytes(totalGzipBytes)}B vs ceiling ${formatBytes(config.ceilingBytes)}B (${over ? "OVER" : "within budget"})`
  );
  console.log(
    `[bundle-budget] vendor-motion chunks in path: ${vendorMotionFiles.length}${vendorMotionFiles.length ? ` (${vendorMotionFiles.join(", ")})` : ""}`
  );

  const report = {
    metric: config.metric,
    baselineCommit: config.baselineCommit,
    baselineBytes: config.baselineBytes,
    allowanceBytes: config.allowanceBytes,
    ceilingBytes: config.ceilingBytes,
    totalGzipBytes,
    over,
    files,
    vendorMotionFiles,
    distDir,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  if (over) {
    console.error(
      `[bundle-budget] FAIL: ${formatBytes(totalGzipBytes)}B exceeds the ${formatBytes(config.ceilingBytes)}B ceiling by ${formatBytes(totalGzipBytes - config.ceilingBytes)}B`
    );
    process.exit(1);
  }
  console.log(
    `[bundle-budget] PASS: ${formatBytes(totalGzipBytes)}B is ${formatBytes(config.ceilingBytes - totalGzipBytes)}B under the ceiling`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
