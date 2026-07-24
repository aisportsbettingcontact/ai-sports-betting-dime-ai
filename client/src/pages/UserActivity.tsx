/**
 * UserActivity — owner-only Customer Profiling Cockpit (Admin Dashboard tab).
 *
 * Route /admin/activity. A tabbed workspace over the device-aware analytics
 * pipeline: Overview (platform metrics + device activity), Segments, Power Users,
 * Feature Scorecard, Journeys, Retention — plus a per-user profile drawer that
 * opens over the Power Users leaderboard.
 *
 * Auth: CLIENT (cosmetic) half of the owner lockdown — the real boundary is the
 * server-verified ownerProcedure on every metrics/analytics procedure the panels
 * call. Route-wrapped RequireAuth > RequireOwner (client/src/App.tsx); the guard
 * below is defense-in-depth. Panels' owner-only queries must not fire for a
 * non-owner, so they render ONLY below the loading/redirect early-return.
 *
 * Design: Dime brand law + apple-design — semantic tokens only, AdminShell chrome,
 * 160ms motion, mono tab labels with a one-accent mint active state.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { MetricsPanel } from "@/pages/admin/MetricsPanel";
import DeviceActivityPanel from "@/pages/admin/DeviceActivityPanel";
import SegmentsPanel from "@/pages/admin/SegmentsPanel";
import PowerUsersPanel from "@/pages/admin/PowerUsersPanel";
import FeatureScorecardPanel from "@/pages/admin/FeatureScorecardPanel";
import JourneyFunnelPanel from "@/pages/admin/JourneyFunnelPanel";
import RetentionPanel from "@/pages/admin/RetentionPanel";
import UserProfileDrawer from "@/pages/admin/UserProfileDrawer";
import type { UserProfileRow } from "@/pages/admin/profilingTypes";
import { RefreshCw } from "lucide-react";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "segments", label: "Segments" },
  { key: "power", label: "Power Users" },
  { key: "scorecard", label: "Feature Scorecard" },
  { key: "journeys", label: "Journeys" },
  { key: "retention", label: "Retention" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function UserActivity() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabKey>("overview");
  const [selected, setSelected] = useState<UserProfileRow | null>(null);

  // Redirect if not owner — MUST be in useEffect, never in render body (a
  // render-phase navigate() crashes React 19 to a blank screen). Defense-in-depth
  // behind the route-level RequireOwner wrapper.
  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      console.warn(`[UserActivity] Unauthorized: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting to /feed/model/mlb`);
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  // Keep owner-only queries from firing until the caller is confirmed owner.
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
          {/* Page header */}
          <div className="mb-4">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">User Activity</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Customer profiling — segments, power users, feature strength, journeys, and retention.
            </p>
          </div>

          {/* Tab bar — mono labels, one-accent mint active state, 160ms motion. */}
          <div className="flex flex-wrap gap-0.5 border-b border-border mb-5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`font-mono text-[11px] sm:text-xs whitespace-nowrap px-3 py-2 -mb-px border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                  tab === t.key
                    ? "text-primary border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Active panel */}
          {tab === "overview" && (
            <>
              <MetricsPanel />
              <DeviceActivityPanel />
            </>
          )}
          {tab === "segments" && <SegmentsPanel />}
          {tab === "power" && <PowerUsersPanel onSelect={setSelected} />}
          {tab === "scorecard" && <FeatureScorecardPanel />}
          {tab === "journeys" && <JourneyFunnelPanel />}
          {tab === "retention" && <RetentionPanel />}
        </div>
      </div>

      {/* Per-user profile drawer — owned here, opened from the Power Users leaderboard. */}
      <UserProfileDrawer user={selected} onClose={() => setSelected(null)} />
    </AdminShell>
  );
}
