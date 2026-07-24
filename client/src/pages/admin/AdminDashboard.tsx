/**
 * AdminDashboard — the `/admin` hub: one place that surfaces every admin tool.
 *
 * Before this, only 3 of ~12 owner/admin pages were linked anywhere; the rest
 * were reachable only by typing the URL. This hub renders the shared `ADMIN_NAV`
 * registry as a grouped grid of cards so every tool is discoverable, and the
 * AdminShell nav links back here from any admin surface.
 *
 * Owner-only: wrapped by <RequireOwner> at the route layer (client/src/App.tsx);
 * this component owns no auth logic. Design: Dime brand law — semantic tokens
 * only (mint --primary strictly on signal), Familjen Grotesk, font-mono labels,
 * 160ms motion, no gradients — matching AdminShell / MetricsPanel.
 */
import { useLocation } from "wouter";
import { AdminShell } from "@/pages/admin/AdminShell";
import { ADMIN_GROUPS, adminItemsByGroup } from "@/pages/admin/adminNav";

export default function AdminDashboard() {
  const [, navigate] = useLocation();

  return (
    <AdminShell active="dashboard">
      <div className="w-full bg-muted/30 text-foreground">
        <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5 lg:px-8">
          {/* Page header — mirrors the other admin surfaces' treatment */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every admin tool, in one place.
            </p>
          </div>

          <div className="space-y-6">
            {ADMIN_GROUPS.map((group) => (
              <section key={group}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.15em] text-foreground">
                    {group}
                  </span>
                  <div className="h-px flex-1 bg-card" />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                  {adminItemsByGroup(group).map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => navigate(item.path)}
                        className="admin-shell-tab group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left hover:border-primary sm:px-4"
                      >
                        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground lg:text-base">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
