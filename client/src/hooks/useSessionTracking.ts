/**
 * useSessionTracking — records real foreground engagement sessions for the
 * current Dime app so the admin User Activity metrics stop reading zero.
 *
 * Root cause it fixes (owner directive 2026-07-23): `metrics.openSession` had
 * ZERO callers, so `user_sessions` never got a row and DAU/WAU/MAU/avg-duration
 * were all 0 ("not measured"). This hook, mounted once in the authenticated
 * Dime shell, drives the existing session lifecycle:
 *
 *   - open  on leadership acquisition (once per browser)
 *   - heartbeat on a foreground cadence, PAUSED when the tab is hidden or the
 *     user is idle (so engaged time reflects real foreground activity)
 *   - close on logout (enabled→false) and on pagehide (navigation away/close)
 *
 * Duplicate-tab protection: leadership is elected via the Web Locks API — a
 * single tab holds the exclusive lock and owns the session; the lock auto-
 * releases when that tab closes, handing leadership to another open tab. Without
 * Web Locks (older browsers) the single tab is trivially the leader. This keeps
 * multiple tabs from opening duplicate sessions or multiplying engaged time.
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export const HEARTBEAT_INTERVAL_MS = 60_000; //         foreground heartbeat cadence
export const IDLE_THRESHOLD_MS = 30 * 60_000; //         30 min without input ⇒ idle
const SESSION_LOCK = "dime-session-leader";

/**
 * Pure decision: should the leader emit a heartbeat right now? Only when this
 * tab is the leader, the document is visible (foreground), and the user is not
 * idle. Extracted so the engagement rule is unit-testable without a DOM.
 */
export function shouldHeartbeat(opts: {
  isLeader: boolean;
  visible: boolean;
  msSinceInput: number;
  idleThresholdMs?: number;
}): boolean {
  const threshold = opts.idleThresholdMs ?? IDLE_THRESHOLD_MS;
  return opts.isLeader && opts.visible && opts.msSinceInput < threshold;
}

type LockGrantedCallback = () => Promise<void>;
interface MinimalLockManager {
  request(
    name: string,
    options: { mode: "exclusive" | "shared" },
    callback: LockGrantedCallback,
  ): Promise<void>;
}

const INPUT_EVENTS = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;

export function useSessionTracking(enabled: boolean): void {
  const openMutation = trpc.metrics.openSession.useMutation();
  const heartbeatMutation = trpc.metrics.sessionHeartbeat.useMutation();
  const closeMutation = trpc.metrics.closeSession.useMutation();

  // Keep the effect identity-stable across renders while always calling the
  // latest mutate fn (mutate identity can change between renders).
  const openRef = useRef(openMutation.mutate);
  const beatRef = useRef(heartbeatMutation.mutate);
  const closeRef = useRef(closeMutation.mutate);
  openRef.current = openMutation.mutate;
  beatRef.current = heartbeatMutation.mutate;
  closeRef.current = closeMutation.mutate;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let isLeader = false;
    let started = false;
    let intervalId: number | undefined;
    let releaseLock: (() => void) | null = null;
    let lastInput = Date.now();

    const markInput = () => { lastInput = Date.now(); };
    const open = () => { if (!started) { started = true; openRef.current(); } };
    const close = () => { if (started) { started = false; closeRef.current(); } };
    const beat = () => {
      if (
        shouldHeartbeat({
          isLeader,
          visible: document.visibilityState === "visible",
          msSinceInput: Date.now() - lastInput,
        })
      ) {
        beatRef.current();
      }
    };

    const startLeading = () => {
      isLeader = true;
      open();
      beat(); // immediate beat so a genuine foreground open registers as engaged
      intervalId = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    };

    // Leader election (duplicate-tab protection). Web Locks gives an exact
    // single holder with automatic handoff when the tab closes. Browsers
    // without it fall back to a best-effort localStorage claim (renewed each
    // interval; a stale claim is taken over), which dedupes the common
    // multi-tab case without Web Locks' exactness.
    const locks = (navigator as unknown as { locks?: MinimalLockManager }).locks;
    if (locks && typeof locks.request === "function") {
      locks
        .request(SESSION_LOCK, { mode: "exclusive" }, () =>
          new Promise<void>((resolve) => {
            releaseLock = resolve;
            startLeading();
          }),
        )
        .catch(() => { /* lock request aborted on unmount — nothing to do */ });
    } else {
      const myId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const CLAIM_TTL_MS = HEARTBEAT_INTERVAL_MS * 2.5;
      let claimTimer: number | undefined;
      const readClaim = (): { id: string; ts: number } | null => {
        try {
          const raw = window.localStorage.getItem(SESSION_LOCK);
          return raw ? (JSON.parse(raw) as { id: string; ts: number }) : null;
        } catch {
          return null;
        }
      };
      const renewOrClaim = () => {
        const c = readClaim();
        const stale = !c || Date.now() - c.ts > CLAIM_TTL_MS;
        if (isLeader || stale || c?.id === myId) {
          try {
            window.localStorage.setItem(SESSION_LOCK, JSON.stringify({ id: myId, ts: Date.now() }));
          } catch { /* storage unavailable — degrade to this-tab-leads */ }
          if (!isLeader && readClaim()?.id === myId) startLeading();
        }
      };
      renewOrClaim();
      claimTimer = window.setInterval(renewOrClaim, HEARTBEAT_INTERVAL_MS);
      releaseLock = () => {
        if (claimTimer) window.clearInterval(claimTimer);
        try {
          if (readClaim()?.id === myId) window.localStorage.removeItem(SESSION_LOCK);
        } catch { /* ignore */ }
      };
    }

    const onPageHide = () => close();
    // bfcache restore: pagehide closed the session; re-open it if we still lead.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted && isLeader) open(); };
    INPUT_EVENTS.forEach((ev) => window.addEventListener(ev, markInput, { passive: true }));
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      INPUT_EVENTS.forEach((ev) => window.removeEventListener(ev, markInput));
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      close(); // logout / unmount closes the session (server computes engaged duration)
      releaseLock?.(); // release leadership so another tab can take over
    };
  }, [enabled]);
}
