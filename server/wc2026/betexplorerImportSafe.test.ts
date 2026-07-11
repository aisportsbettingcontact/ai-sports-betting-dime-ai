import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the BetExplorer scraper's import-time crash.
 *
 * Defect: betexplorer_scraper.py created DEBUG_DUMP_DIR at MODULE LEVEL with
 *   DEBUG_DUMP_DIR.mkdir(exist_ok=True)
 * where DEBUG_DUMP_DIR = /home/ubuntu/be_debug_dumps_v4 — the legacy Manus home.
 * On any other host (GitHub CI runner, Railway/Debian, dev container) /home/ubuntu
 * is absent, so the parent is missing and mkdir raises FileNotFoundError at IMPORT
 * time. That broke the read-only Jul-11 odds probe (which imports the scraper to
 * reuse its parse and primary-line-selection functions) and is a latent crash
 * anywhere the module is imported off Manus.
 *
 * Fix: guard the mkdir with parents=True + try/except OSError so import never
 * crashes; the dir is only used for optional forensic HTML dumps.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const scraperSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "betexplorer_scraper.py"),
  "utf8",
);

describe("BetExplorer scraper import safety", () => {
  it("guards the module-level DEBUG_DUMP_DIR.mkdir so import never crashes off /home/ubuntu", () => {
    // The bare, unguarded form must be gone.
    expect(scraperSrc).not.toMatch(/^DEBUG_DUMP_DIR\.mkdir\(exist_ok=True\)\s*$/m);
    // The guarded form: parents=True + a try/except that swallows OSError.
    expect(scraperSrc).toMatch(/DEBUG_DUMP_DIR\.mkdir\(parents=True,\s*exist_ok=True\)/);
    expect(scraperSrc).toMatch(/try:[\s\S]*DEBUG_DUMP_DIR\.mkdir[\s\S]*except OSError:/);
  });
});
