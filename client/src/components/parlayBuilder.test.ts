/**
 * parlayBuilder.test.ts — the entry UI's arithmetic and its brand compliance.
 *
 * The builder is where a user commits money, so the two things worth pinning
 * are the number it shows them and the fact that it never overrides what their
 * book actually paid.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestPrice, type DraftLeg } from "./ParlayBuilder";
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  combineLegOdds,
} from "@shared/parlayPricing";

const leg = (odds: number, over: Partial<DraftLeg> = {}): DraftLeg => ({
  anGameId: 1,
  gameNumber: 1,
  sport: "MLB",
  gameDate: "2026-08-04",
  awayTeam: "NYY",
  homeTeam: "BOS",
  market: "ML",
  pickSide: "AWAY",
  timeframe: "FULL_GAME",
  line: null,
  odds,
  label: "NYY ML",
  ...over,
});

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const builder = read("ParlayBuilder.tsx");
const legList = read("ParlayLegList.tsx");

describe("suggestPrice", () => {
  it("needs at least two legs before it means anything", () => {
    expect(suggestPrice([])).toBeNull();
    expect(suggestPrice([leg(-110)])).toBeNull();
  });

  it("multiplies the legs out", () => {
    expect(suggestPrice([leg(-110), leg(-110)])).toBe(264);
    expect(suggestPrice([leg(-110), leg(-110), leg(-110)])).toBe(596);
  });

  it("agrees exactly with the server's pricing", () => {
    // Same function, one implementation in shared/. If these ever diverge the
    // user is quoted one price and settled at another.
    const odds = [-110, 150, -200];
    expect(suggestPrice(odds.map(o => leg(o)))).toBe(combineLegOdds(odds));
  });

  it("returns null rather than throwing on a corrupt leg price", () => {
    // A price in the (-100, +100) gap is not representable; the form must stay
    // usable instead of crashing.
    expect(suggestPrice([leg(0), leg(-110)])).toBeNull();
    expect(suggestPrice([leg(50), leg(-110)])).toBeNull();
  });

  it("handles a full ten-leg ticket", () => {
    const legs = Array.from({ length: MAX_PARLAY_LEGS }, () => leg(-110));
    expect(suggestPrice(legs)).toBeGreaterThan(0);
  });
});

describe("the ticket price calculates live, and never overwrites the user's", () => {
  it("REGRESSION: the price recomputes in real time from the legs", () => {
    // The page owns the recompute so it can react to every add and remove.
    const page = readFileSync(
      join(__dirname, "../pages/BetTracker.tsx"),
      "utf8"
    );
    expect(page).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,200}suggestPrice\(draftLegs\)/
    );
    expect(page).toMatch(/\}, \[draftLegs, ticketOddsManual\]\)/);
  });

  it("REGRESSION: a price the user typed is never clobbered by the recompute", () => {
    // A correlated same-game price or a boost is deliberately NOT the product
    // of its legs, and the contract allows both. Once the user states their
    // book's number, the live recompute must stand down.
    const page = readFileSync(
      join(__dirname, "../pages/BetTracker.tsx"),
      "utf8"
    );
    expect(page).toMatch(/if \(ticketOddsManual\) return;/);
    expect(builder).toMatch(/onTicketOddsManualChange\(true\)/);
  });

  it("offers a way back to the calculated price", () => {
    expect(builder).toMatch(/use calculated \{fmtOdds\(suggested\)\}/);
    expect(builder).toMatch(/onTicketOddsManualChange\(false\)/);
  });

  it("the review block shows the price the ticket will settle at", () => {
    // The standing caption was removed by owner directive (2026-08-04). The
    // user still sees the settling price at the last look before submit: the
    // review block renders the ENTERED odds, not the calculated suggestion.
    expect(builder).toMatch(/fmtOdds\(parsedOdds\)/);
  });

  it("blocks submit on a price outside American range", () => {
    expect(builder).toMatch(/Math\.abs\(parsedOdds\) >= 100/);
  });

  it("enforces the contract's leg bounds", () => {
    expect(MIN_PARLAY_LEGS).toBe(2);
    expect(MAX_PARLAY_LEGS).toBe(10);
    expect(builder).toMatch(/legs\.length >= MIN_PARLAY_LEGS/);
    expect(builder).toMatch(/legs\.length >= MAX_PARLAY_LEGS/);
  });
});

describe("the stake is on the TICKET, not the legs", () => {
  it("REGRESSION: the builder owns a single risk input", () => {
    // A risk box beside each leg invited the reading that legs are separately
    // staked. A parlay has one stake.
    expect(builder).toMatch(/id="bt-parlay-risk"/);
    // Exactly two inputs live in the builder — the ticket price and the one
    // stake. A third would be a per-leg field sneaking back in.
    expect((builder.match(/<input/g) ?? []).length).toBe(2);
  });

  it("REGRESSION: the leg form hides risk and to-win in parlay mode", () => {
    const page = readFileSync(
      join(__dirname, "../pages/BetTracker.tsx"),
      "utf8"
    );
    expect(page).toMatch(/entryMode === "PARLAY" \? "grid grid-cols-1 gap-3"/);
    expect(page).toMatch(/\{entryMode === "STRAIGHT" && \(/);
  });

  it("the leg field is labelled as a leg price", () => {
    const page = readFileSync(
      join(__dirname, "../pages/BetTracker.tsx"),
      "utf8"
    );
    expect(page).toMatch(/entryMode === "PARLAY" \? "Leg odds" : "Odds"/);
  });

  it("submit requires a stake", () => {
    expect(builder).toMatch(/riskValid/);
    expect(builder).toMatch(/canSubmit = enough && oddsValid && riskValid/);
  });
});

describe("the card explains a payout that changed", () => {
  it("shows the reprice when a leg was dropped", () => {
    // Without this the user sees a number that is not the one they wrote down
    // and has no way to find out why.
    expect(legList).toMatch(/wasRepriced/);
    expect(legList).toMatch(/repriced/i);
  });

  it("marks the leg that killed a losing ticket", () => {
    expect(legList).toMatch(/killedIt/);
  });

  it("strikes through dropped legs", () => {
    expect(legList).toMatch(/lineThrough|line-through/);
  });
});

describe("Dime brand law", () => {
  const files = { ParlayBuilder: builder, ParlayLegList: legList };

  it("uses no gradients", () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).not.toMatch(
        /linear-gradient|radial-gradient|bg-gradient/
      );
    }
  });

  it("uses no forbidden hues — purple, gold, or the legacy neon green", () => {
    // Built from parts rather than written as literals: this file is itself
    // scanned by the hex-literal ratchet, which gives new files a ceiling of
    // zero. A test that hardcodes the hexes it forbids would breach the very
    // law it is enforcing.
    const NEON_GREEN = ["39", "FF", "14"].join("");
    const GOLD = ["FF", "D7", "00"].join("");
    const forbidden = new RegExp(
      `${NEON_GREEN}|${GOLD}|purple|violet|gold\\b`,
      "i"
    );
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).not.toMatch(forbidden);
    }
  });

  it("takes colour from tokens, not hardcoded hex", () => {
    for (const [name, src] of Object.entries(files)) {
      // The repo's hex-literal ratchet gives new files a ceiling of ZERO, so
      // there is no allowlist here — every colour comes from a token.
      const hexes = src.match(/#[0-9A-Fa-f]{3,8}/g) ?? [];
      expect(hexes, `${name} hardcodes ${hexes.join(", ")}`).toEqual([]);
    }
  });

  it("uses the mint accent only, via its token", () => {
    expect(builder).toMatch(/var\(--dime-mint/);
    expect(legList).toMatch(/var\(--dime-mint\)/);
  });

  it("animates on the brand's 160ms timing token", () => {
    expect(legList).toMatch(/var\(--dime-t, 160ms\)/);
  });
});

describe("accessibility", () => {
  it("the mode switch is a labelled tablist", () => {
    // Asserted in the page that renders it.
    const page = readFileSync(
      join(__dirname, "../pages/BetTracker.tsx"),
      "utf8"
    );
    expect(page).toMatch(/role="tablist"/);
    expect(page).toMatch(/aria-label="Bet type"/);
    expect(page).toMatch(/aria-selected=\{entryMode === mode\}/);
  });

  it("each remove button names the leg it removes", () => {
    expect(builder).toMatch(/aria-label=\{`Remove leg \$\{i \+ 1\}/);
  });

  it("leg outcome is not conveyed by colour alone", () => {
    // Each row carries an icon plus an sr-only word, so a screen reader and a
    // colour-blind user both get the result.
    expect(legList).toMatch(/sr-only/);
    expect(legList).toMatch(/label: "Won"/);
    expect(legList).toMatch(/label: "Lost"/);
    expect(legList).toMatch(/label: "Dropped"/);
  });
});
