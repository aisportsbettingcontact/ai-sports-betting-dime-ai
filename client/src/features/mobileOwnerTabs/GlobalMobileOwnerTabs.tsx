/**
 * GlobalMobileOwnerTabs
 * ═════════════════════
 * Mounts the mobile primary navigation globally on mobile. Public since
 * 2026-07-12 (MOBILE_OWNER_TABS_PUBLIC_ENABLED): every authenticated user
 * gets the nav, not just the owner. This component lives in App.tsx
 * (outside any route) so the nav appears on ALL pages.
 *
 * [FLOATING NAV 2026-07-18] The fixed bottom tab bar is retired; this now
 * mounts the top-floating MobileFloatingNav (logo chip + pill menu) and
 * toggles `body.dime-floating-nav-active`, which reserves top document-flow
 * space via the measured `--dime-floating-nav-h` variable and offsets page
 * sticky chrome (docs/plans/2026-07-18-mobile-floating-nav.md). The /m/*
 * exclusion is gone — those screens lost their own tab shell bar, so the
 * global nav is their navigation now.
 *
 * Visibility rules:
 * - Only renders if MOBILE_OWNER_TABS_ENABLED === true
 * - Only renders for authenticated users (via useAppAuth; owner-only unless
 *   MOBILE_OWNER_TABS_PUBLIC_ENABLED or TEST_MODE)
 * - Only renders on mobile viewports (max-width: 768px)
 *
 * Logging events (user-specified):
 * - mobile_owner_tab_clicked
 * - mobile_owner_tab_navigated_to_m_route
 * - mobile_owner_existing_page_tabs_rendered
 * - mobile_owner_m_route_rendered
 * - mobile_owner_non_owner_m_route_denied
 *
 * Every log includes: current_path, target_path, tab_name, user_role,
 * is_owner, is_mobile, test_mode, timestamp
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { MobileFloatingNav } from "./MobileFloatingNav";
import {
  MOBILE_OWNER_TABS_ENABLED,
  MOBILE_OWNER_TABS_TEST_MODE,
  MOBILE_OWNER_TABS_PUBLIC_ENABLED,
  MOBILE_OWNER_TABS_DEBUG_PANEL,
} from "./config";
import { mobileOwnerTabLogger } from "./logger";

/** Body class that gates all floating-nav clearance/offset CSS. */
export const FLOATING_NAV_BODY_CLASS = "dime-floating-nav-active";

/** Standard metadata payload for all logs from this component */
function buildLogMetadata(
  appUser: { id?: number; role?: string } | null,
  isOwner: boolean,
  isMobile: boolean,
  currentPath: string,
  targetPath?: string,
  tabName?: string
) {
  return {
    current_path: currentPath,
    target_path: targetPath ?? null,
    tab_name: tabName ?? null,
    user_role: appUser?.role ?? null,
    is_owner: isOwner,
    is_mobile: isMobile,
    test_mode: MOBILE_OWNER_TABS_TEST_MODE,
    timestamp: Date.now(),
    user_id: appUser?.id ?? null,
    feature_flags: {
      MOBILE_OWNER_TABS_ENABLED,
      MOBILE_OWNER_TABS_TEST_MODE,
      MOBILE_OWNER_TABS_PUBLIC_ENABLED,
      MOBILE_OWNER_TABS_DEBUG_PANEL,
    },
  };
}

export function GlobalMobileOwnerTabs() {
  const { appUser, loading, isOwner } = useAppAuth();
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
    if (!MOBILE_OWNER_TABS_ENABLED) return false;
    // Still loading auth
    if (loading) return false;
    // Not authenticated
    if (!appUser) return false;
    // [LOGIN FIX 2026-07-12] Never overlay the auth surface — /login is now
    // reachable while authenticated (account switching).
    if (location === "/login") return false;
    // Not mobile
    if (!isMobile) return false;
    // Public mode — show to everyone
    if (MOBILE_OWNER_TABS_PUBLIC_ENABLED) return true;
    // Test mode — show to any authenticated user
    if (MOBILE_OWNER_TABS_TEST_MODE) return true;
    // Normal mode — owner only
    return isOwner;
  }, [loading, appUser, isOwner, location, isMobile]);

  // ─── Logging: mobile_owner_existing_page_tabs_rendered ───────────────────────
  // Fires when the global nav renders on a page for an eligible user
  useEffect(() => {
    if (loading) return;
    if (!shouldShow) return;

    mobileOwnerTabLogger.log(
      "mobile_owner_existing_page_tabs_rendered",
      undefined,
      buildLogMetadata(appUser, isOwner, isMobile, location)
    );
  }, [shouldShow, loading, appUser, isOwner, isMobile, location]);

  // ─── Logging: mobile_owner_non_owner_m_route_denied ──────────────────────────
  // Fires when a non-owner user is on mobile and the nav is NOT shown
  useEffect(() => {
    if (loading) return;
    if (!appUser) return;
    if (!isMobile) return;
    if (isOwner) return;
    if (!MOBILE_OWNER_TABS_ENABLED) return;
    if (MOBILE_OWNER_TABS_PUBLIC_ENABLED || MOBILE_OWNER_TABS_TEST_MODE) return;

    mobileOwnerTabLogger.log(
      "mobile_owner_non_owner_m_route_denied",
      undefined,
      buildLogMetadata(appUser, isOwner, isMobile, location)
    );
  }, [loading, appUser, isOwner, isMobile, location]);

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
