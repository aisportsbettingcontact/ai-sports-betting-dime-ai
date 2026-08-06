/**
 * betTrackerEntry.test.ts — entry-time live/pregame separation.
 *
 * The Action Network slate serves ONE odds snapshot per game: pregame lines
 * before first pitch, the book's CURRENT (live) lines while in progress,
 * closing lines after. The form must never present one as the other. The
 * matrix below is the whole rule; both the straight path and the leg path
 * consume it, so a hole here is a hole in both.
 */

import { describe, it, expect } from "vitest";
import {
  decideEntrySource,
  defaultWagerType,
  checkLegCoherence,
  deriveTicketWagerType,
} from "./betTrackerEntry";

describe("decideEntrySource — the live/pregame matrix", () => {
  it("scheduled + PREGAME: autofill, chip PRE, LIVE not yet selectable", () => {
    expect(decideEntrySource("scheduled", "PREGAME")).toEqual({
      autofill: true,
      liveSelectable: false,
      sourceLabel: "PRE",
    });
  });

  it("scheduled + LIVE is not a real state: no autofill, LIVE not selectable", () => {
    expect(decideEntrySource("scheduled", "LIVE")).toEqual({
      autofill: false,
      liveSelectable: false,
      sourceLabel: null,
    });
  });

  it("in_progress + LIVE: autofill the live lines, chip LIVE", () => {
    expect(decideEntrySource("in_progress", "LIVE")).toEqual({
      autofill: true,
      liveSelectable: true,
      sourceLabel: "LIVE",
    });
  });

  it("REGRESSION (the mixing hole): in_progress + PREGAME never autofills", () => {
    // The slate's odds ARE the live lines once the game starts. Filling them
    // into a wager the user is recording as pregame mislabels live prices as
    // pregame prices — the exact separation this module exists to enforce.
    expect(decideEntrySource("in_progress", "PREGAME")).toEqual({
      autofill: false,
      liveSelectable: true,
      sourceLabel: null,
    });
  });

  it("complete + PREGAME: autofill closing lines for backfill", () => {
    expect(decideEntrySource("complete", "PREGAME")).toEqual({
      autofill: true,
      liveSelectable: true,
      sourceLabel: "PRE",
    });
  });

  it("complete + LIVE: manual only — the feed has no live line anymore", () => {
    expect(decideEntrySource("complete", "LIVE")).toEqual({
      autofill: false,
      liveSelectable: true,
      sourceLabel: null,
    });
  });

  it("an unknown status fails safe as scheduled", () => {
    expect(decideEntrySource("weird_new_status", "PREGAME")).toEqual({
      autofill: true,
      liveSelectable: false,
      sourceLabel: "PRE",
    });
    expect(decideEntrySource("weird_new_status", "LIVE").autofill).toBe(false);
  });
});

describe("defaultWagerType — the toggle follows the game", () => {
  it("in_progress → LIVE, anything else → PREGAME", () => {
    expect(defaultWagerType("in_progress")).toBe("LIVE");
    expect(defaultWagerType("scheduled")).toBe("PREGAME");
    expect(defaultWagerType("complete")).toBe("PREGAME");
    expect(defaultWagerType("anything_else")).toBe("PREGAME");
  });
});

describe("checkLegCoherence — one ticket, one moment", () => {
  it("the first leg always coheres", () => {
    expect(checkLegCoherence([], "LIVE").ok).toBe(true);
    expect(checkLegCoherence([], "PREGAME").ok).toBe(true);
  });

  it("legs of the same kind cohere", () => {
    expect(checkLegCoherence(["LIVE", "LIVE"], "LIVE").ok).toBe(true);
    expect(checkLegCoherence(["PREGAME"], "PREGAME").ok).toBe(true);
  });

  it("REGRESSION: mixing is rejected, both directions, with a specific message", () => {
    const liveOntoPre = checkLegCoherence(["PREGAME"], "LIVE");
    expect(liveOntoPre.ok).toBe(false);
    if (!liveOntoPre.ok) expect(liveOntoPre.message).toMatch(/pregame legs/i);

    const preOntoLive = checkLegCoherence(["LIVE"], "PREGAME");
    expect(preOntoLive.ok).toBe(false);
    if (!preOntoLive.ok) expect(preOntoLive.message).toMatch(/live legs/i);
  });
});

describe("deriveTicketWagerType — the ticket label comes from its legs", () => {
  it("all LIVE legs → LIVE; empty or any PREGAME → PREGAME", () => {
    expect(deriveTicketWagerType(["LIVE", "LIVE"])).toBe("LIVE");
    expect(deriveTicketWagerType(["PREGAME", "PREGAME"])).toBe("PREGAME");
    expect(deriveTicketWagerType([])).toBe("PREGAME");
  });
});

// ─── Source scans: the builder's copy and cells ───────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

const builder = readFileSync(
  join(__dirname, "../components/ParlayBuilder.tsx"),
  "utf8"
);
const page = readFileSync(join(__dirname, "BetTracker.tsx"), "utf8");

describe("the builder's copy and cells", () => {
  it("REGRESSION: the two standing captions are gone", () => {
    expect(builder).not.toMatch(/Calculated from/);
    expect(builder).not.toMatch(/One stake on the whole ticket/);
    expect(builder).not.toMatch(/that price is what settles/);
  });

  it("legs are editable and deletable", () => {
    expect(builder).toMatch(/onEditLeg/);
    expect(builder).toMatch(/onRemoveLeg/);
  });

  it("cells carry logos and a wager-type stamp", () => {
    expect(builder).toMatch(/awayLogo/);
    expect(builder).toMatch(/homeLogo/);
    expect(builder).toMatch(/wagerType/);
  });

  it("the ticket label derives from the legs, not the toggle", () => {
    expect(builder).toMatch(/deriveTicketWagerType/);
    expect(page).toMatch(/deriveTicketWagerType\(draftLegs\.map/);
  });

  it("STRAIGHT is the term, not SINGLE", () => {
    expect(page).toMatch(/"STRAIGHT"/);
    expect(page).not.toMatch(/entryMode === "SINGLE"/);
    expect(page).not.toMatch(/"SINGLE" \| "PARLAY"/);
  });

  it("REGRESSION: autofill is gated by the matrix on both paths", () => {
    expect(page).toMatch(/decideEntrySource/);
    expect(page).toMatch(/checkLegCoherence/);
    expect(page).toMatch(/defaultWagerType/);
  });
});
