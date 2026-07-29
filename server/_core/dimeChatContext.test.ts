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

import {
  formatDimeGameContext,
  getDimeChatContext,
  selectDimeContextRows,
} from "./dimeChatContext";
import { planDimeAnswerRoute } from "./dimeAnswerRouting";

describe("Dime Chat TiDB context formatting", () => {
  const gameRow = (
    id: number,
    gameDate: string,
    gameNumber = 1,
    overrides: Record<string, unknown> = {}
  ) =>
    ({
      id,
      sport: "MLB",
      gameDate,
      startTimeEst: "7:00 PM",
      gameNumber,
      awayTeam: "Seattle Mariners",
      homeTeam: "Los Angeles Dodgers",
      modelRunAt: null,
      ...overrides,
    }) as never;

  it("formats grounded platform rows for the LLM without inventing missing fields", () => {
    const context = formatDimeGameContext(
      [
        {
          id: 42,
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
          awaySpreadOdds: "-105",
          homeSpreadOdds: "-115",
          overOdds: "-108",
          underOdds: "-112",
          openAwaySpread: "+2.5",
          openAwaySpreadOdds: "-110",
          openHomeSpread: "-2.5",
          openHomeSpreadOdds: "-110",
          openTotal: "9.0",
          openOverOdds: "-110",
          openUnderOdds: "-110",
          openAwayML: "+130",
          openHomeML: "-150",
          spreadAwayBetsPct: 38,
          spreadAwayMoneyPct: 61,
          totalOverBetsPct: 55,
          totalOverMoneyPct: 49,
          mlAwayBetsPct: 42,
          mlAwayMoneyPct: 58,
          oddsSource: "dk",
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
      new Date("2026-07-10T12:00:00.000Z")
    );

    expect(context).toContain(
      "Dime platform context generated_at=2026-07-10T12:00:00.000Z"
    );
    expect(context).toContain("event_id=42 MLB");
    expect(context).toContain("Yankees at Red Sox");
    expect(context).toContain(
      "Current market: spread Yankees +1.5 (-105) / Red Sox -1.5 (-115); total 8.5 over -108 / under -112"
    );
    expect(context).toContain(
      "Opening market: spread Yankees +2.5 (-110) / Red Sox -2.5 (-110); total 9.0"
    );
    expect(context).toContain(
      "Provider-scoped splits: spread away bets=38% money=61%"
    );
    expect(context).toContain(
      "Model: spread Yankees +0.4 / Red Sox -0.4; total 9.1"
    );
    expect(context).toContain(
      "Edges: spread=Yankees +1.5 diff=1.1; total=Over diff=0.6"
    );
    expect(context).toContain(
      "Pitchers: Ace Away (confirmed) vs Ace Home (projected)"
    );
    expect(context).toContain("oddsSource=dk");
    expect(context).toContain("marketObservedAt=unavailable");
  });

  it("prioritizes a named matchup outside the default first 64 candidates", () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      sport: "MLB",
      gameDate: "2026-07-10",
      startTimeEst: "7:00 PM",
      awayTeam: index === 79 ? "Seattle Mariners" : `Away ${index}`,
      homeTeam: index === 79 ? "Boston Red Sox" : `Home ${index}`,
    })) as never;

    const selected = selectDimeContextRows(
      rows,
      "Break down Mariners at Red Sox",
      12
    );

    expect(selected).toHaveLength(12);
    expect(selected[0].id).toBe(80);
    expect(selected[0].awayTeam).toBe("Seattle Mariners");
  });

  it("bypasses the games database for platform and educational requests", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";
    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockClear();

    try {
      const platform = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "What can Dime AI help me with?"
      );
      const educational = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "Explain no-vig probability with a hypothetical example."
      );

      expect(platform.route.mode).toBe("platform");
      expect(platform.grounding).toBe("catalog_only");
      expect(platform.rowCount).toBe(0);
      expect(educational.route.mode).toBe("educational");
      expect(educational.grounding).toBe("none");
      expect(educational.rowCount).toBe(0);
      expect(mysqlMocks.execute).not.toHaveBeenCalled();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("retrieves one exact matchup and excludes a nearby event", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";
    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockClear();
    mysqlMocks.execute.mockResolvedValueOnce([
      [
        gameRow(101, "2026-07-28", 1, {
          awayML: "-110",
          bookTotal: "8.5",
        }),
        gameRow(102, "2026-07-29"),
      ],
    ]);

    try {
      const result = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "Analyze SEA vs LAD in MLB on July 28, 2026"
      );

      expect(result.route.mode).toBe("matchup");
      expect(result.resolution.kind).toBe("exact");
      expect(result.grounding).toBe("full_event");
      expect(result.eventIds).toEqual([101]);
      expect(result.context).toContain("result=exact");
      expect(result.context).toContain("event_id=101");
      expect(result.context).not.toContain("event_id=102");
      expect(result.supportedNumericValues).toEqual(
        expect.arrayContaining(["-110", "8.5"])
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("returns nearby and ambiguous candidates as identity-only evidence", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";
    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockClear();
    mysqlMocks.execute
      .mockResolvedValueOnce([[gameRow(201, "2026-07-29")]])
      .mockResolvedValueOnce([
        [gameRow(202, "2026-07-28", 1), gameRow(203, "2026-07-28", 2)],
      ]);

    try {
      const nearby = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "Analyze SEA vs LAD in MLB on July 28, 2026"
      );
      const ambiguous = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "Analyze SEA vs LAD in MLB on July 28, 2026"
      );

      expect(nearby.resolution.kind).toBe("nearby");
      expect(nearby.grounding).toBe("identity_only");
      expect(nearby.context).toContain("result=nearby");
      expect(nearby.context).not.toContain("Current market:");
      expect(ambiguous.resolution.kind).toBe("ambiguous");
      expect(ambiguous.grounding).toBe("identity_only");
      expect(ambiguous.eventIds).toEqual([202, 203]);
      expect(ambiguous.context).not.toContain("Current market:");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("labels an unresolved matchup with unrelated candidates as ungrounded", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";
    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockClear();
    mysqlMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 204,
          sport: "MLB",
          gameDate: "2026-07-28",
          startTimeEst: "7:00 PM",
          gameNumber: 1,
          awayTeam: "Boston Red Sox",
          homeTeam: "New York Yankees",
          modelRunAt: null,
        } as never,
      ],
    ]);

    try {
      const result = await getDimeChatContext(
        new Date("2026-07-28T12:00:00.000Z"),
        "Analyze SEA vs LAD in MLB on July 28, 2026"
      );
      expect(result.resolution.kind).toBe("missing");
      expect(result.grounding).toBe("none");
      expect(result.rowCount).toBe(0);
      expect(result.eventIds).toEqual([]);
      expect(result.context).toContain("result=missing");
      expect(result.context).not.toContain("Current market:");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("uses a trusted literal context cap instead of binding a prepared LIMIT value", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";

    mysqlMocks.createPool.mockReturnValue({
      execute: mysqlMocks.execute,
    });
    mysqlMocks.execute.mockClear();
    mysqlMocks.execute.mockResolvedValueOnce([[]]);

    try {
      const now = new Date("2026-07-10T12:00:00.000Z");
      await getDimeChatContext(
        now,
        "",
        planDimeAnswerRoute("", now, {
          DIME_ANSWER_ROUTING_V1_ENABLED: "false",
        })
      );
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

    expect(statement).toMatch(/LIMIT 64\s*$/);
    expect(statement).not.toContain("LIMIT ?");
    expect(parameters).toEqual(["2026-07-10", "2026-07-13"]);
  });

  it("parameterizes requested teams into SQL ordering and labels untimestamped evidence delayed", async () => {
    const previousDatabaseUrl = process.env.DIME_CHAT_DATABASE_URL;
    process.env.DIME_CHAT_DATABASE_URL = "mysql://localhost:3306/dime";
    mysqlMocks.execute.mockClear();
    mysqlMocks.execute.mockResolvedValueOnce([
      [
        {
          id: 80,
          sport: "MLB",
          gameDate: "2026-07-10",
          startTimeEst: "7:00 PM",
          awayTeam: "Seattle Mariners",
          homeTeam: "Boston Red Sox",
          modelRunAt: null,
        },
      ],
    ]);

    let result;
    try {
      result = await getDimeChatContext(
        new Date("2026-07-10T12:00:00.000Z"),
        "Analyze Mariners vs Red Sox"
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DIME_CHAT_DATABASE_URL;
      } else {
        process.env.DIME_CHAT_DATABASE_URL = previousDatabaseUrl;
      }
    }

    const [statement, parameters] = mysqlMocks.execute.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(statement).toContain("ORDER BY CASE WHEN");
    expect(statement).not.toContain("Mariners");
    expect(parameters).toEqual([
      "2026-07-10",
      "2026-07-13",
      "MLB",
      "%mariners%",
      "%mariners%",
      "%red%",
      "%red%",
      "%sox%",
      "%sox%",
    ]);
    expect(result.freshness).toBe("delayed");
    expect(result.eventIds).toEqual([80]);
  });
});
