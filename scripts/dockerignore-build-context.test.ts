/**
 * dockerignore-build-context.test.ts — the Docker build context must contain
 * every file the server bundle resolves at build time.
 *
 * WHY THIS EXISTS
 *
 * .dockerignore excludes scripts/** (agent/credential tooling must not ship),
 * with explicit `!` negations for the few files the image build needs. The
 * 2026-08-05 Railway deploy failed because server/_core/dimeAnswerRouting.ts
 * imports two JSON datasets from scripts/data/ — present in git, present
 * locally, absent from the Docker context. Local `pnpm run build` and CI both
 * run on full checkouts, so only the Railway image build could catch it.
 *
 * This test closes that gap statically: every relative import from bundled
 * server code that escapes into root scripts/ must have a matching negation
 * in .dockerignore.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const REPO = resolve(__dirname, "..");

const negations = new Set(
  readFileSync(join(REPO, ".dockerignore"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("!"))
    .map((l) => l.slice(1)),
);

/** Bundled-at-build-time source roots (esbuild entry graph lives under these). */
const BUNDLED_ROOTS = ["server", "shared", "drizzle"];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__pycache__") continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|mts|mjs|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      yield full;
    }
  }
}

const IMPORT_RE = /(?:from\s+|require\(\s*|import\(\s*)["']((?:\.\.\/)+scripts\/[^"']+)["']/g;

describe("Docker build context covers all bundled imports", () => {
  it("every server-bundle import into root scripts/ is negated in .dockerignore", () => {
    const missing: string[] = [];
    for (const root of BUNDLED_ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        const src = readFileSync(file, "utf8");
        for (const match of src.matchAll(IMPORT_RE)) {
          const imported = resolve(join(file, ".."), match[1]);
          const repoRel = relative(REPO, imported).split(sep).join("/");
          // Only root scripts/ is context-excluded; server/scripts/ ships.
          if (!repoRel.startsWith("scripts/")) continue;
          if (!negations.has(repoRel)) {
            missing.push(`${relative(REPO, file)} imports ${repoRel}`);
          }
        }
      }
    }
    expect(
      missing,
      "These build-time imports resolve to files excluded from the Docker " +
        "context by `scripts/**` — the Railway image build will fail with " +
        "esbuild 'Could not resolve'. Add a `!<path>` negation to .dockerignore.",
    ).toEqual([]);
  });

  it("the build-gate script negation is present", () => {
    // pnpm run build calls this before build:server; without the negation the
    // image build dies earlier and louder, but guard it all the same.
    expect([...negations]).toContain("scripts/verify-preview-production.mjs");
  });
});
