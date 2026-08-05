/**
 * scripts/os/artifacts.test.ts — the /os/ artifact gate (ISSUE-006).
 *
 * Rides the ALREADY-REQUIRED `Vitest` check: `scripts/**\/*.test.ts` is in the
 * vitest include set and `Vitest` is one of three required contexts on `main`.
 * So this binds on merge with NO ruleset change — which matters, because in
 * five ruleset revisions this repo has never once promoted a check.
 *
 * STRUCTURAL VALIDATION ONLY. No time-based assertions: at ~13 merges/day a
 * staleness assertion here would turn `Vitest` red on unrelated PRs and get
 * skipped, and this repo has a documented instance of exactly that
 * (`server/kenpomCredentials.test.ts` returns early and reports green with zero
 * assertions). The clock's ENFORCEMENT lives in the per-prompt hook; this file
 * only proves the clock's inputs are well-formed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { parseArtifactHeader, findSupersededClaims, requiredSections, type ArtifactFile } from "../../shared/os/artifacts";

const OS = resolve(__dirname, "../../os");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

const files: ArtifactFile[] = walk(OS).map((p) => ({
  path: p.slice(resolve(OS, "..").length + 1),
  body: readFileSync(p, "utf-8"),
}));

describe("/os/ artifact gate", () => {
  it("finds artifacts to validate (guards against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every decision record satisfies the contract for its declared kind", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (!/os\/decisions\/DR-\d+/.test(f.path)) continue;
      const { kind, status } = parseArtifactHeader(f.body);
      const missing = requiredSections(kind, status).filter((s) => !f.body.includes(s));
      if (missing.length) bad.push(`${f.path} [kind=${kind} status=${status}] missing ${missing.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("every plan issue carries a ruling dependency, acceptance criteria and verification", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (!/os\/plan\/issues\/ISSUE-\d+/.test(f.path)) continue;
      const missing = ["**Ruling dependency:**", "## Acceptance criteria", "## Verification"].filter(
        (s) => !f.body.includes(s),
      );
      if (missing.length) bad.push(`${f.path} missing ${missing.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("every relative markdown link resolves to a real file", () => {
    const broken: string[] = [];
    for (const f of files) {
      const abs = resolve(OS, "..", f.path);
      for (const m of f.body.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
        const target = m[1].split("#")[0];
        if (!target) continue;
        if (!existsSync(resolve(dirname(abs), target))) broken.push(`${f.path} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("no live artifact asserts a claim recorded as superseded", () => {
    const reg = JSON.parse(readFileSync(join(OS, "SUPERSEDED-CLAIMS.json"), "utf-8"));
    const terms: string[] = reg.claims.map((c: { term: string }) => c.term);
    const exempt: string[] = reg.claims.flatMap((c: { exemptPaths?: string[] }) => c.exemptPaths ?? []);
    expect(terms.length).toBeGreaterThan(0);
    const offenders = findSupersededClaims(files, terms, exempt).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
