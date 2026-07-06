/**
 * MobileOwnerBottomTabs
 * ═════════════════════
 * Fixed bottom navigation bar with 5 tabs.
 * - DraftKings-inspired dark theme with green active state
 * - iOS safe-area inset support (env(safe-area-inset-bottom))
 * - 44px minimum touch targets (Apple HIG)
 * - Smooth icon transitions
 * - Haptic-ready tap handler
 */

import { useLocation } from "wouter";
import {
  Newspaper,
  BarChart3,
  MessageSquare,
  Receipt,
  User,
} from "lucide-react";
import { type MobileOwnerTabId, MOBILE_OWNER_TABS } from "./config";
import { mobileOwnerTabLogger } from "./logger";
import { useEffect, useRef } from "react";

const ICON_MAP: Record<string, React.FC<{ className?: string; strokeWidth?: number }>> = {
  Newspaper,
  BarChart3,
  MessageSquare,
  Receipt,
  User,
};

interface MobileOwnerBottomTabsProps {
  className?: string;
}

export function MobileOwnerBottomTabs({ className = "" }: MobileOwnerBottomTabsProps) {
  const [location, navigate] = useLocation();
  const renderedRef = useRef(false);

  // Log initial render
  useEffect(() => {
    if (!renderedRef.current) {
      renderedRef.current = true;
      mobileOwnerTabLogger.log("tabs_rendered", undefined, {
        location,
        tabCount: MOBILE_OWNER_TABS.length,
      });
    }
  }, [location]);

  const activeTabId = getActiveTab(location);

  function handleTabTap(tabId: MobileOwnerTabId, path: string) {
    mobileOwnerTabLogger.log("tab_tapped", tabId, { from: location, to: path });

    // Haptic feedback (if available)
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(10);
        mobileOwnerTabLogger.log("haptic_triggered", tabId);
      } catch {
        // Silent — not all browsers support vibrate
      }
    }

    if (location !== path) {
      mobileOwnerTabLogger.log("tab_changed", tabId, { from: activeTabId, to: tabId });
      navigate(path);
      mobileOwnerTabLogger.log("route_navigated", tabId, { path });
    }
  }

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#1a1a2e]/95 backdrop-blur-xl ${className}`}
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around h-[60px] max-w-lg mx-auto px-2">
        {MOBILE_OWNER_TABS.map((tab) => {
          const isActive = activeTabId === tab.id;
          const Icon = ICON_MAP[tab.iconName];

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => handleTabTap(tab.id, tab.path)}
              disabled={tab.disabled}
              className={`
                flex flex-col items-center justify-center gap-0.5
                min-w-[44px] min-h-[44px] px-3 py-1.5
                rounded-lg transition-all duration-200 ease-out
                active:scale-95
                ${isActive
                  ? "text-emerald-400"
                  : "text-gray-400 hover:text-gray-200"
                }
                ${tab.disabled ? "opacity-40 pointer-events-none" : ""}
              `}
            >
              {Icon && (
                <Icon
                  className={`w-5 h-5 transition-all duration-200 ${
                    isActive ? "scale-110" : ""
                  }`}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
              )}
              <span
                className={`text-[10px] leading-tight font-medium transition-all duration-200 ${
                  isActive ? "font-semibold" : ""
                }`}
              >
                {tab.label}
              </span>
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Helper: Determine active tab from current path ──────────────────────────
function getActiveTab(path: string): MobileOwnerTabId | null {
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
