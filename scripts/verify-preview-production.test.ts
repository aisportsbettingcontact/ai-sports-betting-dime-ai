import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { scanDist, LOAD_BEARING_TOKENS } from "./verify-preview-production.mjs";

const dirs: string[] = [];

function fixtureDist(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "preview-scan-"));
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

describe("verify-preview-production scanner", () => {
  it("passes a clean dist", () => {
    const root = fixtureDist({
      "assets/index-abc.js": 'console.log("hello");',
      "index.html": "<div>app</div>",
    });
    const result = scanDist(root);
    expect(result.loadBearing.every((t: { matches: string[] }) => t.matches.length === 0)).toBe(
      true
    );
  });

  it("negative control: detects an injected activation canary", () => {
    const root = fixtureDist({
      "assets/index-abc.js": 'x&&console.debug("__DIME_PREVIEW_GATE_ACTIVE__");',
    });
    const result = scanDist(root);
    const canary = result.loadBearing.find(
      (t: { token: string }) => t.token === "__DIME_PREVIEW_GATE_ACTIVE__"
    );
    expect(canary.matches).toEqual(["assets/index-abc.js"]);
  });

  it("negative control: detects a runtime preview query check", () => {
    const root = fixtureDist({
      "assets/chunk.js": 'if(new URLSearchParams(s).get("preview")==="1"){enable()}',
    });
    const result = scanDist(root);
    expect(
      result.loadBearing.some((t: { matches: string[] }) => t.matches.length > 0)
    ).toBe(true);
  });

  it("scans source maps, which carry original sources", () => {
    const root = fixtureDist({
      "assets/index-abc.js": "min();",
      "assets/index-abc.js.map": JSON.stringify({
        sourcesContent: ['allows(search){return get("preview")==="1"}'],
      }),
    });
    const result = scanDist(root);
    expect(
      result.loadBearing.some((t: { matches: string[] }) =>
        t.matches.includes("assets/index-abc.js.map")
      )
    ).toBe(true);
  });

  it("reports inert plumbing as advisory, not failure", () => {
    const root = fixtureDist({
      "assets/index-abc.js": 'a.searchParams.set("preview","1")',
    });
    const result = scanDist(root);
    expect(result.loadBearing.every((t: { matches: string[] }) => t.matches.length === 0)).toBe(
      true
    );
    expect(
      result.advisory.some((t: { matches: string[] }) => t.matches.length > 0)
    ).toBe(true);
  });

  it("keeps the canary literal in sync with previewGate.ts", () => {
    expect(LOAD_BEARING_TOKENS).toContain("__DIME_PREVIEW_GATE_ACTIVE__");
  });
});
