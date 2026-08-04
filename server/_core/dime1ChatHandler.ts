/**
 * Dime 1.0 chat handler — frozen future "dime1" integration scaffold.
 * ---------------------------------------------------------------
 * Lives in its own module (not inline in dime-chat.route.ts) so the route
 * keeps a single context/stream call site for the provider-freeze contract
 * tests, and so the execution-plane swap never touches the Claude wiring.
 *
 * Control-plane parity with the Claude path, on purpose:
 *   - grounding via getDimeChatContext() with the same context/ack framing
 *   - the same SSE contract the client already parses (meta → delta → done)
 *   - the same post-generation gates: validateDimeResponseText +
 *     containsProhibitedBettingCertainty, with whole-answer withholding
 * No production model or endpoint is approved. This handler is unreachable
 * while DIME_CHAT_LLM_PROVIDER is "frozen"; a later owner-authorized promotion
 * must prove the canonical release gates before activating it.
 */

import type { Request, Response } from "express";
import type { DimeChatMessage, DimeChatRequestClass } from "./dimeChatModel";
import {
  DIME1_CHAT_TEMPERATURE,
  DIME1_PROMPT_SOURCE,
  DIME1_PRODUCT_PROFILE,
  DIME1_PROFILE_VERSION,
  DIME_RESEARCH_ALPHA_PROMPT_SOURCE,
  DIME_RESEARCH_ALPHA_PRODUCT_PROFILE,
  DIME_RESEARCH_ALPHA_PROFILE_VERSION,
} from "./dime1Model";
import {
  DIME_PLATFORM_KNOWLEDGE_SHA256,
  DIME_PLATFORM_KNOWLEDGE_VERSION,
} from "./dimePlatformKnowledge";
import {
  Dime1ApiError,
  dime1ChatComplete,
  resolveDime1Config,
} from "./dime1Client";
import { getDimeChatContext } from "./dimeChatContext";
import { handleDimeDeterministicMathResponse } from "./dimeDeterministicMathHandler";
import {
  collectDimeNumericValues,
  type DimeAnswerEvidence,
  type DimeAnswerRoute,
  resolveDimeEvent,
  validateDimeResponseCompleteness,
} from "./dimeAnswerRouting";
import { validateDimeResponseText } from "./dimeVerdict";
import { containsProhibitedBettingCertainty } from "./dimeSafety";
import {
  DIME_CHAT_TRACE_HEADER,
  appendDimeChatTraceEvent,
  type ActiveDimeChatTrace,
  dimeChatTraceMeta,
  failDimeChatTrace,
  finalizeDimeChatTrace,
  recordDimeChatTraceContext,
  sendDimeChatTraceJsonError,
} from "../dimeChatTrace";
import {
  assembleDimeContextObservability,
  dimeContextToolTrace,
  dimeNoDynamicContextObservability,
  type DimeTraceContextObservability,
} from "./dimeTraceObservability";

const VALIDATION_BLOCKED_RESPONSE =
  "I can’t verify that betting verdict against grounded Dime data, so I’m blocking it rather than risking a fabricated edge. Please provide the event, market, current line/odds, sportsbook, timestamp, and model projection/version so I can evaluate it safely.";

function dime1Log(
  event: string,
  requestId: string,
  data: Record<string, unknown> = {}
) {
  const timestamp = new Date().toISOString();
  console.log(
    `[Dime] [${timestamp}] [${requestId}] ${event}`,
    Object.keys(data).length > 0 ? JSON.stringify(data) : ""
  );
}

export interface Dime1ChatRequestArgs {
  req: Request;
  res: Response;
  requestId: string;
  startTime: number;
  messages: DimeChatMessage[];
  requestClass: DimeChatRequestClass;
  responseBudget: number;
  answerRoute: DimeAnswerRoute;
  classificationLatencyMs: number;
  systemPrompt: string;
  deploymentTier?: "production" | "research-alpha";
  trace?: ActiveDimeChatTrace;
}

export async function handleDime1ChatRequest(
  args: Dime1ChatRequestArgs
): Promise<void> {
  const {
    res,
    requestId,
    startTime,
    messages,
    requestClass,
    responseBudget,
    answerRoute,
    classificationLatencyMs,
    systemPrompt,
    deploymentTier = "production",
    trace,
  } = args;
  const isResearchAlpha = deploymentTier === "research-alpha";

  if (
    await handleDimeDeterministicMathResponse({
      res,
      requestId,
      startTime,
      answerRoute,
      classificationLatencyMs,
      trace,
      log: dime1Log,
      meta: {
        dimeProfile: isResearchAlpha
          ? DIME_RESEARCH_ALPHA_PRODUCT_PROFILE
          : DIME1_PRODUCT_PROFILE,
        profileVersion: isResearchAlpha
          ? DIME_RESEARCH_ALPHA_PROFILE_VERSION
          : DIME1_PROFILE_VERSION,
        promptSource: isResearchAlpha
          ? DIME_RESEARCH_ALPHA_PROMPT_SOURCE
          : DIME1_PROMPT_SOURCE,
        deploymentTier,
      },
    })
  ) {
    return;
  }

  // Config check before any SSE header flush so a misconfigured endpoint
  // fails as a clean HTTP 500 instead of a broken stream.
  const config = resolveDime1Config();
  if (!config) {
    if (trace) {
      await failDimeChatTrace(trace, {
        status: "failed",
        errorClass: "ConfigurationError",
        errorCode: "dime1_not_configured",
        latencyMs: Date.now() - startTime,
      }).catch(traceError => {
        dime1Log("dime.chat.trace.failure_record_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
          deploymentTier,
        });
      });
    }
    dime1Log("dime.chat.dime1.error", requestId, {
      errorClass: "ConfigurationError",
      statusCode: 500,
      detail: "Dime 1.0 endpoint not configured",
      deploymentTier,
    });
    const error =
      "Dime 1.0 is not configured. Set RUNPOD_ENDPOINT_ID (+ DIME_MODEL_API_SECRET or RUNPOD_API_KEY), or DIME_MODEL_BASE_URL for a custom endpoint.";
    if (trace) {
      sendDimeChatTraceJsonError(res, 500, error, trace);
    } else {
      res.status(500).json({ error });
    }
    return;
  }

  let dataFreshness: "live" | "delayed" | "none" = "none";
  let contextSnapshot: string | undefined;
  let contextRowCount = 0;
  let contextEventIds: number[] = [];
  let contextLookupErrorClass: string | undefined;
  let contextObservability: DimeTraceContextObservability =
    dimeNoDynamicContextObservability(classificationLatencyMs);
  const contextToolStartedAt = new Date();
  const userNumericValues = collectDimeNumericValues(
    messages
      .filter(message => message.role === "user")
      .map(message => message.content)
  );
  let answerEvidence: DimeAnswerEvidence = {
    route: answerRoute,
    resolution: resolveDimeEvent([], answerRoute).resolution,
    freshness: "none",
    grounding: answerRoute.mode === "platform" ? "catalog_only" : "none",
    rowCount: 0,
    retrievalCandidateCount: 0,
    retrievalLatencyMs: 0,
    supportedNumericValues: userNumericValues,
  };
  const providerMessages = [...messages];

  try {
    const context = await getDimeChatContext(
      new Date(),
      messages.at(-1)?.content ?? "",
      answerRoute
    );
    dataFreshness = context.freshness;
    contextSnapshot = context.context;
    contextRowCount = context.rowCount;
    contextEventIds = context.eventIds;
    contextObservability = assembleDimeContextObservability({
      classificationMs: classificationLatencyMs,
      ...context.observability,
    });
    answerEvidence = {
      route: context.route,
      resolution: context.resolution,
      freshness: context.freshness,
      grounding: context.grounding,
      rowCount: context.rowCount,
      retrievalCandidateCount: context.retrievalCandidateCount,
      retrievalLatencyMs: context.retrievalLatencyMs,
      supportedNumericValues: Array.from(
        new Set([...context.supportedNumericValues, ...userNumericValues])
      ),
    };

    if (context.context) {
      providerMessages.unshift(
        { role: "user", content: context.context },
        {
          role: "assistant",
          content:
            "Understood. I will ground Dime answers in this platform context and clearly say when a requested market is missing.",
        }
      );
    }

    dime1Log("dime.chat.dime1.context", requestId, {
      dataFreshness,
      rowCount: context.rowCount,
      eventIds: context.eventIds,
      answerMode: context.route.mode,
      productRoute: context.route.productRoute,
      eventResolution: context.resolution.kind,
      groundingStatus: context.grounding,
      retrievalCandidateCount: context.retrievalCandidateCount,
      retrievalLatencyMs: context.retrievalLatencyMs,
      deploymentTier,
    });
  } catch (contextErr) {
    dataFreshness = "none";
    contextLookupErrorClass =
      (contextErr as Error)?.constructor?.name ?? "Unknown";
    const contextToolCompletedAt = new Date();
    contextObservability = {
      ...dimeNoDynamicContextObservability(
        classificationLatencyMs,
        contextToolCompletedAt
      ),
      toolCall: dimeContextToolTrace({
        status: "failed",
        normalizedArguments: {
          route: answerRoute.productRoute,
          league: answerRoute.league ?? null,
          requestedDate: answerRoute.requestedDate ?? null,
          retrievalCap: answerRoute.retrievalCap,
        },
        startedAt: contextToolStartedAt,
        completedAt: contextToolCompletedAt,
        validationResult: "not_run",
      }),
    };
    dime1Log("dime.chat.dime1.context_error", requestId, {
      errorClass: contextLookupErrorClass,
      detail: (contextErr as Error)?.message ?? "Context lookup failed",
      deploymentTier,
    });
  }

  if (trace) {
    try {
      await recordDimeChatTraceContext(trace, {
        freshness: dataFreshness,
        rowCount: contextRowCount,
        eventIds: contextEventIds,
        context: contextSnapshot,
        lookupErrorClass: contextLookupErrorClass,
        answerMode: answerEvidence.route.mode,
        productRoute: answerEvidence.route.productRoute,
        routingVersion: answerEvidence.route.version,
        dateSource: answerEvidence.route.dateSource,
        requestedDate: answerEvidence.route.requestedDate,
        league: answerEvidence.route.league,
        eventResolution: answerEvidence.resolution.kind,
        groundingStatus: answerEvidence.grounding,
        retrievalCandidateCount: answerEvidence.retrievalCandidateCount,
        retrievalLatencyMs: answerEvidence.retrievalLatencyMs,
        confidence: answerEvidence.resolution.confidence,
        observability: contextObservability,
      });
    } catch (traceError) {
      await failDimeChatTrace(trace, {
        status: "failed",
        errorClass: "TraceContextPersistenceError",
        errorCode: "trace_context_write_failed",
        latencyMs: Date.now() - startTime,
      }).catch(() => undefined);
      dime1Log("dime.chat.trace.context_error", requestId, {
        errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        deploymentTier,
      });
      sendDimeChatTraceJsonError(
        res,
        503,
        "Dime could not securely record this generation. No model call was made.",
        trace
      );
      return;
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (trace) {
    res.setHeader(DIME_CHAT_TRACE_HEADER, "1");
  }
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({
    type: "meta",
    dataFreshness,
    dimeProfile: isResearchAlpha
      ? DIME_RESEARCH_ALPHA_PRODUCT_PROFILE
      : DIME1_PRODUCT_PROFILE,
    profileVersion: isResearchAlpha
      ? DIME_RESEARCH_ALPHA_PROFILE_VERSION
      : DIME1_PROFILE_VERSION,
    promptSource: isResearchAlpha
      ? DIME_RESEARCH_ALPHA_PROMPT_SOURCE
      : DIME1_PROMPT_SOURCE,
    platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
    platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
    provider: isResearchAlpha ? "dime1-research-alpha" : "dime1",
    deploymentTier,
    model: config.model,
    requestClass,
    responseBudget,
    answerMode: answerRoute.mode,
    productRoute: answerRoute.productRoute,
    answerRoutingVersion: answerRoute.version,
    eventResolution: answerEvidence.resolution.kind,
    groundingStatus: answerEvidence.grounding,
    routingConfidence: answerEvidence.resolution.confidence,
    ...(trace ? { trace: dimeChatTraceMeta(trace) } : {}),
  });

  const abort = new AbortController();
  let aborted = false;

  res.once("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      abort.abort();
      dime1Log("dime.chat.dime1.aborted", requestId, {
        latencyMs: Date.now() - startTime,
        deploymentTier,
      });
    }
  });

  dime1Log("dime.chat.dime1.generate.start", requestId, {
    model: config.model,
    endpointSource: config.source,
    historyLength: providerMessages.length,
    requestClass,
    responseBudget,
    platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
    platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
    answerMode: answerRoute.mode,
    productRoute: answerRoute.productRoute,
    answerRoutingVersion: answerRoute.version,
    eventResolution: answerEvidence.resolution.kind,
    groundingStatus: answerEvidence.grounding,
    deploymentTier,
  });

  let traceFinalized = false;
  try {
    const modelStartedAt = Date.now();
    const result = await dime1ChatComplete({
      system: systemPrompt,
      messages: providerMessages,
      maxTokens: responseBudget,
      temperature: DIME1_CHAT_TEMPERATURE,
      signal: abort.signal,
    });
    const modelCompletedAt = Date.now();
    if (aborted || res.destroyed) {
      if (trace) {
        await failDimeChatTrace(trace, {
          status: "aborted",
          errorClass: "ClientDisconnected",
          errorCode: "client_disconnected_before_finalize",
          latencyMs: Date.now() - startTime,
        });
      }
      return;
    }

    const validationStartedAt = Date.now();
    const validation = validateDimeResponseText(result.content);
    const certaintyViolation = containsProhibitedBettingCertainty(
      result.content
    );
    const completeness = validateDimeResponseCompleteness(
      answerEvidence,
      result.content
    );
    const combinedValidationErrors = [
      ...validation.errors,
      ...completeness.errorCodes.map(code => `answer_completeness:${code}`),
    ];
    const completenessBlocked = completeness.status === "failed";
    const servedBlockedOutput =
      validation.ok && !certaintyViolation && completeness.safeFallback
        ? completeness.safeFallback
        : VALIDATION_BLOCKED_RESPONSE;
    const blockedFinishReason =
      validation.ok && !certaintyViolation && completeness.safeFallback
        ? "runtime_answer_fallback"
        : "validation_blocked";
    const validationMs = Date.now() - validationStartedAt;

    dime1Log("dime.chat.dime1.generate.done", requestId, {
      finishReason: result.finishReason,
      outputCharCount: result.content.length,
      latencyMs: Date.now() - startTime,
      verificationStatus:
        validation.ok && !certaintyViolation && !completenessBlocked
          ? "passed"
          : "blocked",
      validationErrors: combinedValidationErrors,
      certaintyViolation,
      completenessStatus: completeness.status,
      usage: result.usage,
      deploymentTier,
    });

    if (!validation.ok || certaintyViolation || completenessBlocked) {
      let assistantMessageId: number | undefined;
      if (trace) {
        const finalized = await finalizeDimeChatTrace(trace, {
          rawOutput: result.content,
          servedOutput: servedBlockedOutput,
          status: "blocked",
          finishReason: blockedFinishReason,
          actualModel: result.model,
          validationErrors: combinedValidationErrors,
          certaintyViolation,
          answerMode: answerRoute.mode,
          productRoute: answerRoute.productRoute,
          routingVersion: answerRoute.version,
          completenessStatus: completeness.status,
          groundingStatus: answerEvidence.grounding,
          usage: result.usage,
          modelCompletionMs: modelCompletedAt - modelStartedAt,
          validationMs,
          latencyMs: Date.now() - startTime,
        });
        assistantMessageId = finalized.assistantMessageId;
        traceFinalized = true;
      }
      send({
        type: "delta",
        text: servedBlockedOutput,
      });
      send({
        type: "done",
        stopReason: blockedFinishReason,
        completenessStatus: completeness.status,
        ...(trace
          ? { trace: dimeChatTraceMeta(trace, assistantMessageId) }
          : {}),
      });
      if (trace) {
        await appendDimeChatTraceEvent(trace, "response_dispatched", {
          transport: "sse",
          delivery: "unknown",
        }).catch(traceError => {
          dime1Log("dime.chat.trace.dispatch_event_error", requestId, {
            errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
            deploymentTier,
          });
        });
      }
      return;
    }

    let assistantMessageId: number | undefined;
    if (trace) {
      const finalized = await finalizeDimeChatTrace(trace, {
        rawOutput: result.content,
        servedOutput: result.content,
        status: "completed",
        finishReason: result.finishReason,
        actualModel: result.model,
        validationErrors: combinedValidationErrors,
        certaintyViolation,
        answerMode: answerRoute.mode,
        productRoute: answerRoute.productRoute,
        routingVersion: answerRoute.version,
        completenessStatus: completeness.status,
        groundingStatus: answerEvidence.grounding,
        usage: result.usage,
        modelCompletionMs: modelCompletedAt - modelStartedAt,
        validationMs,
        latencyMs: Date.now() - startTime,
      });
      assistantMessageId = finalized.assistantMessageId;
      traceFinalized = true;
    }
    send({ type: "delta", text: result.content });
    send({
      type: "done",
      stopReason: result.finishReason ?? "end_turn",
      completenessStatus: completeness.status,
      ...(trace ? { trace: dimeChatTraceMeta(trace, assistantMessageId) } : {}),
    });
    if (trace) {
      await appendDimeChatTraceEvent(trace, "response_dispatched", {
        transport: "sse",
        delivery: "unknown",
      }).catch(traceError => {
        dime1Log("dime.chat.trace.dispatch_event_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
          deploymentTier,
        });
      });
    }
  } catch (err: unknown) {
    if (trace && !traceFinalized) {
      await failDimeChatTrace(trace, {
        status: aborted ? "aborted" : "failed",
        errorClass:
          (err as Error)?.constructor?.name ??
          (aborted ? "AbortError" : "Unknown"),
        errorCode:
          err instanceof Dime1ApiError
            ? `http_${err.status}`
            : aborted
              ? "client_disconnected"
              : "generation_failed",
        latencyMs: Date.now() - startTime,
      }).catch(traceError => {
        dime1Log("dime.chat.trace.failure_record_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
          deploymentTier,
        });
      });
    }
    if (!aborted) {
      const isApiError = err instanceof Dime1ApiError;
      const message = isApiError
        ? `Model error (${err.status}).`
        : "Dime hit a connection problem.";

      dime1Log("dime.chat.dime1.error", requestId, {
        errorClass: isApiError
          ? "Dime1ApiError"
          : ((err as Error)?.constructor?.name ?? "Unknown"),
        statusCode: isApiError ? err.status : undefined,
        latencyMs: Date.now() - startTime,
        deploymentTier,
      });

      send({
        type: "error",
        message,
        ...(trace ? { trace: dimeChatTraceMeta(trace) } : {}),
      });
    }
  } finally {
    res.end();
  }
}
