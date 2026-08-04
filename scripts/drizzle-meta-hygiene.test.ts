/**
 * drizzle-meta-hygiene.test.ts — keep `drizzle/meta/` free of anything that is
 * not a drizzle artifact.
 *
 * WHY THIS EXISTS
 *
 * `drizzle-kit generate` does not look for a filename pattern when it collects
 * snapshots. It takes every directory entry that does not start with `_`
 * (drizzle-kit 0.31.10, bin.cjs:8135):
 *
 *     const snapshots = readdirSync(meta)
 *       .filter((it) => !it.startsWith("_"))
 *       .map((it) => join(meta, it));
 *
 * Each of those is then parsed as a migration snapshot. Anything that fails
 * validation lands in `report.malformed`, and `prepareMigrationFolder`
 * (bin.cjs:8226) does this:
 *
 *     const abort = report.malformed.length || collisionEntries.length > 0;
 *     if (abort) {
 *       process.exit(0);
 *     }
 *
 * `process.exit(0)`. A hard abort, before any schema diffing, reported to the
 * shell as SUCCESS. Because `db:push` is `drizzle-kit generate && …`, the `&&`
 * reads that zero and runs the migrator against a migration that was never
 * written. The pipeline reports success having shipped nothing.
 *
 * That is exactly what happened: `drizzle/meta/production_legacy_journal.json`
 * (the reconciler's own manifest, not a drizzle artifact) sat there from
 * 2026-07-30 and disarmed every schema change. It went unnoticed because no
 * `db-push` run happened afterwards — a loaded gun rather than a fired one.
 *
 * The failure mode is silent by construction, so a test is the only thing that
 * can catch a recurrence. Note the same validation in `drizzle-kit check` uses
 * `process.exit(1)`; only the generate path lies.
 */

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const META = join(__dirname, "..", "drizzle", "meta");

/** The only two shapes drizzle-kit itself writes into drizzle/meta/. */
const ALLOWED = [/^_journal\.json$/, /^\d{4}_snapshot\.json$/];

describe("drizzle/meta hygiene", () => {
  const entries = readdirSync(META);

  it("contains only drizzle-owned artifacts", () => {
    const stray = entries.filter(e => !ALLOWED.some(rx => rx.test(e)));
    expect(
      stray,
      "Files in drizzle/meta/ that drizzle-kit will try to parse as snapshots. " +
      "Any of these makes `drizzle-kit generate` abort with exit code 0, which " +
      "silently disarms `pnpm db:push`. Put non-drizzle files somewhere else " +
      "(the legacy-journal manifest lives in drizzle/profiles/).",
    ).toEqual([]);
  });

  it("nothing in drizzle/meta escapes the snapshot glob via a leading underscore", () => {
    // A `_`-prefixed file is skipped by drizzle's filter, so it would not abort
    // generate — but it would also be invisible to this check if we only tested
    // the abort condition. _journal.json is the sole legitimate case.
    const underscored = entries.filter(e => e.startsWith("_"));
    expect(underscored).toEqual(["_journal.json"]);
  });

  it("every journal entry's snapshot index is well-formed", () => {
    // Guards the other half of prepareOutFolder: snapshots are sorted as
    // strings, so a mis-padded name (e.g. 123_snapshot.json) would sort wrong
    // and silently change which snapshot the next diff runs against.
    const snapshots = entries.filter(e => /_snapshot\.json$/.test(e));
    for (const s of snapshots) {
      expect(s, `${s} must be zero-padded to 4 digits`).toMatch(/^\d{4}_snapshot\.json$/);
    }
  });
});
