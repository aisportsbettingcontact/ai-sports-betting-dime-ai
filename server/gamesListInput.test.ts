import { describe, expect, it } from "vitest";
import { gamesListInput } from "./gamesListInput";

describe("gamesListInput", () => {
  it("accepts the supported public filters", () => {
    const parsed = gamesListInput.parse({
      sport: "MLB",
      gameDate: "2026-08-05",
      gameStatus: "upcoming",
    });
    expect(parsed).toEqual({
      sport: "MLB",
      gameDate: "2026-08-05",
      gameStatus: "upcoming",
    });
  });

  it("accepts an omitted input (public feed default)", () => {
    expect(gamesListInput.parse(undefined)).toBeUndefined();
  });

  it("strips forceRefresh — the public cache bypass is not wire-reachable", () => {
    // Regression guard: games.list once accepted forceRefresh: boolean, letting
    // any unauthenticated caller bypass the 60s games cache and force a TiDB
    // round-trip per request (amplification lever for scrapers).
    const parsed = gamesListInput.parse({ sport: "MLB", forceRefresh: true });
    expect(parsed).not.toHaveProperty("forceRefresh");
    expect(parsed).toEqual({ sport: "MLB" });
  });
});
