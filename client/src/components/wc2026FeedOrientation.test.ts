import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the WC projections card odds-orientation bug.
 *
 * Defect (money-critical): the desktop card `WcDesktopMergedPanel` fed the HOME
 * team's ML / to-advance value into the AWAY (top) row, so England (the favorite,
 * shown top) displayed Norway's underdog price (+300 / +160). SPREAD and DBL CHC
 * were correct, which is why only ML/to-advance looked swapped. The score panel
 * lists AWAY on top / HOME on bottom, and `WcMktCol` renders `away*` props in the
 * top row — so each row must carry ITS OWN team's value.
 *
 * Also guards: DBL CHC row order (HOME WD top / AWAY WD bottom, owner spec), the
 * per-row label surfacing (spread ±line etc.), and the round-aware stage label
 * (was hardcoded "Round of 32" for every knockout round).
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "WcFeedInline.tsx"),
  "utf8",
);

describe("WC projections card — odds orientation & row order", () => {
  it("ML binds each team row to its own value (away row = away team)", () => {
    expect(src).toMatch(/title="ML"[\s\S]{0,240}awayBookNum=\{dkOdds\?\.away\}/);
    expect(src).toMatch(/title="ML"[\s\S]{0,240}homeBookNum=\{dkOdds\?\.home\}/);
    // The old swapped form must be gone.
    expect(src).not.toMatch(/title="ML"[\s\S]{0,240}awayBookNum=\{dkOdds\?\.home\}/);
  });

  it("TO ADV binds each team row to its own to-advance value", () => {
    expect(src).toMatch(/title="TO ADV"[\s\S]{0,240}awayBookNum=\{dkOdds\?\.toAdvanceAway\}/);
    expect(src).toMatch(/title="TO ADV"[\s\S]{0,240}homeBookNum=\{dkOdds\?\.toAdvanceHome\}/);
    expect(src).not.toMatch(/title="TO ADV"[\s\S]{0,240}awayBookNum=\{dkOdds\?\.toAdvanceHome\}/);
  });

  it("DBL CHC shows HOME WD on top, AWAY WD on bottom (owner spec)", () => {
    expect(src).toMatch(/title="DBL CHC"[\s\S]{0,260}awayLabel="HOME WD"/);
    expect(src).toMatch(/title="DBL CHC"[\s\S]{0,260}homeLabel="AWAY WD"/);
    expect(src).toMatch(/title="DBL CHC"[\s\S]{0,260}awayBookNum=\{dkOdds\?\.homeDrawOdds\}/);
  });

  it("surfaces per-row labels for option/line markets (spread line, DRAW/BTTS/DC labels)", () => {
    expect(src).toMatch(/const showRowLabel = title !== 'ML' && title !== 'TO ADV'/);
    expect(src).toMatch(/bookLine=\{showRowLabel \? awayLabel : ''\}/);
  });

  it("stage label is round-aware (quarterfinals not mislabelled 'Round of 32')", () => {
    expect(src).toMatch(/Knockout Stage · Quarterfinals/);
    expect(src).toMatch(/selectedDate >= '2026-07-09' \? 'Knockout Stage · Quarterfinals'/);
  });
});
