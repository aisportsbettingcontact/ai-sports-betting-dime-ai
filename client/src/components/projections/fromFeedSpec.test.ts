import { describe, it, expect } from "vitest";
import { feedSpecToProjectionGame, parseAmerican, type FeedSpecLike } from "./fromFeedSpec";
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
  away: { name: "Brewers", crest: { code: "MIL", url: "/mil.svg", bg: "#12284B" }, score: "5" },
  home: { name: "Pirates", crest: { code: "PIT", url: null, bg: "#111111" }, score: "14" },
  meta: "Gasser vs Skenes",
  pitchers: { away: "R. Gasser", home: "P. Skenes" },
  venueLine: "PNC Park",
  markets: [
    { title: "Run Line", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "MIL +1.5", book: "-198", model: "-179" },
      { label: "PIT -1.5", book: "+163", model: "+179" },
    ] },
    { title: "Total", foot: { label: "EDGE", edge: true }, rows: [
      { label: "Over 8.5", book: "-102", model: "-109" },
      { label: "Under 8.5", book: "-117", model: "+109" },
    ] },
  ],
};

describe("feedSpecToProjectionGame", () => {
  const g = feedSpecToProjectionGame(SPEC, "MLB");

  it("maps identity, status, teams, and meta without altering data", () => {
    expect(g.league).toBe("MLB");
    expect(g.status).toBe("final"); // has scores, no live label
    expect(g.away).toMatchObject({ abbr: "MIL", name: "Brewers", logo: "/mil.svg", score: 5 });
    expect(g.home).toMatchObject({ abbr: "PIT", logo: null, color: "#111111", score: 14 });
    expect(g.matchupContext).toBe("Gasser vs Skenes");
    expect(g.awayPitcher).toBe("R. Gasser");
    expect(g.venue).toBe("PNC Park");
  });

  it("parses prices to numbers and pairs opposite sides for no-vig", () => {
    const total = g.markets[1];
    expect(total.sides[0]).toMatchObject({ sideLabel: "Over 8.5", bookPrice: -102, modelPrice: -109, bookOppPrice: -117 });
    expect(total.sides[1]).toMatchObject({ sideLabel: "Under 8.5", bookPrice: -117, bookOppPrice: -102 });
  });

  it("preserves the result row and drives the same insight the engine computes", () => {
    expect(g.markets[0].resultLabel).toBe("NO EDGE"); // foot.edge=false → result kept
    expect(g.markets[1].resultLabel).toBeUndefined(); // foot.edge=true → shown as signal
    const insight = primaryInsight(g.markets.flatMap((m) => m.sides));
    expect(insight?.sideLabel).toBe("Over 8.5"); // strongest edge surfaces as the pick
    expect(insight?.recommendation).toBe("WATCH");
  });
});
