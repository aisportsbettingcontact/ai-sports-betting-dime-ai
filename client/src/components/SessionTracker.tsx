import { useCallback } from "react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useSessionTracking } from "@/hooks/useSessionTracking";
import { useAnalytics } from "@/lib/analytics";

/**
 * SessionTracker — lazy render-null island. Drives foreground engagement
 * sessions (useSessionTracking) AND emits one device-tagged `session_started`
 * analytics event per foreground open. Lazy so it stays off chat's critical
 * path. No-ops for signed-out viewers.
 */
export default function SessionTracker() {
  const { appUser } = useAppAuth();
  const track = useAnalytics();
  const onOpen = useCallback(() => track("session_started"), [track]);
  useSessionTracking(!!appUser, onOpen);
  return null;
}
