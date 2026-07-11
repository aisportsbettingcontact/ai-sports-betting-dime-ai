/**
 * GlobalMobileOwnerTabs
 * ═════════════════════
 * Mounts the MobileOwnerBottomTabs globally for owner users on mobile.
 * This component lives in App.tsx (outside any route) so the bottom nav
 * appears on ALL pages (e.g. /feed/model/mlb-…, /betting-splits/MLB) — not
 * just /m/* routes.
 *
 * Visibility rules:
 * - Only renders if MOBILE_OWNER_TABS_ENABLED === true
 * - Only renders for authenticated owner users (via useAppAuth)
 * - Only renders on mobile viewports (max-width: 768px)
 * - Does NOT render on /m/* routes (those have their own shell with tabs)
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
import { MobileOwnerBottomTabs } from "./MobileOwnerBottomTabs";
import {
  MOBILE_OWNER_TABS_ENABLED,
  MOBILE_OWNER_TABS_TEST_MODE,
  MOBILE_OWNER_TABS_PUBLIC_ENABLED,
  MOBILE_OWNER_TABS_DEBUG_PANEL,
} from "./config";
import { mobileOwnerTabLogger } from "./logger";

/** Standard metadata payload for all logs from this component */
function buildLogMetadata(
  appUser: { id?: number; role?: string } | null,
  isOwner: boolean,
  isMobile: boolean,
  currentPath: string,
  targetPath?: string,
  tabName?: string,
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

  // Detect mobile viewport — strictly <768 so it agrees with the CSS
  // clearance breakpoint (max-width:767px); at exactly 768 neither applies.
  useEffect(() => {
    function checkMobile() {
      setIsMobile(window.innerWidth < 768);
    }
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Determine if we should show the tabs
  const shouldShow = useMemo(() => {
    // Feature disabled
    if (!MOBILE_OWNER_TABS_ENABLED) return false;
    // Still loading auth
    if (loading) return false;
    // Not authenticated
    if (!appUser) return false;
    // Already on /m/* routes (those have their own tab shell) — segment-exact
    // so /mlb/team/:slug (which merely starts with "/m") keeps the global tabs
    if (location === "/m" || location.startsWith("/m/")) return false;
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
  // Fires when the global tabs render on an existing (non-/m/*) page for an owner
  useEffect(() => {
    if (loading) return;
    if (!shouldShow) return;
    // Only log when NOT on /m/* (those have their own logging)
    if (location === "/m" || location.startsWith("/m/")) return;

    mobileOwnerTabLogger.log(
      "mobile_owner_existing_page_tabs_rendered",
      undefined,
      buildLogMetadata(appUser, isOwner, isMobile, location),
    );
  }, [shouldShow, loading, appUser, isOwner, isMobile, location]);

  // ─── Logging: mobile_owner_non_owner_m_route_denied ──────────────────────────
  // Fires when a non-owner user is on mobile and tabs are NOT shown
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
      buildLogMetadata(appUser, isOwner, isMobile, location),
    );
  }, [loading, appUser, isOwner, isMobile, location]);

  // Add/remove body class for CSS targeting (e.g. extra bottom padding on feed)
  useEffect(() => {
    if (shouldShow) {
      document.body.classList.add("mobile-owner-tabs-active");
    } else {
      document.body.classList.remove("mobile-owner-tabs-active");
    }
    return () => {
      document.body.classList.remove("mobile-owner-tabs-active");
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  // Content clearance comes from body.mobile-owner-tabs-active (index.css),
  // which reserves real document-flow space — the old position:fixed "spacer"
  // reserved none and let the bar occlude the last row of every page.
  return <MobileOwnerBottomTabs />;
}
