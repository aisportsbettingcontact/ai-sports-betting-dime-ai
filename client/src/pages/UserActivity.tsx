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
import OverviewHeaderPanel from "@/pages/admin/OverviewHeaderPanel";
import IdealCustomerPanel from "@/pages/admin/IdealCustomerPanel";
import ActivityTrendPanel from "@/pages/admin/ActivityTrendPanel";
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
        <div className="flex-1 admin-container py-6 sm:py-8">
          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
              User Activity
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
              Customer profiling infrastructure — who's active, who your power users are, which
              features earn their time, where they fall off, and whether they come back.
            </p>
          </div>

          {/* Tab bar — mono labels, one-accent mint active state, 160ms motion. */}
          <div className="flex flex-wrap gap-1 border-b border-border mb-6 sm:mb-8 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`font-mono text-xs sm:text-sm whitespace-nowrap px-3.5 sm:px-4 py-2.5 -mb-px border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t ${
                  tab === t.key
                    ? "text-primary border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Active panel */}
          {tab === "overview" && (
            <>
              <OverviewHeaderPanel />
              <IdealCustomerPanel />
              <ActivityTrendPanel />
              <DeviceActivityPanel />
              <MetricsPanel />
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
