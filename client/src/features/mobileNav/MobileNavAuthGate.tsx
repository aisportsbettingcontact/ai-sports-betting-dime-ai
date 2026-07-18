/**
 * MobileNavAuthGate
 * ═════════════════
 * Wraps the /m/* screen content. Only renders children if:
 * 1. Feature flag is enabled
 * 2. User is authenticated
 *
 * There are no role checks — every tab and screen is default and
 * project-wide for all users. Unauthenticated visitors see the fallback
 * (default: nothing — no flash, no redirect, no error).
 */

import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { type ReactNode, useEffect, useMemo } from "react";
import { decideMobileNavAccess } from "./config";
import { mobileNavLogger } from "./logger";

interface MobileNavAuthGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function MobileNavAuthGate({
  children,
  fallback = null,
}: MobileNavAuthGateProps) {
  // Source of truth is the app's own Discord-OAuth-backed session
  // (appUsers.me), NOT the legacy Manus useAuth() hook — that hook's backend
  // is gone post-cutover and always resolves isAuthenticated: false, which
  // would hide these screens from everyone. See GlobalMobileNav for the same
  // pattern.
  const { appUser, loading } = useAppAuth();

  const decision = useMemo(() => {
    if (loading) return null;
    return decideMobileNavAccess(Boolean(appUser));
  }, [appUser, loading]);

  useEffect(() => {
    if (!decision) return;
    if (decision.granted) {
      mobileNavLogger.log("access_granted", undefined, {
        reason: decision.reason,
      });
    } else {
      mobileNavLogger.log("access_denied", undefined, {
        reason: decision.reason,
      });
    }
  }, [decision]);

  // While loading auth, render nothing (HTML shell covers)
  if (loading || !decision) return null;

  // Access denied — render fallback (default: nothing)
  if (!decision.granted) return <>{fallback}</>;

  // Access granted — render children
  return <>{children}</>;
}
