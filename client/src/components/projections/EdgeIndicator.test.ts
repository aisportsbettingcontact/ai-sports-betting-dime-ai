import { describe, it, expect } from "vitest";
import { formatEdge } from "./EdgeIndicator";

describe("formatEdge", () => {
  it("formats a positive edge with a leading plus and one decimal", () => {
    expect(formatEdge(3.5)).toBe("+3.5%");
    expect(formatEdge(1.66)).toBe("+1.7%"); // rounds to the directive's +1.7
    expect(formatEdge(0)).toBe("+0.0%");
  });
  it("uses a real minus sign (not a hyphen) for negatives", () => {
    expect(formatEdge(-2.1)).toBe("−2.1%");
  });
  it("renders an em-dash placeholder for non-finite input", () => {
    expect(formatEdge(NaN)).toBe("—");
    expect(formatEdge(Infinity)).toBe("—");
  });
});
