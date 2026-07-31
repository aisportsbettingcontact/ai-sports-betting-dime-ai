/**
 * dimeChatTitle.test.ts — the deterministic topic-detection titler
 * (owner directive 2026-07-29 r3). Every case is a real first-message shape;
 * the engine must be bulletproof: same input, same title, always.
 */
import { describe, it, expect } from "vitest";
import { deriveThreadTitle, sanitizeThreadTitle } from "./dimeChatTitle";

describe("deriveThreadTitle — league + topic + date composition", () => {
  it("titles the canonical schedule ask league-topic-date", () => {
    expect(deriveThreadTitle("What is the MLB schedule for July 29, 2026?")).toBe(
      "MLB Schedule — Jul 29",
    );
  });

  it("abbreviated month and ordinal day both parse", () => {
    expect(deriveThreadTitle("mlb schedule sept 3rd")).toBe("MLB Schedule — Sep 3");
  });

  it("slash dates parse with sanity guards", () => {
    expect(deriveThreadTitle("who plays 7/29?")).toBe("Schedule — 7/29");
    // 13/40 is not a date — no date suffix.
    expect(deriveThreadTitle("who plays 13/40?")).toBe("Schedule");
  });

  it("relative dates: tonight beats today; tomorrow stands alone", () => {
    expect(deriveThreadTitle("best bets tonight")).toBe("Best Bets — Tonight");
    expect(deriveThreadTitle("any games tomorrow?")).toBe("Schedule — Tomorrow");
  });

  it("league alone / topic alone / league+date all compose", () => {
    expect(deriveThreadTitle("talk to me about the nfl")).toBe("NFL");
    expect(deriveThreadTitle("parlay ideas")).toBe("Parlay");
    expect(deriveThreadTitle("mlb today")).toBe("MLB — Today");
  });

  it("sport words map to leagues; college football beats bare baseball order", () => {
    expect(deriveThreadTitle("college football futures")).toBe("CFB Futures");
    expect(deriveThreadTitle("baseball props")).toBe("MLB Props");
    expect(deriveThreadTitle("world cup odds")).toBe("World Cup Odds");
  });
});

describe("deriveThreadTitle — topic precedence", () => {
  it("'best bets' beats the generic odds/lines vocabulary", () => {
    expect(deriveThreadTitle("best bets and odds for mlb")).toBe("MLB Best Bets");
  });

  it("'ml' is Moneyline but never fires inside 'mlb'", () => {
    expect(deriveThreadTitle("marlins ml worth it?")).toBe("Marlins Moneyline");
    expect(deriveThreadTitle("mlb lines")).toBe("MLB Odds");
  });

  it("edges vocabulary titles as Edges (product term)", () => {
    expect(deriveThreadTitle("best MLB edges today")).toBe("MLB Edges — Today");
  });
});

describe("deriveThreadTitle — teams and matchups", () => {
  it("two teams mirror the user's separator form", () => {
    expect(deriveThreadTitle("phillies @ marlins props")).toBe(
      "Phillies @ Marlins Props",
    );
    expect(deriveThreadTitle("who wins phillies vs marlins")).toBe(
      "Phillies vs Marlins",
    );
  });

  it("one team pairs with topic, or with date when no topic", () => {
    expect(deriveThreadTitle("dodgers lineup today?")).toBe("Dodgers Lineups");
    expect(deriveThreadTitle("yankees tonight")).toBe("Yankees — Tonight");
    expect(deriveThreadTitle("how are the cubs doing")).toBe("Cubs");
  });

  it("multiword nicknames resolve (Red Sox, D-backs)", () => {
    expect(deriveThreadTitle("red sox vs white sox totals")).toBe(
      "Red Sox vs White Sox Totals",
    );
    expect(deriveThreadTitle("dbacks spread?")).toBe("D-backs Spread");
  });

  it("teams appear in text order, capped at two", () => {
    expect(deriveThreadTitle("mets, braves, and phillies news")).toBe(
      "Mets vs Braves",
    );
  });
});

describe("deriveThreadTitle — fallback cleanup", () => {
  it("strips layered question/command scaffolding", () => {
    expect(deriveThreadTitle("Hey dime, can you tell me your data sources?")).toBe(
      "Your data sources",
    );
    expect(deriveThreadTitle("what can Dime AI currently help me with?")).toBe(
      "Dime AI currently help me with",
    );
  });

  it("pure greetings become New Chat", () => {
    expect(deriveThreadTitle("hi")).toBe("New Chat");
    expect(deriveThreadTitle("Hello!")).toBe("New Chat");
    expect(deriveThreadTitle("   ")).toBe("New Chat");
  });

  it("capitalizes, drops trailing punctuation, truncates at a word boundary", () => {
    // Deliberately vocabulary-neutral text — no league/topic/team/date words,
    // so this exercises the pure fallback path.
    const t = deriveThreadTitle(
      "explain the difference between correlation and causation in simple terms for a beginner audience",
    );
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t.endsWith("…")).toBe(true);
    expect(t.charAt(0)).toBe("E");
    expect(t).not.toMatch(/ …$/);
  });

  it("whitespace collapses before anything else", () => {
    expect(deriveThreadTitle("  bankroll\n\nadvice   please ")).toBe("Bankroll");
  });
});

describe("deriveThreadTitle — determinism", () => {
  it("same input, same output, every time", () => {
    const input = "What is the MLB schedule for July 29, 2026?";
    const first = deriveThreadTitle(input);
    for (let i = 0; i < 50; i++) expect(deriveThreadTitle(input)).toBe(first);
  });
});

describe("sanitizeThreadTitle — rename path", () => {
  it("keeps user-chosen text verbatim apart from whitespace collapse", () => {
    expect(sanitizeThreadTitle("  My   weird\ntitle ")).toBe("My weird title");
  });

  it("truncates to the cap with an ellipsis", () => {
    const t = sanitizeThreadTitle("x".repeat(200));
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("…")).toBe(true);
  });

  it("never applies topic detection to a rename", () => {
    expect(sanitizeThreadTitle("what is the mlb schedule for july 29")).toBe(
      "what is the mlb schedule for july 29",
    );
  });
});
