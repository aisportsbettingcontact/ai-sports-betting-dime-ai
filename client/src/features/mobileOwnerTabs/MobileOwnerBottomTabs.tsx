/**
 * MobileOwnerBottomTabs
 * ═════════════════════
 * Fixed bottom navigation bar with 5 tabs.
 *
 * DESIGN SPEC (PERMANENT — DO NOT CHANGE):
 * ─────────────────────────────────────────
 * Background:      #000000 (pure black, NO navy, NO blur, NO transparency)
 * Border-top:      1px solid rgba(255, 255, 255, 0.08)
 * Active icon:     #39FF14 (neon green)
 * Active label:    #FFFFFF (white)
 * Inactive icon:   rgba(255, 255, 255, 0.55) (muted gray)
 * Inactive label:  rgba(255, 255, 255, 0.55) (muted gray)
 * Active dot:      #39FF14, 4px circle
 * Icon size:       22px
 * Label:           11px, weight 600 active / 500 inactive
 * Height:          60px
 * Touch targets:   44px minimum (Apple HIG)
 * Safe area:       env(safe-area-inset-bottom)
 *
 * ALL COLORS USE INLINE style={{}} — NOT Tailwind classes.
 * This prevents any CSS specificity override.
 */

import { useLocation } from "wouter";
import {
  Newspaper,
  BarChart3,
  MessageSquare,
  FlaskConical,
  User,
} from "lucide-react";
import { type MobileOwnerTabId, MOBILE_OWNER_TABS } from "./config";
import { mobileOwnerTabLogger } from "./logger";
import { useEffect, useRef } from "react";

// ─── Design tokens (single source of truth) ─────────────────────────────────
const COLORS = {
  BG: "#000000",
  BORDER: "rgba(255, 255, 255, 0.08)",
  ACTIVE_ICON: "#39FF14",
  ACTIVE_LABEL: "#FFFFFF",
  INACTIVE: "rgba(255, 255, 255, 0.55)",
  DOT: "#39FF14",
} as const;

const ICON_MAP: Record<string, React.FC<{ className?: string; strokeWidth?: number }>> = {
  Newspaper,
  BarChart3,
  MessageSquare,
  FlaskConical,
  User,
};

interface MobileOwnerBottomTabsProps {
  className?: string;
}

export function MobileOwnerBottomTabs({ className = "" }: MobileOwnerBottomTabsProps) {
  const [location, navigate] = useLocation();
  const renderedRef = useRef(false);

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

    // For paths with query params (e.g., /feed?tab=dual), wouter's navigate
    // only handles pathname. We need to use window.location for full URL navigation.
    const currentFull = location + (typeof window !== "undefined" ? window.location.search : "");
    if (currentFull !== path) {
      mobileOwnerTabLogger.log("tab_changed", tabId, { from: activeTabId, to: tabId });
      if (path.includes("?")) {
        // Path has query params — use window.location to preserve them
        window.location.href = path;
      } else {
        navigate(path);
      }
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
        zIndex: 9999,
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
                transition: "transform 150ms ease-out",
              }}
            >
              {Icon && (
                <span
                  style={{
                    display: "inline-flex",
                    color: iconColor,
                    transform: isActive ? "scale(1.05)" : "scale(1)",
                    transition: "transform 150ms ease-out, color 150ms ease-out",
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
                  fontSize: "11px",
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: "0.01em",
                  lineHeight: 1.2,
                  color: labelColor,
                  transition: "color 150ms ease-out",
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
// Handles both simple paths (/m/chat) and paths with query params (/feed?tab=dual)
function getActiveTab(path: string): MobileOwnerTabId | null {
  // wouter's useLocation() returns pathname only (no query string).
  // We need to check the full URL including search params.
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const fullPath = path + currentSearch;

  // Direct match: check if current path+search matches a tab's path exactly
  for (const tab of MOBILE_OWNER_TABS) {
    // For tabs with query params (e.g., /feed?tab=dual)
    if (tab.path.includes("?")) {
      const [tabPathname, tabSearch] = tab.path.split("?");
      if (path === tabPathname && currentSearch.includes(tabSearch)) {
        return tab.id;
      }
    } else {
      // Simple path match (e.g., /m/chat, /m/profile)
      if (path === tab.path || path.startsWith(tab.path + "/")) {
        return tab.id;
      }
    }
  }

  // Fallback: if on /feed with no recognized tab param, default to "feed"
  if (path === "/feed") {
    // Check if ?tab= matches any props-related tab
    const tabParam = new URLSearchParams(currentSearch).get("tab");
    if (tabParam === "splits") return "splits";
    if (tabParam === "lineups" || tabParam === "props" || tabParam === "f5nrfi" || tabParam === "hrprops") return "props";
    return "feed"; // dual or no param = feed
  }

  // Fallback: if on /m/* but no exact match, try prefix
  if (path.startsWith("/m/")) {
    const segment = path.split("/")[2];
    const match = MOBILE_OWNER_TABS.find(t => t.id === segment || t.path.includes(segment));
    if (match) return match.id;
  }

  return "feed"; // Default to feed
}
