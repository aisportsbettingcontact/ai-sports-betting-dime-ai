import { describe, it, expect } from "vitest";
import {
  toFeedSlugDate,
  feedModelPath,
  bettingSplitsPath,
  parseSplitsSport,
  legacyFeedRedirectTarget,
} from "./feedRoutes";

const SLUG_RE = /^\/feed\/model\/(mlb|wc)-\d{2}-\d{2}-\d{4}$/;

describe("feedRoutes — canonical path builders", () => {
  it("toFeedSlugDate converts YYYY-MM-DD to MM-DD-YYYY", () => {
    expect(toFeedSlugDate("2026-07-11")).toBe("07-11-2026");
    expect(toFeedSlugDate("2026-01-02")).toBe("01-02-2026");
  });

  it("feedModelPath builds dated lowercase slugs", () => {
    expect(feedModelPath("MLB", "2026-07-11")).toBe("/feed/model/mlb-07-11-2026");
    expect(feedModelPath("WC", "2026-07-11")).toBe("/feed/model/wc-07-11-2026");
  });

  it("feedModelPath defaults to MLB + today's effective date", () => {
    expect(feedModelPath()).toMatch(SLUG_RE);
    expect(feedModelPath()).toContain("/feed/model/mlb-");
    expect(feedModelPath("WC")).toContain("/feed/model/wc-");
  });

  it("bettingSplitsPath builds uppercase sport paths, MLB default", () => {
    expect(bettingSplitsPath()).toBe("/betting-splits/MLB");
    expect(bettingSplitsPath("NHL")).toBe("/betting-splits/NHL");
    expect(bettingSplitsPath("NBA")).toBe("/betting-splits/NBA");
  });

  it("parseSplitsSport validates case-insensitively and rejects junk", () => {
    expect(parseSplitsSport("MLB")).toBe("MLB");
    expect(parseSplitsSport("mlb")).toBe("MLB");
    expect(parseSplitsSport("nhl")).toBe("NHL");
    expect(parseSplitsSport("WC")).toBeNull();
    expect(parseSplitsSport("")).toBeNull();
    expect(parseSplitsSport(undefined)).toBeNull();
  });
});

describe("feedRoutes — legacy /feed?… eradication mapping", () => {
  it("?tab=splits routes to the canonical splits page", () => {
    expect(legacyFeedRedirectTarget("?tab=splits")).toBe("/betting-splits/MLB");
  });

  it("every other legacy tab lands on the canonical feed", () => {
    for (const q of ["", "?tab=dual", "?tab=lineups", "?tab=props", "?tab=f5nrfi", "?tab=hrprops"]) {
      expect(legacyFeedRedirectTarget(q)).toMatch(SLUG_RE);
      expect(legacyFeedRedirectTarget(q)).toContain("mlb-");
    }
  });

  it("legacy ?sport=WC is preserved; unknown sports fall back to MLB", () => {
    expect(legacyFeedRedirectTarget("?sport=WC")).toContain("/feed/model/wc-");
    expect(legacyFeedRedirectTarget("?sport=NHL")).toContain("/feed/model/mlb-");
  });

  it("legacy ?date=YYYY-MM-DD carries into the slug; invalid dates ignored", () => {
    expect(legacyFeedRedirectTarget("?sport=MLB&date=2026-07-04")).toBe(
      "/feed/model/mlb-07-04-2026",
    );
    expect(legacyFeedRedirectTarget("?date=07/04/2026")).toMatch(SLUG_RE);
  });

  it("never emits a legacy slug", () => {
    for (const q of ["", "?tab=splits", "?tab=dual", "?sport=WC", "?tab=lineups&sport=NBA"]) {
      const target = legacyFeedRedirectTarget(q);
      expect(target).not.toContain("?");
      expect(target.startsWith("/feed/model/") || target.startsWith("/betting-splits/")).toBe(true);
    }
  });
});
