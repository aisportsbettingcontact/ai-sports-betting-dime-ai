/**
 * RequireOwner — Owner-only route guard
 *
 * Round 3 Step 5 (owner directive 2026-07-22): the Admin Dashboard (User
 * Management + Publish Projections) is for @prez only — "No other users or
 * site members should be able to view these pages."
 *
 * This component is the CLIENT-SIDE half of that lockdown. It is cosmetic —
 * the real boundary is server-verified ownerProcedure middleware on every
 * tRPC procedure these pages call (server/routers/appUsers.ts, routers.ts,
 * wc2026Router.ts). Hiding the route is not the security boundary; this
 * guard exists only to avoid showing admin chrome to someone who could not
 * do anything with it anyway.
 *
 * Composition (App.tsx): nested INSIDE RequireAuth, matching the existing
 * guard-composition style (RequireAuth already redirects unauthenticated
 * visitors to /login before this component ever mounts):
 *
 *   <RequireAuth>
 *     <RequireOwner>
 *       <AdminShell activeTab="users"><UserManagement /></AdminShell>
 *     </RequireOwner>
 *   </RequireAuth>
 *
 * Architecture (mirrors RequireAuth.tsx):
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RequireOwner renders null while appUsers.me is in flight AND while a   │
 * │  redirect is pending — no flash of admin content is ever possible.      │
 * │                                                                         │
 * │  Owner = server-verified role === "owner" via useAppAuth().isOwner      │
 * │  ONLY. Never an email/username string check on the client — that was   │
 * │  explicitly ruled out by the owner spec ("gates the Admin Dashboard row │
 * │  on the server-verified isOwner prop, not a username check" — same     │
 * │  contract this guard extends to full-page routes).                     │
 * │                                                                         │
 * │  Once resolved:                                                         │
 * │    • appUser present AND isOwner  → render children                     │
 * │    • otherwise (no appUser, or authenticated non-owner) → replace       │
 * │      the history entry with /chat. `replace` (not push) so Back never   │
 * │      lands the visitor on an admin URL they were just bounced from.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";

interface RequireOwnerProps {
  children: React.ReactNode;
}

export function RequireOwner({ children }: RequireOwnerProps) {
  const { appUser, loading, isOwner } = useAppAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (loading) return; // still resolving — wait, do not redirect yet
    if (isOwner) return; // server-verified owner — render children

    console.warn(
      `[RequireOwner] Non-owner access blocked: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting to /chat`
    );
    navigate("/chat", { replace: true });
  }, [loading, isOwner, appUser, navigate]);

  // [NO-FLASH] Render nothing until auth has resolved AND ownership is
  // confirmed. This covers three states with the same null render:
  //   1. Auth still loading (appUsers.me in flight)
  //   2. Authenticated but not owner (redirect effect above is queued)
  //   3. Unauthenticated (redirect effect above is queued)
  // Admin content (`children`) is reachable ONLY on the fourth state.
  if (loading || !isOwner) {
    return null;
  }

  return <>{children}</>;
}
