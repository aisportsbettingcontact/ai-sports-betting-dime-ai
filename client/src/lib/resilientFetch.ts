/**
 * resilientFetch — the `fetch` implementation for the tRPC httpBatchLink. It
 * normalizes responses that would otherwise crash tRPC's superjson transform
 * with "Unable to transform response from server".
 *
 * TWO failure modes it repairs (both confirmed against @trpc v11 transformResult):
 *   1. Plain-text bodies from an edge proxy/CDN (e.g. "Rate exceeded.",
 *      Content-Type: text/plain) — not JSON at all.
 *   2. This app's express-rate-limit middleware, which answers 429 with
 *      Content-Type: application/json and body `{ error: "<string>" }`. That is
 *      NOT a valid tRPC/superjson envelope (tRPC requires `error` to be a
 *      `{ json, meta }` object whose deserialized value has a numeric `code`),
 *      so deserializing the bare string yields `undefined` and tRPC throws.
 *      Hitting the auth limiter (5 login attempts / 15 min per IP) triggered
 *      exactly this on login.
 *
 * The fix: treat any `status === 429` (rate limit) OR a rate-limit body as a
 * throttle regardless of Content-Type — retry with backoff, then synthesize a
 * VALID tRPC error envelope tRPC can parse. Genuine JSON tRPC responses (any
 * non-429) still fast-path through untouched.
 */
import { toast } from "sonner";

export const RATE_LIMIT_PATTERNS = [
  "rate exceeded",
  "too many requests",
  "rate limit",
  "ratelimit",
  "throttled",
  "quota exceeded",
];

export function isRateLimitBody(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

/**
 * A valid tRPC batch response is always a top-level JSON ARRAY (e.g. a procedure
 * that legitimately threw TOO_MANY_REQUESTS returns `[{error:{json:{…}}}]` with
 * HTTP 429). Those are already transformable and must pass through UNTOUCHED —
 * only the express-middleware shape (`{error:"<string>"}`) or plain text needs
 * repair. This is what keeps the fix from clobbering a real login-lockout error.
 */
export function isTrpcBatchBody(text: string): boolean {
  try {
    return Array.isArray(JSON.parse(text));
  } catch {
    return false;
  }
}

/** Pull a human message out of an express `{ error: "<string>" }` body, if present. */
function extractServerMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const err = (parsed as { error?: unknown }).error;
      if (typeof err === "string" && err.trim()) return err.trim();
      const msg = (parsed as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
  } catch {
    /* not JSON — ignore */
  }
  return null;
}

/**
 * Synthesize a batch tRPC error response that transformResult can parse
 * (array of `{ error: { json: { message, code, data } } }`). Surfaces the
 * server's own message when available so an auth lockout reads clearly.
 */
export function synthesizeRateLimitResponse(bodyText: string): Response {
  const serverMsg = extractServerMessage(bodyText);
  const message = serverMsg ?? "The server is temporarily busy. Please wait a moment and try again.";
  const errorBody = JSON.stringify([
    {
      error: {
        json: {
          message,
          code: -32029, // TRPC TOO_MANY_REQUESTS (JSON-RPC code)
          data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, path: null },
        },
      },
    },
  ]);
  return new Response(errorBody, { status: 429, headers: { "Content-Type": "application/json" } });
}

/** Synthesize a generic tRPC error envelope for an unexpected non-JSON response. */
export function synthesizeGenericErrorResponse(status: number, bodyText: string): Response {
  const message =
    extractServerMessage(bodyText) ?? "An unexpected server error occurred. Please refresh and try again.";
  const errorBody = JSON.stringify([
    {
      error: {
        json: {
          message,
          code: -32603, // INTERNAL_SERVER_ERROR
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: status || 500, path: null },
        },
      },
    },
  ]);
  return new Response(errorBody, { status: status || 500, headers: { "Content-Type": "application/json" } });
}

export interface ResilientFetchDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Side-channel for user-facing toasts; injectable so tests stay silent. */
  notify?: (kind: "retry" | "final", message?: string) => void;
}

// Dedup: only show the rate-limit toast once per page load to avoid stacking.
let _rateLimitToastShown = false;

function defaultNotify(kind: "retry" | "final", message?: string): void {
  if (kind === "retry") {
    if (_rateLimitToastShown) return;
    _rateLimitToastShown = true;
    toast.warning("Server is busy. Retrying automatically…", {
      id: "rate-limit-retry",
      duration: 6000,
      description: message ?? "This usually resolves in a few seconds.",
    });
    setTimeout(() => {
      _rateLimitToastShown = false;
    }, 30_000);
  } else {
    toast.error(message ?? "Server is temporarily unavailable. Please try again in a minute.", {
      id: "rate-limit-final",
      duration: 8000,
    });
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];

export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  attempt = 0,
  deps: ResilientFetchDeps = {},
): Promise<Response> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? realSleep;
  const notify = deps.notify ?? defaultNotify;

  const response = await doFetch(input, { ...(init ?? {}), credentials: "include" });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  // A 429 (from ANY layer) is never a valid tRPC procedure result — the express
  // rate limiters emit 429 with a NON-envelope JSON body. Also inspect the body
  // of non-JSON responses for a plain-text throttle message. Read the body only
  // when we actually need to (429, or non-JSON), so valid JSON stays a fast path.
  let bodyText = "";
  if (response.status === 429 || !isJson) {
    try {
      bodyText = await response.clone().text();
    } catch {
      return response;
    }
    // Already a valid tRPC batch (top-level JSON array) — even at 429, this is a
    // real procedure error tRPC can transform. Pass it through untouched so we
    // never retry-and-clobber a legitimate TOO_MANY_REQUESTS login lockout.
    if (bodyText && isTrpcBatchBody(bodyText)) return response;
  }

  const isRateLimit = response.status === 429 || (!!bodyText && isRateLimitBody(bodyText));

  if (isRateLimit) {
    console.warn(
      `[ResilientFetch] Rate-limit response` +
        ` | attempt=${attempt + 1}/${MAX_RETRIES}` +
        ` | status=${response.status}` +
        ` | contentType="${contentType}"` +
        ` | body="${bodyText.slice(0, 100)}"`,
    );
    notify("retry", extractServerMessage(bodyText) ?? undefined);

    if (attempt < MAX_RETRIES - 1) {
      const delay = BACKOFF_MS[attempt] ?? 4000;
      await sleep(delay);
      return resilientFetch(input, init, attempt + 1, deps);
    }

    console.error(`[ResilientFetch] Max retries (${MAX_RETRIES}) exhausted — synthesizing rate-limit error.`);
    notify("final", extractServerMessage(bodyText) ?? undefined);
    return synthesizeRateLimitResponse(bodyText);
  }

  // Valid JSON, non-429 — a real tRPC response. Fast-path unchanged.
  if (isJson) return response;

  // Non-JSON, non-rate-limit (e.g. an HTML error page). Synthesize a generic
  // tRPC error so the transform never throws.
  console.error(
    `[ResilientFetch] Unexpected non-JSON response` +
      ` | status=${response.status}` +
      ` | contentType="${contentType}"` +
      ` | body="${bodyText.slice(0, 200)}"`,
  );
  return synthesizeGenericErrorResponse(response.status, bodyText);
}
