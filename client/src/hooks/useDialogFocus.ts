import { useEffect, useRef, type RefObject } from "react";

/** Same selector contract as SettingsModal.tsx's dialog trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A return target is only worth focusing if it is still a real on-screen box
 *  outside any inert subtree — focusing a hidden/inert element silently no-ops
 *  and strands focus on document.body (see SettingsModal.tsx's isReachable). */
function isReachable(el: HTMLElement | null): el is HTMLElement {
  return (
    !!el && el.isConnected && el.offsetParent !== null && !el.closest("[inert]")
  );
}

/**
 * WAI-ARIA dialog focus contract (A11Y-FOCUS-RETURN) for the app's custom
 * dialogs/drawers: while `open`, moves focus into the dialog, wraps Tab, and
 * on close returns focus to whatever was focused when the dialog opened.
 * `handleEscape` also closes on Esc — leave it off for dialogs that already
 * own an Escape listener.
 */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>,
  { handleEscape = false }: { handleEscape?: boolean } = {}
): void {
  // Latest onClose without re-arming the trap on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusables = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusables[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (handleEscape && event.key === "Escape") {
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
      if (isReachable(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, dialogRef, handleEscape]);
}
