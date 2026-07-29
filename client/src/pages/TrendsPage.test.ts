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

describe("Trends page layout v2: toggle cards on a container-query grid", () => {
  it("renders both panels non-collapsible (the card owns collapse/toggle)", () => {
    const collapsibleFalse = src.match(/collapsible=\{false\}/g) ?? [];
    expect(collapsibleFalse).toHaveLength(2);
    expect(src).not.toMatch(/defaultCollapsed=\{true\}/);
    // The segmented toggle labels the panel, so the panels' own title rows
    // are hidden on this surface.
    const hideHeader = src.match(/hideHeader/g) ?? [];
    expect(hideHeader.length).toBeGreaterThanOrEqual(2);
  });
  it("shows one panel at a time behind a Last 5 Games / Trends toggle", () => {
    expect(src).toMatch(/activePanel/);
    expect(src).toMatch(/"last5"/);
    expect(src).toMatch(/"trends"/);
  });
  it("lays the slate out as a pane-width-aware two-up grid", () => {
    expect(src).toMatch(/data-trends-grid/);
    // Container query, not a viewport breakpoint: the shell sidebar eats
    // 264px, so two-up only when the PANE itself fits two readable cards.
    expect(src).toMatch(/@container/);
    expect(src).toMatch(/grid-cols-1 @\[52rem\]:grid-cols-2/);
  });
  it("collapses game cards below the shell boundary", () => {
    expect(src).toMatch(
      /import \{ useIsMdUp \} from ["']@\/hooks\/useIsMdUp["']/
    );
    expect(src).toMatch(/aria-expanded=\{expanded\}/);
  });
});
