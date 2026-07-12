import { describe, expect, it } from "vitest";
import {
  classifyPointerIntent,
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
