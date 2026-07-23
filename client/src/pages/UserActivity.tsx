/**
 * UserActivity — owner-only "User Activity" tab of the Admin Dashboard.
 *
 * Owner directive 2026-07-23: "create a User Activity tab and move Platform
 * Metrics into that tab/page" (route /admin/activity). This page hosts the
 * MetricsPanel block that previously lived inline on the User Management page.
 *
 * Auth: this is the CLIENT (cosmetic) half of the owner lockdown — the real
 * boundary is server-verified ownerProcedure middleware on every metrics
 * procedure MetricsPanel calls (server/routers/metrics.ts). At the route layer
 * this page is wrapped RequireAuth > RequireOwner (client/src/App.tsx), and the
 * internal guard below is defense-in-depth mirroring UserManagement.
 *
 * IMPORTANT — render ordering is load-bearing: MetricsPanel's three tRPC
 * queries have NO `enabled` guard, so they fire the moment it mounts. It is
 * therefore rendered ONLY below the loading/redirect early-return, so a
 * non-owner never triggers a FORBIDDEN metrics query before the redirect fires.
 *
 * Design: Dime brand law + apple-design — semantic tokens only, the shared
 * AdminShell chrome (wordmark, three-tab nav, 160ms motion curve), and a page
 * header matching the User Management surface's typographic treatment.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { MetricsPanel } from "@/pages/admin/MetricsPanel";
import { RefreshCw } from "lucide-react";

export default function UserActivity() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();

  // Redirect if not owner — MUST be in useEffect, never in render body.
  // Calling navigate() during render crashes React 19 silently (blank screen).
  // Defense-in-depth behind the route-level RequireOwner wrapper.
  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      console.warn(`[UserActivity] Unauthorized: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting to /feed/model/mlb`);
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  // Show loading skeleton while auth is resolving OR while redirect is pending.
  // This prevents both the blank screen and the flash of unauthorized content —
  // and, critically, keeps MetricsPanel's owner-only queries from firing until
  // the caller is confirmed to be an owner.
  if (loading || (!loading && (!appUser || appUser.role !== "owner"))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <RefreshCw className="w-5 h-5 text-foreground animate-spin" />
        <span className="text-sm text-foreground">{loading ? "Authenticating..." : "Redirecting..."}</span>
      </div>
    );
  }

  return (
    <AdminShell active="activity">
      <div className="w-full bg-muted/30 text-foreground flex flex-col">
        <div className="flex-1 w-full px-3 sm:px-5 lg:px-8 py-4">
          {/* Page header — mirrors UserManagement's "Accounts overview" treatment */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">User Activity</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Session engagement, membership, and usage across the platform.
            </p>
          </div>

          {/* Platform Metrics — moved here from the User Management page */}
          <MetricsPanel />
        </div>
      </div>
    </AdminShell>
  );
}
