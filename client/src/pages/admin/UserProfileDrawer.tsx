/**
 * UserProfileDrawer — right-side slide-in drawer for the admin Customer
 * Profiling Cockpit. Renders one user's *aggregate* profile (the pre-joined
 * UserProfileRow) with no fetching of its own; the parent panel owns the data
 * and passes the selected row in. Honest states (owner directive): any null
 * identity field renders an explicit "not linked" — never a blank or a
 * fabricated handle. There is no per-user event timeline in this version; that
 * is a P2 addition and is called out inline.
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint on the score/affinity focal marks, 160ms motion, no gradients or heavy
 * shadows; mirrors DeviceActivityPanel / SegmentsPanel. Motion honors
 * `prefers-reduced-motion` (skip the slide, just show).
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  type UserProfileRow,
  TIER_LABEL,
  TIER_CLASS,
  SEGMENT_LABEL,
  displayName,
  fmtAgo,
} from "@/pages/admin/profilingTypes";

interface Props {
  user: UserProfileRow | null;
  onClose: () => void;
}

/** Duration of the slide/opacity transition — Dime's 160ms motion budget. */
const SLIDE_MS = 150;

/**
 * Self-contained prefers-reduced-motion read. Deliberately NOT the chat page's
 * hook — importing across the chat boundary would pull this lazy admin drawer's
 * shared module onto the /chat critical-path bundle. Kept local so the drawer
 * stays off that budget.
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

/** Up to two mono initials from the display name; "?" if nothing usable. */
function initials(u: UserProfileRow): string {
  const parts = displayName(u)
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export default function UserProfileDrawer({ user, onClose }: Props) {
  const reduceMotion = usePrefersReducedMotion();
  const open = user !== null;

  // Keep the overlay mounted through the slide-out and keep rendering the last
  // profile while it animates away, so closing never flashes an empty drawer.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [shownUser, setShownUser] = useState<UserProfileRow | null>(user);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }

    if (open) {
      setShownUser(user);
      setMounted(true);
      if (reduceMotion) {
        setShown(true);
        return;
      }
      // Two-frame trick: mount off-screen (translate-x-full), then flip to the
      // in position so the CSS transition actually runs on first open.
      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    setShown(false);
    if (reduceMotion) {
      setMounted(false);
    } else {
      closeTimer.current = setTimeout(() => setMounted(false), SLIDE_MS);
    }
  }, [open, user, reduceMotion]);

  // Clear any pending close timer on unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  // Esc-to-close while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  const u = shownUser;
  if (!u) return null;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Value events", value: u.valueEvents.toLocaleString() },
    { label: "Actions", value: u.actionEvents.toLocaleString() },
    { label: "Active days", value: u.activeDays.toLocaleString() },
    { label: "Sessions", value: u.sessions.toLocaleString() },
    { label: "Last seen", value: fmtAgo(u.lastActive) },
  ];

  const filledSurfaces = Math.max(0, Math.min(4, u.distinctSurfaces));
  const scrimMotion = reduceMotion ? "" : "transition-opacity duration-150";
  const panelMotion = reduceMotion ? "" : "transition-transform duration-150";

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim — click to close. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-background/70 ${scrimMotion} ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Drawer panel — slides in from the right. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Profile — ${displayName(u)}`}
        style={{ maxWidth: 440 }}
        className={`absolute inset-y-0 right-0 w-full bg-card border-l border-border flex flex-col ${panelMotion} ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Close button — top-right, floats over the header. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" />
        </button>

        {/* HEADER — mono-initials avatar + identity. */}
        <div className="flex items-start gap-3 px-4 sm:px-5 py-4 pr-12 border-b border-border">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background font-mono text-sm font-bold text-foreground">
            {initials(u)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm sm:text-base font-semibold text-foreground truncate">
              {displayName(u)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {u.discordUsername ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] sm:text-xs font-mono text-primary">
                  Discord: @{u.discordUsername}
                </span>
              ) : (
                <span className="text-[10px] sm:text-xs font-mono text-muted-foreground">
                  Discord not linked
                </span>
              )}
              {u.role && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] sm:text-xs font-mono uppercase tracking-wide text-muted-foreground">
                  {u.role}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* BODY — scrolls if it overflows. */}
        <div className="flex-1 overflow-y-auto">
          {/* 1. Score block. */}
          <section className="px-4 sm:px-5 py-4 border-b border-border">
            <div className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-muted-foreground uppercase mb-2">
              Power score
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <span className="text-4xl sm:text-5xl font-bold font-mono text-primary leading-none">
                {u.score}
              </span>
              <div className="flex flex-wrap items-center gap-1.5 pb-1">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] sm:text-xs font-mono uppercase tracking-wide ${
                    TIER_CLASS[u.tier] ?? "text-muted-foreground"
                  }`}
                >
                  {TIER_LABEL[u.tier] ?? u.tier}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-border text-[10px] sm:text-xs font-mono text-muted-foreground">
                  {SEGMENT_LABEL[u.segment] ?? u.segment}
                </span>
              </div>
            </div>
          </section>

          {/* 2. Surface affinity — distinct surfaces out of 4. */}
          <section className="px-4 sm:px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-muted-foreground uppercase">
                Surface affinity
              </span>
              <span className="text-xs sm:text-sm font-mono text-foreground">
                {u.distinctSurfaces} <span className="text-muted-foreground">/ 4</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < filledSurfaces ? "bg-primary" : "bg-muted/60"
                  }`}
                />
              ))}
            </div>
          </section>

          {/* 3. Activity stats — mono, right-aligned. */}
          <section className="px-4 sm:px-5 py-4 border-b border-border">
            <div className="text-[10px] sm:text-xs font-semibold font-mono tracking-wider text-muted-foreground uppercase mb-2">
              Activity
            </div>
            <div className="space-y-1.5">
              {stats.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">
                    {s.label}
                  </span>
                  <span className="text-xs sm:text-sm font-mono text-foreground text-right">
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* P2 note — no per-user event timeline in this version. */}
          <div className="px-4 sm:px-5 py-4">
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-snug">
              Event timeline lands in P2.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
