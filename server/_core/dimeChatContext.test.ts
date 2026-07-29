import { describe, expect, it, vi } from "vitest";

const mysqlMocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: mysqlMocks.createPool,
  },
}));

import { formatDimeGameContext, getDimeChatContext } from "./dimeChatContext";

describe("Dime Chat TiDB context formatting", () => {
  it("formats grounded platform rows for the LLM without inventing missing fields", () => {
    const context = formatDimeGameContext(
      [
        {
          sport: "MLB",
          gameDate: "2026-07-10",
          startTimeEst: "7:05 PM",
          awayTeam: "Yankees",
          homeTeam: "Red Sox",
          awayBookSpread: "+1.5",
          awayModelSpread: "+0.4",
          homeBookSpread: "-1.5",
          homeModelSpread: "-0.4",
          bookTotal: "8.5",
          modelTotal: "9.1",
          spreadEdge: "Yankees +1.5",
          spreadDiff: "1.1",
          totalEdge: "Over",
          totalDiff: "0.6",
          awayML: "+120",
          homeML: "-140",
          modelAwayML: "+105",
          modelHomeML: "-105",
          modelAwayScore: "4.55",
          modelHomeScore: "4.52",
          modelOverRate: "56.25",
          modelUnderRate: "43.75",
          modelAwayWinPct: "49.10",
          modelHomeWinPct: "50.90",
          awayStartingPitcher: "Ace Away",
          homeStartingPitcher: "Ace Home",
          awayPitcherConfirmed: 1,
          homePitcherConfirmed: 0,
          awayGoalie: null,
          homeGoalie: null,
          awayGoalieConfirmed: null,
          homeGoalieConfirmed: null,
          modelRunAt: 1783728000000,
        },
      ] as never,
      new Date("2026-07-10T12:00:00.000Z"),
    );

    expect(context).toContain("Dime platform context generated_at=2026-07-10T12:00:00.000Z");
    expect(context).toContain("Yankees at Red Sox");
    expect(context).toContain("Market: spread Yankees +1.5 / Red Sox -1.5; total 8.5");
    expect(context).toContain("Model: spread Yankees +0.4 / Red Sox -0.4; total 9.1");
    expect(context).toContain("Edges: spread=Yankees +1.5 diff=1.1; total=Over diff=0.6");
    expect(context).toContain("Pitchers: Ace Away (confirmed) vs Ace Home (projected)");
  });

  it("uses a trusted literal context cap instead of binding a prepared LIMIT value", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";

    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockResolvedValueOnce([[]]);

    try {
      await getDimeChatContext(new Date("2026-07-10T12:00:00.000Z"));
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }

    expect(mysqlMocks.execute).toHaveBeenCalledOnce();

    const [statement, parameters] = mysqlMocks.execute.mock.calls[0] as [
      string,
      unknown[],
    ];

    expect(statement).toMatch(/LIMIT 12\s*$/);
    expect(statement).not.toContain("LIMIT ?");
    expect(parameters).toEqual(["2026-07-10", "2026-07-13"]);
  });
});
