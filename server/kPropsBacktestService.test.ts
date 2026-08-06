import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  K_BACKTEST_SENTINEL,
  K_BACKTEST_RETRYABLE,
} from "./kPropsBacktestService";

/**
 * Guards the defect found in the 2026-08-06 post-deploy audit of PR #416.
 *
 * `mlb_strikeout_props.backtestResult` is `varchar(16)`. The service wrote the
 * 17-character `"NAME_MATCH_FAILED"` into it, and MySQL in strict mode rejects
 * an oversized value outright rather than truncating — so every write threw
 * ER_DATA_TOO_LONG (errno 1406), the marker never persisted, and the row was
 * re-queued forever while each cycle logged a stack trace.
 *
 * The class of bug is "a string literal silently outgrew its column", so the
 * guard is written against that class, not against the one value: it reads the
 * declared width out of drizzle/schema.ts and checks every sentinel this
 * codebase can write to that column, on BOTH tables that have one. If the
 * column is ever resized, or a new sentinel is added, this test tracks it
 * without being edited.
 */

const repoRoot = path.join(import.meta.dirname, "..");
const schemaSrc = fs.readFileSync(
  path.join(repoRoot, "drizzle", "schema.ts"),
  "utf8"
);

/** Declared width of every `backtestResult` column in the schema. */
function backtestResultWidths(): number[] {
  const widths = [
    ...schemaSrc.matchAll(
      /backtestResult:\s*varchar\("backtestResult",\s*\{\s*length:\s*(\d+)\s*\}\)/g
    ),
  ].map(m => Number(m[1]));
  if (widths.length === 0)
    throw new Error(
      "schema.ts no longer declares backtestResult as a varchar — update this guard"
    );
  return widths;
}

describe("backtestResult sentinels fit their column (ER_DATA_TOO_LONG guard)", () => {
  it("finds a backtestResult column on both prop tables", () => {
    // mlb_strikeout_props and mlb_hr_props. If a third appears, the width
    // assertions below cover it automatically.
    expect(backtestResultWidths().length).toBeGreaterThanOrEqual(2);
  });

  it("every K-prop sentinel fits the narrowest declared column", () => {
    const limit = Math.min(...backtestResultWidths());
    for (const [key, value] of Object.entries(K_BACKTEST_SENTINEL)) {
      expect(
        value.length,
        `K_BACKTEST_SENTINEL.${key} = "${value}" is ${value.length} chars; ` +
          `the column is varchar(${limit}). MySQL strict mode REJECTS the ` +
          `write (ER_DATA_TOO_LONG) — it does not truncate — so the row would ` +
          `silently keep its old state and be re-queued forever.`
      ).toBeLessThanOrEqual(limit);
    }
  });

  it("the specific value that caused the incident can no longer be written", () => {
    const written = Object.values(K_BACKTEST_SENTINEL) as string[];
    expect(written).not.toContain("NAME_MATCH_FAILED");
    expect(K_BACKTEST_SENTINEL.NAME_MISMATCH).toBe("NAME_MISMATCH");
    expect(K_BACKTEST_SENTINEL.NAME_MISMATCH.length).toBe(13);
  });

  it("no string literal assigned to backtestResult anywhere in server/ overflows", () => {
    // Catches a future literal written past the const — the exact way the
    // original defect entered.
    const limit = Math.min(...backtestResultWidths());
    const offenders: string[] = [];
    for (const file of fs
      .readdirSync(path.join(repoRoot, "server"))
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = fs.readFileSync(path.join(repoRoot, "server", file), "utf8");
      for (const m of src.matchAll(/backtestResult(?::|\s*=)\s*"([^"]*)"/g)) {
        if (m[1].length > limit)
          offenders.push(`${file}: "${m[1]}" (${m[1].length} > ${limit})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the retry sweep able to rescue rows left by the old code paths", () => {
    // Neither legacy form should be reachable: production is strict (which is
    // why the write threw instead of truncating) and the column has been
    // varchar(16) since migration 0049. They are retained because a stranded
    // row would otherwise never be graded again, and the cost is one array
    // entry. Pinned so a future cleanup is a deliberate decision, not a slip.
    expect(K_BACKTEST_RETRYABLE).toContain("NAME_MATCH_FAILED");
    expect(K_BACKTEST_RETRYABLE).toContain("NAME_MATCH_FAIL");
    expect(K_BACKTEST_RETRYABLE).toContain(K_BACKTEST_SENTINEL.PENDING);
    expect(K_BACKTEST_RETRYABLE).toContain(K_BACKTEST_SENTINEL.NAME_MISMATCH);
    // A graded row must never be re-queued.
    for (const settled of ["OVER", "UNDER", "PUSH", "NO_LINE"])
      expect(K_BACKTEST_RETRYABLE).not.toContain(settled);
  });

  it("the service reads the retry set rather than re-listing literals", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "server", "kPropsBacktestService.ts"),
      "utf8"
    );
    expect(src).toMatch(
      /inArray\(\s*mlbStrikeoutProps\.backtestResult,\s*\[\.\.\.K_BACKTEST_RETRYABLE\]\s*\)/
    );
    // The write site must go through the const, not a bare literal.
    expect(src).not.toMatch(/backtestResult:\s*"NAME_MATCH_FAILED"/);
  });
});
