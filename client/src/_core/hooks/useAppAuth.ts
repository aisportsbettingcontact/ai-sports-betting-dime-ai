import { trpc } from "@/lib/trpc";

export function useAppAuth() {
  const {
    data: appUser,
    isLoading,
    refetch,
  } = trpc.appUsers.me.useQuery(undefined, {
    // staleTime: 0 (default) — auth state must always be re-fetched after a full page
    // navigation. A stale null from a previous unauthenticated visit would cause
    // RequireAuth to immediately redirect to /login even after a successful Discord
    // OAuth callback (which is a full page navigation that clears React Query cache).
    staleTime: 0,
    // gcTime: 0 — do not keep stale auth data in the garbage-collection window.
    // Ensures that after a Discord OAuth callback, the very first useAppAuth call
    // fires a fresh network request and does NOT return a cached null.
    gcTime: 0,
    // Retry once on failure — prevents 30s+ spinner on transient network errors
    retry: 1,
    retryDelay: 1000,
    // Refetch on window focus — catches session expiry when user switches tabs
    refetchOnWindowFocus: true,
  });

  return {
    appUser: appUser ?? null,
    loading: isLoading,
    isOwner: appUser?.role === "owner",
    isAdmin: appUser?.role === "admin" || appUser?.role === "owner",
    refetch,
  };
}
