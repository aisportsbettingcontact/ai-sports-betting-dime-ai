import { useCallback, useEffect } from "react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useSessionTracking } from "@/hooks/useSessionTracking";
import { useAnalytics } from "@/lib/analytics";
import { registerAnalyticsEmit, unregisterAnalyticsEmit } from "@/lib/analyticsBridge";

/**
 * SessionTracker — lazy render-null island. Drives foreground engagement
 * sessions (useSessionTracking) AND emits one device-tagged `session_started`
 * analytics event per foreground open. Lazy so it stays off chat's critical
 * path. No-ops for signed-out viewers.
 *
 * It also registers its `track` into analyticsBridge so bundle-critical-path
 * surfaces (DimeChatPage) can emit without importing the analytics machinery.
 */
export default function SessionTracker() {
  const { appUser } = useAppAuth();
  const track = useAnalytics();
  const onOpen = useCallback(() => track("session_started"), [track]);
  useSessionTracking(!!appUser, onOpen);

  // Bridge the heavy (lazy) emitter to critical-path callers.
  useEffect(() => {
    registerAnalyticsEmit(track);
    return () => unregisterAnalyticsEmit(track);
  }, [track]);

  return null;
}
