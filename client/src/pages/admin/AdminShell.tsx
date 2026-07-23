/**
 * AdminShell — shared chrome for the owner-only Admin Dashboard
 *
 * Round 3 Step 5 (owner directive 2026-07-22): "Design all of these pages
 * with world class apple design UI within the Dime AI Brand kit." This is
 * the shared shell the three admin surfaces (User Management, User Activity,
 * Publish Projections) render inside of — it is purely presentational chrome:
 *
 *   - Dime wordmark + an "Admin" context label, so the surface never
 *     reads as a bare, unbranded internal tool.
 *   - A three-tab nav switching between the three admin pages.
 *   - A back-to-app affordance returning to the canonical feed.
 *
 * This component owns NO auth logic. Access control lives one layer up —
 * <RequireOwner> (client/src/components/RequireOwner.tsx) wraps the route
 * before AdminShell ever mounts, and every data-bearing tRPC procedure the
 * wrapped pages call is bound to server-verified ownerProcedure middleware
 * (server/routers/appUsers.ts, routers.ts, wc2026/wc2026Router.ts). AdminShell
 * rendering is not a security boundary — it is cosmetic chrome for a surface
 * the caller has already been authorized to see.
 *
 * Design: Dime brand law (design-system/dime-ai/MASTER.md +
 * dime-ai/THREE-COLOR-LAW.md v2/v3, which supersedes MASTER's literal hex
 * values) — one-accent mint via the semantic --primary/--color-* tokens
 * already wired app-wide in index.css, Familjen Grotesk (--font-sans),
 * the 160ms cubic-bezier(0.16,1,0.3,1) motion curve, and no gradients.
 * Apple-design discipline (.claude/skills/apple-design/SKILL.md): restrained
 * critically-damped motion only, translucent sticky chrome with content
 * scrolling underneath, optical typography (tight tracking on the wordmark,
 * near-zero on body/labels), and full prefers-reduced-motion collapse.
 */

import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { ADMIN_NAV, type AdminNavKey } from "./adminNav";
import "./AdminShell.css";

/** Back-compat alias — `active` now accepts any registry key (or "dashboard"). */
export type AdminTab = AdminNavKey;

// Canonical "back to the app" destination — matches the target both admin
// pages already navigate to from their own internal back buttons, so the
// shell's affordance and each page's pre-existing one never disagree.
const BACK_TO_APP_PATH = "/feed/model/mlb";

interface AdminShellProps {
  /** Which destination is current — set by the page mounting the shell, not
   *  derived, so the contract stays a simple explicit prop (easy to source-test
   *  and impossible to get out of sync with routing internals). "dashboard" is
   *  the `/admin` hub. */
  active: AdminNavKey;
  children: ReactNode;
}

export function AdminShell({ active, children }: AdminShellProps) {
  const [, navigate] = useLocation();

  return (
    <div className="admin-shell min-h-screen bg-background text-foreground">
      <header className="admin-shell-header sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          {/* Back to app */}
          <button
            type="button"
            onClick={() => navigate(BACK_TO_APP_PATH)}
            className="admin-shell-back flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Back to app"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Back to app</span>
          </button>

          <div className="hidden h-5 w-px flex-shrink-0 bg-border sm:block" aria-hidden="true" />

          {/* Dime wordmark + admin context */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="dime-wordmark" style={{ fontSize: 18 }} aria-hidden="true">
              d
              <span className="dime-wordmark-i">
                ı<span className="dime-coindot" />
              </span>
              me
            </span>
            <span className="admin-shell-badge rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Admin
            </span>
          </div>

          {/* Dashboard hub link — the home for all admin tools (/admin). */}
          <button
            type="button"
            onClick={() => {
              if (active !== "dashboard") navigate("/admin");
            }}
            aria-current={active === "dashboard" ? "page" : undefined}
            className={`admin-shell-back flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-sm ${
              active === "dashboard"
                ? "text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label="Admin dashboard home"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>

          <div className="flex-1" />

          {/* Registry-driven nav — every admin destination, horizontally
              scrollable so the list scales past the original three tabs. */}
          <nav
            role="tablist"
            aria-label="Admin Dashboard"
            className="admin-shell-tabs flex items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1"
          >
            {ADMIN_NAV.map((tab) => {
              const isActive = tab.key === active;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    if (!isActive) navigate(tab.path);
                  }}
                  className={`admin-shell-tab flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold sm:text-sm ${
                    isActive
                      ? "bg-[var(--row-active)] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {/* Short label on mobile, full label at sm+ */}
                  <span className="sm:hidden">{tab.short}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="admin-shell-content">{children}</main>
    </div>
  );
}

export default AdminShell;
