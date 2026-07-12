/**
 * Dime 1.0 chat handler — the "dime1" branch of POST /api/dime/chat.
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
 * Only the generation call differs: a private RunPod vLLM endpoint serving
 * the 4-bit Dime 1.0 checkpoint instead of the Claude API.
 */

import type { Request, Response } from "express";
import type { DimeChatMessage, DimeChatRequestClass } from "./dimeChatModel";
import {
  DIME1_CHAT_TEMPERATURE,
  DIME1_PRODUCT_PROFILE,
  DIME1_PROFILE_VERSION,
  DIME1_SYSTEM_PROMPT,
} from "./dime1Model";
import { Dime1ApiError, dime1ChatComplete, resolveDime1Config } from "./dime1Client";
import { getDimeChatContext } from "./dimeChatContext";
import { validateDimeResponseText } from "./dimeVerdict";
import { containsProhibitedBettingCertainty } from "./dimeSafety";

function dime1Log(event: string, requestId: string, data: Record<string, unknown> = {}) {
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
}

export async function handleDime1ChatRequest(args: Dime1ChatRequestArgs): Promise<void> {
  const { req, res, requestId, startTime, messages, requestClass, responseBudget } = args;

  // Config check before any SSE header flush so a misconfigured endpoint
  // fails as a clean HTTP 500 instead of a broken stream.
  const config = resolveDime1Config();
  if (!config) {
    dime1Log("dime.chat.dime1.error", requestId, {
      errorClass: "ConfigurationError",
      statusCode: 500,
      detail: "Dime 1.0 endpoint not configured",
    });
    res.status(500).json({
      error:
        "Dime 1.0 is not configured. Set RUNPOD_ENDPOINT_ID (+ DIME_MODEL_API_SECRET or RUNPOD_API_KEY), or DIME_MODEL_BASE_URL for a custom endpoint.",
    });
    return;
  }

  let dataFreshness: "live" | "none" = "none";

  try {
    const context = await getDimeChatContext();
    dataFreshness = context.freshness;

    if (context.context) {
      messages.unshift(
        { role: "user", content: context.context },
        {
          role: "assistant",
          content:
            "Understood. I will ground Dime answers in this platform context and clearly say when a requested market is missing.",
        },
      );
    }

    dime1Log("dime.chat.dime1.context", requestId, {
      dataFreshness,
      rowCount: context.rowCount,
    });
  } catch (contextErr) {
    dataFreshness = "none";
    dime1Log("dime.chat.dime1.context_error", requestId, {
      errorClass: (contextErr as Error)?.constructor?.name ?? "Unknown",
      detail: (contextErr as Error)?.message ?? "Context lookup failed",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({
    type: "meta",
    dataFreshness,
    dimeProfile: DIME1_PRODUCT_PROFILE,
    profileVersion: DIME1_PROFILE_VERSION,
    promptSource: "dime1-v1",
    provider: "dime1",
    model: config.model,
    requestClass,
    responseBudget,
  });

  const abort = new AbortController();
  let aborted = false;

  req.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      abort.abort();
      dime1Log("dime.chat.dime1.aborted", requestId, {
        latencyMs: Date.now() - startTime,
      });
    }
  });

  dime1Log("dime.chat.dime1.generate.start", requestId, {
    model: config.model,
    endpointSource: config.source,
    historyLength: messages.length,
    requestClass,
    responseBudget,
  });

  try {
    const result = await dime1ChatComplete({
      system: DIME1_SYSTEM_PROMPT,
      messages,
      maxTokens: responseBudget,
      temperature: DIME1_CHAT_TEMPERATURE,
      signal: abort.signal,
    });

    const validation = validateDimeResponseText(result.content);
    const certaintyViolation = containsProhibitedBettingCertainty(result.content);

    dime1Log("dime.chat.dime1.generate.done", requestId, {
      finishReason: result.finishReason,
      outputCharCount: result.content.length,
      latencyMs: Date.now() - startTime,
      verificationStatus: validation.ok && !certaintyViolation ? "passed" : "blocked",
      validationErrors: validation.errors,
      certaintyViolation,
      usage: result.usage,
    });

    if (!validation.ok || certaintyViolation) {
      send({
        type: "delta",
        text: "I can’t verify that betting verdict against grounded Dime data, so I’m blocking it rather than risking a fabricated edge. Please provide the event, market, current line/odds, sportsbook, timestamp, and model projection/version so I can evaluate it safely.",
      });
      send({ type: "done", stopReason: "validation_blocked" });
      return;
    }

    send({ type: "delta", text: result.content });
    send({ type: "done", stopReason: result.finishReason ?? "end_turn" });
  } catch (err: unknown) {
    if (!aborted) {
      const isApiError = err instanceof Dime1ApiError;
      const message = isApiError ? `Model error (${err.status}).` : "Dime hit a connection problem.";

      dime1Log("dime.chat.dime1.error", requestId, {
        errorClass: isApiError ? "Dime1ApiError" : (err as Error)?.constructor?.name ?? "Unknown",
        statusCode: isApiError ? err.status : undefined,
        latencyMs: Date.now() - startTime,
      });

      send({ type: "error", message });
    }
  } finally {
    res.end();
  }
}
