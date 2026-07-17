import { describe, it, expect } from "vitest";
import {
  createSoccerPresentation,
  createMlbPresentation,
  sportAdapters,
  formatDoubleChanceSelection,
  toPresentation,
  type FeedEventLike,
  type SportPresentationModel,
} from "./presentation";
import { isRawCountryCode, countryIdentity, flagEmojiFromIso2 } from "./countries";

// A World Cup event as the feed normalizes it: away = Spain (top), home = France.
const WC_EVENT: FeedEventLike = {
  id: "esp-fra",
  liveLabel: null,
  timeLabel: "3:00 PM ET",
  away: { name: "Spain", crest: { code: "ESP", url: null, bg: "#C60B1E" }, score: null },
  home: { name: "France", crest: { code: "FRA", url: null, bg: "#0055A4" }, score: null },
  meta: "Semifinal · MetLife Stadium, East Rutherford",
  venueLine: "Semifinal · MetLife Stadium, East Rutherford",
  markets: [
    { title: "ML", foot: { label: "ESP ML · +3.1%", edge: true }, rows: [
      { label: "ESP", book: "+140", model: "+120" },
      { label: "FRA", book: "+190", model: "+200" },
    ] },
    { title: "Draw", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "DRAW", book: "+210", model: "+205" },
      { label: "NO DRAW", book: "-280", model: "-270" },
    ] },
    { title: "Total", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "O 2.5", book: "+105", model: "+110" },
      { label: "U 2.5", book: "-125", model: "-130" },
    ] },
    { title: "Spread", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "ESP -0.5", book: "+140", model: "+120" },
      { label: "FRA +0.5", book: "-170", model: "-150" },
    ] },
    { title: "Dbl Chc", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "HOME WD", book: "-115", model: "-120" },
      { label: "AWAY WD", book: "-130", model: "-140" },
    ] },
    { title: "BTTS", foot: { label: "NO EDGE", edge: false }, rows: [
      { label: "YES", book: "-105", model: "-110" },
      { label: "NO", book: "-115", model: "-110" },
    ] },
  ],
};

/** Every string a user could read in the rendered card. */
function renderedStrings(model: SportPresentationModel): string[] {
  return [
    model.competition,
    model.statusLabel,
    model.homeParticipant.displayName,
    model.homeParticipant.shortName,
    model.awayParticipant.displayName,
    model.awayParticipant.shortName,
    model.contextLine ?? "",
    model.venue ?? "",
    model.startTime ?? "",
    ...model.markets.flatMap((m) => [m.label, m.resultLabel ?? "", ...m.selections.map((s) => s.label)]),
  ];
}

describe("createSoccerPresentation — country identity", () => {
  const model = createSoccerPresentation(WC_EVENT);

  it("renders real country names, never raw codes, in header and participants", () => {
    expect(model.awayParticipant.displayName).toBe("Spain");
    expect(model.homeParticipant.displayName).toBe("France");
    expect(model.awayParticipant.kind).toBe("country");
    expect(isRawCountryCode(model.awayParticipant.displayName)).toBe(false);
    expect(isRawCountryCode(model.homeParticipant.displayName)).toBe(false);
  });

  it("carries kickoff time for scheduled events (matchup block's last line)", () => {
    expect(model.startTime).toBe("3:00 PM ET");
  });

  it("binds each participant's flag and name to the same ISO code", () => {
    const spain = countryIdentity("ESP", "Spain");
    expect(model.awayParticipant.iso2).toBe("ES");
    expect(model.awayParticipant.flag).toBe(spain.flag);
    expect(model.awayParticipant.flag).toBe(flagEmojiFromIso2("ES"));
    expect(model.homeParticipant.iso2).toBe("FR");
    expect(model.homeParticipant.flag).toBe(flagEmojiFromIso2("FR"));
  });

  it("expands ML / spread codes to full country names", () => {
    const ml = model.markets.find((m) => m.key === "ml")!;
    expect(ml.selections.map((s) => s.label)).toEqual(["Spain", "France"]);
    const spread = model.markets.find((m) => m.key === "spread")!;
    expect(spread.selections[0].label).toBe("Spain -0.5");
    expect(spread.selections[1].label).toBe("France +0.5");
  });

  it("renders Total / BTTS / Draw with human labels", () => {
    expect(model.markets.find((m) => m.key === "total")!.selections.map((s) => s.label))
      .toEqual(["Over 2.5", "Under 2.5"]);
    expect(model.markets.find((m) => m.key === "btts")!.selections.map((s) => s.label))
      .toEqual(["Both teams to score — Yes", "Both teams to score — No"]);
    expect(model.markets.find((m) => m.key === "draw")!.selections.map((s) => s.label))
      .toEqual(["Draw", "No Draw"]);
  });

  it("NO raw abbreviation reaches ANY rendered string", () => {
    for (const s of renderedStrings(model)) {
      // no standalone ESP/FRA token anywhere a user can see
      expect(/\b(ESP|FRA)\b/.test(s)).toBe(false);
    }
  });

  it("preserves prices unchanged (calculations untouched)", () => {
    const ml = model.markets.find((m) => m.key === "ml")!;
    expect(ml.selections[0]).toMatchObject({ bookPrice: 140, modelPrice: 120 });
    expect(ml.selections[1]).toMatchObject({ bookPrice: 190, modelPrice: 200 });
  });
});

describe("formatDoubleChanceSelection — resolved via participant identity", () => {
  const model = createSoccerPresentation(WC_EVENT);

  it("HOME_OR_DRAW always resolves to the home participant", () => {
    expect(formatDoubleChanceSelection("HOME_OR_DRAW", model)).toBe("France Win or Draw");
    const dbl = model.markets.find((m) => m.key === "dbl-chc")!;
    // row 0 (HOME WD) → home participant, France; carries France's flag
    expect(dbl.selections[0].label).toBe("France Win or Draw");
    expect(dbl.selections[0].participantId).toBe(model.homeParticipant.id);
    expect(dbl.selections[0].flag).toBe(model.homeParticipant.flag);
  });

  it("AWAY_OR_DRAW always resolves to the away participant", () => {
    expect(formatDoubleChanceSelection("AWAY_OR_DRAW", model)).toBe("Spain Win or Draw");
    const dbl = model.markets.find((m) => m.key === "dbl-chc")!;
    expect(dbl.selections[1].label).toBe("Spain Win or Draw");
    expect(dbl.selections[1].participantId).toBe(model.awayParticipant.id);
    expect(dbl.selections[1].flag).toBe(model.awayParticipant.flag);
  });

  it("DRAW is fixed", () => {
    expect(formatDoubleChanceSelection("DRAW", model)).toBe("Draw");
  });

  it("reversing the participants reverses BOTH labels correctly", () => {
    const swapped = createSoccerPresentation({
      ...WC_EVENT,
      away: WC_EVENT.home,
      home: WC_EVENT.away,
    });
    // now home = Spain, away = France
    expect(formatDoubleChanceSelection("HOME_OR_DRAW", swapped)).toBe("Spain Win or Draw");
    expect(formatDoubleChanceSelection("AWAY_OR_DRAW", swapped)).toBe("France Win or Draw");
    const dbl = swapped.markets.find((m) => m.key === "dbl-chc")!;
    expect(dbl.selections[0].label).toBe("Spain Win or Draw"); // HOME WD → Spain now
    expect(dbl.selections[1].label).toBe("France Win or Draw"); // AWAY WD → France now
    // flags follow identity too
    expect(dbl.selections[0].flag).toBe(swapped.homeParticipant.flag);
  });
});

describe("sportAdapters registry", () => {
  it("covers every sport", () => {
    expect(Object.keys(sportAdapters).sort()).toEqual(
      ["MLB", "NBA", "NCAAF", "NCAAM", "NFL", "NHL", "SOCCER"].sort(),
    );
  });

  it("MLB adapter keeps team codes and does not touch numbers", () => {
    const mlb: FeedEventLike = {
      id: "mil-pit",
      timeLabel: "FINAL",
      away: { name: "Brewers", crest: { code: "MIL", url: "/mil.svg", bg: "#12284B" }, score: "5" },
      home: { name: "Pirates", crest: { code: "PIT", url: null, bg: "#111111" }, score: "14" },
      meta: "Gasser vs Skenes",
      markets: [
        { title: "Moneyline", foot: { label: "NO EDGE", edge: false }, rows: [
          { label: "MIL", book: "-140", model: "-150" },
          { label: "PIT", book: "+120", model: "+130" },
        ] },
      ],
    };
    const model = createMlbPresentation(mlb);
    expect(model.sport).toBe("MLB");
    expect(model.status).toBe("final");
    expect(model.startTime).toBeUndefined(); // finals have no first-pitch line
    expect(model.awayParticipant).toMatchObject({ kind: "team", displayName: "Brewers", shortName: "MIL" });
    expect(model.markets[0].selections[0]).toMatchObject({ label: "MIL", bookPrice: -140, modelPrice: -150 });
  });

  it("toPresentation dispatches by sport key", () => {
    expect(toPresentation("SOCCER", WC_EVENT).sport).toBe("SOCCER");
    expect(toPresentation("NBA", WC_EVENT).sport).toBe("NBA");
  });
});
