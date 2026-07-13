/**
 * LoginModal — Discord-only sign-in modal
 *
 * Clicking "Sign in with Discord":
 *   1. Sets isRedirecting=true → button shows spinner + "Redirecting to Discord…"
 *   2. Navigates to /api/auth/discord-login/connect?returnPath=<current path>
 *      (server returns 302 → Discord consent screen)
 *   3. While the browser is navigating away, the spinner remains visible.
 *      The modal close button is disabled during redirect to prevent confusion.
 *
 * The server-side callback will:
 *   1. Validate CSRF state JWT (CPU-only, <1ms)
 *   2. Exchange the Discord code for an access_token
 *   3. Fetch Discord profile + guild member IN PARALLEL
 *   4. Verify AI MODEL SUB role
 *   5. Look up the appUser by discordId
 *   6. Issue an app_session JWT cookie (90-day)
 *   7. Redirect back to returnPath
 */

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

// Discord brand icon (inline SVG — no external dependency)
function DiscordIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void; // kept for API compatibility — not used with redirect flow
}

export function LoginModal({ onClose }: LoginModalProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const returnPath = typeof window !== "undefined" ? window.location.pathname : "/";
  // No prompt param — server defaults to "consent" which always shows the Discord screen.
  // This ensures users with expired Discord sessions are not silently rejected.
  const loginUrl = `/api/auth/discord-login/connect?returnPath=${encodeURIComponent(returnPath)}`;

  function handleDiscordClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isRedirecting) {
      e.preventDefault();
      return;
    }
    // Set redirecting state immediately on click — before the browser navigates.
    // The spinner will be visible during the ~1-3s it takes for:
    //   browser → /connect (server, <2ms) → Discord consent (1-3s) → callback
    setIsRedirecting(true);
    // Safety reset: if the page is still here after 15s (e.g. user cancelled in
    // a new tab, or Discord returned an error), reset the button so they can retry.
    setTimeout(() => setIsRedirecting(false), 15_000);
  }

  function handleClose() {
    // Prevent closing while redirect is in flight — avoids confusing state
    if (isRedirecting) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "#000000", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
      >
        {/* Close button — hidden during redirect */}
        {!isRedirecting && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Header */}
        <div className="px-6 pt-8 pb-6 text-center">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: "#000000" }}
          >
            {isRedirecting
              ? <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#45E0A8" }} />
              : <DiscordIcon size={28} />
            }
          </div>
          <h2 className="text-lg font-bold text-foreground mb-1">
            {isRedirecting ? "Redirecting to Discord…" : "Sign in to AI Sports Betting"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isRedirecting
              ? "Opening Discord authentication. Please wait…"
              : "Use your Discord account to access the platform."
            }
          </p>
        </div>

        {/* Discord login button */}
        <div className="px-6 pb-6 space-y-3">
          <a
            href={loginUrl}
            onClick={handleDiscordClick}
            aria-disabled={isRedirecting}
            className="flex items-center justify-center gap-3 w-full px-5 py-3 rounded-xl font-bold text-sm text-black transition-all active:scale-[0.98]"
            style={{
              backgroundColor: "#45E0A8",
              opacity: isRedirecting ? 0.75 : 1,
              pointerEvents: isRedirecting ? "none" : "auto",
              cursor: isRedirecting ? "default" : "pointer",
            }}
          >
            {isRedirecting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Discord…</>
              : <><DiscordIcon size={20} /> Sign in with Discord</>
            }
          </a>

          {!isRedirecting && (
            <p className="text-center text-xs text-muted-foreground pt-1">
              Access is by invitation only.{" "}
              <span className="text-muted-foreground">
                Your Discord account must be linked by the owner.
              </span>
            </p>
          )}
        </div>

        {/* Footer */}
        {!isRedirecting && (
          <div className="px-6 pb-5 text-center border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              This tool is for informational purposes only. Gamble responsibly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
