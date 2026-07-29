import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  complete: vi.fn(),
  resolveConfig: vi.fn(),
  context: vi.fn(),
  appendTraceEvent: vi.fn(),
  failTrace: vi.fn(),
  finalizeTrace: vi.fn(),
  recordTraceContext: vi.fn(),
  sendTraceJsonError: vi.fn(),
  traceMeta: vi.fn(),
}));

vi.mock("./dime1Client", async () => {
  const actual =
    await vi.importActual<typeof import("./dime1Client")>("./dime1Client");
  return {
    ...actual,
    dime1ChatComplete: mocked.complete,
    resolveDime1Config: mocked.resolveConfig,
  };
});

vi.mock("./dimeChatContext", () => ({
  getDimeChatContext: mocked.context,
}));

vi.mock("../dimeChatTrace", () => ({
  DIME_CHAT_TRACE_HEADER: "x-dime-chat-trace-v1",
  appendDimeChatTraceEvent: mocked.appendTraceEvent,
  failDimeChatTrace: mocked.failTrace,
  finalizeDimeChatTrace: mocked.finalizeTrace,
  recordDimeChatTraceContext: mocked.recordTraceContext,
  sendDimeChatTraceJsonError: mocked.sendTraceJsonError,
  dimeChatTraceMeta: mocked.traceMeta,
}));

import type { DimeContextResult } from "./dimeChatContext";
import { handleDime1ChatRequest } from "./dime1ChatHandler";
import {
  applyDimeAnswerRoute,
  type DimeAnswerRoute,
  type DimeEventIdentity,
  planDimeAnswerRoute,
  renderPlatformCapabilitiesFallback,
  resolveDimeEvent,
} from "./dimeAnswerRouting";

const NOW = new Date("2026-07-29T02:30:00.000Z");
const BASE_SYSTEM_PROMPT = "BASE DIME SYSTEM PROMPT";

interface SseFrame {
  type: string;
  text?: string;
  answerMode?: string;
  answerRoutingVersion?: string;
  eventResolution?: string;
  groundingStatus?: string;
  completenessStatus?: string;
  stopReason?: string;
}

function responseHarness() {
  const chunks: string[] = [];
  const headers = new Map<string, unknown>();
  const response = {
    destroyed: false,
    writableEnded: false,
    setHeader: vi.fn((name: string, value: unknown) => {
      headers.set(name.toLowerCase(), value);
      return response;
    }),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }),
    once: vi.fn(() => response),
    end: vi.fn(() => {
      response.writableEnded = true;
      return response;
    }),
    status: vi.fn(() => response),
    json: vi.fn(() => response),
  };

  return {
    response: response as unknown as Response,
    headers,
    frames(): SseFrame[] {
      return chunks.flatMap(chunk =>
        chunk
          .split("\n\n")
          .filter(line => line.startsWith("data: "))
          .map(line => JSON.parse(line.slice("data: ".length)) as SseFrame)
      );
    },
  };
}

function contextResult(
  route: DimeAnswerRoute,
  overrides: Partial<DimeContextResult> = {}
): DimeContextResult {
  const resolution = resolveDimeEvent([], route).resolution;
  return {
    freshness: "none",
    rowCount: 0,
    eventIds: [],
    route,
    resolution,
    grounding: route.mode === "platform" ? "catalog_only" : "none",
    retrievalCandidateCount: 0,
    retrievalLatencyMs: 0,
    supportedNumericValues: [],
    ...overrides,
  };
}

function event(id: number, gameDate: string): DimeEventIdentity {
  return {
    id,
    sport: "MLB",
    gameDate,
    startTimeEst: "7:10 PM",
    gameNumber: null,
    awayTeam: "Seattle Mariners",
    homeTeam: "Los Angeles Dodgers",
  };
}

function providerResult(content: string) {
  return {
    content,
    finishReason: "stop",
    model: "dime-1.0-integration-test",
    usage: {
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    },
  };
}

async function invoke(
  query: string,
  route: DimeAnswerRoute,
  systemPrompt: string
) {
  const harness = responseHarness();
  await handleDime1ChatRequest({
    req: {} as Request,
    res: harness.response,
    requestId: "routing-integration-request",
    startTime: Date.now(),
    messages: [{ role: "user", content: query }],
    requestClass: "standard",
    responseBudget: 512,
    answerRoute: route,
    systemPrompt,
  });
  return { ...harness, frames: harness.frames() };
}

function expectTraceOffAndNoExternalFetch(
  fetchGuard: ReturnType<typeof vi.fn>
) {
  expect(fetchGuard).not.toHaveBeenCalled();
  expect(mocked.appendTraceEvent).not.toHaveBeenCalled();
  expect(mocked.failTrace).not.toHaveBeenCalled();
  expect(mocked.finalizeTrace).not.toHaveBeenCalled();
  expect(mocked.recordTraceContext).not.toHaveBeenCalled();
  expect(mocked.sendTraceJsonError).not.toHaveBeenCalled();
  expect(mocked.traceMeta).not.toHaveBeenCalled();
}

describe("Dime1 provider boundary with Answer Routing v1", () => {
  let fetchGuard: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    fetchGuard = vi.fn(() => {
      throw new Error("The provider integration test must not use network.");
    });
    vi.stubGlobal("fetch", fetchGuard);
    mocked.resolveConfig.mockReturnValue({
      baseUrl: "https://unused.invalid/v1",
      model: "dime-1.0-integration-test",
      timeoutMs: 1_000,
      source: "explicit",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bypasses game retrieval for platform questions and replaces an incomplete answer", async () => {
    const query =
      "What can Dime AI currently help me with across the platform?";
    const route = planDimeAnswerRoute(query, NOW, {});
    const routedSystemPrompt = applyDimeAnswerRoute(BASE_SYSTEM_PROMPT, route);
    mocked.context.mockResolvedValue(contextResult(route));
    mocked.complete.mockResolvedValue(
      providerResult("I can explain sports betting. Send me a game.")
    );

    const result = await invoke(query, route, routedSystemPrompt);
    const [meta, delta, done] = result.frames;

    expect(route.mode).toBe("platform");
    expect(route.retrievalBypassed).toBe(true);
    expect(mocked.context).toHaveBeenCalledOnce();
    expect(mocked.context).toHaveBeenCalledWith(expect.any(Date), query, route);
    expect(mocked.complete).toHaveBeenCalledOnce();
    expect(mocked.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: routedSystemPrompt,
        messages: [{ role: "user", content: query }],
        maxTokens: 512,
      })
    );
    expect(routedSystemPrompt).toContain(
      "DIME_RUNTIME_ANSWER_ROUTING version=runtime-answer-routing-v1"
    );
    expect(routedSystemPrompt).toContain("RUNTIME ANSWER ROUTE: platform");
    expect(
      mocked.complete.mock.calls[0]?.[0].messages.some(
        (message: { content: string }) =>
          message.content.includes("DIME_EVENT_RESOLUTION") ||
          message.content.includes("Dime platform context")
      )
    ).toBe(false);

    expect(result.headers.get("content-type")).toBe("text/event-stream");
    expect(result.frames.map(frame => frame.type)).toEqual([
      "meta",
      "delta",
      "done",
    ]);
    expect(meta).toMatchObject({
      type: "meta",
      answerMode: "platform",
      answerRoutingVersion: "runtime-answer-routing-v1",
      eventResolution: "not_applicable",
      groundingStatus: "catalog_only",
    });
    expect(delta).toEqual({
      type: "delta",
      text: renderPlatformCapabilitiesFallback(),
    });
    expect(done).toMatchObject({
      type: "done",
      stopReason: "runtime_answer_fallback",
      completenessStatus: "failed",
    });
    expect(
      result.frames.some(frame => frame.text?.includes("Send me a game"))
    ).toBe(false);
    expectTraceOffAndNoExternalFetch(fetchGuard);
  });

  it("passes one exact-matchup answer with routed context and no retry", async () => {
    const query = "SEA vs LAD on July 28 in MLB";
    const route = planDimeAnswerRoute(query, NOW, {});
    const routedSystemPrompt = applyDimeAnswerRoute(BASE_SYSTEM_PROMPT, route);
    const selected = event(77, "2026-07-28");
    const context =
      "DIME_EVENT_RESOLUTION result=exact\nDime platform context event_id=77";
    const content =
      "Seattle Mariners at Los Angeles Dodgers is the exact matchup in delayed Dime evidence; the exact market observation timestamp is unavailable.";
    mocked.context.mockResolvedValue(
      contextResult(route, {
        freshness: "delayed",
        context,
        rowCount: 1,
        eventIds: [77],
        resolution: {
          kind: "exact",
          selected: [selected],
          candidateEventIds: [77],
          confidence: 0.99,
          reason: "one_exact_event",
        },
        grounding: "full_event",
        retrievalCandidateCount: 1,
        retrievalLatencyMs: 4,
      })
    );
    mocked.complete.mockResolvedValue(providerResult(content));

    const result = await invoke(query, route, routedSystemPrompt);
    const [meta, delta, done] = result.frames;
    const providerCall = mocked.complete.mock.calls[0]?.[0];

    expect(mocked.complete).toHaveBeenCalledOnce();
    expect(providerCall.system).toBe(routedSystemPrompt);
    expect(providerCall.messages).toEqual([
      { role: "user", content: context },
      {
        role: "assistant",
        content:
          "Understood. I will ground Dime answers in this platform context and clearly say when a requested market is missing.",
      },
      { role: "user", content: query },
    ]);
    expect(meta).toMatchObject({
      type: "meta",
      answerMode: "matchup",
      eventResolution: "exact",
      groundingStatus: "full_event",
    });
    expect(delta).toEqual({ type: "delta", text: content });
    expect(done).toMatchObject({
      type: "done",
      stopReason: "stop",
      completenessStatus: "passed",
    });
    expectTraceOffAndNoExternalFetch(fetchGuard);
  });

  it.each([
    {
      label: "missing",
      context:
        "DIME_EVENT_RESOLUTION result=missing\n- no eligible event selected",
      resolution: {
        kind: "missing" as const,
        selected: [],
        candidateEventIds: [],
        confidence: 0,
        reason: "database_unavailable",
      },
      expectedFallback:
        "NO DATA: I could not match Los Angeles Dodgers vs Seattle Mariners on 2026-07-28 to an eligible Dime event. I will not substitute another game or invent a line. Confirm the league, teams, date, and market.",
    },
    {
      label: "nearby",
      context:
        "DIME_EVENT_RESOLUTION result=nearby\n- event_id=88 MLB 2026-07-29 Seattle Mariners at Los Angeles Dodgers",
      resolution: {
        kind: "nearby" as const,
        selected: [event(88, "2026-07-29")],
        candidateEventIds: [88],
        confidence: 0.85,
        reason: "one_adjacent_date_event",
      },
      expectedFallback:
        "DATE CHECK: I did not find Seattle Mariners at Los Angeles Dodgers on 2026-07-28. I found that matchup on 2026-07-29 in delayed Dime evidence. Confirm that you want 2026-07-29 before I analyze it; the exact market observation timestamp is unavailable.",
    },
  ])(
    "blocks unsupported $label-event analysis and serves the deterministic resolution fallback",
    async ({ context, resolution, expectedFallback }) => {
      const query = "SEA vs LAD on July 28 in MLB";
      const route = planDimeAnswerRoute(query, NOW, {});
      const routedSystemPrompt = applyDimeAnswerRoute(
        BASE_SYSTEM_PROMPT,
        route
      );
      const smuggledAnalysis =
        resolution.kind === "nearby"
          ? "DATE CHECK: the requested date is 2026-07-28 and the candidate date is 2026-07-29, but bet the Dodgers -150 because they have a 62% edge."
          : "NO DATA: the requested event is missing, but bet the Dodgers -150 because they have a 62% edge.";
      mocked.context.mockResolvedValue(
        contextResult(route, {
          freshness: resolution.kind === "nearby" ? "delayed" : "none",
          context,
          rowCount: 0,
          eventIds: [],
          resolution,
          grounding: resolution.kind === "nearby" ? "identity_only" : "none",
          retrievalCandidateCount: resolution.candidateEventIds.length,
          retrievalLatencyMs: 3,
        })
      );
      mocked.complete.mockResolvedValue(providerResult(smuggledAnalysis));

      const result = await invoke(query, route, routedSystemPrompt);
      const [meta, delta, done] = result.frames;

      expect(mocked.complete).toHaveBeenCalledOnce();
      expect(meta).toMatchObject({
        type: "meta",
        answerMode: "matchup",
        eventResolution: resolution.kind,
      });
      expect(delta).toEqual({ type: "delta", text: expectedFallback });
      expect(delta.text).not.toContain("-150");
      expect(delta.text).not.toContain("62%");
      expect(done).toMatchObject({
        type: "done",
        stopReason: "runtime_answer_fallback",
        completenessStatus: "failed",
      });
      expectTraceOffAndNoExternalFetch(fetchGuard);
    }
  );
});
