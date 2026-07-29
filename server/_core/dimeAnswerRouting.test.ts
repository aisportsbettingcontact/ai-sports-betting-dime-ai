import { describe, expect, it } from "vitest";
import type { DimeChatMessage } from "./dimeChatModel";
import {
  DIME_ANSWER_ROUTING_VERSION,
  DIME_PLATFORM_TIME_ZONE,
  addDimeCalendarDays,
  applyDimeAnswerRoute,
  collectDimeNumericValues,
  hashDimeAnswerSystemPrompt,
  isDimeAnswerRoutingEnabled,
  matchDimeTeamAliases,
  normalizeDimeSearchText,
  parseDimeLeagueAliases,
  parseDimeRequestedDate,
  planDimeAnswerRoute,
  renderPlatformCapabilitiesFallback,
  resolveDimeEvent,
  validateDimeResponseCompleteness,
  type DimeAnswerEvidence,
  type DimeAnswerRoute,
  type DimeResolvableGame,
} from "./dimeAnswerRouting";

const ET_LATE_JULY_28 = new Date("2026-07-29T03:30:00.000Z");

function messages(content: string): DimeChatMessage[] {
  return [{ role: "user", content }];
}

function game(
  id: number,
  gameDate: string,
  awayTeam: string,
  homeTeam: string,
  options: {
    sport?: string;
    startTimeEst?: string;
    gameNumber?: number | null;
  } = {}
): DimeResolvableGame {
  return {
    id,
    sport: options.sport ?? "MLB",
    gameDate,
    startTimeEst: options.startTimeEst ?? "7:10 PM",
    gameNumber: options.gameNumber ?? null,
    awayTeam,
    homeTeam,
  };
}

function evidence(
  route: DimeAnswerRoute,
  rows: DimeResolvableGame[],
  freshness: DimeAnswerEvidence["freshness"] = "delayed"
): DimeAnswerEvidence {
  const resolved = resolveDimeEvent(rows, route);
  return {
    route,
    resolution: resolved.resolution,
    freshness,
    grounding:
      resolved.resolution.kind === "exact"
        ? "full_event"
        : resolved.resolution.kind === "nearby" ||
            resolved.resolution.kind === "ambiguous"
          ? "identity_only"
          : "none",
    rowCount: resolved.selectedRows.length,
    retrievalCandidateCount: rows.length,
    retrievalLatencyMs: 4,
    supportedNumericValues: collectDimeNumericValues([
      route.normalizedQuery,
      ...rows.flatMap(row => Object.values(row)),
    ]),
  };
}

describe("Dime Answer Routing v1 mode contract", () => {
  it.each([
    {
      prompt: "What can Dime AI currently help me with across the platform?",
      mode: "platform",
      scope: "capabilities",
      cap: 0,
    },
    {
      prompt: "Break down SEA vs LAD tonight in MLB.",
      mode: "matchup",
      scope: "not_applicable",
      cap: 2,
    },
    {
      prompt: "Rank the MLB slate tonight.",
      mode: "slate",
      scope: "not_applicable",
      cap: 12,
    },
    {
      prompt: "Explain implied probability using a hypothetical example.",
      mode: "educational",
      scope: "not_applicable",
      cap: 0,
    },
  ] as const)(
    "routes $mode prompts with the mode-specific retrieval cap",
    ({ prompt, mode, scope, cap }) => {
      const route = planDimeAnswerRoute(prompt, ET_LATE_JULY_28, {});

      expect(route).toMatchObject({
        version: DIME_ANSWER_ROUTING_VERSION,
        enabled: true,
        mode,
        platformScope: scope,
        retrievalCap: cap,
        retrievalBypassed: cap === 0,
      });
    }
  );

  it("keeps request messages outside the pure routing API", () => {
    const history = messages("What can Dime do?");
    const route = planDimeAnswerRoute(
      history.at(-1)?.content ?? "",
      ET_LATE_JULY_28,
      {}
    );
    expect(route.mode).toBe("platform");
    expect(route.normalizedQuery).toBe("what can dime do");
  });
});

describe("Dime Answer Routing v1 Eastern Time date parsing", () => {
  it("pins the platform calendar to America/New_York", () => {
    expect(DIME_PLATFORM_TIME_ZONE).toBe("America/New_York");
    expect(
      parseDimeRequestedDate(
        "tonight",
        ET_LATE_JULY_28,
        DIME_PLATFORM_TIME_ZONE
      )
    ).toEqual({
      source: "relative",
      requestedDate: "2026-07-28",
      candidates: ["2026-07-28"],
    });
  });

  it.each([
    ["SEA at LAD on 2026-07-28", "2026-07-28"],
    ["SEA at LAD on Jul 28", "2026-07-28"],
    ["SEA at LAD on July 28", "2026-07-28"],
    ["SEA at LAD on 7/28", "2026-07-28"],
    ["SEA at LAD on 7/28/26", "2026-07-28"],
  ])("parses %s deterministically", (prompt, expected) => {
    expect(parseDimeRequestedDate(prompt, ET_LATE_JULY_28)).toEqual({
      source: "explicit",
      requestedDate: expected,
      candidates: [expected],
    });
  });

  it("resolves tonight and tomorrow against the ET date, not UTC", () => {
    expect(
      parseDimeRequestedDate("games tonight", ET_LATE_JULY_28).requestedDate
    ).toBe("2026-07-28");
    expect(
      parseDimeRequestedDate("games tomorrow", ET_LATE_JULY_28).requestedDate
    ).toBe("2026-07-29");
    expect(addDimeCalendarDays("2026-07-28", 1)).toBe("2026-07-29");
  });

  it("fails closed on an invalid calendar date", () => {
    expect(
      parseDimeRequestedDate("SEA at LAD on 2026-02-30", ET_LATE_JULY_28)
    ).toEqual({
      source: "invalid",
      candidates: [],
    });
  });

  it("preserves conflicting date interpretations as ambiguous", () => {
    expect(
      parseDimeRequestedDate("SEA at LAD tonight or tomorrow", ET_LATE_JULY_28)
    ).toEqual({
      source: "ambiguous",
      candidates: ["2026-07-28", "2026-07-29"],
    });
    expect(
      parseDimeRequestedDate(
        "SEA at LAD on July 28 or 7/29/2026",
        ET_LATE_JULY_28
      )
    ).toEqual({
      source: "ambiguous",
      candidates: ["2026-07-28", "2026-07-29"],
    });
  });
});

describe("Dime Answer Routing v1 team and league identity", () => {
  it.each([
    ["SEA", "Seattle Mariners"],
    ["Mariners", "Seattle Mariners"],
    ["Seattle Mariners", "Seattle Mariners"],
    ["LAD", "Los Angeles Dodgers"],
    ["Dodgers", "Los Angeles Dodgers"],
    ["Los Angeles Dodgers", "Los Angeles Dodgers"],
  ])("maps MLB alias %s to %s", (alias, expectedName) => {
    const matches = matchDimeTeamAliases(alias, "MLB");
    expect(matches.map(match => match.name)).toContain(expectedName);
  });

  it("requires token boundaries for short aliases and rejects adversarial collisions", () => {
    expect(matchDimeTeamAliases("SEAfood vs LADder", "MLB")).toEqual([]);
    expect(
      matchDimeTeamAliases(
        "The seaside ladder has no baseball matchup in it.",
        "MLB"
      )
    ).toEqual([]);
    expect(normalizeDimeSearchText("SÉA@LAD")).toBe("sea lad");
  });

  it("uses an explicit league to disambiguate shared nicknames", () => {
    const nhl = planDimeAnswerRoute(
      "NHL Kings vs Rangers tonight",
      ET_LATE_JULY_28,
      {}
    );
    expect(nhl.league).toBe("NHL");
    expect(nhl.teamCandidates.map(team => team.name)).toEqual([
      "Los Angeles Kings",
      "New York Rangers",
    ]);

    const mlb = planDimeAnswerRoute(
      "MLB Giants vs Cardinals tonight",
      ET_LATE_JULY_28,
      {}
    );
    expect(mlb.league).toBe("MLB");
    expect(mlb.teamCandidates.map(team => team.name)).toEqual([
      "San Francisco Giants",
      "St. Louis Cardinals",
    ]);
  });

  it("disambiguates shared nicknames when the complete pair identifies one league", () => {
    const route = planDimeAnswerRoute(
      "Kings vs Rangers tonight",
      ET_LATE_JULY_28,
      {}
    );
    expect(route.mode).toBe("matchup");
    expect(route.league).toBe("NHL");
    expect(route.leagueCandidates).toEqual(
      expect.arrayContaining(["MLB", "NBA", "NHL"])
    );
    expect(route.teamCandidates.map(team => team.name)).toEqual([
      "Los Angeles Kings",
      "New York Rangers",
    ]);
  });

  it("parses league aliases without substring collisions", () => {
    expect(parseDimeLeagueAliases("MLB baseball tonight")).toEqual(["MLB"]);
    expect(parseDimeLeagueAliases("college basketball tomorrow")).toEqual([
      "NCAAM",
    ]);
    expect(parseDimeLeagueAliases("The basketballs are in a basket")).toEqual(
      []
    );
  });

  it.each([
    ["KC vs BUF in the NFL", ["Buffalo Bills", "Kansas City Chiefs"]],
    ["Chiefs vs Bills in the NFL", ["Buffalo Bills", "Kansas City Chiefs"]],
  ])("maps source-backed NFL aliases in %s", (prompt, expectedNames) => {
    const route = planDimeAnswerRoute(prompt, ET_LATE_JULY_28, {});
    expect(route.league).toBe("NFL");
    expect(route.teamCandidates.map(team => team.name)).toEqual(expectedNames);
  });

  it.each([
    ["ALA vs UGA in NCAAF", ["Alabama Crimson Tide", "Georgia Bulldogs"]],
    [
      "Alabama vs Georgia in college football",
      ["Alabama Crimson Tide", "Georgia Bulldogs"],
    ],
  ])("maps source-backed NCAAF aliases in %s", (prompt, expectedNames) => {
    const route = planDimeAnswerRoute(prompt, ET_LATE_JULY_28, {});
    expect(route.league).toBe("NCAAF");
    expect(route.teamCandidates.map(team => team.name)).toEqual(expectedNames);
  });

  it("fails closed for WNBA until a governed team registry exists", () => {
    const route = planDimeAnswerRoute(
      "Rank the WNBA slate tonight",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [game(91, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers")],
      route
    );
    expect(route).toMatchObject({
      mode: "slate",
      unsupportedLeague: "WNBA",
      retrievalBypassed: true,
    });
    expect(route.league).toBeUndefined();
    expect(route.teamCandidates).toEqual([]);
    expect(result.resolution).toMatchObject({
      kind: "missing",
      reason: "unsupported_league_wnba",
    });
    expect(result.selectedRows).toEqual([]);
  });
});

describe("Dime Answer Routing v1 event resolution", () => {
  it("resolves one exact matchup on the requested date", () => {
    const route = planDimeAnswerRoute(
      "SEA vs LAD on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [
        game(11, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers"),
        game(12, "2026-07-28", "Boston Red Sox", "New York Yankees"),
      ],
      route
    );

    expect(result.resolution).toMatchObject({
      kind: "exact",
      candidateEventIds: [11],
      confidence: 0.99,
      reason: "one_exact_event",
    });
    expect(result.selectedRows.map(row => row.id)).toEqual([11]);
  });

  it("resolves an explicitly requested doubleheader game number exactly", () => {
    const route = planDimeAnswerRoute(
      "SEA vs LAD game 1 on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [
        game(21, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
          startTimeEst: "1:10 PM",
          gameNumber: 1,
        }),
        game(22, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
          startTimeEst: "7:10 PM",
          gameNumber: 2,
        }),
      ],
      route
    );

    expect(result.resolution).toMatchObject({
      kind: "exact",
      candidateEventIds: [21],
      reason: "one_exact_event",
    });
    expect(result.selectedRows.map(row => row.id)).toEqual([21]);
  });

  it("preserves an unspecified doubleheader as ambiguous and bounded", () => {
    const route = planDimeAnswerRoute(
      "SEA vs LAD on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [
        game(31, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
          startTimeEst: "1:10 PM",
          gameNumber: 1,
        }),
        game(32, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
          startTimeEst: "7:10 PM",
          gameNumber: 2,
        }),
        game(33, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
          startTimeEst: "9:10 PM",
          gameNumber: 3,
        }),
      ],
      route
    );

    expect(result.resolution.kind).toBe("ambiguous");
    expect(result.resolution.candidateEventIds).toEqual([31, 32]);
    expect(result.selectedRows).toHaveLength(2);
  });

  it("returns nearby without treating an adjacent-date event as exact", () => {
    const route = planDimeAnswerRoute(
      "SEA vs LAD on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [game(41, "2026-07-29", "Seattle Mariners", "Los Angeles Dodgers")],
      route
    );

    expect(result.resolution).toMatchObject({
      kind: "nearby",
      candidateEventIds: [41],
      confidence: 0.85,
      reason: "one_adjacent_date_event",
    });
  });

  it("returns missing rather than substituting an unrelated event", () => {
    const route = planDimeAnswerRoute(
      "SEA vs LAD on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [game(51, "2026-07-28", "Boston Red Sox", "New York Yankees")],
      route
    );

    expect(result.resolution).toMatchObject({
      kind: "missing",
      selected: [],
      candidateEventIds: [],
      reason: "requested_event_not_found",
    });
    expect(result.selectedRows).toEqual([]);
  });

  it("does not resolve across an explicitly different league", () => {
    const route = planDimeAnswerRoute(
      "MLB Giants vs Cardinals on July 28",
      ET_LATE_JULY_28,
      {}
    );
    const result = resolveDimeEvent(
      [
        game(61, "2026-07-28", "San Francisco Giants", "St. Louis Cardinals", {
          sport: "NCAAM",
        }),
      ],
      route
    );
    expect(result.resolution.kind).toBe("missing");
  });
});

describe("Dime Answer Routing v1 retrieval bounds and rollback", () => {
  it("caps matchup, slate, and bypass modes deterministically", () => {
    const matchup = planDimeAnswerRoute(
      "SEA vs LAD on July 28 in MLB",
      ET_LATE_JULY_28,
      {}
    );
    const matchupRows = Array.from({ length: 6 }, (_, index) =>
      game(
        100 + index,
        "2026-07-28",
        "Seattle Mariners",
        "Los Angeles Dodgers",
        { startTimeEst: `${index + 1}:00 PM`, gameNumber: index + 1 }
      )
    );
    expect(resolveDimeEvent(matchupRows, matchup).selectedRows).toHaveLength(2);

    const slate = planDimeAnswerRoute(
      "Rank the MLB slate tonight",
      ET_LATE_JULY_28,
      {}
    );
    const slateRows = Array.from({ length: 20 }, (_, index) =>
      game(
        200 + index,
        "2026-07-28",
        `Away Team ${index}`,
        `Home Team ${index}`
      )
    );
    expect(resolveDimeEvent(slateRows, slate).selectedRows).toHaveLength(12);

    for (const prompt of [
      "What can Dime currently help me with?",
      "Explain no-vig probability.",
    ]) {
      const route = planDimeAnswerRoute(prompt, ET_LATE_JULY_28, {});
      expect(route.retrievalCap).toBe(0);
      expect(resolveDimeEvent(slateRows, route).selectedRows).toEqual([]);
    }
  });

  it("uses the exact false kill switch and preserves the legacy 12-row path", () => {
    expect(isDimeAnswerRoutingEnabled({})).toBe(true);
    expect(
      isDimeAnswerRoutingEnabled({
        DIME_ANSWER_ROUTING_V1_ENABLED: " FALSE ",
      })
    ).toBe(false);

    const route = planDimeAnswerRoute(
      "What can Dime currently help me with?",
      ET_LATE_JULY_28,
      { DIME_ANSWER_ROUTING_V1_ENABLED: "false" }
    );
    const rows = Array.from({ length: 20 }, (_, index) =>
      game(
        300 + index,
        "2026-07-28",
        `Away Team ${index}`,
        `Home Team ${index}`
      )
    );
    expect(route).toMatchObject({
      enabled: false,
      retrievalCap: 12,
      retrievalBypassed: false,
    });
    expect(resolveDimeEvent(rows, route).selectedRows).toHaveLength(12);
  });
});

describe("Dime Answer Routing v1 system prompt contract", () => {
  it("leaves the legacy system prompt byte-identical when disabled", () => {
    const base = "  Canonical Dime system prompt.  ";
    const route = planDimeAnswerRoute("SEA vs LAD", ET_LATE_JULY_28, {
      DIME_ANSWER_ROUTING_V1_ENABLED: "false",
    });
    expect(applyDimeAnswerRoute(base, route)).toBe(base);
  });

  it.each([
    ["What can Dime do?", "platform"],
    ["SEA vs LAD odds tonight", "matchup"],
    ["Rank the MLB slate tonight", "slate"],
    ["Explain no-vig probability", "educational"],
  ] as const)("appends one versioned %s mode block", (prompt, mode) => {
    const route = planDimeAnswerRoute(prompt, ET_LATE_JULY_28, {});
    const system = applyDimeAnswerRoute("Canonical prompt.", route);

    expect(route.mode).toBe(mode);
    expect(system).toContain(
      `DIME_RUNTIME_ANSWER_ROUTING version=${DIME_ANSWER_ROUTING_VERSION}`
    );
    expect(system).toContain(`RUNTIME ANSWER ROUTE: ${mode}`);
    expect(system.match(/DIME_RUNTIME_ANSWER_ROUTING version=/g)).toHaveLength(
      1
    );
    expect(hashDimeAnswerSystemPrompt(system)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDimeAnswerSystemPrompt(system)).toBe(
      hashDimeAnswerSystemPrompt(system)
    );
  });
});

describe("Dime Answer Routing v1 platform completeness", () => {
  const broadRoute = planDimeAnswerRoute(
    "What can Dime AI currently help me with? Separate what is available and unavailable.",
    ET_LATE_JULY_28,
    {}
  );
  const broadEvidence = evidence(broadRoute, []);

  it("accepts the canonical deterministic platform fallback", () => {
    const fallback = renderPlatformCapabilitiesFallback();
    expect(validateDimeResponseCompleteness(broadEvidence, fallback)).toEqual({
      status: "passed",
      errorCodes: [],
    });
  });

  it("rejects the audited incomplete platform response and supplies the safe fallback", () => {
    const result = validateDimeResponseCompleteness(
      broadEvidence,
      "Dime can provide sports-betting explanations. Please provide a game and numbers."
    );

    expect(result.status).toBe("failed");
    expect(result.errorCodes).toEqual(
      expect.arrayContaining([
        "missing_section_chat_now",
        "missing_section_elsewhere",
        "missing_section_unavailable",
        "missing_feature_model_projections",
        "missing_feature_splits_history",
        "missing_feature_trends",
        "missing_feature_bet_tracker",
        "missing_feature_prop_projections",
        "missing_authenticated_access_boundary",
        "missing_owner_access_boundary",
      ])
    );
    expect(result.safeFallback).toBe(renderPlatformCapabilitiesFallback());
  });

  it.each([
    [
      "Dime can access your Bet Tracker and review your betting history.",
      "unsupported_bet_tracker_chat_access",
    ],
    [
      "Prop Projections are currently available as a live feature.",
      "unsupported_prop_projections_availability",
    ],
    [
      "Betting Splits and Odds History are public to everyone.",
      "unsupported_splits_public_access",
    ],
    ["Dime can place a bet for you.", "unsupported_wager_execution"],
  ])("blocks unsupported platform claim: %s", (output, expectedCode) => {
    const featureRoute = planDimeAnswerRoute(
      "What platform capabilities are available?",
      ET_LATE_JULY_28,
      {}
    );
    const result = validateDimeResponseCompleteness(
      evidence(featureRoute, []),
      output
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain(expectedCode);
    expect(result.safeFallback).toBe(renderPlatformCapabilitiesFallback());
  });

  it("always serves the deterministic Bet Tracker boundary for personal-history requests", () => {
    const route = planDimeAnswerRoute(
      "Look at my Bet Tracker and tell me my strongest betting angle.",
      ET_LATE_JULY_28,
      {}
    );
    const result = validateDimeResponseCompleteness(
      evidence(route, []),
      "I reviewed your betting history. Your strongest sport is baseball."
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toEqual(
      expect.arrayContaining([
        "bet_tracker_history_requires_deterministic_fallback",
        "unsupported_bet_tracker_chat_access",
      ])
    );
    expect(result.safeFallback).toContain(
      "cannot currently read or review your Bet Tracker history"
    );
    expect(result.safeFallback).not.toContain("strongest sport");
  });

  it("always serves the deterministic account-state boundary for personal account requests", () => {
    const route = planDimeAnswerRoute(
      "What plan am I on and when does my subscription renew?",
      ET_LATE_JULY_28,
      {}
    );
    const result = validateDimeResponseCompleteness(
      evidence(route, []),
      "Your owner plan is active and renews July 31."
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toEqual(
      expect.arrayContaining([
        "account_state_requires_deterministic_fallback",
        "unsupported_personal_account_state",
      ])
    );
    expect(result.safeFallback).toContain(
      "cannot see or infer your current account plan"
    );
    expect(result.safeFallback).not.toContain("July 31");
  });

  it("accepts the governed authenticated access boundary for Model Projections", () => {
    const featureRoute = planDimeAnswerRoute(
      "Where can authenticated users access Model Projections?",
      ET_LATE_JULY_28,
      {}
    );
    expect(
      validateDimeResponseCompleteness(
        evidence(featureRoute, []),
        "AI Model Projections are available to authenticated users elsewhere in Dime when coverage exists."
      )
    ).toEqual({ status: "passed", errorCodes: [] });
  });

  it("does not enforce platform completeness when the kill switch is off", () => {
    const disabled = planDimeAnswerRoute(
      "What can Dime currently help me with?",
      ET_LATE_JULY_28,
      { DIME_ANSWER_ROUTING_V1_ENABLED: "false" }
    );
    expect(
      validateDimeResponseCompleteness(
        evidence(disabled, []),
        "Legacy response."
      )
    ).toEqual({
      status: "disabled",
      errorCodes: [],
    });
  });
});

describe("Dime Answer Routing v1 matchup completeness", () => {
  const exactRoute = planDimeAnswerRoute(
    "SEA vs LAD on July 28 in MLB",
    ET_LATE_JULY_28,
    {}
  );
  const exactRows = [
    game(401, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers"),
  ];

  it("requires both resolved teams and delayed-data disclosure", () => {
    const exactEvidence = evidence(exactRoute, exactRows);
    expect(
      validateDimeResponseCompleteness(
        exactEvidence,
        "Seattle Mariners at Los Angeles Dodgers. The Dime market evidence is delayed because its exact observation timestamp is unavailable."
      )
    ).toEqual({
      status: "passed",
      errorCodes: [],
    });

    const incomplete = validateDimeResponseCompleteness(
      exactEvidence,
      "Seattle Mariners are the play."
    );
    expect(incomplete.status).toBe("failed");
    expect(incomplete.errorCodes).toEqual(
      expect.arrayContaining(["missing_home_team", "missing_data_freshness"])
    );
  });

  it("rejects an unsupported team injected into an exact-event answer", () => {
    const result = validateDimeResponseCompleteness(
      evidence(exactRoute, exactRows),
      "Seattle Mariners at Los Angeles Dodgers is grounded in delayed Dime evidence, and the New York Yankees are also part of this matchup."
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain("unsupported_event_team");
  });

  it("allows supported inputs and their deterministic betting calculations", () => {
    const exactEvidence = {
      ...evidence(exactRoute, exactRows),
      supportedNumericValues: collectDimeNumericValues([
        ...evidence(exactRoute, exactRows).supportedNumericValues,
        "-110",
        "+120",
        "8.5",
        "55%",
        "45.45%",
      ]),
    };
    expect(
      validateDimeResponseCompleteness(
        exactEvidence,
        [
          "Seattle Mariners -110 at Los Angeles Dodgers with a total of 8.5, based on delayed Dime evidence.",
          "At -110, the implied probability is 52.38%.",
          "At -110 and +120, the no-vig probabilities are 53.54% and 46.46%.",
          "A supported 55% model probability has fair odds of -122.",
          "At +120 with a supported 55% model probability, EV and ROI are 21%.",
          "A supported 55% model probability versus a supported 45.45% market probability is a 9.55 percentage-point edge.",
        ].join(" ")
      )
    ).toEqual({ status: "passed", errorCodes: [] });
  });

  it("continues to reject fabricated exact-event market numbers", () => {
    const exactEvidence = {
      ...evidence(exactRoute, exactRows),
      supportedNumericValues: collectDimeNumericValues([
        ...evidence(exactRoute, exactRows).supportedNumericValues,
        "-110",
        "8.5",
      ]),
    };
    const fabricated = validateDimeResponseCompleteness(
      exactEvidence,
      "Seattle Mariners -999 at Los Angeles Dodgers with a total of 99.5, based on delayed Dime evidence."
    );
    expect(fabricated.status).toBe("failed");
    expect(fabricated.errorCodes).toContain("unsupported_numeric_claim");
  });

  it("requires requested and candidate dates for a nearby event", () => {
    const nearbyEvidence = evidence(exactRoute, [
      game(402, "2026-07-29", "Seattle Mariners", "Los Angeles Dodgers"),
    ]);
    const result = validateDimeResponseCompleteness(
      nearbyEvidence,
      "I found a nearby game."
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toEqual(
      expect.arrayContaining([
        "missing_nearby_date_check",
        "missing_requested_date",
        "missing_candidate_date",
      ])
    );
    expect(result.safeFallback).toContain("DATE CHECK:");
    expect(result.safeFallback).toContain("2026-07-28");
    expect(result.safeFallback).toContain("2026-07-29");
  });

  it("requires explicit ambiguity and missing-data notices", () => {
    const doubleheader = evidence(exactRoute, [
      game(403, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
        gameNumber: 1,
      }),
      game(404, "2026-07-28", "Seattle Mariners", "Los Angeles Dodgers", {
        gameNumber: 2,
      }),
    ]);
    const ambiguous = validateDimeResponseCompleteness(
      doubleheader,
      "Choose a game."
    );
    expect(ambiguous.errorCodes).toContain("missing_ambiguous_match_notice");
    expect(ambiguous.safeFallback).toContain("AMBIGUOUS MATCH:");

    const missing = evidence(exactRoute, [
      game(405, "2026-07-28", "Boston Red Sox", "New York Yankees"),
    ]);
    const noData = validateDimeResponseCompleteness(
      missing,
      "I could not find it."
    );
    expect(noData.errorCodes).toContain("missing_no_data_notice");
    expect(noData.safeFallback).toContain("NO DATA:");
  });

  it.each([
    [
      "nearby",
      evidence(exactRoute, [
        game(406, "2026-07-29", "Seattle Mariners", "Los Angeles Dodgers"),
      ]),
      "DATE CHECK: the requested date is 2026-07-28 and the candidate date is 2026-07-29. Bet Dodgers -150 because they have a 62% edge.",
      "DATE CHECK:",
    ],
    [
      "missing",
      evidence(exactRoute, [
        game(407, "2026-07-28", "Boston Red Sox", "New York Yankees"),
      ]),
      "NO DATA: the requested event is missing, but bet Dodgers -150 because they have a 62% edge.",
      "NO DATA:",
    ],
  ])(
    "replaces marker-prefixed malicious %s analysis with the deterministic fallback",
    (_label, routeEvidence, output, fallbackMarker) => {
      const result = validateDimeResponseCompleteness(routeEvidence, output);
      expect(result.status).toBe("failed");
      expect(result.errorCodes).toContain("unsupported_non_exact_analysis");
      expect(result.safeFallback).toContain(fallbackMarker);
      expect(result.safeFallback).not.toContain("-150");
      expect(result.safeFallback).not.toContain("62%");
    }
  );

  it("fails closed when a slate has no resolved events", () => {
    const slateRoute = planDimeAnswerRoute(
      "Rank the MLB slate tonight",
      ET_LATE_JULY_28,
      {}
    );
    const result = validateDimeResponseCompleteness(
      evidence(slateRoute, []),
      "NO DATA: the slate was not resolved, but top plays are Yankees -180, Dodgers -150, and Cubs over 12.5."
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain("unsupported_non_exact_analysis");
    expect(result.safeFallback).toContain("NO DATA:");
    expect(result.safeFallback).toContain("will not invent");
    expect(result.safeFallback).not.toContain("-180");
  });
});
