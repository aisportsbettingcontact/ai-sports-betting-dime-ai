import type { Response } from "express";
import {
  type DimeAnswerEvidence,
  type DimeAnswerRoute,
  resolveDimeEvent,
  validateDimeResponseCompleteness,
} from "./dimeAnswerRouting";
import { containsProhibitedBettingCertainty } from "./dimeSafety";
import { validateDimeResponseText } from "./dimeVerdict";
import {
  DIME_CHAT_TRACE_HEADER,
  type ActiveDimeChatTrace,
  appendDimeChatTraceEvent,
  dimeChatTraceMeta,
  failDimeChatTrace,
  finalizeDimeChatTrace,
  recordDimeChatTraceContext,
  sendDimeChatTraceJsonError,
} from "../dimeChatTrace";

const VALIDATION_BLOCKED_RESPONSE =
  "I can’t verify that betting verdict against grounded Dime data, so I’m blocking it rather than risking a fabricated edge. Please provide the event, market, current line/odds, sportsbook, timestamp, and model projection/version so I can evaluate it safely.";

type DimeRuntimeLog = (
  event: string,
  requestId: string,
  data?: Record<string, unknown>
) => void;

export interface DimeDeterministicMathResponseArgs {
  res: Response;
  requestId: string;
  startTime: number;
  answerRoute: DimeAnswerRoute;
  trace?: ActiveDimeChatTrace;
  log: DimeRuntimeLog;
  meta?: Record<string, unknown>;
}

/**
 * Serve canonical betting math without retrieving games or contacting a model.
 * Returns true when it handled the response and false for every other route.
 */
export async function handleDimeDeterministicMathResponse(
  args: DimeDeterministicMathResponseArgs
): Promise<boolean> {
  const {
    res,
    requestId,
    startTime,
    answerRoute,
    trace,
    log,
    meta = {},
  } = args;
  const deterministicMath = answerRoute.deterministicMath;
  if (!deterministicMath) return false;

  const deterministicOutput = deterministicMath.answer;
  const resolution = resolveDimeEvent([], answerRoute).resolution;
  const evidence: DimeAnswerEvidence = {
    route: answerRoute,
    resolution,
    freshness: "none",
    grounding: "none",
    rowCount: 0,
    retrievalCandidateCount: 0,
    retrievalLatencyMs: 0,
    supportedNumericValues: [],
  };
  const validation = validateDimeResponseText(deterministicOutput);
  const certaintyViolation =
    containsProhibitedBettingCertainty(deterministicOutput);
  const completeness = validateDimeResponseCompleteness(
    evidence,
    deterministicOutput
  );
  const validationErrors = [
    ...validation.errors,
    ...completeness.errorCodes.map(code => `answer_completeness:${code}`),
  ];
  const passed =
    validation.ok && !certaintyViolation && completeness.status === "passed";
  const servedOutput = passed
    ? deterministicOutput
    : VALIDATION_BLOCKED_RESPONSE;
  const finishReason = passed ? "deterministic_math" : "validation_blocked";
  let assistantMessageId: number | undefined;

  if (trace) {
    try {
      await recordDimeChatTraceContext(trace, {
        freshness: "none",
        rowCount: 0,
        answerMode: answerRoute.mode,
        routingVersion: answerRoute.version,
        dateSource: answerRoute.dateSource,
        requestedDate: answerRoute.requestedDate,
        league: answerRoute.league,
        eventResolution: resolution.kind,
        groundingStatus: "none",
        retrievalCandidateCount: 0,
        retrievalLatencyMs: 0,
        confidence: resolution.confidence,
      });
      const finalized = await finalizeDimeChatTrace(trace, {
        rawOutput: deterministicOutput,
        servedOutput,
        status: passed ? "completed" : "blocked",
        finishReason,
        actualModel: deterministicMath.version,
        validationErrors,
        certaintyViolation,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        answerMode: answerRoute.mode,
        routingVersion: answerRoute.version,
        completenessStatus: completeness.status,
        groundingStatus: "none",
        latencyMs: Date.now() - startTime,
      });
      assistantMessageId = finalized.assistantMessageId;
    } catch (traceError) {
      await failDimeChatTrace(trace, {
        status: "failed",
        errorClass: "DeterministicMathPersistenceError",
        errorCode: "deterministic_math_write_failed",
        latencyMs: Date.now() - startTime,
      }).catch(() => undefined);
      log("dime.chat.trace.deterministic_math_error", requestId, {
        errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
      });
      sendDimeChatTraceJsonError(
        res,
        503,
        "Dime could not securely save this response. No model call was made.",
        trace
      );
      return true;
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (trace) res.setHeader(DIME_CHAT_TRACE_HEADER, "1");
  res.flushHeaders?.();
  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  log("dime.chat.deterministic_math.done", requestId, {
    kind: deterministicMath.kind,
    version: deterministicMath.version,
    outputCharCount: servedOutput.length,
    verificationStatus: passed ? "passed" : "blocked",
    validationErrors,
    latencyMs: Date.now() - startTime,
    providerCallMade: false,
  });
  send({
    type: "meta",
    ...meta,
    dataFreshness: "none",
    provider: "dime-deterministic",
    model: deterministicMath.version,
    answerMode: answerRoute.mode,
    answerRoutingVersion: answerRoute.version,
    eventResolution: resolution.kind,
    groundingStatus: "none",
    routingConfidence: resolution.confidence,
    ...(trace ? { trace: dimeChatTraceMeta(trace) } : {}),
  });
  send({ type: "delta", text: servedOutput });
  send({
    type: "done",
    stopReason: finishReason,
    completenessStatus: completeness.status,
    ...(trace ? { trace: dimeChatTraceMeta(trace, assistantMessageId) } : {}),
  });
  if (trace) {
    await appendDimeChatTraceEvent(trace, "response_dispatched", {
      transport: "sse",
      delivery: "unknown",
    }).catch(traceError => {
      log("dime.chat.trace.dispatch_event_error", requestId, {
        errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
      });
    });
  }
  res.end();
  return true;
}
