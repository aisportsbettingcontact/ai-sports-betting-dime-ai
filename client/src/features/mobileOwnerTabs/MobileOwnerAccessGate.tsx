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

import { useAuth } from "@/_core/hooks/useAuth";
import { type ReactNode, useEffect, useMemo } from "react";
import { decideMobileOwnerAccess } from "./config";
import { mobileOwnerTabLogger } from "./logger";

interface MobileOwnerAccessGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function MobileOwnerAccessGate({ children, fallback = null }: MobileOwnerAccessGateProps) {
  const { user, isAuthenticated, loading } = useAuth();

  const decision = useMemo(() => {
    if (loading) return null;
    return decideMobileOwnerAccess(user?.role, isAuthenticated, true);
  }, [user?.role, isAuthenticated, loading]);

  useEffect(() => {
    if (!decision) return;
    if (decision.granted) {
      mobileOwnerTabLogger.log("access_granted", undefined, { reason: decision.reason, role: user?.role });
    } else {
      mobileOwnerTabLogger.log("access_denied", undefined, { reason: decision.reason, role: user?.role });
    }
  }, [decision, user?.role]);

  // While loading auth, render nothing (HTML shell covers)
  if (loading || !decision) return null;

  // Access denied — render fallback (default: nothing)
  if (!decision.granted) return <>{fallback}</>;

  // Access granted — render children
  return <>{children}</>;
}
