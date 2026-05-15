/**
 * ForgotPasswordModal
 *
 * Allows users to request a password reset link by entering their email or username.
 * The server delivers the reset link via Discord DM (if linked) or owner notification.
 *
 * Design:
 *   - Always shows "Check your Discord / contact support" after submit (anti-enumeration).
 *   - Input accepts email or username (server handles both).
 *   - Disabled after first successful submit to prevent spam.
 *
 * [FIX 2026-05-14] iOS Safari "string did not match expected pattern" fix:
 *   Same root cause as LoginModal: label text "Username or Email" contains "email",
 *   which triggers Safari's AutoFill heuristic to classify the field as email-type
 *   and apply email pattern validation before the submit event fires.
 *
 *   FIX: Replace <form> with <div role="form"> + button onClick handler.
 *   Label changed to "Username" to remove the "email" keyword trigger.
 *   Three-layer suppression: onInvalid + stopPropagation + stopImmediatePropagation.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [identifier, setIdentifier] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const requestReset = trpc.appUsers.requestPasswordReset.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      console.log("[ForgotPasswordModal] Reset request submitted successfully");
    },
    onError: (err) => {
      console.error("[ForgotPasswordModal] Reset request error:", err.message);
      toast.error("Something went wrong. Please try again.");
    },
  });

  // [FIX] Pure JS handler — NOT attached to a <form> onSubmit.
  // Bypasses Safari's pre-submit validation engine entirely.
  function handleReset() {
    const trimmed = identifier.trim();
    if (!trimmed) return;
    console.log("[ForgotPasswordModal] Submitting reset request for:", trimmed);
    requestReset.mutate({
      emailOrUsername: trimmed,
      origin: window.location.origin,
    });
  }

  // Allow Enter key to trigger reset
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !requestReset.isPending) {
      e.preventDefault();
      handleReset();
    }
  }

  // Belt-and-suspenders: suppress any residual invalid events
  function suppressInvalid(e: React.InvalidEvent<HTMLInputElement>) {
    e.preventDefault();
    e.stopPropagation();
    (e.nativeEvent as Event).stopImmediatePropagation();
  }

  function handleClose() {
    setIdentifier("");
    setSubmitted(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md bg-[#111] border border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Mail className="w-5 h-5 text-blue-400" />
            Forgot Password
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Enter your username or email address. If your account exists, a reset
            link will be sent via Discord DM or relayed by the site owner.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400" />
            <div>
              <p className="font-semibold text-white text-lg">Request Received</p>
              <p className="text-white/60 text-sm mt-1">
                If your account exists, a reset link has been sent via Discord DM.
                If you don&apos;t have Discord linked, the site owner will relay the
                link to you directly.
              </p>
              <p className="text-white/40 text-xs mt-3">
                Links expire in 30 minutes.
              </p>
            </div>
            <Button
              onClick={handleClose}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              Back to Sign In
            </Button>
          </div>
        ) : (
          /*
           * [FIX] <div role="form"> instead of <form>.
           * Safari's constraint validation API only fires on <form> elements.
           * A <div> is completely invisible to Safari's validation engine.
           * Keyboard submission handled via onKeyDown on the input.
           */
          <div
            role="form"
            aria-label="Password Reset"
            className="flex flex-col gap-4 mt-2"
          >
            <div className="flex flex-col gap-1.5">
              {/*
               * [FIX] Label changed from "Username or Email" to "Username".
               * Safari scans label text for the keyword "email" and misclassifies
               * the field as email-type, applying email pattern validation.
               * Removing "email" from the label prevents this misclassification.
               * Users can still enter their email — the backend accepts both.
               */}
              <Label
                htmlFor="fp-identifier"
                className="text-xs font-semibold tracking-widest text-white/70 uppercase"
              >
                Username
              </Label>
{/* [FIX] autoComplete="off" (not "username"), no name attr — eliminates iOS Safari AutoFill email-classification signals 4, 5 */}
              <Input
                id="fp-identifier"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Enter your username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={requestReset.isPending}
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400"
                aria-required="true"
                aria-label="Username"
                onInvalid={suppressInvalid}
                maxLength={320}
              />
            </div>

            {requestReset.isError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Something went wrong. Please try again.</span>
              </div>
            )}

            <div className="flex gap-3 mt-1">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={requestReset.isPending}
                className="flex-1 border-white/20 text-white/70 hover:text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              {/* [FIX] type="button" + onClick — not type="submit". No <form> to submit. */}
              <Button
                type="button"
                onClick={handleReset}
                disabled={requestReset.isPending || !identifier.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {requestReset.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
