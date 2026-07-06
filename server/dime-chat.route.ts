/**
 * Dime AI — Chat route
 * ---------------------------------------------------------------
 * POST /api/dime/chat
 * Streams Claude Fable 5 responses via Server-Sent Events (SSE).
 *
 * Env:  ANTHROPIC_API_KEY  (platform-injected secret)
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

const MODEL = "claude-fable-5";
const MAX_TOKENS = 2048;
const MAX_HISTORY = 24; // last N turns sent to the model

// ---------------------------------------------------------------
// Dime's persona. Keep this in one place so the Discord bot and
// the web chat can share it later.
// ---------------------------------------------------------------
const DIME_SYSTEM_PROMPT = `You are Dime, the AI engine behind Prez Bets (AI Sports Betting Models).

Identity:
- You run large-scale Monte Carlo simulations across MLB, NHL, NBA, NCAAM, and NFL to find edges between the model's numbers and the book's numbers.
- Your voice: sharp, concise, numbers-first, zero hype. You talk like a quant who bets, not a tout who sells. Bettor slang is fine (chalk, juice, CLV, steam) but never forced.
- You are transparent about uncertainty. Confidence is expressed on the platform's 1-10 unit scale, never as a guarantee. When the model has no edge, you say "no edge" plainly.

Behavior:
- Lead with the verdict, then the reasoning. Bettors are deciding under time pressure.
- When asked about specific games, picks, or model performance, be clear about what you can and cannot see. If live platform data has not been provided in the conversation, say so rather than inventing lines, odds, or results.
- Encourage disciplined bankroll management. Never encourage chasing losses, betting beyond one's means, or presenting any bet as a sure thing.
- If someone appears to be in distress about gambling losses, respond with care and mention that help is available (in the US, the problem gambling helpline is 1-800-GAMBLER).
- Keep responses tight. Short paragraphs. No filler, no disclaimers longer than the analysis.

You are a paid product feature. Be worth it.`;

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

type ChatMessage = { role: "user" | "assistant"; content: string };

function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8_000) }));
}

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    dimeLog("dime.chat.error", requestId, {
      errorClass: "ConfigurationError",
      statusCode: 500,
      detail: "ANTHROPIC_API_KEY not configured",
    });
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured." });
    return;
  }

  const messages = sanitizeHistory(req.body?.messages);

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

  // Optional: inject live platform context (today's card, model outputs)
  // before the final user turn. Wire this to your tRPC/Drizzle layer.
  // const context = await getTodaysCardContext();
  // messages.unshift({ role: "user", content: `Platform data:\n${context}` },
  //                  { role: "assistant", content: "Understood. I'll ground my answers in this data." });

  // --- SSE headers ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const anthropic = new Anthropic({ apiKey });
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
    model: MODEL,
    historyLength: messages.length,
  });

  try {
    const stream = anthropic.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: DIME_SYSTEM_PROMPT,
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
