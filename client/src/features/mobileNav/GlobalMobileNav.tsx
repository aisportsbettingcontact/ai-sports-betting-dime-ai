/**
 * GlobalMobileNav
 * ═══════════════
 * Mounts the mobile primary navigation globally on mobile for every
 * authenticated user — there are no role-gated tabs. This component lives
 * in App.tsx (outside any route) so the nav appears on ALL pages,
 * including the /m/* screens (which have no nav chrome of their own).
 *
 * [FLOATING NAV 2026-07-18] Renders the top-floating MobileFloatingNav
 * (logo chip + pill menu) and toggles `body.dime-floating-nav-active`,
 * which reserves top document-flow space via the measured
 * `--dime-floating-nav-h` variable and offsets page sticky chrome
 * (docs/plans/2026-07-18-mobile-floating-nav.md).
 *
 * Visibility rules:
 * - Only renders if MOBILE_NAV_ENABLED === true
 * - Only renders for authenticated users (via useAppAuth)
 * - Only renders on mobile viewports (<768px)
 * - Never overlays the auth surface (/login)
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { MobileFloatingNav } from "./MobileFloatingNav";
import { MOBILE_NAV_ENABLED, MOBILE_NAV_DEBUG_PANEL } from "./config";
import { mobileNavLogger } from "./logger";

/** Body class that gates all floating-nav clearance/offset CSS. */
export const FLOATING_NAV_BODY_CLASS = "dime-floating-nav-active";

export function GlobalMobileNav() {
  const { appUser, loading } = useAppAuth();
  const [location] = useLocation();
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport — strictly <768 so it agrees with the shell
  // boundary (DIME_SHELL_MIN_WIDTH_PX); at exactly 768 the shell owns nav.
  useEffect(() => {
    function checkMobile() {
      setIsMobile(window.innerWidth < 768);
    }
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Determine if we should show the nav
  const shouldShow = useMemo(() => {
    // Feature disabled
    if (!MOBILE_NAV_ENABLED) return false;
    // Still loading auth
    if (loading) return false;
    // Not authenticated
    if (!appUser) return false;
    // [LOGIN FIX 2026-07-12] Never overlay the auth surface — /login is
    // reachable while authenticated (account switching).
    if (location === "/login") return false;
    // Not mobile
    if (!isMobile) return false;
    return true;
  }, [loading, appUser, location, isMobile]);

  // ─── Logging: mobile_nav_rendered ────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (!shouldShow) return;

    mobileNavLogger.log("mobile_nav_rendered", undefined, {
      current_path: location,
      is_mobile: isMobile,
      timestamp: Date.now(),
      user_id: appUser?.id ?? null,
      feature_flags: { MOBILE_NAV_ENABLED, MOBILE_NAV_DEBUG_PANEL },
    });
  }, [shouldShow, loading, appUser, isMobile, location]);

  // Body class for CSS targeting: reserves real document-flow space above the
  // content (padding-top: var(--dime-floating-nav-h)) and offsets sticky page
  // chrome + hides duplicate page-level wordmarks while the floating logo owns
  // the brand identity ("one Dime identity per page").
  useEffect(() => {
    if (shouldShow) {
      document.body.classList.add(FLOATING_NAV_BODY_CLASS);
    } else {
      document.body.classList.remove(FLOATING_NAV_BODY_CLASS);
    }
    return () => {
      document.body.classList.remove(FLOATING_NAV_BODY_CLASS);
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  return <MobileFloatingNav />;
}
