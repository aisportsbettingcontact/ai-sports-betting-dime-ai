/**
 * MobileOwnerAccessGate
 * ═════════════════════
 * Wraps mobile owner tab content. Only renders children if:
 * 1. Feature flag is enabled
 * 2. User is authenticated
 * 3. User role === "owner" (or test_mode/public overrides)
 *
 * Non-owners see nothing (no flash, no redirect, no error).
 */

import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { type ReactNode, useEffect, useMemo } from "react";
import { decideMobileOwnerAccess } from "./config";
import { mobileOwnerTabLogger } from "./logger";

interface MobileOwnerAccessGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function MobileOwnerAccessGate({ children, fallback = null }: MobileOwnerAccessGateProps) {
  // Source of truth is the app's own Discord-OAuth-backed session (appUsers.me),
  // NOT the legacy Manus useAuth() hook — that hook's backend is gone post-cutover
  // and always resolves isAuthenticated: false, which would hide these tabs from
  // everyone including real owners. See GlobalMobileOwnerTabs for the same pattern.
  const { appUser, loading } = useAppAuth();

  const decision = useMemo(() => {
    if (loading) return null;
    return decideMobileOwnerAccess(appUser?.role, Boolean(appUser), true);
  }, [appUser, loading]);

  useEffect(() => {
    if (!decision) return;
    if (decision.granted) {
      mobileOwnerTabLogger.log("access_granted", undefined, { reason: decision.reason, role: appUser?.role });
    } else {
      mobileOwnerTabLogger.log("access_denied", undefined, { reason: decision.reason, role: appUser?.role });
    }
  }, [decision, appUser?.role]);

  // While loading auth, render nothing (HTML shell covers)
  if (loading || !decision) return null;

  // Access denied — render fallback (default: nothing)
  if (!decision.granted) return <>{fallback}</>;

  // Access granted — render children
  return <>{children}</>;
}
