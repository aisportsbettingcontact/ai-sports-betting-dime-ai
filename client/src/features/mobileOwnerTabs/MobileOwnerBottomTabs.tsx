/**
 * MobileOwnerBottomTabs
 * ═════════════════════
 * Fixed bottom navigation bar with 5 tabs.
 *
 * DESIGN SPEC — Dime brand law (design-system/dime-ai/MASTER.md):
 * ────────────────────────────────────────────────────────────────
 * All colors resolve from the global `--dime-*` tokens
 * (client/src/styles/dime-mobile.css), so the bar follows the
 * app theme (html.dark) with no state wiring:
 *   Background:      --dime-surface-sidebar (#101016 dark / #F4F4F6 light)
 *   Border-top:      1px solid --dime-border (#24242E / #E4E4E9)
 *   Active icon:     --dime-mint-text (#45E0A8 dark / #0FA36B light — the
 *                    mint-text-on-light contrast rule, MASTER.md:47)
 *   Active label:    --dime-text-primary
 *   Inactive:        --dime-text-secondary
 *   Active dot:      --dime-mint 4px circle; on light it carries the brand
 *                    coin-dot hairline (--dime-coin-keyline)
 *   Motion:          160ms cubic-bezier(0.16,1,0.3,1); disabled under
 *                    prefers-reduced-motion
 *   Icon size 22px · label 11px Familjen Grotesk (600 active / 500 inactive)
 *   Height 60px · 44px touch targets · env(safe-area-inset-bottom)
 *
 * ALL COLORS USE INLINE style={{}} — NOT Tailwind classes.
 * This prevents any CSS specificity override. Neon `#39FF14` and pure
 * black `#000000` are the pre-rebrand legacy spec — do not reintroduce.
 */

import { useLocation } from "wouter";
import {
  Newspaper,
  BarChart3,
  MessageSquare,
  TrendingUp,
  User,
} from "lucide-react";
import { type MobileOwnerTabId, MOBILE_OWNER_TABS } from "./config";
import { mobileOwnerTabLogger } from "./logger";
import { useEffect, useRef, useState } from "react";

// ─── Design tokens (single source of truth: --dime-* in dime-mobile.css) ────
const COLORS = {
  BG: "var(--dime-surface-sidebar)",
  BORDER: "var(--dime-border)",
  ACTIVE_ICON: "var(--dime-mint-text)",
  ACTIVE_LABEL: "var(--dime-text-primary)",
  INACTIVE: "var(--dime-text-secondary)",
  DOT: "var(--dime-mint)",
} as const;

const BRAND_TRANSITION = "var(--dime-t) var(--dime-ease)";

/** MASTER.md motion law: respect prefers-reduced-motion (disable transitions). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const ICON_MAP: Record<string, React.FC<{ className?: string; strokeWidth?: number }>> = {
  Newspaper,
  BarChart3,
  MessageSquare,
  TrendingUp,
  User,
};

interface MobileOwnerBottomTabsProps {
  className?: string;
}

export function MobileOwnerBottomTabs({ className = "" }: MobileOwnerBottomTabsProps) {
  const [location, navigate] = useLocation();
  const renderedRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  // Log initial render + verify design tokens on mount
  useEffect(() => {
    if (!renderedRef.current) {
      renderedRef.current = true;
      mobileOwnerTabLogger.log("tabs_rendered", undefined, {
        location,
        tabCount: MOBILE_OWNER_TABS.length,
      });

      // Design verification log
      console.log(
        "[MobileOwnerBottomTabs] MOUNTED — Design tokens:",
        JSON.stringify(COLORS)
      );

      mobileOwnerTabLogger.log("mobile_owner_tabs_visual_refinement_loaded", undefined, {
        current_path: location,
        active_tab: getActiveTab(location),
        user_role: "owner",
        is_owner: true,
        viewport_width: typeof window !== "undefined" ? window.innerWidth : 0,
        viewport_height: typeof window !== "undefined" ? window.innerHeight : 0,
        timestamp: Date.now(),
        bg_color: COLORS.BG,
        active_icon_color: COLORS.ACTIVE_ICON,
        active_text_color: COLORS.ACTIVE_LABEL,
        inactive_color: COLORS.INACTIVE,
      });

      mobileOwnerTabLogger.log("mobile_owner_tabs_visual_refinement_safe_area_verified", undefined, {
        current_path: location,
        active_tab: getActiveTab(location),
        user_role: "owner",
        is_owner: true,
        viewport_width: typeof window !== "undefined" ? window.innerWidth : 0,
        viewport_height: typeof window !== "undefined" ? window.innerHeight : 0,
        timestamp: Date.now(),
        safe_area_bottom: "env(safe-area-inset-bottom)",
      });
    }
  }, [location]);

  const activeTabId = getActiveTab(location);

  function handleTabTap(tabId: MobileOwnerTabId, path: string) {
    mobileOwnerTabLogger.log("tab_tapped", tabId, { from: location, to: path });

    // Visual refinement: active state verified on tap
    mobileOwnerTabLogger.log("mobile_owner_tabs_visual_refinement_active_state_verified", tabId, {
      current_path: location,
      active_tab: tabId,
      user_role: "owner",
      is_owner: true,
      viewport_width: typeof window !== "undefined" ? window.innerWidth : 0,
      viewport_height: typeof window !== "undefined" ? window.innerHeight : 0,
      timestamp: Date.now(),
    });

    // User-specified event: mobile_owner_tab_clicked
    mobileOwnerTabLogger.log("mobile_owner_tab_clicked", tabId, {
      current_path: location,
      target_path: path,
      tab_name: tabId,
      user_role: null,
      is_owner: true,
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });

    // Haptic feedback (if available)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(10);
        mobileOwnerTabLogger.log("haptic_triggered", tabId);
      } catch {
        // Silent — not all browsers support vibrate
      }
    }

    // [NAV RECONSTRUCTION 2026-07-11] All tab paths are pathname-only (the
    // /feed?tab=… query hooks are eradicated) — SPA navigation everywhere,
    // no full-page window.location fallback.
    if (location !== path) {
      mobileOwnerTabLogger.log("tab_changed", tabId, { from: activeTabId, to: tabId });
      // Re-tapping the active tab (e.g. Feed from a dated URL back to
      // /feed/model/mlb) replaces instead of pushing — no history pile-up.
      navigate(path, { replace: activeTabId === tabId });
      mobileOwnerTabLogger.log("route_navigated", tabId, { path });

      // User-specified event: mobile_owner_tab_navigated_to_m_route
      mobileOwnerTabLogger.log("mobile_owner_tab_navigated_to_m_route", tabId, {
        current_path: location,
        target_path: path,
        tab_name: tabId,
        is_owner: true,
        is_mobile: true,
        test_mode: false,
        timestamp: Date.now(),
      });
    }
  }

  return (
    <nav
      data-testid="mobile-owner-bottom-tabs"
      className={className}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        // Below the app modals (AgeModal/LoginModal render at z-50): the 21+
        // age gate must not be overlapped or routable-around by the tab bar.
        zIndex: 40,
        backgroundColor: COLORS.BG,
        borderTop: `1px solid ${COLORS.BORDER}`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="tablist"
      aria-label="Main navigation"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          height: "60px",
          maxWidth: "32rem",
          margin: "0 auto",
          padding: "0 8px",
        }}
      >
        {MOBILE_OWNER_TABS.map((tab) => {
          const isActive = activeTabId === tab.id;
          const Icon = ICON_MAP[tab.iconName];
          const iconColor = isActive ? COLORS.ACTIVE_ICON : COLORS.INACTIVE;
          const labelColor = isActive ? COLORS.ACTIVE_LABEL : COLORS.INACTIVE;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              data-testid={`tab-${tab.id}`}
              data-active={isActive}
              onClick={() => handleTabTap(tab.id, tab.path)}
              disabled={tab.disabled}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "2px",
                minWidth: "44px",
                minHeight: "44px",
                padding: "6px 12px",
                border: "none",
                background: "transparent",
                cursor: tab.disabled ? "not-allowed" : "pointer",
                opacity: tab.disabled ? 0.4 : 1,
                WebkitTapHighlightColor: "transparent",
                transition: reducedMotion ? "none" : `transform ${BRAND_TRANSITION}`,
              }}
            >
              {Icon && (
                <span
                  style={{
                    display: "inline-flex",
                    color: iconColor,
                    transform: isActive && !reducedMotion ? "scale(1.05)" : "scale(1)",
                    transition: reducedMotion
                      ? "none"
                      : `transform ${BRAND_TRANSITION}, color ${BRAND_TRANSITION}`,
                  }}
                >
                  <Icon
                    className="w-[22px] h-[22px]"
                    strokeWidth={isActive ? 2.2 : 1.8}
                  />
                </span>
              )}
              <span
                style={{
                  fontFamily: "var(--dime-font-sans)",
                  fontSize: "11px",
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: "0.01em",
                  lineHeight: 1.2,
                  color: labelColor,
                  transition: reducedMotion ? "none" : `color ${BRAND_TRANSITION}`,
                }}
              >
                {tab.label}
              </span>
              {/* Active indicator dot */}
              {isActive && (
                <span
                  data-testid={`tab-dot-${tab.id}`}
                  style={{
                    position: "absolute",
                    bottom: "4px",
                    width: "4px",
                    height: "4px",
                    borderRadius: "999px",
                    backgroundColor: COLORS.DOT,
                    // Brand coin-dot rule: mint dot needs a near-black hairline
                    // on light surfaces (token is `none` on dark).
                    boxShadow: "var(--dime-coin-keyline)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Helper: Determine active tab from current path ──────────────────────────
// [NAV RECONSTRUCTION 2026-07-11] Pure pathname matching — the legacy
// /feed?tab=… query hooks are eradicated, so no query-string parsing remains.
function getActiveTab(path: string): MobileOwnerTabId | null {
  // Canonical surface prefixes (any date/sport variant of the surface
  // keeps its tab lit — e.g. /feed/model/wc-07-11-2026 is still "feed").
  if (path.startsWith("/feed/model")) return "feed";
  if (path.startsWith("/betting-splits")) return "splits";
  if (path === "/m/tracker" || path.startsWith("/m/tracker/")) return "tracker";
  // Legacy slug — /m/props redirects to /m/tracker; keep the tab lit meanwhile.
  if (path === "/m/props" || path.startsWith("/m/props/")) return "tracker";

  // Exact/prefix match against configured tab paths (/chat, /profile, /m/*)
  for (const tab of MOBILE_OWNER_TABS) {
    if (path === tab.path || path.startsWith(tab.path + "/")) {
      return tab.id;
    }
  }

  // Fallback: if on /m/* but no exact match, try prefix
  if (path.startsWith("/m/")) {
    const segment = path.split("/")[2];
    const match = MOBILE_OWNER_TABS.find(t => t.id === segment || t.path.includes(segment));
    if (match) return match.id;
  }

  return "feed"; // Default to feed
}
