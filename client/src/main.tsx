import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import superjson from "superjson";
import App from "./App";
import { resilientFetch } from "@/lib/resilientFetch";
import "./index.css";
import "./styles/type-system.css";
import "./styles/dime-mobile.css";

// The tRPC httpBatchLink `fetch` is `resilientFetch` (client/src/lib/resilientFetch.ts):
// it normalizes rate-limit / non-JSON responses (which would otherwise crash
// superjson's transform with "Unable to transform response from server") into
// valid tRPC error envelopes, with retry + backoff. See that module for details.

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
    toast.error("Your session has expired. Please log in again.", {
      id: "session-expired",       // prevents duplicate toasts from stacking
      duration: 5000,              // 5 s — enough to read before redirect
      description: "You have been logged out. Redirecting to log in…",
    });
  }

  // [STEP] Delay redirect by 1.5 s so the toast is visible before navigation.
  // Land on /login (matching the toast copy) with the current path preserved
  // so signing back in returns the user to where their session expired.
  setTimeout(() => {
    const rp = window.location.pathname + window.location.search;
    window.location.href = rp === "/" || rp === "/login"
      ? "/login"
      : `/login?returnPath=${encodeURIComponent(rp)}`;
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
