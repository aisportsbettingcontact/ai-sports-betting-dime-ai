import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(
  path.join(import.meta.dirname, "GameCard.tsx"),
  "utf8"
);

describe("splits-surface accordion gating (moved to Trends tab at ≥768px)", () => {
  it("imports the shared shell-boundary hook", () => {
    expect(src).toMatch(
      /import \{ useIsMdUp \} from ["']@\/hooks\/useIsMdUp["']/
    );
  });

  it("renders Last 5 Games + Trends only below the shell boundary in splits mode", () => {
    // The gate: (mode === 'splits' && !isMdUp) || mobileTab === 'splits'
    expect(src).toMatch(
      /\(\(mode === 'splits' && !isMdUp\) \|\| mobileTab === 'splits'\)[\s\S]{0,160}game\.sport === 'MLB'/
    );
  });

  it("keeps ODDS & SPLITS HISTORY on the splits surface at every width", () => {
    expect(src).toMatch(
      /\(mode === 'splits' \|\| mobileTab === 'splits'\) && isCardVisible && game\.id != null/
    );
  });
});
