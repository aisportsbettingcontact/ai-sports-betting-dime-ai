import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  detectSportFromFilename,
  detectDateFromFilename,
  formatTeamName,
} from "./fileParser";

// ─── Unit tests for helpers ───────────────────────────────────────────────────

describe("detectSportFromFilename", () => {
  it("detects NCAAM from filename", () => {
    expect(detectSportFromFilename("NCAAMModel-03-02-2026.csv")).toBe("NCAAM");
  });
  it("detects NBA from filename", () => {
    expect(detectSportFromFilename("NBAModel-03-02-2026.xlsx")).toBe("NBA");
  });
  it("defaults to NCAAM for unknown", () => {
    expect(detectSportFromFilename("model.csv")).toBe("NCAAM");
  });
});

describe("detectDateFromFilename", () => {
  it("parses MM-DD-YYYY from filename", () => {
    expect(detectDateFromFilename("NCAAMModel-03-02-2026.csv")).toBe(
      "2026-03-02"
    );
  });
  it("returns null for no date", () => {
    expect(detectDateFromFilename("model.csv")).toBeNull();
  });
});

describe("formatTeamName", () => {
  it("converts snake_case to Title Case", () => {
    expect(formatTeamName("nc_state")).toBe("Nc State");
    expect(formatTeamName("duke")).toBe("Duke");
    expect(formatTeamName("iowa_state")).toBe("Iowa State");
  });
});

// ─── CSV parsing ─────────────────────────────────────────────────────────────

const SAMPLE_CSV = `date,start_time_est,away_team,away_book_spread,away_model_spread,home_team,home_book_spread,book_total,home_model_spread,model_total,spread_edge,spread_diff,total_edge,total_diff
03022026,1900,duke,-9.5,-11.0,nc_state,9.5,150.5,11.0,148.5,duke,1.5,UNDER 148.5,2.0
03022026,2100,iowa_state,-5.5,-7.0,marquette,5.5,145.0,7.0,143.0,PASS,0,PASS,0`;

describe("parseCsvBuffer", () => {
  it("parses valid CSV with 2 games", () => {
    const buf = Buffer.from(SAMPLE_CSV, "utf-8");
    const games = parseCsvBuffer(buf, 1, "NCAAM");
    expect(games).toHaveLength(2);
  });

  it("correctly maps game fields", () => {
    const buf = Buffer.from(SAMPLE_CSV, "utf-8");
    const [g] = parseCsvBuffer(buf, 1, "NCAAM");
    expect(g!.awayTeam).toBe("duke");
    expect(g!.homeTeam).toBe("nc_state");
    expect(g!.gameDate).toBe("2026-03-02");
    expect(g!.startTimeEst).toBe("19:00");
    expect(g!.sport).toBe("NCAAM");
    expect(g!.fileId).toBe(1);
    expect(g!.spreadEdge).toBe("duke");
    expect(g!.totalEdge).toBe("UNDER 148.5");
  });

  it("handles PASS rows correctly", () => {
    const buf = Buffer.from(SAMPLE_CSV, "utf-8");
    const games = parseCsvBuffer(buf, 1, "NCAAM");
    const passGame = games[1]!;
    expect(passGame.spreadEdge).toBe("PASS");
    expect(passGame.totalEdge).toBe("PASS");
  });

  it("throws on invalid header", () => {
    const bad = `wrong,headers\nfoo,bar`;
    const buf = Buffer.from(bad, "utf-8");
    expect(() => parseCsvBuffer(buf, 1, "NCAAM")).toThrow();
  });

  it("skips empty rows", () => {
    const withEmpty = SAMPLE_CSV + "\n,,,,,,,,,,,,,";
    const buf = Buffer.from(withEmpty, "utf-8");
    const games = parseCsvBuffer(buf, 1, "NCAAM");
    expect(games).toHaveLength(2);
  });
});

// ─── XLSX parsing (real file) ─────────────────────────────────────────────────

const XLSX_PATH = path.join(__dirname, "../upload/NCAAMModel.xlsx");

describe("parseXlsxBuffer (real file)", () => {
  it("parses the 03-02-2026 sheet from the real XLSX", () => {
    if (!fs.existsSync(XLSX_PATH)) {
      console.warn("Skipping XLSX test — file not found at", XLSX_PATH);
      return;
    }
    const buf = fs.readFileSync(XLSX_PATH);
    const games = parseXlsxBuffer(buf, 99, "NCAAM");
    expect(games.length).toBeGreaterThan(0);
    // All games should have required fields
    for (const g of games) {
      expect(g.awayTeam).toBeTruthy();
      expect(g.homeTeam).toBeTruthy();
      expect(g.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.sport).toBe("NCAAM");
    }
  });
});
