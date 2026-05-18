/**
 * RequireAuth — Authentication gate component
 *
 * Wraps any route that requires a valid app_session cookie.
 * Unauthenticated users are redirected to /login BEFORE any child content renders.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RequireAuth returns null while appUsers.me is in flight.               │
 * │  The HTML loading shell in index.html covers this gap — it stays        │
 * │  visible until React renders real content into #root.                   │
 * │                                                                         │
 * │  Once resolved:                                                         │
 * │    • appUser present  → render children (protected page)                │
 * │    • appUser null     → hard redirect to /login?returnPath=<current>    │
 * │                                                                         │
 * │  Hard redirect (window.location.href) is used instead of wouter        │
 * │  setLocation to ensure React Query cache is fully cleared on the        │
 * │  login page load. This prevents stale auth state from persisting.       │
 * │                                                                         │
 * │  A 10-second timeout prevents infinite loading if the auth check stalls.│
 * │                                                                         │
 * │  A 300ms minimum wait prevents a redirect race condition after OAuth    │
 * │  callback — the browser navigates to /feed before appUsers.me resolves. │
 * │  300ms is sufficient: auth API resolves in ~100-200ms on good networks. │
 * │                                                                         │
 * │  [PERF] No inline loading state — the HTML shell covers auth wait.      │
 * │  This eliminates the double loading screen (HTML shell → React spinner).│
 * │                                                                         │
 * │  [PERF] URL-aware feed data prefetch — fires the moment auth resolves.  │
 * │  Reads ?sport= and ?date= from the URL so the prefetched cache key      │
 * │  EXACTLY matches what ModelProjections will request on mount.           │
 * │                                                                         │
 * │  This eliminates the server date sync double-fetch:                     │
 * │    Old: prefetch MLB+today → getCurrentDate resolves → date mismatch    │
 * │         → setSelectedDate → NEW games.list query (second loading cycle) │
 * │    New: prefetch correct sport+date + yesterday fallback → cache hit    │
 * │         → getCurrentDate resolves → already cached → no second query   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   <Route path="/feed">
 *     {() => <RequireAuth><ModelProjections /></RequireAuth>}
 *   </Route>
 */

import { useEffect, useRef, useState } from "react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { todayUTC } from "@/components/CalendarPicker";

interface RequireAuthProps {
  children: React.ReactNode;
}

const VALID_SPORTS_SET = new Set(["MLB", "NHL", "NBA"]);

// Feed data prefetch — fires once when auth resolves on /feed routes.
// Populates React Query cache so ModelProjections renders with data immediately.
//
// [PERF] URL-aware: reads ?sport= and ?date= from the current URL so the
// prefetched cache key EXACTLY matches what ModelProjections will request on mount.
// Also prefetches getCurrentDate FIRST so the date sync effect in ModelProjections
// resolves from cache — preventing the setSelectedDate → second games.list cascade.
function useFeedPrefetch(authenticated: boolean) {
  const utils = trpc.useUtils();
  const prefetchedRef = useRef(false);

  useEffect(() => {
    if (!authenticated || prefetchedRef.current) return;
    // Only prefetch on /feed route — other routes don't need games.list
    if (!window.location.pathname.startsWith("/feed")) return;

    prefetchedRef.current = true;

    // [PERF] Read URL params to prefetch the exact sport+date the user will see.
    // Falls back to MLB+todayUTC() if no params are present (first visit).
    const urlParams = new URLSearchParams(window.location.search);
    const urlSport = urlParams.get("sport");
    const urlDate  = urlParams.get("date");
    const sport = (urlSport && VALID_SPORTS_SET.has(urlSport))
      ? (urlSport as "MLB" | "NHL" | "NBA")
      : "MLB";
    const today = todayUTC();
    // Validate YYYY-MM-DD format for the date param
    const dateParam = (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) ? urlDate : null;
    const gameDate = dateParam ?? today;

    // Step 1: Prefetch getCurrentDate so the date sync effect in ModelProjections
    // reads from cache (no network round-trip) → no second games.list query.
    void utils.games.getCurrentDate.prefetch(undefined, { staleTime: 5 * 60 * 1000 });

    // Step 2: Prefetch the primary games.list for the detected sport+date.
    void utils.games.list.prefetch(
      { sport, gameDate },
      { staleTime: 60 * 1000 }
    );

    // Step 3: Prefetch activeSports for sport pill visibility.
    void utils.games.activeSports.prefetch(undefined, { staleTime: 5 * 60 * 1000 });

    // [PERF] If no explicit ?date= in URL, also prefetch yesterday as a fallback.
    // Covers the case where the server's effective date is yesterday (before 11:00 UTC
    // cutoff) but the client computed today. Both cache entries will be warm — whichever
    // the server date sync picks will be a cache hit, not a network round-trip.
    if (!dateParam) {
      const d = new Date();
      const yesterday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1))
        .toISOString()
        .slice(0, 10);
      if (yesterday !== gameDate) {
        void utils.games.list.prefetch(
          { sport, gameDate: yesterday },
          { staleTime: 60 * 1000 }
        );
      }
    }
  }, [authenticated, utils]);
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { appUser, loading } = useAppAuth();

  // Safety timeout: if auth check takes > 10s, treat as unauthenticated
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      console.warn("[RequireAuth] Auth check timed out after 10s — redirecting to login");
      setTimedOut(true);
    }, 10000);
    return () => clearTimeout(t);
  }, [loading]);

  // Minimum wait (300ms) before redirecting — prevents race condition on OAuth callback.
  // After Discord OAuth callback, browser does full page nav to /feed.
  // React Query fires appUsers.me immediately but response takes ~100-200ms.
  // Without this guard, RequireAuth could redirect to /login before auth check completes.
  // [PERF] Reduced from 800ms → 300ms: auth resolves in ~100-200ms on good networks.
  // The HTML loading shell covers this 300ms gap seamlessly.
  const [minWaitDone, setMinWaitDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinWaitDone(true), 300);
    return () => clearTimeout(t);
  }, []);

  // [PERF] Prefetch feed data the moment auth resolves — eliminates in-page spinner
  useFeedPrefetch(Boolean(appUser));

  // Redirect unauthenticated users to /login with returnPath preserved
  useEffect(() => {
    if (loading && !timedOut) return; // still loading — wait
    if (!minWaitDone && !timedOut) return; // minimum wait not done — hold
    if (appUser) return; // authenticated — render children

    // [ACTION] Not authenticated — redirect to login
    const returnPath = window.location.pathname + window.location.search;
    const loginUrl = returnPath === "/login" || returnPath === "/"
      ? "/login"
      : `/login?returnPath=${encodeURIComponent(returnPath)}`;

    console.log(`[RequireAuth] Unauthenticated — redirecting to ${loginUrl} (timedOut=${timedOut} minWaitDone=${minWaitDone})`);
    window.location.href = loginUrl;
  }, [appUser, loading, timedOut, minWaitDone]);

  // [PERF] No inline loading state — return null so the HTML shell covers the auth wait.
  // The HTML shell (index.html) is visible until React renders real content into #root.
  // Returning null here means the HTML shell stays up during the auth check, then
  // disappears the moment the authenticated page renders. Zero double loading screen.
  if ((loading || !minWaitDone) && !timedOut) {
    return null;
  }

  // Authenticated — render the protected page
  if (appUser) {
    return <>{children}</>;
  }

  // Redirect is in progress — render nothing
  return null;
}
