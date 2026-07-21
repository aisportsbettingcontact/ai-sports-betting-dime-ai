import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatGameTime, timeToMinutes } from "../lib/gameUtils";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "TrendsPage.tsx"),
  "utf8"
);

describe("TrendsPage uses canonical gameUtils time handling", () => {
  it("imports the shared formatters instead of redefining them", () => {
    expect(src).toMatch(
      /import \{[^}]*formatGameTime[^}]*\} from ["']@\/lib\/gameUtils["']/
    );
    expect(src).not.toMatch(/function formatTimeEt/);
    expect(src).not.toMatch(/function timeToMinutes/);
    expect(src).not.toMatch(/function formatDateHeader/);
  });

  it("renders game times through formatGameTime", () => {
    expect(src).toMatch(/formatGameTime\(game\.startTimeEst\)/);
  });
});

describe("gameUtils handles the 12-hour DB form (the 6:40 AM bug)", () => {
  it("formats '6:40 PM' as PM, not AM", () => {
    expect(formatGameTime("6:40 PM")).toBe("6:40 PM ET");
  });
  it("still formats military time", () => {
    expect(formatGameTime("18:40")).toBe("6:40 PM ET");
  });
  it("sorts 11:35 AM before 1:05 PM", () => {
    expect(timeToMinutes("11:35 AM")).toBeLessThan(timeToMinutes("1:05 PM"));
  });
});
