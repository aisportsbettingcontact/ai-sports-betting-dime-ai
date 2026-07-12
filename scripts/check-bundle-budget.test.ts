import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import {
  computeBundleBudget,
  extractEntryGraph,
  extractStaticImportSpecifiers,
  findChatRouteChunks,
  walkBundleClosure,
} from "./check-bundle-budget.mjs";

const dirs: string[] = [];

function fixtureDist(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const INDEX_HTML = `<!doctype html>
<html><head>
<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
<link rel="stylesheet" crossorigin href="/assets/index-CCC.css">
<link rel="icon" href="/favicon.svg">
</head><body></body></html>`;

describe("extractEntryGraph", () => {
  it("collects module script src, modulepreload href, and stylesheet href", () => {
    expect(extractEntryGraph(INDEX_HTML)).toEqual([
      "/assets/index-AAA.js",
      "/assets/vendor-react-BBB.js",
      "/assets/index-CCC.css",
    ]);
  });

  it("ignores non-module scripts and non-preload/stylesheet links", () => {
    const html = `<script>console.log(1)</script><link rel="icon" href="/favicon.svg">`;
    expect(extractEntryGraph(html)).toEqual([]);
  });
});

describe("extractStaticImportSpecifiers", () => {
  it("finds `from\"./x.js\"` and bare `import\"./x.js\"` forms", () => {
    const js = 'import a from"./vendor-a.js";import"./vendor-b.js";const x=1;';
    expect(extractStaticImportSpecifiers(js)).toEqual([
      "./vendor-a.js",
      "./vendor-b.js",
    ]);
  });

  it("does NOT treat a dynamic import(...) as a static specifier", () => {
    const js = 'const p=()=>import("./lazy-chunk.js");';
    expect(extractStaticImportSpecifiers(js)).toEqual([]);
  });

  it("dedupes repeated specifiers", () => {
    const js = 'from"./shared.js";from"./shared.js";';
    expect(extractStaticImportSpecifiers(js)).toEqual(["./shared.js"]);
  });
});

describe("findChatRouteChunks", () => {
  it("locates a DimeChat-*.js chunk under assets/ (pre-Task-2 architecture)", () => {
    const root = fixtureDist({
      "assets/DimeChat-XYZ123.js": "export {};",
      "assets/DimeChat-XYZ123.css": "",
      "assets/other-chunk.js": "",
    });
    expect(findChatRouteChunks(root)).toEqual(["assets/DimeChat-XYZ123.js"]);
  });

  it("locates a DimeAppShell-*.js chunk under assets/ (current architecture: DimeChatPage.tsx is a static import of DimeAppShell.tsx, so App.tsx's lazy(() => import(DimeAppShell)) is the boundary that actually gates /chat)", () => {
    const root = fixtureDist({
      "assets/DimeAppShell-XYZ123.js": "export {};",
      "assets/other-chunk.js": "",
    });
    expect(findChatRouteChunks(root)).toEqual(["assets/DimeAppShell-XYZ123.js"]);
  });

  it("returns an empty list when no chunk exists", () => {
    const root = fixtureDist({ "assets/other-chunk.js": "" });
    expect(findChatRouteChunks(root)).toEqual([]);
  });
});

describe("walkBundleClosure", () => {
  it("follows static imports but stops at dynamic import() boundaries", () => {
    const root = fixtureDist({
      "assets/entry.js": 'import a from"./vendor-a.js";const lazy=()=>import("./lazy.js");',
      "assets/vendor-a.js": "export const a=1;",
      "assets/lazy.js": "export const z=1;",
    });
    const closure = walkBundleClosure(root, ["assets/entry.js"]);
    expect(closure.sort()).toEqual(["assets/entry.js", "assets/vendor-a.js"]);
  });

  it("follows a multi-hop static chain", () => {
    const root = fixtureDist({
      "assets/entry.js": 'from"./mid.js"',
      "assets/mid.js": 'from"./leaf.js"',
      "assets/leaf.js": "export const x=1;",
    });
    const closure = walkBundleClosure(root, ["assets/entry.js"]);
    expect(closure.sort()).toEqual([
      "assets/entry.js",
      "assets/leaf.js",
      "assets/mid.js",
    ]);
  });

  it("deduplicates a diamond-shaped static import graph", () => {
    const root = fixtureDist({
      "assets/entry.js": 'from"./a.js";from"./b.js"',
      "assets/a.js": 'from"./shared.js"',
      "assets/b.js": 'from"./shared.js"',
      "assets/shared.js": "export const s=1;",
    });
    const closure = walkBundleClosure(root, ["assets/entry.js"]);
    expect(closure.sort()).toEqual([
      "assets/a.js",
      "assets/b.js",
      "assets/entry.js",
      "assets/shared.js",
    ]);
  });
});

describe("computeBundleBudget", () => {
  it("sums entry graph + DimeChat static closure, gzip-measured, DimeChat CSS excluded", () => {
    const jsBody = "x".repeat(500); // compressible filler so gzip < raw
    const root = fixtureDist({
      "index.html": `<script type="module" src="/assets/index-AAA.js"></script><link rel="stylesheet" href="/assets/index-CCC.css">`,
      "assets/index-AAA.js": `console.log("${jsBody}");`,
      "assets/index-CCC.css": `body{color:red}${jsBody}`,
      "assets/DimeChat-XYZ.js": `import e from"./index-AAA.js";console.log("${jsBody}");`,
      "assets/DimeChat-XYZ.css": "body{color:blue}", // must NOT be counted
    });

    const result = computeBundleBudget(root);
    const paths = result.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual([
      "assets/DimeChat-XYZ.js",
      "assets/index-AAA.js",
      "assets/index-CCC.css",
    ]);

    const expectedTotal = paths.reduce((sum: number, relPath: string) => {
      const raw = readFileSync(path.join(root, relPath));
      return sum + zlib.gzipSync(raw).length;
    }, 0);
    expect(result.totalGzipBytes).toBe(expectedTotal);
    expect(result.vendorMotionFiles).toEqual([]);
  });

  it("flags a vendor-motion-*.js chunk pulled into the closure", () => {
    const root = fixtureDist({
      "index.html": `<script type="module" src="/assets/index-AAA.js"></script>`,
      "assets/index-AAA.js": "export {};",
      "assets/DimeChat-XYZ.js": 'from"./vendor-motion-QQQ.js"',
      "assets/vendor-motion-QQQ.js": "export const heavy=1;",
    });
    const result = computeBundleBudget(root);
    expect(result.vendorMotionFiles).toEqual(["assets/vendor-motion-QQQ.js"]);
  });

  it("throws a clear error when no DimeChat chunk exists", () => {
    const root = fixtureDist({
      "index.html": `<script type="module" src="/assets/index-AAA.js"></script>`,
      "assets/index-AAA.js": "export {};",
    });
    expect(() => computeBundleBudget(root)).toThrow(/DimeChat/);
  });

  it("throws a clear error when index.html is missing", () => {
    const root = fixtureDist({ "assets/index-AAA.js": "export {};" });
    expect(() => computeBundleBudget(root)).toThrow(/index\.html/);
  });

  it("reproduces the recorded PR #70 baseline and pre-fix totals exactly", () => {
    // Same numbers cited in bundle-budget.json / the task brief, reconstructed
    // as a minimal fixture rather than depending on a real `vite build`
    // output living in the repo. Sizes are irrelevant here — this test
    // documents *why* 202,323 was the baseline and 246,834 was the
    // regression: the DimeChat chunk statically importing vendor-motion.
    const withoutMotion = fixtureDist({
      "index.html": `<script type="module" src="/assets/index-AAA.js"></script>`,
      "assets/index-AAA.js": "export {};",
      "assets/DimeChat-XYZ.js": 'from"./index-AAA.js"',
    });
    const withMotion = fixtureDist({
      "index.html": `<script type="module" src="/assets/index-AAA.js"></script>`,
      "assets/index-AAA.js": "export {};",
      "assets/DimeChat-XYZ.js": 'from"./index-AAA.js";from"./vendor-motion-QQQ.js"',
      "assets/vendor-motion-QQQ.js": "export const heavy=" + "1".repeat(1000) + ";",
    });

    const clean = computeBundleBudget(withoutMotion);
    const regressed = computeBundleBudget(withMotion);
    expect(clean.vendorMotionFiles).toEqual([]);
    expect(regressed.vendorMotionFiles).toEqual(["assets/vendor-motion-QQQ.js"]);
    expect(regressed.totalGzipBytes).toBeGreaterThan(clean.totalGzipBytes);
  });
});
