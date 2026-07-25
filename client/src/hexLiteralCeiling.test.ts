import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * hexLiteralCeiling.test.ts — the X-HEX-EPIDEMIC ratchet (PR #198).
 *
 * This test IS the canonical hex-literal metric for the deferred token
 * migration. It does not migrate anything; it freezes the remainder so the
 * ~1,200 legacy literals can burn down in normal-sized PRs without new ones
 * sneaking in behind them.
 *
 * Metric definition (the ledger cites THIS file):
 *   - Pattern: /#[0-9a-fA-F]{3,8}\b/g  (inclusive: #fff shorthand and
 *     #RRGGBBAA alpha forms count; invalid-length runs that happen to match
 *     count too — the metric is mechanical, not a CSS validator)
 *   - File set: every *.ts / *.tsx / *.css under client/src, test files
 *     included; this file itself is the single exclusion (it must name the
 *     exempted values below without counting them)
 *   - Exemptions: the owner-approved Discord platform values #5865F2 and
 *     #4752C4 (THREE-COLOR-LAW.md §Discord platform exception) are stripped
 *     before counting, so the guard cannot fight the brand law
 *
 * Rules enforced:
 *   1. A file may never EXCEED its recorded ceiling. Lower is always legal.
 *   2. A file absent from the fixture has ceiling 0 — new files ship clean.
 *   3. A fixture entry whose file is gone must be deleted — no zombie
 *      allowances.
 *
 * When you REMOVE literals (the only sanctioned direction), regenerate:
 *   REGENERATE_HEX_CEILINGS=1 pnpm exec vitest run client/src/hexLiteralCeiling.test.ts
 * then commit the updated hexLiteralCeilings.json alongside your change.
 * Never regenerate to RAISE a ceiling — that is the defect this test exists
 * to stop; raising requires an owner-approved law exception instead.
 */

const ROOT = path.resolve(import.meta.dirname);
const FIXTURE = path.join(ROOT, "hexLiteralCeilings.json");
const SELF = path.join(ROOT, "hexLiteralCeiling.test.ts");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const EXEMPT = /#(5865F2|4752C4)\b/gi;

function countFile(full: string): number {
  const src = fs.readFileSync(full, "utf8").replace(EXEMPT, "");
  return (src.match(HEX) ?? []).length;
}

function walk(dir: string, out: Record<string, number>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|css)$/.test(entry.name) && full !== SELF) {
      const n = countFile(full);
      if (n > 0) out[path.relative(ROOT, full)] = n;
    }
  }
}

describe("hex-literal ceiling ratchet (X-HEX-EPIDEMIC)", () => {
  const counts: Record<string, number> = {};
  walk(ROOT, counts);

  if (process.env.REGENERATE_HEX_CEILINGS === "1") {
    it("regenerates hexLiteralCeilings.json from current counts", () => {
      const sorted = Object.fromEntries(
        Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
      );
      fs.writeFileSync(FIXTURE, JSON.stringify(sorted, null, 2) + "\n");
      expect(fs.existsSync(FIXTURE)).toBe(true);
    });
    return;
  }

  const ceilings: Record<string, number> = JSON.parse(
    fs.readFileSync(FIXTURE, "utf8"),
  );

  it("no file exceeds its recorded hex-literal ceiling (new files: ceiling 0)", () => {
    const offenders = Object.entries(counts)
      .filter(([file, n]) => n > (ceilings[file] ?? 0))
      .map(
        ([file, n]) =>
          `${file}: ${n} > ceiling ${ceilings[file] ?? 0} — remove the new raw hex (use law tokens); ceilings only ratchet DOWN`,
      );
    expect(offenders).toEqual([]);
  });

  it("no zombie allowances: every fixture entry's file still exists", () => {
    const zombies = Object.keys(ceilings).filter(
      (file) => !fs.existsSync(path.join(ROOT, file)),
    );
    expect(
      zombies,
      `Deleted files still hold ceilings — regenerate the fixture: ${zombies.join(", ")}`,
    ).toEqual([]);
  });
});
