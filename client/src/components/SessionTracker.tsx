import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useSessionTracking } from "@/hooks/useSessionTracking";

/**
 * SessionTracker — a render-null island that records foreground engagement
 * sessions for authenticated users (see useSessionTracking). It is lazy-loaded
 * by DimeAppShell specifically so this background instrumentation stays OUT of
 * chat's critical-path bundle — it is not needed for first paint. No-ops for
 * signed-out / preview viewers (openSession is auth-only).
 */
export default function SessionTracker() {
  const { appUser } = useAppAuth();
  useSessionTracking(!!appUser);
  return null;
}
