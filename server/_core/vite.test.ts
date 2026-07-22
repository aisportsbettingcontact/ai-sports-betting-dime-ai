import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Round-3 hotfix (2026-07-22 stale-bfcache incident) — server source-contract
 * guard, following the pattern in server/legacyRedirects.test.ts (read the
 * real .ts source, pin the fix as string/regex matches rather than spinning
 * up an express app + real Vite build, which this repo's other server tests
 * avoid for the same reason).
 *
 * Root cause (see .superpowers/sdd/r3-live-c-report.md, C7):
 * serveStatic()'s fallback `express.static(distPath)` mount defaults its own
 * `index` option on, so a request for "/" (or a literal "/index.html") was
 * fully handled THERE — with a weak, bfcache-eligible
 * `Cache-Control: public, max-age=0` — and never reached the catch-all below
 * that sets NO_CACHE_HEADERS for every other SPA route. A tab that last
 * loaded the bare domain root before a deploy could restore straight from
 * bfcache after the deploy shipped: old JS, no network request, no server
 * log entry — indistinguishable from "the deploy didn't ship."
 *
 * Fix: `index: false` on that mount so "/" falls through to the existing
 * no-store catch-all; `setHeaders` additionally guards a literal
 * "/index.html" request, since `index: false` only disables the
 * directory-index auto-serve, not an explicit filename match. The hashed
 * `/assets/*` mount (a SEPARATE express.static call) must keep its
 * long/immutable caching untouched.
 */

const viteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "vite.ts"),
  "utf8"
);

describe("serveStatic — root index.html is always no-store (2026-07-22 stale-bfcache incident)", () => {
  it("documents the incident it fixes", () => {
    expect(viteSrc).toMatch(/2026-07-22 stale-bfcache incident/);
  });

  it("mounts the fallback static middleware with index disabled, so \"/\" can no longer be auto-served with a cacheable header", () => {
    const fallbackIdx = viteSrc.indexOf("express.static(distPath,");
    expect(fallbackIdx).toBeGreaterThan(-1);
    const fallbackEnd = viteSrc.indexOf(");", fallbackIdx);
    const fallbackBlock = viteSrc.slice(fallbackIdx, fallbackEnd);
    expect(fallbackBlock).toMatch(/index: false,/);
  });

  it("still guards a literal \"/index.html\" request explicitly, since index:false only disables the directory-index auto-serve", () => {
    const fallbackIdx = viteSrc.indexOf("express.static(distPath,");
    const fallbackEnd = viteSrc.indexOf(");", fallbackIdx);
    const fallbackBlock = viteSrc.slice(fallbackIdx, fallbackEnd);
    expect(fallbackBlock).toMatch(/setHeaders:/);
    expect(fallbackBlock).toMatch(/path\.basename\(filePath\) === "index\.html"/);
    expect(fallbackBlock).toMatch(/Object\.entries\(NO_CACHE_HEADERS\)/);
  });

  it("the catch-all \"/\" now falls through to — still sends index.html with NO_CACHE_HEADERS", () => {
    const catchAllIdx = viteSrc.indexOf('app.use("*", (_req, res) => {');
    expect(catchAllIdx).toBeGreaterThan(-1);
    const sendFileIdx = viteSrc.indexOf("res.sendFile(", catchAllIdx);
    expect(sendFileIdx).toBeGreaterThan(catchAllIdx);
    const catchAllEnd = viteSrc.indexOf("});", sendFileIdx);
    const catchAllBlock = viteSrc.slice(catchAllIdx, catchAllEnd);
    expect(catchAllBlock).toMatch(/res\.set\(\{ \.\.\.NO_CACHE_HEADERS \}\)/);
    expect(catchAllBlock).toMatch(
      /res\.sendFile\(path\.resolve\(distPath, "index\.html"\)\)/
    );
    // The fallback static mount (with its new index:false) must come BEFORE
    // this catch-all — that ordering is what lets "/" fall through to it.
    const fallbackIdx = viteSrc.indexOf("express.static(distPath,");
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeLessThan(catchAllIdx);
  });

  it("hashed /assets/* keeps its own separate, untouched 1-year immutable mount — not affected by this fix", () => {
    const assetsIdx = viteSrc.indexOf('app.use(\n    "/assets",');
    expect(assetsIdx).toBeGreaterThan(-1);
    const varyIdx = viteSrc.indexOf('"Vary", "Accept-Encoding"', assetsIdx);
    expect(varyIdx).toBeGreaterThan(assetsIdx);
    const assetsEnd = viteSrc.indexOf(");", varyIdx);
    const assetsBlock = viteSrc.slice(assetsIdx, assetsEnd);
    expect(assetsBlock).toMatch(/maxAge: "1y",/);
    expect(assetsBlock).toMatch(/immutable: true,/);
    expect(assetsBlock).toMatch(
      /Cache-Control", "public, max-age=31536000, immutable"/
    );
    // This mount must not have gained index:false — that option is
    // meaningless here (assets are never requested as a bare directory) and
    // its presence would signal an accidental edit of the wrong mount.
    expect(assetsBlock).not.toMatch(/index: false/);
  });
});
