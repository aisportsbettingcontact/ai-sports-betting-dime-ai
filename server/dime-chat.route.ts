/**
 * Dime AI — Chat route
 * ---------------------------------------------------------------
 * POST /api/dime/chat
 * Streams Claude Fable 5 responses via Server-Sent Events (SSE).
 *
 * Env:  ANTHROPIC_API_KEY (direct) — or ANTHROPIC_AUTH_TOKEN +
 *       ANTHROPIC_BASE_URL to route through an Anthropic-compatible gateway
 *       (see references/ai-gateway-setup.md)
 * Deps: @anthropic-ai/sdk (already installed)
 *
 * Mount in server/_core/index.ts:
 *   import { registerDimeChatRoute } from "../dime-chat.route";
 *   registerDimeChatRoute(app);
 */

import { Router, type Request, type Response, type Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getAppUserById } from "./db";
import {
  canAccessDimeModel,
  DIME_MODEL_ACCESS_MESSAGE,
} from "./dimeModelAccess";
import { canAccessDimeResearchAlpha } from "./dimeModelAccess";
import {
  createAnthropicClient,
  hasAnthropicCredentials,
} from "./_core/anthropicClient";
import {
  DIME_CHAT_FROZEN_NOTICE,
  DIME_CHAT_LLM_PROVIDER,
  DIME_CHAT_MODEL,
  DIME_CHAT_PROFILE_METADATA,
  DIME_CHAT_SYSTEM_PROMPT,
  classifyDimeChatRequest,
  sanitizeDimeChatHistory,
  selectDimeChatResponseBudget,
} from "./_core/dimeChatModel";
import { getDimeChatContext } from "./_core/dimeChatContext";
import { handleDimeDeterministicMathResponse } from "./_core/dimeDeterministicMathHandler";
import {
  applyDimeAnswerRoute,
  collectDimeNumericValues,
  type DimeAnswerEvidence,
  type DimeAnswerRoute,
  planDimeAnswerRoute,
  resolveDimeEvent,
  validateDimeResponseCompleteness,
} from "./_core/dimeAnswerRouting";
import { handleDime1ChatRequest } from "./_core/dime1ChatHandler";
import {
  DIME1_BASE_MODEL_REVISION,
  DIME1_CHAT_TEMPERATURE,
  DIME1_PROMPT_SOURCE,
  DIME1_PRODUCT_PROFILE,
  DIME1_PROFILE_VERSION,
  DIME1_SYSTEM_PROMPT,
  DIME_RESEARCH_ALPHA_PROMPT_SOURCE,
  DIME_RESEARCH_ALPHA_PRODUCT_PROFILE,
  DIME_RESEARCH_ALPHA_PROFILE_VERSION,
  DIME_RESEARCH_ALPHA_SYSTEM_PROMPT,
} from "./_core/dime1Model";
import {
  DIME_PLATFORM_KNOWLEDGE_SHA256,
  DIME_PLATFORM_KNOWLEDGE_VERSION,
} from "./_core/dimePlatformKnowledge";
import { resolveDimeResearchAlphaGate } from "./_core/dimeResearchAlpha";
import { validateDimeResponseText } from "./_core/dimeVerdict";
import {
  assessDimeResponsibleGamblingSafety,
  containsProhibitedBettingCertainty,
} from "./_core/dimeSafety";
import {
  checkDimeChatRateLimit,
  DIME_CHAT_RATE_LIMIT_WINDOW_MS,
} from "./dimeChatRateLimit";
import {
  DIME_CHAT_TRACE_HEADER,
  appendDimeChatTraceEvent,
  beginDimeChatTrace,
  dimeChatTraceMeta,
  failDimeChatTrace,
  finalizeDimeChatTrace,
  isDimeChatTraceEnabled,
  parseDimeChatTraceEnvelope,
  recordDimeChatTraceContext,
  sendDimeChatTraceJsonError,
  type ActiveDimeChatTrace,
  type DimeChatTraceProviderMetadata,
} from "./dimeChatTrace";

const VALIDATION_BLOCKED_RESPONSE =
  "I can’t verify that betting verdict against grounded Dime data, so I’m blocking it rather than risking a fabricated edge. Please provide the event, market, current line/odds, sportsbook, timestamp, and model projection/version so I can evaluate it safely.";

const DISTRESS_RESPONSE_PREFIX =
  "I can’t help you chase losses or size another bet from distress.";

// ---------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------
function dimeLog(
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

function traceProviderMetadata(
  researchAlphaGate: ReturnType<typeof resolveDimeResearchAlphaGate>,
  responseBudget: number,
  answerRoute: DimeAnswerRoute
): DimeChatTraceProviderMetadata {
  if (answerRoute.deterministicMath) {
    return {
      provider: "dime-deterministic",
      deploymentTier: "local-runtime",
      requestedModel: answerRoute.deterministicMath.version,
      endpointSource: "server-runtime",
      productProfile: "Dime deterministic betting math",
      profileVersion: answerRoute.deterministicMath.version,
      promptSource: "server/_core/dimeEducationalMath.ts",
      maxTokens: 0,
      temperature: 0,
    };
  }
  if (researchAlphaGate.active) {
    return {
      provider: "dime1-research-alpha",
      deploymentTier: "research-alpha",
      requestedModel: researchAlphaGate.model,
      endpointSource: researchAlphaGate.endpointSource,
      baseRevision: researchAlphaGate.revision,
      productProfile: DIME_RESEARCH_ALPHA_PRODUCT_PROFILE,
      profileVersion: DIME_RESEARCH_ALPHA_PROFILE_VERSION,
      promptSource: DIME_RESEARCH_ALPHA_PROMPT_SOURCE,
      systemPrompt: applyDimeAnswerRoute(
        DIME_RESEARCH_ALPHA_SYSTEM_PROMPT,
        answerRoute
      ),
      platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
      platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
      maxTokens: responseBudget,
      temperature: DIME1_CHAT_TEMPERATURE,
    };
  }
  if (DIME_CHAT_LLM_PROVIDER === "dime1") {
    return {
      provider: "dime1",
      deploymentTier: "production",
      requestedModel: process.env.DIME_MODEL_VERSION?.trim() || "dime-1.0",
      endpointSource: process.env.DIME_MODEL_BASE_URL?.trim()
        ? "explicit"
        : "runpod",
      baseRevision: DIME1_BASE_MODEL_REVISION,
      adapterRevision:
        process.env.DIME_MODEL_ADAPTER_REVISION?.trim() || undefined,
      productProfile: DIME1_PRODUCT_PROFILE,
      profileVersion: DIME1_PROFILE_VERSION,
      promptSource: DIME1_PROMPT_SOURCE,
      systemPrompt: applyDimeAnswerRoute(DIME1_SYSTEM_PROMPT, answerRoute),
      platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
      platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
      maxTokens: responseBudget,
      temperature: DIME1_CHAT_TEMPERATURE,
    };
  }
  if (DIME_CHAT_LLM_PROVIDER === "anthropic") {
    return {
      provider: "anthropic",
      deploymentTier: "production",
      requestedModel: DIME_CHAT_MODEL,
      endpointSource: "anthropic-direct",
      productProfile: DIME_CHAT_PROFILE_METADATA.productProfile,
      profileVersion: DIME_CHAT_PROFILE_METADATA.profileVersion,
      promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
      systemPrompt: applyDimeAnswerRoute(DIME_CHAT_SYSTEM_PROMPT, answerRoute),
      blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
      platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
      platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
      maxTokens: responseBudget,
    };
  }
  return {
    provider: "frozen",
    deploymentTier: "disabled",
    requestedModel: "no-provider",
    productProfile: DIME_CHAT_PROFILE_METADATA.productProfile,
    profileVersion: DIME_CHAT_PROFILE_METADATA.profileVersion,
    promptSource: "provider-frozen",
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
    platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
    platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
    maxTokens: responseBudget,
  };
}

function startDimeSse(
  res: Response,
  trace?: ActiveDimeChatTrace
): (payload: Record<string, unknown>) => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (trace) res.setHeader(DIME_CHAT_TRACE_HEADER, "1");
  res.flushHeaders?.();
  return payload => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
}

// ---------------------------------------------------------------
// Auth — app_session JWT (legacy OAuth has no Railway-reachable server)
// ---------------------------------------------------------------
async function authenticateDimeRequest(
  req: Request
): Promise<{ userId: number; role: string } | null> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies["app_session"];
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user") return null;

    // SEC-001: tokenVersion check — reject invalidated sessions
    const userId = Number(payload.sub);
    const tv = payload.tv as number | null | undefined;
    if (tv !== null && tv !== undefined) {
      const user = await getAppUserById(userId);
      if (user && user.tokenVersion !== tv) {
        console.log(
          `[DimeAuth] REJECTED — tokenVersion mismatch: jwt.tv=${tv} db.tv=${user.tokenVersion} userId=${userId}`
        );
        return null;
      }
    }

    return { userId, role: payload.role as string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Entitlement — OWNER-ONLY (restored per plan A1, 2026-07-12): the Dime
// model answers role="owner" accounts only; subscribers with hasAccess are
// NOT entitled (see dimeModelAccess.ts). Evaluated per-request against the
// DB (never the JWT role claim), so a demoted/revoked user loses chat
// access immediately instead of waiting out their JWT expiry.
// ---------------------------------------------------------------
async function checkDimeChatEntitlement(userId: number): Promise<boolean> {
  const user = await getAppUserById(userId);
  return canAccessDimeModel(user);
}

async function checkDimeResearchAlphaEntitlement(
  userId: number
): Promise<boolean> {
  const user = await getAppUserById(userId);
  return canAccessDimeResearchAlpha(user);
}

const dimeChatRouter = Router();

dimeChatRouter.post("/chat", async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // --- A2: Backend auth gate — reject unauthenticated requests before any Claude call ---
  const authedUser = await authenticateDimeRequest(req);
  if (!authedUser) {
    dimeLog("dime.chat.auth_rejected", requestId, {
      errorClass: "AuthenticationError",
      statusCode: 401,
      detail: "Unauthenticated request rejected",
    });
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  const researchAlphaGate = resolveDimeResearchAlphaGate();

  // --- SEC-CRIT: Entitlement gate — reject every non-owner request before any
  // Claude call or SSE stream (owner-only policy, dimeModelAccess.ts). Runs
  // BEFORE the provider-freeze branch so non-owners get a 403, never the
  // frozen-notice stream. Checked per-request against the DB, closing the
  // hasAccess-revocation bypass (stripeWebhook.ts revokes without bumping
  // tokenVersion) and the stale-JWT-role bypass. ---
  const entitled = researchAlphaGate.active
    ? await checkDimeResearchAlphaEntitlement(authedUser.userId)
    : await checkDimeChatEntitlement(authedUser.userId);
  if (!entitled) {
    dimeLog("dime.chat.entitlement_rejected", requestId, {
      errorClass: "AuthorizationError",
      statusCode: 403,
      userId: authedUser.userId,
      detail: researchAlphaGate.active
        ? "Research Alpha access — non-owner/non-admin rejected"
        : "Owner-only access — non-owner rejected",
    });
    res.status(403).json({ error: DIME_MODEL_ACCESS_MESSAGE });
    return;
  }

  // --- SEC-CRIT: Per-user rate limit — cap streaming requests per user per
  // window so an entitled account cannot drive unbounded Anthropic spend. ---
  if (!checkDimeChatRateLimit(authedUser.userId)) {
    dimeLog("dime.chat.rate_limited", requestId, {
      errorClass: "RateLimitError",
      statusCode: 429,
      userId: authedUser.userId,
      detail: "Chat rate limit exceeded",
    });
    res.setHeader(
      "Retry-After",
      Math.ceil(DIME_CHAT_RATE_LIMIT_WINDOW_MS / 1000).toString()
    );
    res.status(429).json({
      error: "You're sending messages too quickly. Please wait a moment.",
    });
    return;
  }

  const messages = sanitizeDimeChatHistory(req.body?.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    dimeLog("dime.chat.error", requestId, {
      errorClass: "ValidationError",
      statusCode: 400,
      detail: "Request must end with a user message",
    });
    res.status(400).json({ error: "Request must end with a user message." });
    return;
  }

  const requestClass = classifyDimeChatRequest(messages);
  const responseBudget = selectDimeChatResponseBudget(requestClass);
  const answerRoute = planDimeAnswerRoute(
    messages[messages.length - 1].content
  );
  const requestProviderMetadata = traceProviderMetadata(
    researchAlphaGate,
    responseBudget,
    answerRoute
  );

  dimeLog("dime.chat.request", requestId, {
    messageCount: messages.length,
    requestClass,
    responseBudget,
    answerMode: answerRoute.mode,
    answerRoutingVersion: answerRoute.version,
    requestedDate: answerRoute.requestedDate,
    dateSource: answerRoute.dateSource,
    league: answerRoute.league,
    retrievalCap: answerRoute.retrievalCap,
    retrievalBypassed: answerRoute.retrievalBypassed,
    dimeProfile: requestProviderMetadata.productProfile,
    profileVersion: requestProviderMetadata.profileVersion,
    blueprintHash: requestProviderMetadata.blueprintHash,
    promptSource: requestProviderMetadata.promptSource,
    platformKnowledgeVersion: requestProviderMetadata.platformKnowledgeVersion,
    platformKnowledgeSha256: requestProviderMetadata.platformKnowledgeSha256,
    lastMessageLength: messages[messages.length - 1].content.length,
  });

  let activeTrace: ActiveDimeChatTrace | undefined;
  if (isDimeChatTraceEnabled()) {
    const parsedTrace = parseDimeChatTraceEnvelope(req.body?.trace);
    if (parsedTrace.kind === "invalid") {
      dimeLog("dime.chat.trace.invalid", requestId, {
        errorClass: "ValidationError",
        statusCode: 400,
        fields: parsedTrace.issues,
      });
      res.status(400).json({
        error: "Invalid Dime Conversation Trace v1 metadata.",
      });
      return;
    }
    if (parsedTrace.kind === "valid") {
      try {
        const traceResult = await beginDimeChatTrace({
          requestId,
          userId: authedUser.userId,
          envelope: parsedTrace.value,
          userPrompt: messages.at(-1)?.content ?? "",
          history: messages,
          requestClass,
          responseBudget,
          provider: requestProviderMetadata,
        });
        if (traceResult.kind === "conflict") {
          res.status(409).json({ error: traceResult.reason });
          return;
        }
        if (traceResult.kind === "in_progress") {
          sendDimeChatTraceJsonError(
            res,
            409,
            "This Dime generation is already in progress.",
            traceResult.trace
          );
          return;
        }
        if (traceResult.kind === "terminal_error") {
          sendDimeChatTraceJsonError(
            res,
            409,
            "The prior attempt ended without a response. Use Retry to create a new generation attempt.",
            traceResult.trace
          );
          return;
        }
        if (traceResult.kind === "replay") {
          const sendReplay = startDimeSse(res, traceResult.trace);
          sendReplay({
            type: "meta",
            dataFreshness: traceResult.dataFreshness,
            replayed: true,
            evidenceIdentity: "trace_lookup",
            trace: dimeChatTraceMeta(traceResult.trace),
          });
          sendReplay({
            type: "delta",
            text: traceResult.servedOutput,
          });
          sendReplay({
            type: "done",
            stopReason: traceResult.stopReason,
            trace: dimeChatTraceMeta(
              traceResult.trace,
              traceResult.assistantMessageId
            ),
          });
          await appendDimeChatTraceEvent(
            traceResult.trace,
            "response_dispatched",
            {
              transport: "sse",
              delivery: "unknown",
              replayed: true,
            }
          ).catch(traceError => {
            dimeLog("dime.chat.trace.dispatch_event_error", requestId, {
              errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
            });
          });
          res.end();
          return;
        }
        activeTrace = traceResult.trace;
      } catch (traceError) {
        dimeLog("dime.chat.trace.begin_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
          statusCode: 503,
          detail: "No model call was made",
        });
        res.status(503).json({
          error:
            "Dime could not securely save your prompt. No model call was made.",
        });
        return;
      }
    }
  }

  const safety = assessDimeResponsibleGamblingSafety(
    messages.at(-1)?.content ?? "unknown"
  );
  if (safety.risk === "distress") {
    const servedOutput = `${DISTRESS_RESPONSE_PREFIX} ${safety.resourceText} If you want, I can help you step back and review bankroll limits without recommending a wager.`;
    let assistantMessageId: number | undefined;
    if (activeTrace) {
      try {
        await appendDimeChatTraceEvent(
          activeTrace,
          "responsible_gambling_intervention",
          { reason: safety.reason }
        );
        await recordDimeChatTraceContext(activeTrace, {
          freshness: "none",
          rowCount: 0,
          answerMode: answerRoute.mode,
          routingVersion: answerRoute.version,
          dateSource: answerRoute.dateSource,
          requestedDate: answerRoute.requestedDate,
          league: answerRoute.league,
          eventResolution: "not_applicable",
          groundingStatus: "none",
          retrievalCandidateCount: 0,
          retrievalLatencyMs: 0,
          confidence: 1,
        });
        const finalized = await finalizeDimeChatTrace(activeTrace, {
          rawOutput: servedOutput,
          servedOutput,
          status: "completed",
          finishReason: "safety_intervention",
          actualModel: "responsible-gambling-policy-v1",
          answerMode: answerRoute.mode,
          routingVersion: answerRoute.version,
          completenessStatus: "not_applicable",
          groundingStatus: "none",
          latencyMs: Date.now() - startTime,
        });
        assistantMessageId = finalized.assistantMessageId;
      } catch (traceError) {
        await failDimeChatTrace(activeTrace, {
          status: "failed",
          errorClass: "SafetyPersistenceError",
          errorCode: "safety_write_failed",
          latencyMs: Date.now() - startTime,
        }).catch(() => undefined);
        dimeLog("dime.chat.trace.safety_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
        sendDimeChatTraceJsonError(
          res,
          503,
          "Dime could not securely save the safety response.",
          activeTrace
        );
        return;
      }
    }
    dimeLog("dime.chat.safety_intervention", requestId, {
      reason: safety.reason,
    });
    const sendSafety = startDimeSse(res, activeTrace);
    sendSafety({
      type: "meta",
      dataFreshness: "none",
      answerMode: answerRoute.mode,
      answerRoutingVersion: answerRoute.version,
      eventResolution: "not_applicable",
      groundingStatus: "none",
      ...(activeTrace ? { trace: dimeChatTraceMeta(activeTrace) } : {}),
    });
    sendSafety({ type: "delta", text: servedOutput });
    sendSafety({
      type: "done",
      stopReason: "safety_intervention",
      ...(activeTrace
        ? {
            trace: dimeChatTraceMeta(activeTrace, assistantMessageId),
          }
        : {}),
    });
    if (activeTrace) {
      await appendDimeChatTraceEvent(activeTrace, "response_dispatched", {
        transport: "sse",
        delivery: "unknown",
      }).catch(traceError => {
        dimeLog("dime.chat.trace.dispatch_event_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
      });
    }
    res.end();
    return;
  }

  // Deterministic betting math is resolved before provider configuration,
  // context retrieval, or provider execution.
  if (
    await handleDimeDeterministicMathResponse({
      res,
      requestId,
      startTime,
      answerRoute,
      trace: activeTrace,
      log: dimeLog,
      meta: {
        dimeProfile: requestProviderMetadata.productProfile,
        profileVersion: requestProviderMetadata.profileVersion,
        promptSource: requestProviderMetadata.promptSource,
      },
    })
  ) {
    return;
  }

  // Credentials are only required when the Anthropic provider is live. A
  // Trace-v1 prompt is already canonical at this point, so configuration
  // failures are recorded as terminal attempts without a provider call.
  if (DIME_CHAT_LLM_PROVIDER === "anthropic" && !hasAnthropicCredentials()) {
    if (activeTrace) {
      await failDimeChatTrace(activeTrace, {
        status: "failed",
        errorClass: "ConfigurationError",
        errorCode: "anthropic_not_configured",
        latencyMs: Date.now() - startTime,
      }).catch(() => undefined);
    }
    dimeLog("dime.chat.error", requestId, {
      errorClass: "ConfigurationError",
      statusCode: 500,
      detail: "Anthropic credentials not configured",
    });
    const error =
      "Anthropic credentials are not configured. Set ANTHROPIC_API_KEY (direct) or ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL (AI Gateway).";
    if (activeTrace) {
      sendDimeChatTraceJsonError(res, 500, error, activeTrace);
    } else {
      res.status(500).json({ error });
    }
    return;
  }

  // --- DIME RESEARCH ALPHA: temporary official Llama Instruct control.
  // This lane is independent of the governed Dime 1.0 provider, which stays
  // hardcoded frozen. The fail-closed gate requires two off switches, an
  // explicit non-production acknowledgement, a private credentialed endpoint,
  // and the exact pinned control-model identity. ---
  if (researchAlphaGate.active) {
    dimeLog("dime.chat.research_alpha.start", requestId, {
      deploymentTier: researchAlphaGate.deploymentTier,
      model: researchAlphaGate.model,
      revision: researchAlphaGate.revision,
      endpointSource: researchAlphaGate.endpointSource,
    });
    await handleDime1ChatRequest({
      req,
      res,
      requestId,
      startTime,
      messages,
      requestClass,
      responseBudget,
      answerRoute,
      systemPrompt:
        requestProviderMetadata.systemPrompt ??
        DIME_RESEARCH_ALPHA_SYSTEM_PROMPT,
      deploymentTier: "research-alpha",
      trace: activeTrace,
    });
    return;
  }

  // --- DIME 1.0 PROVIDER (future scaffold): no production checkpoint,
  // endpoint, or provider activation is approved. This branch remains above
  // the frozen guard only to preserve the existing integration contract.
  // Activation requires a separate owner-authorized promotion PR after the
  // canonical ml/dime-1.0 release gates pass. ---
  if (DIME_CHAT_LLM_PROVIDER === "dime1") {
    await handleDime1ChatRequest({
      req,
      res,
      requestId,
      startTime,
      messages,
      requestClass,
      responseBudget,
      answerRoute,
      systemPrompt: requestProviderMetadata.systemPrompt ?? DIME1_SYSTEM_PROMPT,
      trace: activeTrace,
    });
    return;
  }

  // --- PROVIDER FREEZE (2026-07-12): while DIME_CHAT_LLM_PROVIDER is
  // "frozen", the Dime Chat interface must not use the Anthropic API to
  // respond. Short-circuit here — before context building, before
  // createAnthropicClient(), before any messages.stream() call — and answer
  // with a hardcoded notice over the same SSE frame contract the client
  // already parses (meta → delta → done). The entire Claude streaming path
  // below is intentionally left wired for when the provider is switched
  // back on. ---
  if (DIME_CHAT_LLM_PROVIDER !== "anthropic") {
    let assistantMessageId: number | undefined;
    if (activeTrace) {
      try {
        await recordDimeChatTraceContext(activeTrace, {
          freshness: "none",
          rowCount: 0,
          answerMode: answerRoute.mode,
          routingVersion: answerRoute.version,
          dateSource: answerRoute.dateSource,
          requestedDate: answerRoute.requestedDate,
          league: answerRoute.league,
          eventResolution: "not_applicable",
          groundingStatus: "none",
          retrievalCandidateCount: 0,
          retrievalLatencyMs: 0,
          confidence: 1,
        });
        const finalized = await finalizeDimeChatTrace(activeTrace, {
          rawOutput: DIME_CHAT_FROZEN_NOTICE,
          servedOutput: DIME_CHAT_FROZEN_NOTICE,
          status: "completed",
          finishReason: "provider_frozen",
          actualModel: "no-provider",
          answerMode: answerRoute.mode,
          routingVersion: answerRoute.version,
          completenessStatus: "not_applicable",
          groundingStatus: "none",
          latencyMs: Date.now() - startTime,
        });
        assistantMessageId = finalized.assistantMessageId;
      } catch (traceError) {
        await failDimeChatTrace(activeTrace, {
          status: "failed",
          errorClass: "FrozenNoticePersistenceError",
          errorCode: "frozen_notice_write_failed",
          latencyMs: Date.now() - startTime,
        }).catch(() => undefined);
        dimeLog("dime.chat.trace.frozen_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
        sendDimeChatTraceJsonError(
          res,
          503,
          "Dime could not securely save this response.",
          activeTrace
        );
        return;
      }
    }
    const sendFrozen = startDimeSse(res, activeTrace);

    dimeLog("dime.chat.provider_frozen", requestId, {
      provider: DIME_CHAT_LLM_PROVIDER,
      detail: "No model-provider call made; hardcoded notice streamed",
      latencyMs: Date.now() - startTime,
    });

    sendFrozen({
      type: "meta",
      dataFreshness: "none",
      answerMode: answerRoute.mode,
      answerRoutingVersion: answerRoute.version,
      eventResolution: "not_applicable",
      groundingStatus: "none",
      ...(activeTrace ? { trace: dimeChatTraceMeta(activeTrace) } : {}),
    });
    sendFrozen({ type: "delta", text: DIME_CHAT_FROZEN_NOTICE });
    sendFrozen({
      type: "done",
      stopReason: "end_turn",
      ...(activeTrace
        ? {
            trace: dimeChatTraceMeta(activeTrace, assistantMessageId),
          }
        : {}),
    });
    if (activeTrace) {
      await appendDimeChatTraceEvent(activeTrace, "response_dispatched", {
        transport: "sse",
        delivery: "unknown",
      }).catch(traceError => {
        dimeLog("dime.chat.trace.dispatch_event_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
      });
    }
    res.end();
    return;
  }

  let dataFreshness: "live" | "delayed" | "none" = "none";
  let contextSnapshot: string | undefined;
  let contextRowCount = 0;
  let contextEventIds: number[] = [];
  let contextLookupErrorClass: string | undefined;
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
            "Understood. I will ground Dime Chat answers in this platform context and clearly say when a requested market is missing.",
        }
      );
    }

    dimeLog("dime.chat.context", requestId, {
      dataFreshness,
      rowCount: context.rowCount,
      eventIds: context.eventIds,
      answerMode: context.route.mode,
      eventResolution: context.resolution.kind,
      groundingStatus: context.grounding,
      retrievalCandidateCount: context.retrievalCandidateCount,
      retrievalLatencyMs: context.retrievalLatencyMs,
    });
  } catch (contextErr) {
    dataFreshness = "none";
    contextLookupErrorClass =
      (contextErr as Error)?.constructor?.name ?? "Unknown";
    dimeLog("dime.chat.context_error", requestId, {
      errorClass: contextLookupErrorClass,
      detail: (contextErr as Error)?.message ?? "Context lookup failed",
    });
  }

  if (activeTrace) {
    try {
      await recordDimeChatTraceContext(activeTrace, {
        freshness: dataFreshness,
        rowCount: contextRowCount,
        eventIds: contextEventIds,
        context: contextSnapshot,
        lookupErrorClass: contextLookupErrorClass,
        answerMode: answerEvidence.route.mode,
        routingVersion: answerEvidence.route.version,
        dateSource: answerEvidence.route.dateSource,
        requestedDate: answerEvidence.route.requestedDate,
        league: answerEvidence.route.league,
        eventResolution: answerEvidence.resolution.kind,
        groundingStatus: answerEvidence.grounding,
        retrievalCandidateCount: answerEvidence.retrievalCandidateCount,
        retrievalLatencyMs: answerEvidence.retrievalLatencyMs,
        confidence: answerEvidence.resolution.confidence,
      });
    } catch (traceError) {
      await failDimeChatTrace(activeTrace, {
        status: "failed",
        errorClass: "TraceContextPersistenceError",
        errorCode: "trace_context_write_failed",
        latencyMs: Date.now() - startTime,
      }).catch(() => undefined);
      dimeLog("dime.chat.trace.context_error", requestId, {
        errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
      });
      sendDimeChatTraceJsonError(
        res,
        503,
        "Dime could not securely record this generation. No model call was made.",
        activeTrace
      );
      return;
    }
  }

  // --- SSE headers ---
  const send = startDimeSse(res, activeTrace);

  // Additive data-freshness declaration for the client DataPill. Older clients
  // ignore unknown frame types.
  send({
    type: "meta",
    dataFreshness,
    dimeProfile: DIME_CHAT_PROFILE_METADATA.productProfile,
    profileVersion: DIME_CHAT_PROFILE_METADATA.profileVersion,
    promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
    platformKnowledgeVersion: DIME_PLATFORM_KNOWLEDGE_VERSION,
    platformKnowledgeSha256: DIME_PLATFORM_KNOWLEDGE_SHA256,
    requestClass,
    responseBudget,
    answerMode: answerRoute.mode,
    answerRoutingVersion: answerRoute.version,
    eventResolution: answerEvidence.resolution.kind,
    groundingStatus: answerEvidence.grounding,
    routingConfidence: answerEvidence.resolution.confidence,
    ...(activeTrace ? { trace: dimeChatTraceMeta(activeTrace) } : {}),
  });

  const anthropic = createAnthropicClient();
  const abort = new AbortController();
  let aborted = false;

  res.once("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      abort.abort();
      dimeLog("dime.chat.aborted", requestId, {
        latencyMs: Date.now() - startTime,
      });
    }
  });

  dimeLog("dime.chat.stream.start", requestId, {
    model: DIME_CHAT_MODEL,
    historyLength: providerMessages.length,
    requestClass,
    responseBudget,
    answerMode: answerRoute.mode,
    answerRoutingVersion: answerRoute.version,
    eventResolution: answerEvidence.resolution.kind,
    groundingStatus: answerEvidence.grounding,
    promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
  });

  let traceFinalized = false;
  try {
    const stream = anthropic.messages.stream(
      {
        model: DIME_CHAT_MODEL,
        max_tokens: responseBudget,
        system: requestProviderMetadata.systemPrompt ?? DIME_CHAT_SYSTEM_PROMPT,
        messages: providerMessages,
      },
      { signal: abort.signal }
    );

    let output = "";
    stream.on("text", delta => {
      output += delta;
    });

    const final = await stream.finalMessage();
    if (aborted || res.destroyed) {
      if (activeTrace) {
        await failDimeChatTrace(activeTrace, {
          status: "aborted",
          errorClass: "ClientDisconnected",
          errorCode: "client_disconnected_before_finalize",
          latencyMs: Date.now() - startTime,
        });
      }
      return;
    }
    const validation = validateDimeResponseText(output);
    const certaintyViolation = containsProhibitedBettingCertainty(output);
    const completeness = validateDimeResponseCompleteness(
      answerEvidence,
      output
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

    dimeLog("dime.chat.stream.done", requestId, {
      stopReason: final.stop_reason,
      outputCharCount: output.length,
      latencyMs: Date.now() - startTime,
      verificationStatus:
        validation.ok && !certaintyViolation && !completenessBlocked
          ? "passed"
          : "blocked",
      validationErrors: combinedValidationErrors,
      certaintyViolation,
      completenessStatus: completeness.status,
      usage: final.usage,
    });

    if (!validation.ok || certaintyViolation || completenessBlocked) {
      let assistantMessageId: number | undefined;
      if (activeTrace) {
        const finalized = await finalizeDimeChatTrace(activeTrace, {
          rawOutput: output,
          servedOutput: servedBlockedOutput,
          status: "blocked",
          finishReason: blockedFinishReason,
          actualModel: final.model,
          validationErrors: combinedValidationErrors,
          certaintyViolation,
          answerMode: answerRoute.mode,
          routingVersion: answerRoute.version,
          completenessStatus: completeness.status,
          groundingStatus: answerEvidence.grounding,
          usage: {
            promptTokens: final.usage.input_tokens,
            completionTokens: final.usage.output_tokens,
            totalTokens: final.usage.input_tokens + final.usage.output_tokens,
          },
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
        ...(activeTrace
          ? {
              trace: dimeChatTraceMeta(activeTrace, assistantMessageId),
            }
          : {}),
      });
      if (activeTrace) {
        await appendDimeChatTraceEvent(activeTrace, "response_dispatched", {
          transport: "sse",
          delivery: "unknown",
        }).catch(traceError => {
          dimeLog("dime.chat.trace.dispatch_event_error", requestId, {
            errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
          });
        });
      }
      return;
    }

    let assistantMessageId: number | undefined;
    if (activeTrace) {
      const finalized = await finalizeDimeChatTrace(activeTrace, {
        rawOutput: output,
        servedOutput: output,
        status: "completed",
        finishReason: final.stop_reason,
        actualModel: final.model,
        validationErrors: combinedValidationErrors,
        certaintyViolation,
        answerMode: answerRoute.mode,
        routingVersion: answerRoute.version,
        completenessStatus: completeness.status,
        groundingStatus: answerEvidence.grounding,
        usage: {
          promptTokens: final.usage.input_tokens,
          completionTokens: final.usage.output_tokens,
          totalTokens: final.usage.input_tokens + final.usage.output_tokens,
        },
        latencyMs: Date.now() - startTime,
      });
      assistantMessageId = finalized.assistantMessageId;
      traceFinalized = true;
    }
    send({ type: "delta", text: output });
    send({
      type: "done",
      stopReason: final.stop_reason,
      completenessStatus: completeness.status,
      ...(activeTrace
        ? {
            trace: dimeChatTraceMeta(activeTrace, assistantMessageId),
          }
        : {}),
    });
    if (activeTrace) {
      await appendDimeChatTraceEvent(activeTrace, "response_dispatched", {
        transport: "sse",
        delivery: "unknown",
      }).catch(traceError => {
        dimeLog("dime.chat.trace.dispatch_event_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
      });
    }
  } catch (err: unknown) {
    if (activeTrace && !traceFinalized) {
      await failDimeChatTrace(activeTrace, {
        status: aborted ? "aborted" : "failed",
        errorClass:
          (err as Error)?.constructor?.name ??
          (aborted ? "AbortError" : "Unknown"),
        errorCode:
          err instanceof Anthropic.APIError
            ? `http_${err.status}`
            : aborted
              ? "client_disconnected"
              : "generation_failed",
        latencyMs: Date.now() - startTime,
      }).catch(traceError => {
        dimeLog("dime.chat.trace.failure_record_error", requestId, {
          errorClass: (traceError as Error)?.constructor?.name ?? "Unknown",
        });
      });
    }
    if (!aborted) {
      const isApiError = err instanceof Anthropic.APIError;
      const message = isApiError
        ? `Model error (${err.status}).`
        : "Dime hit a connection problem.";

      dimeLog("dime.chat.error", requestId, {
        errorClass: isApiError
          ? "APIError"
          : ((err as Error)?.constructor?.name ?? "Unknown"),
        statusCode: isApiError ? err.status : undefined,
        latencyMs: Date.now() - startTime,
      });

      send({
        type: "error",
        message,
        ...(activeTrace ? { trace: dimeChatTraceMeta(activeTrace) } : {}),
      });
    }
  } finally {
    res.end();
  }
});

/**
 * Mount the Dime chat route on the Express app.
 * Call this in server/_core/index.ts between existing route registrations and tRPC.
 */
export function registerDimeChatRoute(app: Express) {
  app.use("/api/dime", dimeChatRouter);
}
