import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EspnLogger } from "./espnLogger";

/**
 * The stats file is written from `summary()`, which is reachable from an
 * unauthenticated public route (wc2026Router → espnMatchPage → scraper).
 * It used to be existsSync → readFileSync → writeFileSync, i.e. three separate
 * resolutions of the same name with a truncating write in the middle: a second
 * process could observe a half-written file, and the reader's catch would
 * silently discard the whole history as [].
 *
 * These tests pin the two properties that replaced it — tolerate a missing
 * file without probing for it, and replace the file atomically.
 */
describe("EspnLogger stats persistence", () => {
  const dirs: string[] = [];

  function tempLogDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "espn-logger-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length) {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("creates the stats file when none exists", () => {
    const dir = tempLogDir();
    new EspnLogger("game-1", dir).summary("SUCCESS");

    const statsFile = path.join(dir, "espn-scraper-stats.json");
    const parsed = JSON.parse(fs.readFileSync(statsFile, "utf-8"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].gameId).toBe("game-1");
  });

  it("prepends newest-first and preserves prior runs", () => {
    const dir = tempLogDir();
    new EspnLogger("older", dir).summary("SUCCESS");
    new EspnLogger("newer", dir).summary("FAILURE");

    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, "espn-scraper-stats.json"), "utf-8")
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].gameId).toBe("newer");
    expect(parsed[1].gameId).toBe("older");
  });

  it("recovers from a corrupt stats file instead of throwing", () => {
    const dir = tempLogDir();
    const statsFile = path.join(dir, "espn-scraper-stats.json");
    fs.writeFileSync(statsFile, "{ this is not json");

    expect(() =>
      new EspnLogger("game-2", dir).summary("SUCCESS")
    ).not.toThrow();
    const parsed = JSON.parse(fs.readFileSync(statsFile, "utf-8"));
    expect(parsed).toHaveLength(1);
  });

  it("leaves no temp file behind — the write is a rename, not a truncate", () => {
    const dir = tempLogDir();
    new EspnLogger("game-3", dir).summary("SUCCESS");

    const leftovers = fs.readdirSync(dir).filter(name => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("keeps only the most recent 100 runs", () => {
    const dir = tempLogDir();
    const statsFile = path.join(dir, "espn-scraper-stats.json");
    const seeded = Array.from({ length: 100 }, (_, i) => ({
      gameId: `seed-${i}`,
    }));
    fs.writeFileSync(statsFile, JSON.stringify(seeded));

    new EspnLogger("newest", dir).summary("SUCCESS");

    const parsed = JSON.parse(fs.readFileSync(statsFile, "utf-8"));
    expect(parsed).toHaveLength(100);
    expect(parsed[0].gameId).toBe("newest");
    expect(parsed[99].gameId).toBe("seed-98");
  });
});
