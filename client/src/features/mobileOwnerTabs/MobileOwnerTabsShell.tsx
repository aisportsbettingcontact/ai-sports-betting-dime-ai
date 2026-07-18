/**
 * MobileOwnerTabsShell
 * ════════════════════
 * Layout wrapper that provides:
 * - Content area cleared below the global floating nav
 * - Access gate (owner-only)
 * - Scroll position preservation per tab
 *
 * [FLOATING NAV 2026-07-18] The shell no longer renders its own bottom tab
 * bar — the global MobileFloatingNav (App.tsx mount) now also covers /m/*
 * routes, so this shell only reserves top clearance for it.
 */

import { type ReactNode, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { MobileOwnerAccessGate } from "./MobileOwnerAccessGate";
import { mobileOwnerTabLogger } from "./logger";

interface MobileOwnerTabsShellProps {
  children: ReactNode;
}

export function MobileOwnerTabsShell({ children }: MobileOwnerTabsShellProps) {
  const [location] = useLocation();
  const scrollPositions = useRef<Record<string, number>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  // Save scroll position on route change
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    // Restore scroll position for this route
    const saved = scrollPositions.current[location];
    if (saved !== undefined) {
      el.scrollTop = saved;
      mobileOwnerTabLogger.log("scroll_position_restored", undefined, {
        path: location,
        position: saved,
      });
    } else {
      el.scrollTop = 0;
    }

    return () => {
      // Save current scroll position before leaving
      if (el) {
        scrollPositions.current[location] = el.scrollTop;
        mobileOwnerTabLogger.log("scroll_position_saved", undefined, {
          path: location,
          position: el.scrollTop,
        });
      }
    };
  }, [location]);

  // Log mount/unmount
  useEffect(() => {
    mobileOwnerTabLogger.log("shell_mounted", undefined, { path: location });
    // User-specified event: mobile_owner_m_route_rendered
    mobileOwnerTabLogger.log("mobile_owner_m_route_rendered", undefined, {
      current_path: location,
      target_path: location,
      tab_name: location.split("/")[2] ?? null,
      is_owner: true, // Only owners pass the access gate
      is_mobile: true,
      test_mode: false,
      timestamp: Date.now(),
    });
    return () => {
      mobileOwnerTabLogger.log("shell_unmounted");
    };
  }, []);

  return (
    <MobileOwnerAccessGate>
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: "var(--dime-bg)" }}
      >
        {/* Scrollable content area — the shell root is position:fixed, so the
            body-level clearance can't reach it; reserve the floating-nav lane
            here from the same measured variable. */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{
            paddingTop: "var(--dime-floating-nav-h, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {children}
        </div>
      </div>
    </MobileOwnerAccessGate>
  );
}
