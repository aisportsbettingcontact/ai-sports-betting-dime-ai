/**
 * LoginAttemptBanner
 *
 * Displays real-time rate-limit feedback below the login form submit button.
 *
 * Behaviour:
 *   - Hidden when remainingAttempts === maxAttempts (no failures yet)
 *   - Shows "X attempts remaining" warning when 1–(maxAttempts-1) attempts have been used
 *   - Shows a live countdown clock when the IP is locked out
 *
 * The banner polls trpc.appUsers.getLoginStatus every 5 seconds while visible,
 * and runs a 1-second client-side countdown during an active lockout.
 *
 * [LOGGING]
 *   [LoginAttemptBanner] mount | remaining=X lockoutUntil=Y
 *   [LoginAttemptBanner] countdown tick | secondsLeft=Z
 *   [LoginAttemptBanner] lockout expired — resetting
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Lock, Clock } from "lucide-react";

interface LoginAttemptBannerProps {
  /** Increments on each login failure to trigger an immediate status refetch */
  failureTrigger: number;
}

export function LoginAttemptBanner({ failureTrigger }: LoginAttemptBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, refetch } = trpc.appUsers.getLoginStatus.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Re-fetch immediately after each failed attempt
  useEffect(() => {
    if (failureTrigger > 0) {
      console.log(`[LoginAttemptBanner] failureTrigger=${failureTrigger} — refetching status`);
      refetch();
    }
  }, [failureTrigger, refetch]);

  // Manage the 1-second countdown when locked out
  useEffect(() => {
    if (!data) return;

    console.log(
      `[LoginAttemptBanner] status update | remaining=${data.remainingAttempts} ` +
      `isLockedOut=${data.isLockedOut} lockoutUntil=${data.lockoutUntil}`
    );

    if (data.isLockedOut && data.lockoutUntil) {
      const tick = () => {
        const left = Math.max(0, Math.ceil((data.lockoutUntil! - Date.now()) / 1000));
        console.log(`[LoginAttemptBanner] countdown tick | secondsLeft=${left}`);
        setSecondsLeft(left);
        if (left === 0) {
          console.log("[LoginAttemptBanner] lockout expired — resetting");
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          refetch();
        }
      };
      tick();
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(tick, 1_000);
    } else {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setSecondsLeft(null);
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [data, refetch]);

  // Nothing to show — no failures yet
  if (!data || data.remainingAttempts === data.maxAttempts) return null;

  // ── Locked out ──────────────────────────────────────────────────────────────
  if (data.isLockedOut) {
    const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : null;
    const secs = secondsLeft !== null ? secondsLeft % 60 : null;
    const countdownStr =
      mins !== null && secs !== null
        ? `${mins}:${String(secs).padStart(2, "0")}`
        : "…";

    return (
      <div
        role="alert"
        aria-live="polite"
        className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs"
      >
        <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-400" />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-red-200">Too many failed attempts</span>
          <span className="text-red-400/90 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Try again in{" "}
            <span className="font-mono font-bold text-red-200">{countdownStr}</span>
          </span>
        </div>
      </div>
    );
  }

  // ── Warning — attempts remaining ────────────────────────────────────────────
  const used = data.maxAttempts - data.remainingAttempts;
  const pct = used / data.maxAttempts;
  const color =
    pct >= 0.8
      ? "bg-red-950/60 border-red-800/60 text-red-300"
      : pct >= 0.5
        ? "bg-amber-950/60 border-amber-700/60 text-amber-300"
        : "bg-yellow-950/40 border-yellow-700/40 text-yellow-300";
  const iconColor =
    pct >= 0.8 ? "text-red-400" : pct >= 0.5 ? "text-amber-400" : "text-yellow-400";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-xs ${color}`}
    >
      <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
      <span>
        <span className="font-semibold">{data.remainingAttempts}</span>
        {" "}attempt{data.remainingAttempts !== 1 ? "s" : ""} remaining before lockout
      </span>
    </div>
  );
}
