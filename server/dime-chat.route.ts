/**
 * Dime AI — Chat route
 * ---------------------------------------------------------------
 * POST /api/dime/chat
 * Streams Claude Fable 5 responses via Server-Sent Events (SSE).
 *
 * Env:  ANTHROPIC_API_KEY (direct) — or ANTHROPIC_AUTH_TOKEN +
 *       ANTHROPIC_BASE_URL to route through Vercel AI Gateway
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
import { canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE } from "./dimeModelAccess";
import { createAnthropicClient, hasAnthropicCredentials } from "./_core/anthropicClient";
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
import { handleDime1ChatRequest } from "./_core/dime1ChatHandler";
import { validateDimeResponseText } from "./_core/dimeVerdict";
import { assessDimeResponsibleGamblingSafety, containsProhibitedBettingCertainty } from "./_core/dimeSafety";
import {
  checkDimeChatRateLimit,
  DIME_CHAT_RATE_LIMIT_WINDOW_MS,
} from "./dimeChatRateLimit";

// ---------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------
function dimeLog(event: string, requestId: string, data: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString();
  console.log(
    `[Dime] [${timestamp}] [${requestId}] ${event}`,
    Object.keys(data).length > 0 ? JSON.stringify(data) : ""
  );
}

// ---------------------------------------------------------------
// Auth — app_session JWT (legacy OAuth has no Railway-reachable server)
// ---------------------------------------------------------------
async function authenticateDimeRequest(req: Request): Promise<{ userId: number; role: string } | null> {
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
        console.log(`[DimeAuth] REJECTED — tokenVersion mismatch: jwt.tv=${tv} db.tv=${user.tokenVersion} userId=${userId}`);
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

  // --- SEC-CRIT: Entitlement gate — reject every non-owner request before any
  // Claude call or SSE stream (owner-only policy, dimeModelAccess.ts). Runs
  // BEFORE the provider-freeze branch so non-owners get a 403, never the
  // frozen-notice stream. Checked per-request against the DB, closing the
  // hasAccess-revocation bypass (stripeWebhook.ts revokes without bumping
  // tokenVersion) and the stale-JWT-role bypass. ---
  const entitled = await checkDimeChatEntitlement(authedUser.userId);
  if (!entitled) {
    dimeLog("dime.chat.entitlement_rejected", requestId, {
      errorClass: "AuthorizationError",
      statusCode: 403,
      userId: authedUser.userId,
      detail: "Owner-only access — non-owner rejected",
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
    res.setHeader("Retry-After", Math.ceil(DIME_CHAT_RATE_LIMIT_WINDOW_MS / 1000).toString());
    res.status(429).json({ error: "You're sending messages too quickly. Please wait a moment." });
    return;
  }

  // Credentials are only required when the Anthropic provider is live; the
  // frozen path makes no provider call and must not 500 on missing creds.
  if (DIME_CHAT_LLM_PROVIDER === "anthropic" && !hasAnthropicCredentials()) {
    dimeLog("dime.chat.error", requestId, {
      errorClass: "ConfigurationError",
      statusCode: 500,
      detail: "Anthropic credentials not configured",
    });
    res.status(500).json({
      error:
        "Anthropic credentials are not configured. Set ANTHROPIC_API_KEY (direct) or ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL (AI Gateway).",
    });
    return;
  }

  const messages = sanitizeDimeChatHistory(req.body?.messages);
  const requestClass = classifyDimeChatRequest(messages);
  const responseBudget = selectDimeChatResponseBudget(requestClass);

  dimeLog("dime.chat.request", requestId, {
    messageCount: messages.length,
    requestClass,
    responseBudget,
    dimeProfile: DIME_CHAT_PROFILE_METADATA.productProfile,
    profileVersion: DIME_CHAT_PROFILE_METADATA.profileVersion,
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
    promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
    lastMessageLength: messages.length > 0 ? messages[messages.length - 1].content.length : 0,
  });

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    dimeLog("dime.chat.error", requestId, {
      errorClass: "ValidationError",
      statusCode: 400,
      detail: "Request must end with a user message",
    });
    res.status(400).json({ error: "Request must end with a user message." });
    return;
  }

  const safety = assessDimeResponsibleGamblingSafety(messages.at(-1)?.content ?? "unknown");
  if (safety.risk === "distress") {
    dimeLog("dime.chat.safety_intervention", requestId, { reason: safety.reason });
    res.status(200).json({ message: `I can’t help you chase losses or size another bet from distress. ${safety.resourceText} If you want, I can help you step back and review bankroll limits without recommending a wager.` });
    return;
  }

  // --- DIME 1.0 PROVIDER (v1): self-hosted Llama-3-based Dime 1.0 served
  // 4-bit by vLLM from a private RunPod Serverless endpoint. Railway stays
  // the control plane — auth, entitlement, rate limits, and the distress
  // screen already ran above; retrieval grounding, prompt construction, and
  // post-generation validation run inside the handler. Only generation
  // leaves the box. This branch sits ABOVE the frozen guard and delegates
  // to a separate module so the freeze contract tests keep pinning the
  // frozen branch as the single barrier in front of the Claude path. ---
  if (DIME_CHAT_LLM_PROVIDER === "dime1") {
    await handleDime1ChatRequest({ req, res, requestId, startTime, messages, requestClass, responseBudget });
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
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendFrozen = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    dimeLog("dime.chat.provider_frozen", requestId, {
      provider: DIME_CHAT_LLM_PROVIDER,
      detail: "No model-provider call made; hardcoded notice streamed",
      latencyMs: Date.now() - startTime,
    });

    sendFrozen({ type: "meta", dataFreshness: "none" });
    sendFrozen({ type: "delta", text: DIME_CHAT_FROZEN_NOTICE });
    sendFrozen({ type: "done", stopReason: "end_turn" });
    res.end();
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
            "Understood. I will ground Dime Chat answers in this platform context and clearly say when a requested market is missing.",
        },
      );
    }

    dimeLog("dime.chat.context", requestId, {
      dataFreshness,
      rowCount: context.rowCount,
    });
  } catch (contextErr) {
    dataFreshness = "none";
    dimeLog("dime.chat.context_error", requestId, {
      errorClass: (contextErr as Error)?.constructor?.name ?? "Unknown",
      detail: (contextErr as Error)?.message ?? "Context lookup failed",
    });
  }

  // --- SSE headers ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Additive data-freshness declaration for the client DataPill. Older clients
  // ignore unknown frame types.
  send({
    type: "meta",
    dataFreshness,
    dimeProfile: DIME_CHAT_PROFILE_METADATA.productProfile,
    profileVersion: DIME_CHAT_PROFILE_METADATA.profileVersion,
    promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
    requestClass,
    responseBudget,
  });

  const anthropic = createAnthropicClient();
  const abort = new AbortController();
  let aborted = false;

  req.on("close", () => {
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
    historyLength: messages.length,
    requestClass,
    responseBudget,
    promptSource: DIME_CHAT_PROFILE_METADATA.promptSource,
    blueprintHash: DIME_CHAT_PROFILE_METADATA.blueprintHash,
  });

  try {
    const stream = anthropic.messages.stream(
      {
        model: DIME_CHAT_MODEL,
        max_tokens: responseBudget,
        system: DIME_CHAT_SYSTEM_PROMPT,
        messages,
      },
      { signal: abort.signal },
    );

    let output = "";
    stream.on("text", (delta) => {
      output += delta;
    });

    const final = await stream.finalMessage();
    const validation = validateDimeResponseText(output);
    const certaintyViolation = containsProhibitedBettingCertainty(output);

    dimeLog("dime.chat.stream.done", requestId, {
      stopReason: final.stop_reason,
      outputCharCount: output.length,
      latencyMs: Date.now() - startTime,
      verificationStatus: validation.ok && !certaintyViolation ? "passed" : "blocked",
      validationErrors: validation.errors,
      certaintyViolation,
      usage: final.usage,
    });

    if (!validation.ok || certaintyViolation) {
      send({
        type: "delta",
        text: "I can’t verify that betting verdict against grounded Dime data, so I’m blocking it rather than risking a fabricated edge. Please provide the event, market, current line/odds, sportsbook, timestamp, and model projection/version so I can evaluate it safely.",
      });
      send({ type: "done", stopReason: "validation_blocked" });
      return;
    }

    send({ type: "delta", text: output });
    send({ type: "done", stopReason: final.stop_reason });
  } catch (err: unknown) {
    if (!aborted) {
      const isApiError = err instanceof Anthropic.APIError;
      const message = isApiError
        ? `Model error (${err.status}).`
        : "Dime hit a connection problem.";

      dimeLog("dime.chat.error", requestId, {
        errorClass: isApiError ? "APIError" : (err as Error)?.constructor?.name ?? "Unknown",
        statusCode: isApiError ? err.status : undefined,
        latencyMs: Date.now() - startTime,
      });

      send({ type: "error", message });
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
