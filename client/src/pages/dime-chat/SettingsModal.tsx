/**
 * Dime AI — Settings modal (Round 3 Step 2, owner directive 2026-07-22).
 * ---------------------------------------------------------------------
 * Opened from the account popover's Settings row (DimeChatPage.tsx,
 * "TODO(step-2)" hook Round 3 Step 1 left in place) — the popover closes,
 * this centers over the whole app. Left nav: Account (Username · Discord ·
 * Reset Password — the content that used to live behind the popover's now-
 * removed "Edit Profile" / "Discord Connected" rows, see .superpowers/sdd/
 * r3-task-1-report.md for where that logic went), Billing (Round 3 Step 4 —
 * the real plan card / history / payment methods / billing info / Upgrade-
 * Renew-Cancel pane, extracted to BillingSection.tsx and wired to Step 3's
 * server/routers/stripe.ts read-only procedures), and a bottom Log Out row.
 *
 * Apple-design discipline (.claude/skills/apple-design/SKILL.md):
 *  - This is the app's first real modal (the account popover is a menu,
 *    not a dialog) — it earns the full WAI-ARIA dialog contract: role,
 *    aria-modal, a focus trap, Esc + scrim-click to close, body scroll
 *    lock, and focus returned to a real, on-screen trigger on close.
 *  - §12 materials & depth: a scrim dims the app so the dialog reads as
 *    the one thing to focus on.
 *  - §14 reduced motion: the enter beat collapses to an instant frame,
 *    never removed outright — comprehension (the dialog appearing at all)
 *    is preserved even when motion isn't.
 *  - §16 principles 4 (familiarity) + 6 (simplicity): a plain nav list +
 *    content pane — the same shape as macOS/iOS Settings — rather than a
 *    bespoke pattern users have to learn.
 *
 * Dime brand skin (design-system/dime-ai/MASTER.md — brand law wins over
 * apple-design's own visual suggestions, CLAUDE.md precedence rule 1):
 * mint stays reserved for signal (nothing here IS signal, so nothing here
 * is mint), the ONE 160ms cubic-bezier(0.16,1,0.3,1) curve for the enter
 * beat, Familjen Grotesk body copy + IBM Plex Mono section micro-labels —
 * the same pairing profile.css's `.pf-label` already uses for this exact
 * "account settings" surface on mobile, kept visually consistent here.
 */

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import { CreditCard, KeyRound, LogOut as LogOutIcon, UserRound, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  deriveTierLabel,
  formatExpiryLine,
  formatHandle,
  type SidebarUser,
} from "./sidebarIdentity";
import BillingSection from "./BillingSection";

/** Everything the Account section needs beyond SidebarUser's shape —
 *  appUsers.me already returns `email` alongside every field SidebarUser
 *  pins (server/routers/appUsers.ts `me` query), so no extra fetch. */
export type SettingsModalUser = SidebarUser & { email: string };

type SettingsSection = "account" | "billing";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  appUser: SettingsModalUser | null;
  isOwner: boolean;
  /** The sidebar's root node — used only to find a live settings trigger
   *  and return focus to it on close. Reusing the ref DimeChatPage already
   *  threads to <DimeSidebar> avoids adding a new prop there just for this. */
  sidebarRef?: MutableRefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Two candidate triggers can open this modal: the persistent gear button,
 *  and the avatar button that becomes the ONLY trigger once the desktop
 *  sidebar collapses to its icon-only rail (conversation.css:1007 hides
 *  .dc-settings-trigger there). Whichever is actually on-screen wins —
 *  focusing a display:none element is a silent no-op and would strand
 *  focus at document.body. */
function findReturnFocusTarget(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const candidates = [
    root.querySelector<HTMLElement>(".dc-settings-trigger"),
    root.querySelector<HTMLElement>(".dc-avatar-btn"),
  ];
  return candidates.find(el => !!el && el.offsetParent !== null) ?? null;
}

const DISCORD_GLYPH_PATH =
  "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z";

/** Same official Discord mark used by ModelProjections.tsx / ManageAccount.tsx —
 *  one glyph, reused verbatim for brand consistency across every surface
 *  that shows Discord connection state. */
function DiscordGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={DISCORD_GLYPH_PATH} />
    </svg>
  );
}

export default function SettingsModal({
  open,
  onClose,
  appUser,
  isOwner,
  sidebarRef,
}: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>("account");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Latest onClose without re-arming the trap effect on every parent
  // render — only `open` should ever re-run focus/scroll-lock setup.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const logoutMutation = trpc.appUsers.logout.useMutation();
  const onLogout = async () => {
    if (logoutMutation.isPending) return;
    try {
      await logoutMutation.mutateAsync();
    } finally {
      // Hard redirect: clears every in-memory cache, same contract as the
      // popover's own onLogout (DimeSidebar, DimeChatPage.tsx).
      window.location.assign("/");
    }
  };

  // Every open starts on Account — never resume mid-Billing from a prior
  // session (apple-design §7 spatial consistency: a dialog's entry state
  // must be predictable, not wherever it was left last time).
  useEffect(() => {
    if (open) setSection("account");
  }, [open]);

  // Focus trap + Esc + body scroll lock + focus return. Runs only while
  // open; the effect's cleanup (unlock + focus return) fires the instant
  // `open` flips back to false — the WAI-ARIA dialog pattern.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusables = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusables[0] ?? dialog)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const els = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const trigger =
        findReturnFocusTarget(sidebarRef?.current ?? null) ??
        previouslyFocusedRef.current;
      trigger?.focus?.();
    };
  }, [open, sidebarRef]);

  if (!open || !appUser) return null;

  const tier = deriveTierLabel(appUser);
  const expiryLine = formatExpiryLine(appUser.expiryDate);

  return (
    <div className="dc-sm-scrim" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dc-sm-dialog dc-sm-dialog--enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dc-sm-title"
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="dc-sm-header">
          <div className="dc-sm-header-id">
            <h2 id="dc-sm-title" className="dc-sm-title">
              Settings
            </h2>
            <div className="dc-sm-subtitle">
              {formatHandle(appUser.username)} · {tier}
              {expiryLine ? ` · ${expiryLine}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="dc-sm-close dc-hv2 dc-focusable dc-pressable"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>

        <div className="dc-sm-body">
          <nav className="dc-sm-nav" aria-label="Settings sections">
            <button
              type="button"
              className={`dc-sm-nav-item dc-hv2 dc-focusable dc-pressable${
                section === "account" ? " is-active" : ""
              }`}
              aria-current={section === "account" ? "page" : undefined}
              onClick={() => setSection("account")}
            >
              <UserRound size={16} strokeWidth={1.8} aria-hidden="true" />
              Account
            </button>
            <button
              type="button"
              className={`dc-sm-nav-item dc-hv2 dc-focusable dc-pressable${
                section === "billing" ? " is-active" : ""
              }`}
              aria-current={section === "billing" ? "page" : undefined}
              onClick={() => setSection("billing")}
            >
              <CreditCard size={16} strokeWidth={1.8} aria-hidden="true" />
              Billing
            </button>
            <div className="dc-sm-nav-spacer" aria-hidden="true" />
            <button
              type="button"
              className="dc-sm-nav-item dc-sm-nav-logout dc-hv2 dc-focusable dc-pressable"
              disabled={logoutMutation.isPending}
              onClick={onLogout}
            >
              <LogOutIcon size={16} strokeWidth={1.8} aria-hidden="true" />
              {logoutMutation.isPending ? "Logging out…" : "Log Out"}
            </button>
          </nav>

          <div className="dc-sm-content">
            {section === "account" ? (
              <AccountSection appUser={appUser} />
            ) : (
              <BillingSection isOwner={isOwner} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountSection({ appUser }: { appUser: SettingsModalUser }) {
  const resetMutation = trpc.appUsers.requestPasswordReset.useMutation({
    onSuccess: () => {
      toast.success("Password reset email sent. Check your inbox.");
    },
    onError: err => {
      toast.error(err.message || "Failed to send reset email.");
    },
  });

  const handleResetPassword = () => {
    if (!appUser.email || resetMutation.isPending) return;
    resetMutation.mutate({
      emailOrUsername: appUser.email,
      origin: window.location.origin,
    });
  };

  const connected = !!appUser.discordId;
  const resetLabel = resetMutation.isPending
    ? "Sending…"
    : resetMutation.isSuccess
      ? "Reset email sent"
      : "Reset password";

  return (
    <section className="dc-sm-section" aria-label="Account">
      <div className="dc-sm-section-label">Account</div>
      <div className="dc-sm-card">
        <div className="dc-sm-field">
          <div className="dc-sm-field-text">
            <div className="dc-sm-field-label">Username</div>
            <div className="dc-sm-field-value">
              {formatHandle(appUser.username)}
            </div>
          </div>
          <div className="dc-sm-field-note">Cannot be changed</div>
        </div>

        <div className="dc-sm-field">
          <div className="dc-sm-field-text">
            <div className="dc-sm-field-label">Discord</div>
            {connected ? (
              <div className="dc-sm-discord-pill">
                <DiscordGlyph />
                <span>@{appUser.discordUsername ?? appUser.discordId}</span>
              </div>
            ) : (
              <div className="dc-sm-field-value dc-sm-field-value--muted">
                Not connected
              </div>
            )}
          </div>
          {connected ? (
            <div className="dc-sm-field-note">Cannot be disconnected</div>
          ) : (
            <a
              href="/api/auth/discord/connect"
              className="dc-sm-discord-connect dc-hv1 dc-focusable dc-pressable"
            >
              <DiscordGlyph />
              Connect Discord
            </a>
          )}
        </div>

        <button
          type="button"
          className="dc-sm-action-row dc-hv2 dc-focusable dc-pressable"
          disabled={resetMutation.isPending}
          onClick={handleResetPassword}
        >
          <span className="dc-sm-field-text">
            <span className="dc-sm-field-label">Password</span>
            <span className="dc-sm-field-value">{resetLabel}</span>
          </span>
          <KeyRound size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
