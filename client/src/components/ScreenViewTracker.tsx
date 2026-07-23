import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useAnalytics } from "@/lib/analytics";
import { toRoutePattern } from "@/lib/routePattern";

/**
 * ScreenViewTracker — render-null island that emits one device-tagged
 * `screen_viewed` per route change for authenticated users. Lazy-loaded by
 * DimeAppShell so it stays OFF chat's critical-path bundle. Fire-and-forget;
 * server-gated; sends only a low-cardinality route PATTERN (never a raw URL).
 */
export default function ScreenViewTracker() {
  const [location] = useLocation();
  const { appUser } = useAppAuth();
  const track = useAnalytics();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (!appUser) return;
    const route = toRoutePattern(location);
    if (prev.current === route) return;
    const from = prev.current;
    prev.current = route;
    track("screen_viewed", { route, ...(from ? { props: { from_route: from } } : {}) });
  }, [location, appUser, track]);

  return null;
}
