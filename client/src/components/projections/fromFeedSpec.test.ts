import { describe, it, expect } from "vitest";
import {
  feedSpecToProjectionGame,
  parseAmerican,
  type FeedSpecLike,
} from "./fromFeedSpec";
import { primaryInsight } from "@/lib/gameInsight";

describe("parseAmerican", () => {
  it("parses signed odds and the em-dash empty glyph", () => {
    expect(parseAmerican("-198")).toBe(-198);
    expect(parseAmerican("+163")).toBe(163);
    expect(parseAmerican("−109")).toBe(-109); // U+2212 minus
    expect(parseAmerican("—")).toBeNull();
    expect(parseAmerican(null)).toBeNull();
  });
});

const SPEC: FeedSpecLike = {
  id: "mil-pit",
  liveLabel: null,
  timeLabel: "FINAL",
  away: {
    name: "Brewers",
    crest: { code: "MIL", url: "/mil.svg", bg: "#12284B" },
    score: "5",
  },
  home: {
    name: "Pirates",
    crest: { code: "PIT", url: null, bg: "#111111" },
    score: "14",
  },
  meta: "PNC Park", // ballpark only — pitcher names are off the cards (2026-07-17)
  venueLine: "PNC Park",
  markets: [
    {
      title: "Run Line",
      foot: { label: "NO EDGE", edge: false },
      rows: [
        { label: "MIL +1.5", book: "-198", model: "-179" },
        { label: "PIT -1.5", book: "+163", model: "+179" },
      ],
    },
    {
      title: "Total",
      foot: { label: "EDGE", edge: true },
      rows: [
        { label: "Over 8.5", book: "-102", model: "-109" },
        { label: "Under 8.5", book: "-117", model: "+109" },
      ],
    },
  ],
};

describe("feedSpecToProjectionGame", () => {
  const g = feedSpecToProjectionGame(SPEC, "MLB");

  it("maps identity, status, teams, and meta without altering data", () => {
    expect(g.league).toBe("MLB");
    expect(g.status).toBe("final"); // has scores, no live label
    expect(g.away).toMatchObject({
      abbr: "MIL",
      name: "Brewers",
      logo: "/mil.svg",
      score: 5,
    });
    expect(g.home).toMatchObject({
      abbr: "PIT",
      logo: null,
      color: "#111111",
      score: 14,
    });
    // Owner directive 2026-08-05: ballpark + first pitch are pregame-only, so
    // a FINAL card carries none of the three.
    expect(g.matchupContext).toBeUndefined();
    expect(g.venue).toBeUndefined();
    expect(g.startTime).toBeUndefined();
  });

  /** The parallel adapter carries the SAME pregame-only contract as
   *  presentation.ts (owner directive 2026-08-05). */
  describe("pregame-only venue + first pitch (owner directive 2026-08-05)", () => {
    const scheduled = feedSpecToProjectionGame(
      {
        ...SPEC,
        timeLabel: "7:05 PM ET",
        away: { ...SPEC.away, score: null },
        home: { ...SPEC.home, score: null },
      },
      "MLB"
    );

    it("keeps ballpark and first pitch on a scheduled card", () => {
      expect(scheduled.status).toBe("scheduled");
      expect(scheduled.matchupContext).toBe("PNC Park");
      expect(scheduled.venue).toBe("PNC Park");
      expect(scheduled.startTime).toBe("7:05 PM ET");
      expect(scheduled.statusLabel).toBe("7:05 PM ET");
    });

    it("drops both on live cards (the shipped live-card time leak)", () => {
      const live = feedSpecToProjectionGame(
        { ...SPEC, liveLabel: "LIVE · BOT 8TH", timeLabel: "9:40 PM ET" },
        "MLB"
      );
      expect(live.status).toBe("live");
      expect(live.statusLabel).toBe("LIVE · BOT 8TH");
      expect(live.matchupContext).toBeUndefined();
      expect(live.venue).toBeUndefined();
      expect(live.startTime).toBeUndefined();
    });

    it("honors an explicit postponed/suspended status over score inference", () => {
      for (const status of ["postponed", "suspended"] as const) {
        const g2 = feedSpecToProjectionGame(
          { ...SPEC, status, timeLabel: status.toUpperCase() },
          "MLB"
        );
        expect(g2.status).toBe(status);
        expect(g2.statusLabel).toBe(status.toUpperCase());
        expect(g2.matchupContext).toBeUndefined();
        expect(g2.venue).toBeUndefined();
        expect(g2.startTime).toBeUndefined();
      }
    });
  });

  it("parses prices to numbers and pairs opposite sides for no-vig", () => {
    const total = g.markets[1];
    expect(total.sides[0]).toMatchObject({
      sideLabel: "Over 8.5",
      bookPrice: -102,
      modelPrice: -109,
      bookOppPrice: -117,
    });
    expect(total.sides[1]).toMatchObject({
      sideLabel: "Under 8.5",
      bookPrice: -117,
      bookOppPrice: -102,
    });
  });

  it("preserves the result row and drives the same insight the engine computes", () => {
    expect(g.markets[0].resultLabel).toBe("NO EDGE"); // foot.edge=false → result kept
    expect(g.markets[1].resultLabel).toBeUndefined(); // foot.edge=true → shown as signal
    const insight = primaryInsight(g.markets.flatMap(m => m.sides));
    expect(insight?.sideLabel).toBe("Over 8.5"); // strongest edge surfaces as the pick
    expect(insight?.recommendation).toBe("WATCH");
  });
});
