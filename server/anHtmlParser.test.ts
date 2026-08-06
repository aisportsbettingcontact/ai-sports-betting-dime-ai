/**
 * Tests for the Action Network "All Markets" HTML parser.
 *
 * Uses a minimal synthetic HTML fragment that mirrors the real AN table structure
 * to verify parsing logic without depending on external files.
 */

import { describe, it, expect } from "vitest";
import { parseAnAllMarketsHtml } from "./anHtmlParser";

// ─── Minimal synthetic HTML ────────────────────────────────────────────────────
// Simulates one complete game (3 rows: SPREAD, TOTAL, ML) + separator row.
// Column layout: [0]=game-info, [1]=open, [2]=DK NJ (with DK logo), [3..11]=other books

function makeBookCell(
  awayLine: string,
  awayJuice: string,
  homeOrUnderLine: string,
  homeOrUnderJuice: string
): string {
  return `<td>
    <div class="best-odds__odds-container">
      <div>
        <div data-testid="book-cell__odds">
          <span>${awayLine}</span>
          <span>${awayJuice}</span>
        </div>
      </div>
      <div>
        <div data-testid="book-cell__odds">
          <span>${homeOrUnderLine}</span>
          <span>${homeOrUnderJuice}</span>
        </div>
      </div>
    </div>
  </td>`;
}

function makeOpenCell(
  awayLine: string,
  awayJuice: string,
  homeLine: string,
  homeJuice: string
): string {
  return `<td>
    <div class="best-odds__open-container">
      <div class="best-odds__open-cell">
        <div>${awayLine}</div>
        <div class="best-odds__open-cell-secondary"><div>${awayJuice}</div></div>
      </div>
      <div class="best-odds__open-cell">
        <div>${homeLine}</div>
        <div class="best-odds__open-cell-secondary"><div>${homeJuice}</div></div>
      </div>
    </div>
  </td>`;
}

function makeDkCell(
  awayLine: string,
  awayJuice: string,
  homeLine: string,
  homeJuice: string
): string {
  return `<td>
    <div class="best-odds__odds-container">
      <div>
        <picture><img alt="DK NJ logo" src="dk.png" /></picture>
        <div data-testid="book-cell__odds">
          <span>${awayLine}</span>
          <span>${awayJuice}</span>
        </div>
      </div>
      <div>
        <div data-testid="book-cell__odds">
          <span>${homeLine}</span>
          <span>${homeJuice}</span>
        </div>
      </div>
    </div>
  </td>`;
}

function makeGameInfoCell(): string {
  return `<td>
    <div class="game-info__rot-number"><div>607</div><div>608</div></div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="away.png" />
        <span class="game-info__team--desktop">Saint Joe's</span>
        <span class="game-info__team--mobile">SJU</span>
      </div>
    </div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="home.png" />
        <span class="game-info__team--desktop">VCU</span>
        <span class="game-info__team--mobile">VCU</span>
      </div>
    </div>
    <a href="/ncaab-game/saint-josephs-vcu-score-odds-march-14-2026/287105">Game</a>
  </td>`;
}

// Build a minimal 3-row game HTML (SPREAD + TOTAL + ML) with 12 columns (NCAAB)
function buildMinimalGameHtml(): string {
  const emptyCell = `<td><div class="best-odds__odds-container"><div></div><div></div></div></td>`;
  const emptyCells = Array(9).fill(emptyCell).join("");

  const spreadRow = `<tr>
    ${makeGameInfoCell()}
    ${makeOpenCell("+8.5", "-102", "-8.5", "-120")}
    ${makeDkCell("+6.5", "-105", "-6.5", "-106")}
    ${emptyCells}
  </tr>`;

  const totalRow = `<tr>
    <td></td>
    ${makeOpenCell("o135.5", "-110", "u135.5", "-110")}
    ${makeDkCell("o139.5", "-110", "u140.5", "-110")}
    ${emptyCells}
  </tr>`;

  const mlRow = `<tr>
    <td></td>
    ${makeOpenCell("+290", "-110", "-375", "-110")}
    ${makeDkCell("+255", "-110", "-275", "-110")}
    ${emptyCells}
  </tr>`;

  // Separator (1 cell)
  const separatorRow = `<tr><td colspan="12"></td></tr>`;

  return spreadRow + totalRow + mlRow + separatorRow;
}

// Build a minimal 3-row game HTML for NBA (11 columns, nba-game link)
function makeNbaGameInfoCell(): string {
  return `<td>
    <div class="game-info__rot-number"><div>1</div><div>2</div></div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="wiz.png" />
        <span class="game-info__team--desktop">Wizards</span>
      </div>
    </div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="cel.png" />
        <span class="game-info__team--desktop">Celtics</span>
      </div>
    </div>
    <a href="/nba-game/wizards-celtics-score-odds-march-14-2026/281090">Game</a>
  </td>`;
}

function buildMinimalNbaGameHtml(): string {
  const emptyCell = `<td><div class="best-odds__odds-container"><div></div><div></div></div></td>`;
  const emptyCells = Array(8).fill(emptyCell).join(""); // 11 total cols

  const spreadRow = `<tr>
    ${makeNbaGameInfoCell()}
    ${makeOpenCell("+16.5", "-110", "-16.5", "-110")}
    ${makeDkCell("+20.5", "-110", "-20.5", "-110")}
    ${emptyCells}
  </tr>`;

  const totalRow = `<tr>
    <td></td>
    ${makeOpenCell("o228.5", "-110", "u228.5", "-110")}
    ${makeDkCell("o233.5", "-110", "u233.5", "-110")}
    ${emptyCells}
  </tr>`;

  const mlRow = `<tr>
    <td></td>
    ${makeOpenCell("+1100", "-110", "-2200", "-110")}
    ${makeDkCell("+1500", "-110", "-2400", "-110")}
    ${emptyCells}
  </tr>`;

  const separatorRow = `<tr><td colspan="11"></td></tr>`;
  return spreadRow + totalRow + mlRow + separatorRow;
}

// Build a minimal 3-row game HTML for NHL (11 columns, nhl-game link)
function makeNhlGameInfoCell(): string {
  return `<td>
    <div class="game-info__rot-number"><div>43</div><div>44</div></div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="rng.png" />
        <span class="game-info__team--desktop">Rangers</span>
      </div>
    </div>
    <div class="game-info__teams">
      <div>
        <img class="game-info__team-icon" src="wld.png" />
        <span class="game-info__team--desktop">Wild</span>
      </div>
    </div>
    <a href="/nhl-game/rangers-wild-score-odds-march-14-2026/263572">Game</a>
  </td>`;
}

function buildMinimalNhlGameHtml(): string {
  const emptyCell = `<td><div class="best-odds__odds-container"><div></div><div></div></div></td>`;
  const emptyCells = Array(8).fill(emptyCell).join(""); // 11 total cols

  const spreadRow = `<tr>
    ${makeNhlGameInfoCell()}
    ${makeOpenCell("+1.5", "-130", "-1.5", "+106")}
    ${makeDkCell("+1.5", "-133", "-1.5", "+127")}
    ${emptyCells}
  </tr>`;

  const totalRow = `<tr>
    <td></td>
    ${makeOpenCell("o6.5", "+110", "u6.5", "-134")}
    ${makeDkCell("o6.5", "+117", "u6.5", "-122")}
    ${emptyCells}
  </tr>`;

  const mlRow = `<tr>
    <td></td>
    ${makeOpenCell("+195", "-110", "-240", "-110")}
    ${makeDkCell("+162", "-110", "-196", "-110")}
    ${emptyCells}
  </tr>`;

  const separatorRow = `<tr><td colspan="11"></td></tr>`;
  return spreadRow + totalRow + mlRow + separatorRow;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseAnAllMarketsHtml", () => {
  it("returns empty result for empty HTML", () => {
    const result = parseAnAllMarketsHtml("");
    expect(result.games).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("parses a single game with spread, total, and ML", () => {
    const html = buildMinimalGameHtml();
    const result = parseAnAllMarketsHtml(html);

    expect(result.games).toHaveLength(1);
    const g = result.games[0];

    // Game metadata
    expect(g.anGameId).toBe("287105");
    expect(g.awayName).toBe("Saint Joe's");
    expect(g.homeName).toBe("VCU");
    expect(g.awayRot).toBe("607");
    expect(g.homeRot).toBe("608");

    // Open spread
    expect(g.openAwaySpread?.line).toBe("+8.5");
    expect(g.openAwaySpread?.juice).toBe("-102");
    expect(g.openHomeSpread?.line).toBe("-8.5");
    expect(g.openHomeSpread?.juice).toBe("-120");

    // DK NJ spread
    expect(g.dkAwaySpread?.line).toBe("+6.5");
    expect(g.dkAwaySpread?.juice).toBe("-105");
    expect(g.dkHomeSpread?.line).toBe("-6.5");
    expect(g.dkHomeSpread?.juice).toBe("-106");

    // Open total
    expect(g.openOver?.line).toBe("o135.5");
    expect(g.openOver?.juice).toBe("-110");
    expect(g.openUnder?.line).toBe("u135.5");
    expect(g.openUnder?.juice).toBe("-110");

    // DK NJ total
    expect(g.dkOver?.line).toBe("o139.5");
    expect(g.dkOver?.juice).toBe("-110");
    expect(g.dkUnder?.line).toBe("u140.5");
    expect(g.dkUnder?.juice).toBe("-110");

    // Open ML
    expect(g.openAwayML?.line).toBe("+290");
    expect(g.openHomeML?.line).toBe("-375");

    // DK NJ ML
    expect(g.dkAwayML?.line).toBe("+255");
    expect(g.dkHomeML?.line).toBe("-275");
  });

  it("detects DK column dynamically from logo alt text", () => {
    const html = buildMinimalGameHtml();
    const result = parseAnAllMarketsHtml(html);
    // DK logo is in column 2 (index 2) in our synthetic HTML
    expect(result.dkColumnIndex).toBe(2);
  });

  it("returns zero warnings for valid HTML", () => {
    const html = buildMinimalGameHtml();
    const result = parseAnAllMarketsHtml(html);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles multiple games correctly", () => {
    const html = buildMinimalGameHtml() + buildMinimalGameHtml();
    const result = parseAnAllMarketsHtml(html);
    expect(result.games).toHaveLength(2);
  });

  it("extracts total line without o/u prefix for DB storage", () => {
    const html = buildMinimalGameHtml();
    const result = parseAnAllMarketsHtml(html);
    const g = result.games[0];
    // The raw line includes the o/u prefix; the tRPC procedure strips it
    const rawOver = g.dkOver?.line ?? "";
    const dbTotal = rawOver.replace(/^[ou]/i, "");
    expect(dbTotal).toBe("139.5");
  });
});

describe("parseAnAllMarketsHtml - NBA", () => {
  it("parses NBA game with nba-game link (11 columns)", () => {
    const html = buildMinimalNbaGameHtml();
    const result = parseAnAllMarketsHtml(html, "nba");

    expect(result.games).toHaveLength(1);
    const g = result.games[0];

    expect(g.anGameId).toBe("281090");
    expect(g.awayName).toBe("Wizards");
    expect(g.homeName).toBe("Celtics");

    // Open spread
    expect(g.openAwaySpread?.line).toBe("+16.5");
    expect(g.openHomeSpread?.line).toBe("-16.5");

    // DK NJ spread
    expect(g.dkAwaySpread?.line).toBe("+20.5");
    expect(g.dkHomeSpread?.line).toBe("-20.5");

    // Open total
    expect(g.openOver?.line).toBe("o228.5");
    expect(g.openUnder?.line).toBe("u228.5");

    // DK NJ total
    expect(g.dkOver?.line).toBe("o233.5");
    expect(g.dkUnder?.line).toBe("u233.5");

    // Open ML
    expect(g.openAwayML?.line).toBe("+1100");
    expect(g.openHomeML?.line).toBe("-2200");

    // DK NJ ML
    expect(g.dkAwayML?.line).toBe("+1500");
    expect(g.dkHomeML?.line).toBe("-2400");
  });

  it("does not parse NBA game when sport is ncaab", () => {
    const html = buildMinimalNbaGameHtml();
    const result = parseAnAllMarketsHtml(html, "ncaab"); // wrong sport
    expect(result.games).toHaveLength(0); // nba-game link not matched
  });
});

describe("parseAnAllMarketsHtml - NHL", () => {
  it("parses NHL game with nhl-game link (11 columns)", () => {
    const html = buildMinimalNhlGameHtml();
    const result = parseAnAllMarketsHtml(html, "nhl");

    expect(result.games).toHaveLength(1);
    const g = result.games[0];

    expect(g.anGameId).toBe("263572");
    expect(g.awayName).toBe("Rangers");
    expect(g.homeName).toBe("Wild");

    // Open spread (puck line)
    expect(g.openAwaySpread?.line).toBe("+1.5");
    expect(g.openAwaySpread?.juice).toBe("-130");
    expect(g.openHomeSpread?.line).toBe("-1.5");
    expect(g.openHomeSpread?.juice).toBe("+106");

    // DK NJ spread
    expect(g.dkAwaySpread?.line).toBe("+1.5");
    expect(g.dkAwaySpread?.juice).toBe("-133");

    // Open total
    expect(g.openOver?.line).toBe("o6.5");
    expect(g.openUnder?.line).toBe("u6.5");

    // DK NJ total
    expect(g.dkOver?.line).toBe("o6.5");
    expect(g.dkUnder?.line).toBe("u6.5");

    // Open ML
    expect(g.openAwayML?.line).toBe("+195");
    expect(g.openHomeML?.line).toBe("-240");

    // DK NJ ML
    expect(g.dkAwayML?.line).toBe("+162");
    expect(g.dkHomeML?.line).toBe("-196");
  });

  it("does not parse NHL game when sport is nba", () => {
    const html = buildMinimalNhlGameHtml();
    const result = parseAnAllMarketsHtml(html, "nba"); // wrong sport
    expect(result.games).toHaveLength(0); // nhl-game link not matched
  });
});
