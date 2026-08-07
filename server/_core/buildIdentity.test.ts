import { describe, expect, it } from "vitest";
import {
  COMMIT_ENV_VARS,
  commitsMatch,
  readBuildCommit,
} from "./buildIdentity";

describe("readBuildCommit", () => {
  it("reads Railway's provided commit variable", () => {
    expect(
      readBuildCommit({
        RAILWAY_GIT_COMMIT_SHA: "7d95ef63b57c9aaad7228dec9ae8adfda7a04eb1",
      })
    ).toBe("7d95ef63b57c9aaad7228dec9ae8adfda7a04eb1");
  });

  it("prefers the most authoritative source when several are set", () => {
    expect(
      readBuildCommit({
        GITHUB_SHA: "aaaaaaaaaa",
        SOURCE_COMMIT: "bbbbbbbbbb",
        RAILWAY_GIT_COMMIT_SHA: "cccccccccc",
      })
    ).toBe("cccccccccc");
  });

  it("falls back through the remaining sources in order", () => {
    expect(readBuildCommit({ GIT_COMMIT_SHA: "abc1234" })).toBe("abc1234");
    expect(readBuildCommit({ SOURCE_COMMIT: "def5678" })).toBe("def5678");
    expect(readBuildCommit({ GITHUB_SHA: "0badc0de" })).toBe("0badc0de");
  });

  it("normalises case so comparison is not case-sensitive", () => {
    expect(readBuildCommit({ RAILWAY_GIT_COMMIT_SHA: "DEADBEEF" })).toBe(
      "deadbeef"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(readBuildCommit({ RAILWAY_GIT_COMMIT_SHA: "  abc1234\n" })).toBe(
      "abc1234"
    );
  });

  // The whole point of the module: absence must be reported as absence.
  it("returns null when no source is set", () => {
    expect(readBuildCommit({})).toBeNull();
  });

  it("returns null — never a placeholder — for values that are not commits", () => {
    for (const bogus of [
      "",
      "   ",
      "unknown",
      "n/a",
      "1.0.0",
      "not-a-sha",
      "zzzzzzz",
      "abc123", // 6 chars — shorter than any git abbreviation
      "a".repeat(41), // longer than a SHA-1
    ]) {
      expect(readBuildCommit({ RAILWAY_GIT_COMMIT_SHA: bogus })).toBeNull();
    }
  });

  it("skips an invalid higher-priority value rather than giving up", () => {
    expect(
      readBuildCommit({
        RAILWAY_GIT_COMMIT_SHA: "unknown",
        GITHUB_SHA: "7d95ef63b57c9aaad7228dec9ae8adfda7a04eb1",
      })
    ).toBe("7d95ef63b57c9aaad7228dec9ae8adfda7a04eb1");
  });

  it("declares its sources in priority order", () => {
    expect(COMMIT_ENV_VARS[0]).toBe("RAILWAY_GIT_COMMIT_SHA");
    expect([...COMMIT_ENV_VARS]).toHaveLength(4);
  });
});

describe("commitsMatch", () => {
  const full = "7d95ef63b57c9aaad7228dec9ae8adfda7a04eb1";

  it("matches a commit against itself", () => {
    expect(commitsMatch(full, full)).toBe(true);
  });

  it("matches an abbreviation against the full SHA, in both directions", () => {
    expect(commitsMatch("7d95ef63b", full)).toBe(true);
    expect(commitsMatch(full, "7d95ef63b")).toBe(true);
  });

  it("matches across differing case", () => {
    expect(commitsMatch(full.toUpperCase(), full)).toBe(true);
  });

  it("rejects different commits", () => {
    expect(commitsMatch(full, "ec8f329ecaca940efa3703fa5002e8694b2ff4fd")).toBe(
      false
    );
    expect(commitsMatch("7d95ef63b", "ec8f329ec")).toBe(false);
  });

  // Absence must never satisfy an equality check — that is the Incident 64
  // failure shape: a check that passes because it had nothing to compare.
  it("never matches when either side is missing", () => {
    expect(commitsMatch(null, full)).toBe(false);
    expect(commitsMatch(full, null)).toBe(false);
    expect(commitsMatch(null, null)).toBe(false);
    expect(commitsMatch(undefined, undefined)).toBe(false);
    expect(commitsMatch("", "")).toBe(false);
  });

  it("never matches when either side is not a commit", () => {
    expect(commitsMatch("unknown", "unknown")).toBe(false);
    expect(commitsMatch(full, "unknown")).toBe(false);
  });
});
