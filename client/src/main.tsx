import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// ─── Rate-limit resilient fetch wrapper ──────────────────────────────────────
//
// PROBLEM: The Manus platform edge proxy occasionally returns the plain-text
// string "Rate exceeded." (no JSON, Content-Type: text/plain) when the deployed
// domain receives too many requests in a short window. The tRPC httpBatchLink
// uses superjson to parse every response body — when it receives plain text it
// throws: SyntaxError: Unexpected token 'R', "Rate exceeded." is not valid JSON
// This crashes the entire tRPC client and the user sees a raw error message.
//
// FIX: Wrap globalThis.fetch to intercept non-JSON responses BEFORE tRPC parses
// them. If the response body is plain text (not JSON), we synthesize a proper
// JSON error response that tRPC can handle gracefully. Rate-limit responses are
// automatically retried up to 3 times with exponential backoff (1s, 2s, 4s).
//
// [INPUT]  Any fetch request to /api/trpc
// [STEP]   Execute the real fetch
// [STEP]   Check Content-Type header — if not JSON, read body as text
// [STEP]   If body looks like a rate-limit message, retry with backoff
// [STEP]   After max retries, synthesize a JSON error response tRPC can parse
// [OUTPUT] Either the real JSON response or a synthesized error JSON response
// [VERIFY] Never throws a raw SyntaxError to the tRPC layer

const RATE_LIMIT_PATTERNS = [
  "rate exceeded",
  "too many requests",
  "rate limit",
  "ratelimit",
  "throttled",
  "quota exceeded",
];

function isRateLimitBody(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return RATE_LIMIT_PATTERNS.some(p => lower.includes(p));
}

function synthesizeRateLimitResponse(bodyText: string): Response {
  // Synthesize a valid tRPC error JSON response so the tRPC client can handle
  // it gracefully as a TRPCClientError instead of a raw SyntaxError.
  const errorBody = JSON.stringify([{
    error: {
      json: {
        message: "The server is temporarily busy. Please wait a moment and try again.",
        code: -32600,
        data: {
          code: "TOO_MANY_REQUESTS",
          httpStatus: 429,
          path: null,
        },
      },
    },
  }]);
  return new Response(errorBody, {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}

// Dedup: only show the rate-limit toast once per page load to avoid stacking.
let _rateLimitToastShown = false;

async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  attempt = 0
): Promise<Response> {
  const MAX_RETRIES = 3;
  const BACKOFF_MS = [1000, 2000, 4000];

  const response = await globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
  });

  // Fast path: JSON response — return immediately, no interception needed.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response;
  }

  // Non-JSON response: read body as text to inspect it.
  // We must clone the response because body can only be consumed once.
  let bodyText = "";
  try {
    bodyText = await response.clone().text();
  } catch {
    // If we can't read the body, pass through as-is.
    return response;
  }

  // Check if this looks like a rate-limit response.
  if (isRateLimitBody(bodyText) || response.status === 429) {
    console.warn(
      `[ResilientFetch] Rate-limit response detected` +
      ` | attempt=${attempt + 1}/${MAX_RETRIES}` +
      ` | status=${response.status}` +
      ` | body="${bodyText.slice(0, 100)}"`
    );

    // Show a user-facing toast on the first rate-limit hit (deduped).
    if (!_rateLimitToastShown) {
      _rateLimitToastShown = true;
      toast.warning("Server is busy — retrying automatically…", {
        id: "rate-limit-retry",
        duration: 6000,
        description: "This usually resolves in a few seconds.",
      });
      // Reset the dedup flag after 30s so future rate-limit events can show again.
      setTimeout(() => { _rateLimitToastShown = false; }, 30_000);
    }

    if (attempt < MAX_RETRIES - 1) {
      // Wait with exponential backoff, then retry.
      const delay = BACKOFF_MS[attempt] ?? 4000;
      console.log(`[ResilientFetch] Retrying in ${delay}ms…`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return resilientFetch(input, init, attempt + 1);
    }

    // Max retries exhausted — synthesize a proper JSON error response.
    console.error(
      `[ResilientFetch] Max retries (${MAX_RETRIES}) exhausted for rate-limit response.` +
      ` Synthesizing JSON error response.`
    );
    toast.error("Server is temporarily unavailable. Please try again in a minute.", {
      id: "rate-limit-final",
      duration: 8000,
    });
    return synthesizeRateLimitResponse(bodyText);
  }

  // Non-JSON, non-rate-limit response (e.g. HTML error page from proxy).
  // Synthesize a generic JSON error so tRPC doesn't crash on JSON.parse.
  console.error(
    `[ResilientFetch] Unexpected non-JSON response` +
    ` | status=${response.status}` +
    ` | contentType="${contentType}"` +
    ` | body="${bodyText.slice(0, 200)}"`
  );
  const errorBody = JSON.stringify([{
    error: {
      json: {
        message: "An unexpected server error occurred. Please refresh and try again.",
        code: -32600,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: response.status || 500,
          path: null,
        },
      },
    },
  }]);
  return new Response(errorBody, {
    status: response.status || 500,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── QueryClient ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes — prevents redundant refetches on navigation
      staleTime: 5 * 60 * 1000,
      // Retry up to 2 times for transient network errors (Failed to fetch)
      // with exponential backoff: 1s, 2s. Avoids 30s+ spinners on slow connections.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      // Show stale data while refetching (no spinner flash on navigation)
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Deduplicate toast: only show the session-expired toast once per page load.
// Multiple queries can fail simultaneously with UNAUTHORIZED (e.g. games.list +
// strikeoutProps.getByGames), which would stack identical toasts without this guard.
let _sessionExpiredToastShown = false;

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  const pathname = window.location.pathname;

  // Don't redirect on the home/landing page — unauthenticated users should
  // see the landing page and choose to sign in themselves.
  const onLandingPage = pathname === "/" || pathname === "";
  if (onLandingPage) return;

  // Don't redirect from /admin/* pages — they manage their own auth guards
  // via useEffect + setLocation("/feed/model/mlb"). Redirecting from admin pages causes
  // a race condition where button clicks trigger query re-fires that return
  // UNAUTHORIZED before auth state has fully settled, sending the user to OAuth.
  const onAdminPage = pathname.startsWith("/admin");
  if (onAdminPage) return;

  // [STEP] Show session-expired toast BEFORE redirecting so the user understands
  // why they are being sent to the login page (e.g. after force-logout or token
  // version bump). Toast is deduped — only one fires per page load.
  if (!_sessionExpiredToastShown) {
    _sessionExpiredToastShown = true;
    console.log("[Auth] [OUTPUT] UNAUTHORIZED detected — showing session-expired toast before redirect");
    toast.error("Your session has expired — please sign in again.", {
      id: "session-expired",       // prevents duplicate toasts from stacking
      duration: 5000,              // 5 s — enough to read before redirect
      description: "You have been signed out. Redirecting to login...",
    });
  }

  // [STEP] Delay redirect by 1.5 s so the toast is visible before navigation.
  setTimeout(() => {
    window.location.href = "/";
  }, 1500);
};

// Procedure paths that are optional / auth-gated client-side — suppress UNAUTHORIZED noise for these.
// They use enabled:false guards but may fire once on initial render before auth state resolves.
// tRPC query keys are arrays like ["trpc", ["favorites", "getMyFavorites"], {...}]
const OPTIONAL_AUTH_PATHS = new Set([
  "favorites,getMyFavorites",
  "favorites,getMyFavoritesWithDates",
  // Admin/owner-only procedures on TheModelResults page — guarded by enabled:!!appUser&&isOwner
  // but may fire once before auth resolves. Never redirect to OAuth for these.
  "mlbSchedule,getBrierTrend",
  "mlbSchedule,getBrierHeatmap",
  "mlbSchedule,getBrierDrilldown",
  "mlbSchedule,checkDrift",
  "mlbSchedule,getFgEdgeLeaderboard",
  "mlbSchedule,getF5EdgeLeaderboard",
  "mlbSchedule,triggerOutcomeIngestion",
  "strikeoutProps,getRichDailyBacktest",
  "strikeoutProps,getLast7DaysBacktest",
  "strikeoutProps,getCalibrationMetrics",
  "hrProps,getByGames",
  "mlbBacktest,getRollingAccuracy",
  "games,list",
  // Other owner/admin procedures across the app
  "appUsers,list",
  "appUsers,updateRole",
  "appUsers,delete",
  "betTracker,list",
  "betTracker,create",
  "betTracker,update",
  "betTracker,delete",
]);

function isOptionalAuthQuery(queryKey: readonly unknown[]): boolean {
  // tRPC v11 key shape: ["trpc", ["procedure", "name"], inputHash]
  const pathPart = queryKey[1];
  if (Array.isArray(pathPart)) return OPTIONAL_AUTH_PATHS.has(pathPart.join(","));
  return false;
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    // Suppress UNAUTHORIZED console errors for optional auth-gated queries to reduce noise.
    const isUnauthorized = error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG;
    if (isOptionalAuthQuery(event.query.queryKey) && isUnauthorized) return; // suppress
    // Suppress transient network errors (Failed to fetch) — these are browser-level
    // connection blips that auto-retry. Logging them causes false-positive error reports.
    const isNetworkBlip = error instanceof TRPCClientError && error.message === "Failed to fetch";
    if (isNetworkBlip) return;
    // Suppress rate-limit errors — they are already handled by resilientFetch with toast + retry.
    const isRateLimit = error instanceof TRPCClientError &&
      (error.message.includes("temporarily busy") || error.message.includes("temporarily unavailable"));
    if (isRateLimit) return;
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    // Suppress rate-limit errors — already handled by resilientFetch.
    const isRateLimit = error instanceof TRPCClientError &&
      (error.message.includes("temporarily busy") || error.message.includes("temporarily unavailable"));
    if (!isRateLimit) {
      console.error("[API Mutation Error]", error);
    }
  }
});

// ─── tRPC client ─────────────────────────────────────────────────────────────

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Cap GET URL length at 2048 bytes; tRPC will automatically switch to POST
      // for batches that exceed this limit (e.g. 68+ team color queries on Dashboard)
      // preventing HTTP 414 Request-URI Too Large from nginx
      maxURLLength: 2048,
      // Use resilientFetch instead of globalThis.fetch to handle non-JSON responses
      // (e.g. "Rate exceeded." from the platform edge proxy) without crashing.
      fetch: resilientFetch,
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
