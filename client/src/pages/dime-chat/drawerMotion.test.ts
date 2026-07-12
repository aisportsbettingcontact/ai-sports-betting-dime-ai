import { describe, expect, it } from "vitest";
import {
  classifyPointerIntent,
  resolveDrawerAccessibility,
  resolveDrawerTarget,
  rubberBand,
} from "./drawerMotion";

describe("drawerMotion", () => {
  it("waits for 10px before claiming a pointer gesture", () => {
    expect(classifyPointerIntent(7, 4)).toBe("pending");
    expect(classifyPointerIntent(11, 3)).toBe("horizontal");
    expect(classifyPointerIntent(4, 12)).toBe("vertical");
  });

  it("rubber-bands progressively past both drawer bounds", () => {
    expect(rubberBand(-320, -300, 0)).toBeCloseTo(-303.558);
    expect(rubberBand(20, -300, 0)).toBeCloseTo(3.558);
    expect(rubberBand(100, -300, 0) - 0).toBeLessThan(
      5 * rubberBand(20, -300, 0)
    );
    expect(rubberBand(-120, -300, 0)).toBe(-120);
  });

  it("uses velocity sign rather than position to choose open or closed", () => {
    expect(
      resolveDrawerTarget({ velocityX: 20, lastDirection: -1, closedX: -293 })
    ).toBe(0);
    expect(
      resolveDrawerTarget({ velocityX: -20, lastDirection: 1, closedX: -293 })
    ).toBe(-293);
  });

  it("a slow reversed release past halfway goes back", () => {
    // Position is deliberately absent from the API: negative direction wins.
    expect(
      resolveDrawerTarget({ velocityX: 0, lastDirection: -1, closedX: -293 })
    ).toBe(-293);
  });
});

describe("resolveDrawerAccessibility", () => {
  // Full truth table over { drawerOpen, drawerMoving, visible, reduceMotion }.
  // "visible" stands in for drawerVisibleFraction: 0 means fully off-screen,
  // any value > 0 (we use 1 here, and a fractional value below) means some
  // part of the drawer is on screen.
  const rows: Array<{
    drawerOpen: boolean;
    drawerMoving: boolean;
    drawerVisibleFraction: number;
    reduceMotion: boolean;
    mainInert: boolean;
    trapFocus: boolean;
  }> = [
    // --- drawerOpen: false -> mainInert/trapFocus always false, no matter what ---
    { drawerOpen: false, drawerMoving: false, drawerVisibleFraction: 0, reduceMotion: false, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: false, drawerVisibleFraction: 0, reduceMotion: true, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: false, drawerVisibleFraction: 1, reduceMotion: false, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: false, drawerVisibleFraction: 1, reduceMotion: true, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: true, drawerVisibleFraction: 0, reduceMotion: false, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: true, drawerVisibleFraction: 0, reduceMotion: true, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: true, drawerVisibleFraction: 1, reduceMotion: false, mainInert: false, trapFocus: false },
    { drawerOpen: false, drawerMoving: true, drawerVisibleFraction: 1, reduceMotion: true, mainInert: false, trapFocus: false },

    // --- drawerOpen: true, reduceMotion: false -> behavior UNCHANGED from
    // pre-fix code (`main.inert = drawerOpen`): visibility fraction is
    // irrelevant, mainInert always follows drawerOpen. This task does not
    // touch the non-reduced-motion animation path.
    { drawerOpen: true, drawerMoving: false, drawerVisibleFraction: 0, reduceMotion: false, mainInert: true, trapFocus: true },
    { drawerOpen: true, drawerMoving: false, drawerVisibleFraction: 1, reduceMotion: false, mainInert: true, trapFocus: true },
    { drawerOpen: true, drawerMoving: true, drawerVisibleFraction: 0, reduceMotion: false, mainInert: true, trapFocus: false },
    { drawerOpen: true, drawerMoving: true, drawerVisibleFraction: 1, reduceMotion: false, mainInert: true, trapFocus: false },

    // --- drawerOpen: true, reduceMotion: true -> mainInert additionally
    // requires drawerVisibleFraction > 0.
    { drawerOpen: true, drawerMoving: false, drawerVisibleFraction: 1, reduceMotion: true, mainInert: true, trapFocus: true },
    { drawerOpen: true, drawerMoving: false, drawerVisibleFraction: 0.4, reduceMotion: true, mainInert: true, trapFocus: true },
    { drawerOpen: true, drawerMoving: true, drawerVisibleFraction: 1, reduceMotion: true, mainInert: true, trapFocus: false },

    // REGRESSION ROW — PR #70: an edge-swipe gesture used to call
    // setDrawerOpen(true)/setDrawerMoving(true) unconditionally while the
    // drawerX visual write was gated behind `if (!reduceMotion)`, so under
    // prefers-reduced-motion: reduce, drawerOpen went true while the drawer
    // stayed fully off-screen (drawerVisibleFraction === 0) — main.inert
    // followed drawerOpen and froze the chat pane behind an invisible
    // drawer until the pointer lifted. This exact combination — open,
    // moving, invisible, reduceMotion — MUST produce mainInert: false, or
    // this regression is back.
    { drawerOpen: true, drawerMoving: true, drawerVisibleFraction: 0, reduceMotion: true, mainInert: false, trapFocus: false },
  ];

  it.each(rows)(
    "open=$drawerOpen moving=$drawerMoving visible=$drawerVisibleFraction reduceMotion=$reduceMotion -> mainInert=$mainInert trapFocus=$trapFocus",
    ({ mainInert, trapFocus, ...args }) => {
      expect(resolveDrawerAccessibility(args)).toEqual({ mainInert, trapFocus });
    }
  );

  it("never inerts the main pane when the drawer is closed, regardless of moving/visible/reduceMotion", () => {
    for (const drawerMoving of [false, true]) {
      for (const drawerVisibleFraction of [0, 1]) {
        for (const reduceMotion of [false, true]) {
          expect(
            resolveDrawerAccessibility({
              drawerOpen: false,
              drawerMoving,
              drawerVisibleFraction,
              reduceMotion,
            })
          ).toEqual({ mainInert: false, trapFocus: false });
        }
      }
    }
  });
});
