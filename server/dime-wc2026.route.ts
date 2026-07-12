/**
 * Dime WC2026 Intelligence Route
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/dime/wc2026
 *
 * Tier 4 Dime Intelligence Layer — authenticated, credit-gated, source-grounded,
 * refusal-safe, 22-path validated.
 *
 * 14-Step Enforcement Order:
 *   1. request_id generated
 *   2. backend auth check (app_session JWT)
 *   3. user identity resolved
 *   4. subscription entitlement check
 *   5. credit balance check
 *   6. rate limit check
 *   7. request validation
 *   8. intent classification
 *   9. context builder (WC2026)
 *  10. context validation
 *  11. Claude/API call
 *  12. usage log
 *  13. credit deduction
 *  14. response log
 *
 * NO Claude call occurs before steps 1-10 pass.
 * NO credit deduction occurs before successful response.
 */
import { Router, type Request, type Response, type Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, hasAnthropicCredentials } from "./_core/anthropicClient";
import crypto from "crypto";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { getAppUserById } from "./db";
import { sql } from "drizzle-orm";
import { canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE } from "./dimeModelAccess";

// ─── Constants ───────────────────────────────────────────────────────────────
const MODEL = "claude-fable-5";
const MAX_TOKENS = 2048;
const MAX_HISTORY = 12;
const CREDITS_PER_ANSWER = 1;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // per user per window
const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES = 20;

// ─── Rate limit store (in-memory, per-user) ──────────────────────────────────
const rateLimitStore = new Map<number, { count: number; windowStart: number }>();

// ─── Response Modes ──────────────────────────────────────────────────────────
type ResponseMode = "ANSWER" | "REFUSE" | "CLARIFY" | "PASS_ONLY" | "INTERNAL_ERROR";

// ─── Refusal Reasons ─────────────────────────────────────────────────────────
type RefusalReason =
  | "AUTH_REQUIRED"
  | "SUBSCRIPTION_REQUIRED"
  | "INSUFFICIENT_CREDITS"
  | "NO_CONTEXT"
  | "MATCH_NOT_FOUND"
  | "MARKET_NOT_SUPPORTED"
  | "ODDS_MISSING"
  | "ODDS_STALE"
  | "MARKET_CLOSED"
  | "MODEL_PROJECTION_MISSING"
  | "EDGE_MISSING"
  | "LINEUP_MISSING"
  | "PLAYER_STATS_MISSING"
  | "CLV_MISSING"
  | "UNSUPPORTED_PROP"
  | "RATE_LIMITED"
  | "REQUEST_TOO_LARGE"
  | "DUPLICATE_REQUEST";

// ─── Structured Logging ──────────────────────────────────────────────────────
function dimeLog(event: string, requestId: string, data: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString();
  console.log(
    `[DimeWC2026] [${timestamp}] [${requestId}] ${event}`,
    Object.keys(data).length > 0 ? JSON.stringify(data) : ""
  );
}

// ─── Auth Helper ─────────────────────────────────────────────────────────────
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

// ─── Entitlement Check ───────────────────────────────────────────────────────
// OWNER-ONLY LOCKDOWN (2026-07-12): the Dime model answers role="owner"
// accounts only (@prez, @sippi) — see server/dimeModelAccess.ts. Admins and
// Stripe subscribers are NOT entitled while the lockdown is in effect.
async function checkSubscription(userId: number): Promise<{ valid: boolean; reason?: string }> {
  const user = await getAppUserById(userId);
  if (!user) return { valid: false, reason: "USER_NOT_FOUND" };
  if (!user.hasAccess) return { valid: false, reason: "ACCESS_REVOKED" };
  if (user.expiryDate && Date.now() > user.expiryDate) return { valid: false, reason: "SUBSCRIPTION_EXPIRED" };
  if (!canAccessDimeModel(user)) return { valid: false, reason: "OWNER_ONLY" };
  return { valid: true };
}

// ─── Credit Check ────────────────────────────────────────────────────────────
async function checkCredits(userId: number): Promise<{ sufficient: boolean; balance: number }> {
  const db = await getDb();
  if (!db) return { sufficient: false, balance: 0 };
  const result = await db.execute(
    sql`SELECT COALESCE(
      (SELECT balance_after FROM dime_credit_ledger WHERE user_id = ${String(userId)} ORDER BY id DESC LIMIT 1),
      100
    ) AS balance`
  );
  const rows = (result as any)[0];
  const balance = rows?.[0]?.balance ?? 100; // Default 100 credits for new users
  return { sufficient: balance >= CREDITS_PER_ANSWER, balance: Number(balance) };
}

// ─── Rate Limit Check ────────────────────────────────────────────────────────
function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return true; // allowed
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return false; // rate limited
  entry.count++;
  return true;
}

// ─── Credit Deduction (ATOMIC — DB-001 fix) ─────────────────────────────────
// Uses a transaction with SELECT ... FOR UPDATE to prevent double-spend under
// concurrent requests. Returns new balance, or -1 if insufficient credits.
async function deductCredits(userId: number, requestId: string, amount: number): Promise<number> {
  const db = await getDb();
  if (!db) return -1;

  // Atomic transaction: lock the latest ledger row, check balance, insert new row
  const result = await db.transaction(async (tx: any) => {
    // Lock the latest ledger entry for this user (SELECT ... FOR UPDATE)
    const balResult = await tx.execute(
      sql`SELECT COALESCE(
        (SELECT balance_after FROM dime_credit_ledger WHERE user_id = ${String(userId)} ORDER BY id DESC LIMIT 1 FOR UPDATE),
        100
      ) AS balance`
    );
    const rows = (balResult as any)[0];
    const currentBalance = Number(rows?.[0]?.balance ?? 100);

    // Insufficient credits — abort transaction
    if (currentBalance < amount) {
      return -1;
    }

    const newBalance = currentBalance - amount;
    await tx.execute(
      sql`INSERT INTO dime_credit_ledger (user_id, request_id, delta_credits, balance_after, reason)
          VALUES (${String(userId)}, ${requestId}, ${-amount}, ${newBalance}, 'DIME_WC2026_ANSWER')`
    );
    return newBalance;
  });

  return result;
}

// ─── Audit Logging ───────────────────────────────────────────────────────────
async function logRequestAudit(data: {
  requestId: string;
  userId: string | null;
  authStatus: string;
  entitlementStatus?: string;
  creditStatus?: string;
  intent?: string;
  contextStatus?: string;
  responseStatus?: string;
  tokensUsed?: number;
  creditsCharged?: number;
  refusalReason?: string;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(
      sql`INSERT INTO dime_request_audit
          (request_id, user_id, auth_status, entitlement_status, credit_status, intent, context_status, response_status, tokens_used, credits_charged, refusal_reason)
          VALUES (
            ${data.requestId},
            ${data.userId},
            ${data.authStatus},
            ${data.entitlementStatus ?? null},
            ${data.creditStatus ?? null},
            ${data.intent ?? null},
            ${data.contextStatus ?? null},
            ${data.responseStatus ?? null},
            ${data.tokensUsed ?? null},
            ${data.creditsCharged ?? null},
            ${data.refusalReason ?? null}
          )`
    );
  } catch (err) {
    console.error("[DimeWC2026] Failed to log request audit:", err);
  }
}

async function logResponseAudit(data: {
  requestId: string;
  userId: string;
  responseMode: ResponseMode;
  refusalReason?: string;
  contextHash?: string;
  tokensInput?: number;
  tokensOutput?: number;
  creditsCharged: number;
  answerHash?: string;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(
      sql`INSERT INTO dime_response_audit
          (request_id, user_id, response_mode, refusal_reason, context_hash, tokens_input, tokens_output, credits_charged, answer_hash)
          VALUES (
            ${data.requestId},
            ${data.userId},
            ${data.responseMode},
            ${data.refusalReason ?? null},
            ${data.contextHash ?? null},
            ${data.tokensInput ?? null},
            ${data.tokensOutput ?? null},
            ${data.creditsCharged},
            ${data.answerHash ?? null}
          )`
    );
  } catch (err) {
    console.error("[DimeWC2026] Failed to log response audit:", err);
  }
}

// ─── WC2026 Context Builder (imported from separate module) ──────────────────
// Will be created in Block 2
import { getWC2026DimeContext, type WC2026Context } from "./dime/wc2026Context";

// ─── WC2026 System Prompt (source-grounded) ──────────────────────────────────
const WC2026_SYSTEM_PROMPT = `You are Dime, the authenticated AI intelligence layer for AI Sports Betting Models.

IDENTITY:
- You provide WC2026 betting intelligence grounded exclusively in platform data.
- Your voice: sharp, concise, numbers-first, zero hype. You talk like a quant who bets.
- You are transparent about uncertainty and missing data.

WC2026 SOURCE-GROUNDING RULES (NON-NEGOTIABLE):
- Answer ONLY from the injected platform context below.
- NEVER invent odds, scores, edges, projections, lineups, injuries, player stats, model grades, freshness, or recommendations.
- If data is missing, stale, unsupported, or not in context, say so directly and name the exact missing field.
- NEVER claim Monte Carlo for WC2026. WC2026 model outputs are analytical Dixon-Coles unless context explicitly says otherwise.
- NEVER call a recommendation a BET unless recommendation_status=BET AND freshness_status=FRESH AND market_status=OPEN AND edge>0 AND book_odds exists in context.
- Use "matches" not "fixtures" or "games."
- When refusing, explain the exact missing or stale data field.

SUPPORTED MARKETS:
- 1X2 (moneyline / match result) — home win, draw, away win
- That is the ONLY market currently supported for WC2026.
- Spreads, totals, BTTS, props, to-advance, player markets: NOT SUPPORTED. Refuse clearly.

RESPONSE FORMAT:
- Lead with the verdict, then reasoning.
- Keep responses tight. Short paragraphs. No filler.
- Cite model version and data freshness when giving edge/recommendation data.
- If odds are stale (freshness_status != FRESH), explicitly warn the user.

REFUSAL PROTOCOL:
When you cannot answer from context, respond with a clear refusal:
- State what was asked
- State what data is missing or why you cannot answer
- Do NOT generate a paid answer when refusing`;

// ─── Chat Message Types ──────────────────────────────────────────────────────
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
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));
}

// ─── Intent Classification ───────────────────────────────────────────────────
function classifyIntent(message: string): string {
  const lower = message.toLowerCase();
  if (/best edge|top pick|best bet/i.test(lower)) return "BEST_EDGE";
  if (/today.?s card|today.?s match/i.test(lower)) return "TODAYS_CARD";
  if (/breakdown|analysis|preview/i.test(lower)) return "MATCH_BREAKDOWN";
  if (/score predict|final score/i.test(lower)) return "SCORE_PREDICTION";
  if (/moneyline|1x2|match result/i.test(lower)) return "MONEYLINE";
  if (/spread|handicap|asian/i.test(lower)) return "SPREAD";
  if (/total|over.?under|o\/u/i.test(lower)) return "TOTAL";
  if (/btts|both teams/i.test(lower)) return "BTTS";
  if (/advance|qualify|progress/i.test(lower)) return "TO_ADVANCE";
  if (/line move|steam|reverse/i.test(lower)) return "LINE_MOVEMENT";
  if (/lineup|starting|formation/i.test(lower)) return "LINEUP";
  if (/team trend|form|recent/i.test(lower)) return "TEAM_TREND";
  if (/player trend|player stat/i.test(lower)) return "PLAYER_TREND";
  if (/bracket|path|knockout/i.test(lower)) return "BRACKET_PATH";
  if (/model|dixon|method|how.*work/i.test(lower)) return "MODEL_EXPLANATION";
  if (/no.?bet|why not|pass|skip/i.test(lower)) return "NO_BET_REASON";
  if (/stale|fresh|outdated|current/i.test(lower)) return "STALE_CHECK";
  if (/clv|closing line/i.test(lower)) return "CLV";
  if (/confidence|certainty|band/i.test(lower)) return "CONFIDENCE_BAND";
  if (/source|citation|where.*from/i.test(lower)) return "CITATION";
  if (/freshness|last update|when.*update/i.test(lower)) return "FRESHNESS";
  return "GENERAL";
}

// ─── Determine if intent requires refusal (unsupported market) ───────────────
function getRefusalForIntent(intent: string, context: WC2026Context): { refuse: boolean; reason?: RefusalReason } {
  const unsupportedIntents: Record<string, RefusalReason> = {
    SPREAD: "MARKET_NOT_SUPPORTED",
    TOTAL: "MARKET_NOT_SUPPORTED",
    BTTS: "MARKET_NOT_SUPPORTED",
    TO_ADVANCE: "MARKET_NOT_SUPPORTED",
    LINE_MOVEMENT: "MARKET_NOT_SUPPORTED",
    LINEUP: "LINEUP_MISSING",
    PLAYER_TREND: "PLAYER_STATS_MISSING",
    CLV: "CLV_MISSING",
    CONFIDENCE_BAND: "UNSUPPORTED_PROP",
  };
  if (unsupportedIntents[intent]) {
    return { refuse: true, reason: unsupportedIntents[intent] };
  }
  // Check if context has data for supported intents
  if (intent === "BEST_EDGE" && context.activeBets === 0) {
    return { refuse: false }; // Will answer with "no active BET recommendations"
  }
  return { refuse: false };
}

// ─── Main Route ──────────────────────────────────────────────────────────────
const dimeWc2026Router = Router();

dimeWc2026Router.post("/wc2026", async (req: Request, res: Response) => {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Generate request_id
  // ═══════════════════════════════════════════════════════════════════════════
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  dimeLog("step.1.request_id_generated", requestId);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Backend auth check
  // ═══════════════════════════════════════════════════════════════════════════
  const authResult = await authenticateDimeRequest(req);
  if (!authResult) {
    dimeLog("step.2.auth_REJECTED", requestId, { reason: "AUTH_REQUIRED" });
    await logRequestAudit({
      requestId, userId: null, authStatus: "REJECTED", refusalReason: "AUTH_REQUIRED",
    });
    res.status(401).json({ error: "Authentication required.", requestId, mode: "REFUSE", reason: "AUTH_REQUIRED" });
    return;
  }
  dimeLog("step.2.auth_PASSED", requestId, { userId: authResult.userId, role: authResult.role });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: User identity resolved
  // ═══════════════════════════════════════════════════════════════════════════
  const userId = authResult.userId;
  const userIdStr = String(userId);
  dimeLog("step.3.identity_resolved", requestId, { userId });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Subscription entitlement check
  // ═══════════════════════════════════════════════════════════════════════════
  const subCheck = await checkSubscription(userId);
  if (!subCheck.valid) {
    dimeLog("step.4.subscription_REJECTED", requestId, { reason: subCheck.reason });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "REJECTED", refusalReason: "SUBSCRIPTION_REQUIRED",
    });
    res.status(403).json({ error: DIME_MODEL_ACCESS_MESSAGE, requestId, mode: "REFUSE", reason: "SUBSCRIPTION_REQUIRED" });
    return;
  }
  dimeLog("step.4.subscription_PASSED", requestId);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Credit balance check
  // ═══════════════════════════════════════════════════════════════════════════
  const creditCheck = await checkCredits(userId);
  if (!creditCheck.sufficient) {
    dimeLog("step.5.credit_REJECTED", requestId, { balance: creditCheck.balance });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "INSUFFICIENT",
      refusalReason: "INSUFFICIENT_CREDITS",
    });
    res.status(402).json({ error: "Insufficient credits.", requestId, mode: "REFUSE", reason: "INSUFFICIENT_CREDITS", balance: creditCheck.balance });
    return;
  }
  dimeLog("step.5.credit_PASSED", requestId, { balance: creditCheck.balance });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Rate limit check
  // ═══════════════════════════════════════════════════════════════════════════
  if (!checkRateLimit(userId)) {
    dimeLog("step.6.rate_limit_REJECTED", requestId);
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      refusalReason: "RATE_LIMITED",
    });
    res.status(429).json({ error: "Rate limit exceeded. Try again shortly.", requestId, mode: "REFUSE", reason: "RATE_LIMITED" });
    return;
  }
  dimeLog("step.6.rate_limit_PASSED", requestId);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Request validation (check RAW input BEFORE sanitization)
  // ═══════════════════════════════════════════════════════════════════════════
  const rawMessages = req.body?.messages;
  if (Array.isArray(rawMessages) && rawMessages.length > MAX_MESSAGES) {
    dimeLog("step.7.validation_REJECTED", requestId, { reason: "too_many_messages", count: rawMessages.length });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      refusalReason: "REQUEST_TOO_LARGE",
    });
    res.status(400).json({ error: "Too many messages in history.", requestId, mode: "REFUSE", reason: "REQUEST_TOO_LARGE" });
    return;
  }
  if (Array.isArray(rawMessages) && rawMessages.length > 0) {
    const lastRaw = rawMessages[rawMessages.length - 1];
    if (lastRaw && typeof lastRaw.content === 'string' && lastRaw.content.length > MAX_MESSAGE_LENGTH) {
      dimeLog("step.7.validation_REJECTED", requestId, { reason: "message_too_long", length: lastRaw.content.length });
      await logRequestAudit({
        requestId, userId: userIdStr, authStatus: "PASSED",
        entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
        refusalReason: "REQUEST_TOO_LARGE",
      });
      res.status(400).json({ error: "Message too long.", requestId, mode: "REFUSE", reason: "REQUEST_TOO_LARGE" });
      return;
    }
  }
  const messages = sanitizeHistory(rawMessages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    dimeLog("step.7.validation_REJECTED", requestId, { reason: "empty_or_no_user_message" });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      refusalReason: "REQUEST_TOO_LARGE",
    });
    res.status(400).json({ error: "Request must end with a user message.", requestId });
    return;
  }
  const lastMessage = messages[messages.length - 1].content;
  dimeLog("step.7.validation_PASSED", requestId, { messageCount: messages.length });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Intent classification
  // ═══════════════════════════════════════════════════════════════════════════
  const intent = classifyIntent(lastMessage);
  dimeLog("step.8.intent_classified", requestId, { intent });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: Context builder
  // ═══════════════════════════════════════════════════════════════════════════
  let context: WC2026Context;
  try {
    context = await getWC2026DimeContext(requestId, userIdStr);
    dimeLog("step.9.context_built", requestId, {
      matchCount: context.matchCount,
      recommendationCount: context.recommendationCount,
      missingFieldCount: context.missingFieldCount,
      contextHash: context.contextHash,
    });
  } catch (err) {
    dimeLog("step.9.context_FAILED", requestId, { error: (err as Error).message });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      intent, contextStatus: "FAILED", refusalReason: "NO_CONTEXT",
    });
    res.status(500).json({ error: "Failed to build context.", requestId, mode: "INTERNAL_ERROR" });
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 10: Context validation + intent refusal check
  // ═══════════════════════════════════════════════════════════════════════════
  if (context.matchCount === 0) {
    dimeLog("step.10.context_validation_REJECTED", requestId, { reason: "NO_CONTEXT" });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      intent, contextStatus: "REJECTED", refusalReason: "NO_CONTEXT",
    });
    await logResponseAudit({
      requestId, userId: userIdStr, responseMode: "REFUSE",
      refusalReason: "NO_CONTEXT", creditsCharged: 0, contextHash: context.contextHash,
    });
    res.status(200).json({
      requestId, mode: "REFUSE", reason: "NO_CONTEXT",
      message: "No WC2026 match context available. Cannot generate intelligence without platform data.",
      creditsCharged: 0,
    });
    return;
  }

  const intentRefusal = getRefusalForIntent(intent, context);
  if (intentRefusal.refuse) {
    dimeLog("step.10.intent_refusal", requestId, { intent, reason: intentRefusal.reason });
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      intent, contextStatus: "READY", responseStatus: "REFUSED",
      refusalReason: intentRefusal.reason, creditsCharged: 0,
    });
    await logResponseAudit({
      requestId, userId: userIdStr, responseMode: "REFUSE",
      refusalReason: intentRefusal.reason, creditsCharged: 0, contextHash: context.contextHash,
    });
    const refusalMessages: Record<string, string> = {
      MARKET_NOT_SUPPORTED: `This market is not currently supported for WC2026. Only 1X2 (moneyline/match result) is available. Spreads, totals, BTTS, to-advance, and player props are not modeled.`,
      LINEUP_MISSING: `Lineup data is not available in the WC2026 platform context. Cannot provide lineup intelligence.`,
      PLAYER_STATS_MISSING: `Player-level trend data is not available in the WC2026 platform context.`,
      CLV_MISSING: `CLV (Closing Line Value) data is not tracked for WC2026 at this time.`,
      UNSUPPORTED_PROP: `Confidence bands are not generated for WC2026 model outputs.`,
    };
    res.status(200).json({
      requestId, mode: "REFUSE", reason: intentRefusal.reason,
      message: refusalMessages[intentRefusal.reason!] || `Data not available for this request type.`,
      creditsCharged: 0,
    });
    return;
  }
  dimeLog("step.10.context_validation_PASSED", requestId);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 11: Claude/API call (SSE streaming)
  // ═══════════════════════════════════════════════════════════════════════════
  // Accept either a direct ANTHROPIC_API_KEY or the AI Gateway auth-token path
  // (ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL). Previously this route read only
  // ANTHROPIC_API_KEY, so a gateway-only deployment 500'd here while the sibling
  // chat route worked. createAnthropicClient() resolves both credential modes.
  if (!hasAnthropicCredentials()) {
    dimeLog("step.11.api_key_MISSING", requestId);
    await logRequestAudit({
      requestId, userId: userIdStr, authStatus: "PASSED",
      entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
      intent, contextStatus: "READY", responseStatus: "INTERNAL_ERROR",
    });
    res.status(500).json({ error: "Service configuration error.", requestId, mode: "INTERNAL_ERROR" });
    return;
  }

  // Inject context into messages
  const contextInjection: ChatMessage = {
    role: "user",
    content: `[PLATFORM CONTEXT — WC2026 DATA]\n${context.contextJson}\n[END PLATFORM CONTEXT]\n\nAnswer the following question using ONLY the platform context above. If data is missing, refuse clearly.`,
  };
  const contextAck: ChatMessage = {
    role: "assistant",
    content: "Understood. I will answer exclusively from the injected WC2026 platform context. If any requested data is missing, stale, or unsupported, I will refuse clearly and name the missing field.",
  };

  const augmentedMessages: ChatMessage[] = [contextInjection, contextAck, ...messages];

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const anthropic = createAnthropicClient();
  const abort = new AbortController();
  let aborted = false;

  req.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      abort.abort();
      dimeLog("step.11.stream_aborted", requestId, { latencyMs: Date.now() - startTime });
    }
  });

  dimeLog("step.11.claude_call_START", requestId, { model: MODEL, historyLength: augmentedMessages.length });

  let outputChars = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let responseMode: ResponseMode = "ANSWER";

  try {
    const stream = anthropic.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: WC2026_SYSTEM_PROMPT,
        messages: augmentedMessages,
      },
      { signal: abort.signal }
    );

    stream.on("text", (delta) => {
      outputChars += delta.length;
      send({ type: "delta", text: delta });
    });

    const final = await stream.finalMessage();
    tokensInput = final.usage?.input_tokens ?? 0;
    tokensOutput = final.usage?.output_tokens ?? 0;

    dimeLog("step.11.claude_call_DONE", requestId, {
      stopReason: final.stop_reason,
      outputChars,
      tokensInput,
      tokensOutput,
      latencyMs: Date.now() - startTime,
    });

    send({ type: "done", stopReason: final.stop_reason, requestId, creditsCharged: CREDITS_PER_ANSWER });
  } catch (err: unknown) {
    if (!aborted) {
      responseMode = "INTERNAL_ERROR";
      const isApiError = err instanceof Anthropic.APIError;
      dimeLog("step.11.claude_call_ERROR", requestId, {
        errorClass: isApiError ? "APIError" : (err as Error)?.constructor?.name ?? "Unknown",
        statusCode: isApiError ? err.status : undefined,
        latencyMs: Date.now() - startTime,
      });
      send({ type: "error", message: "Dime encountered an error. No credits charged.", requestId });
      // Log audit with 0 credits
      await logRequestAudit({
        requestId, userId: userIdStr, authStatus: "PASSED",
        entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
        intent, contextStatus: "READY", responseStatus: "INTERNAL_ERROR",
        tokensUsed: 0, creditsCharged: 0,
      });
      await logResponseAudit({
        requestId, userId: userIdStr, responseMode: "INTERNAL_ERROR",
        creditsCharged: 0, contextHash: context.contextHash,
        tokensInput: 0, tokensOutput: 0,
      });
      res.end();
      return;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 12: Usage log
  // ═══════════════════════════════════════════════════════════════════════════
  dimeLog("step.12.usage_logged", requestId, { tokensInput, tokensOutput, responseMode });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 13: Credit deduction (ONLY after successful response)
  // ═══════════════════════════════════════════════════════════════════════════
  let creditsCharged = 0;
  if (responseMode === "ANSWER") {
    const newBalance = await deductCredits(userId, requestId, CREDITS_PER_ANSWER);
    if (newBalance === -1) {
      // Atomic check failed — race condition caught, insufficient credits
      dimeLog("step.13.credit_RACE_BLOCKED", requestId, { reason: "concurrent deduction drained balance" });
      creditsCharged = 0;
    } else {
      creditsCharged = CREDITS_PER_ANSWER;
      dimeLog("step.13.credit_deducted", requestId, { charged: CREDITS_PER_ANSWER, newBalance });
    }
  } else {
    dimeLog("step.13.credit_NOT_charged", requestId, { reason: responseMode });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 14: Response log
  // ═══════════════════════════════════════════════════════════════════════════
  const answerHash = crypto.createHash("sha256").update(String(outputChars)).digest("hex").slice(0, 32);
  await logRequestAudit({
    requestId, userId: userIdStr, authStatus: "PASSED",
    entitlementStatus: "PASSED", creditStatus: "SUFFICIENT",
    intent, contextStatus: "READY", responseStatus: responseMode,
    tokensUsed: tokensInput + tokensOutput, creditsCharged,
  });
  await logResponseAudit({
    requestId, userId: userIdStr, responseMode,
    creditsCharged, contextHash: context.contextHash,
    tokensInput, tokensOutput, answerHash,
  });
  dimeLog("step.14.response_logged", requestId, { totalLatencyMs: Date.now() - startTime });

  res.end();
});

// ─── Duplicate request_id idempotency endpoint ───────────────────────────────
dimeWc2026Router.get("/wc2026/audit/:requestId", async (req: Request, res: Response) => {
  const { requestId } = req.params;
  const db = await getDb();
  if (!db) { res.status(500).json({ error: "DB unavailable" }); return; }
  const result = await db.execute(
    sql`SELECT request_id, auth_status, response_status, credits_charged, created_at
        FROM dime_request_audit WHERE request_id = ${requestId}`
  );
  const rows = (result as any)[0];
  if (!rows || rows.length === 0) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json({ audit: rows[0] });
});

/**
 * Mount the Dime WC2026 intelligence route on the Express app.
 */
export function registerDimeWC2026Route(app: Express) {
  app.use("/api/dime", dimeWc2026Router);
}
