import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  MLB_ASG,
  impliedProb,
  computeAsgModel,
  type AsgBook,
} from "./mlbAllStarGame";
import { MLB_VALID_ABBREVS, MLB_BY_ABBREV, getMlbTeamByAnSlug } from "../shared/mlbTeams";

/**
 * Guards for the MLB All-Star Game (AL vs NL) on the projections feed. The engine
 * can't model AL/NL, so the model is owner-provided and stored as run-line +
 * total LADDERS; the rung matching the live book line is displayed so book and
 * model always share the same line. These lock the config, the rung selection,
 * the AL/NL registration, and the CRON-gated write endpoint together.
 */

const book = (over: Partial<AsgBook> = {}): AsgBook => ({
  awayML: "+110", homeML: "-135",
  awaySpread: "+1.5", awaySpreadOdds: "-180",
  homeSpread: "-1.5", homeSpreadOdds: "+145",
  total: "8", overOdds: "-115", underOdds: "-105",
  source: "dk",
  ...over,
});

describe("MLB All-Star Game config + model ladders", () => {
  it("targets the verified AN game (AL away / NL home, 2026-07-14)", () => {
    expect(MLB_ASG.gameDate).toBe("2026-07-14");
    expect(MLB_ASG.anGameId).toBe(291776);
    expect(MLB_ASG.awayAbbr).toBe("AL");
    expect(MLB_ASG.homeAbbr).toBe("NL");
    expect(MLB_ASG.awaySlug).toBe("american-league");
    expect(MLB_ASG.homeSlug).toBe("national-league");
  });

  it("impliedProb matches the owner's no-vig odds", () => {
    expect(impliedProb("-104")).toBeCloseTo(50.98, 2);
    expect(impliedProb("+104")).toBeCloseTo(49.02, 2);
    expect(impliedProb("-262")).toBeCloseTo(72.38, 2);
    expect(impliedProb("+262")).toBeCloseTo(27.62, 2);
    expect(impliedProb("+103")).toBeCloseTo(49.26, 2);
    expect(impliedProb("-103")).toBeCloseTo(50.74, 2);
  });

  it("ML is fixed AL -104 / NL +104 regardless of book", () => {
    const m = computeAsgModel(book());
    expect(m.modelAwayML).toBe("-104");
    expect(m.modelHomeML).toBe("+104");
    expect(m.modelAwayWinPct).toBe("50.98");
    expect(m.modelHomeWinPct).toBe("49.02");
  });

  it("selects the run-line rung matching the book's direction (book AL +1.5)", () => {
    const m = computeAsgModel(book({ awaySpread: "+1.5", homeSpread: "-1.5" }));
    expect(m.runLineRung).toBe("+1.5");
    expect(m.awayModelSpread).toBe("+1.5");
    expect(m.homeModelSpread).toBe("-1.5");
    expect(m.modelAwaySpreadOdds).toBe("-262"); // AL +1.5
    expect(m.modelHomeSpreadOdds).toBe("+262"); // NL -1.5
    expect(m.modelAwayPLCoverPct).toBe("72.38");
    expect(m.modelHomePLCoverPct).toBe("27.62");
  });

  it("flips the run-line rung when the book comes to AL -1.5", () => {
    const m = computeAsgModel(book({ awaySpread: "-1.5", homeSpread: "+1.5" }));
    expect(m.runLineRung).toBe("-1.5");
    expect(m.awayModelSpread).toBe("-1.5");
    expect(m.homeModelSpread).toBe("+1.5");
    expect(m.modelAwaySpreadOdds).toBe("+226"); // AL -1.5
    expect(m.modelHomeSpreadOdds).toBe("-226"); // NL +1.5
  });

  it("selects the total rung matching the book's line (8 / 7.5 / 8.5 / 7)", () => {
    expect(computeAsgModel(book({ total: "8" })).modelOverOdds).toBe("+103");
    expect(computeAsgModel(book({ total: "8" })).modelUnderOdds).toBe("-103");
    expect(computeAsgModel(book({ total: "7.5" })).modelOverOdds).toBe("-115");
    expect(computeAsgModel(book({ total: "8.5" })).modelOverOdds).toBe("+121");
    expect(computeAsgModel(book({ total: "7" })).modelOverOdds).toBe("-169");
    // modelTotal echoes the book's line so book and model share it
    expect(computeAsgModel(book({ total: "8.5" })).modelTotal).toBe("8.5");
  });

  it("normalizes '8.0' to the '8' rung and clamps out-of-ladder totals to nearest", () => {
    expect(computeAsgModel(book({ total: "8.0" })).totalRung).toBe("8");
    expect(computeAsgModel(book({ total: "9" })).totalRung).toBe("8.5"); // nearest rung
    expect(computeAsgModel(book({ total: "6.5" })).totalRung).toBe("7"); // nearest rung
  });
});

describe("AL/NL pseudo-team registration", () => {
  it("registers AL/NL so isValidGame passes and logos/slug resolve", () => {
    expect(MLB_VALID_ABBREVS.has("AL")).toBe(true);
    expect(MLB_VALID_ABBREVS.has("NL")).toBe(true);
    expect(MLB_BY_ABBREV.get("AL")?.isAllStar).toBe(true);
    expect(MLB_BY_ABBREV.get("NL")?.isAllStar).toBe(true);
    // AN url_slug must resolve so the live refresh can keep the book current.
    expect(getMlbTeamByAnSlug("american-league")?.abbrev).toBe("AL");
    expect(getMlbTeamByAnSlug("national-league")?.abbrev).toBe("NL");
  });
});

describe("mlb-asg write endpoint", () => {
  const cronRoutesSrc = fs.readFileSync(
    path.join(import.meta.dirname, "cron", "cronRoutes.ts"),
    "utf8",
  );

  it("registers POST /api/cron/mlb-asg guarded by the cron secret", () => {
    expect(cronRoutesSrc).toMatch(/app\.post\("\/api\/cron\/mlb-asg"/);
    expect(cronRoutesSrc).toMatch(/requireCronSecret\(req, res, "mlb-asg"\)/);
    expect(cronRoutesSrc).toContain("runMlbAllStarGameSync");
  });
});
