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
import { sdk } from "./_core/sdk";
import { createAnthropicClient, hasAnthropicCredentials } from "./_core/anthropicClient";
import {
  DIME_CHAT_MAX_TOKENS,
  DIME_CHAT_MODEL,
  DIME_CHAT_SYSTEM_PROMPT,
  DIME_CHAT_SYSTEM_PROMPT_SOURCE,
  sanitizeDimeChatHistory,
} from "./_core/dimeChatModel";
import { getDimeChatContext } from "./_core/dimeChatContext";

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

const dimeChatRouter = Router();

dimeChatRouter.post("/chat", async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // --- A2: Backend auth gate — reject unauthenticated requests before any Claude call ---
  try {
    await sdk.authenticateRequest(req);
  } catch (authErr) {
    dimeLog("dime.chat.auth_rejected", requestId, {
      errorClass: "AuthenticationError",
      statusCode: 401,
      detail: "Unauthenticated request rejected",
    });
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  if (!hasAnthropicCredentials()) {
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

  dimeLog("dime.chat.request", requestId, {
    messageCount: messages.length,
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
  send({ type: "meta", dataFreshness });

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
    promptSource: DIME_CHAT_SYSTEM_PROMPT_SOURCE,
  });

  try {
    const stream = anthropic.messages.stream(
      {
        model: DIME_CHAT_MODEL,
        max_tokens: DIME_CHAT_MAX_TOKENS,
        system: DIME_CHAT_SYSTEM_PROMPT,
        messages,
      },
      { signal: abort.signal },
    );

    let outputChars = 0;
    stream.on("text", (delta) => {
      outputChars += delta.length;
      send({ type: "delta", text: delta });
    });

    const final = await stream.finalMessage();

    dimeLog("dime.chat.stream.done", requestId, {
      stopReason: final.stop_reason,
      outputCharCount: outputChars,
      latencyMs: Date.now() - startTime,
    });

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
