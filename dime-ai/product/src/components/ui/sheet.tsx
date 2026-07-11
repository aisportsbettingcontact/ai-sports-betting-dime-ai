"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

/** Escape-to-close, body scroll lock, and focus restore shared by every overlay. */
function useOverlayBehavior(open: boolean, onClose: () => void) {
  const triggerRef = useRef<Element | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const container = containerRef.current;
    const focusable = container?.querySelector<HTMLElement>(
      'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, onClose]);

  return containerRef;
}

function Scrim({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      aria-hidden
      className="fixed inset-0 z-40 bg-scrim animate-fade-in"
    />
  );
}

export function BottomSheet({
  open,
  onClose,
  children,
  ariaLabel,
  scrollable = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  scrollable?: boolean;
}) {
  const containerRef = useOverlayBehavior(open, onClose);
  if (!open) return null;
  return (
    <>
      <Scrim onClose={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed left-0 right-0 bottom-0 z-50 mx-auto w-full max-w-[560px] rounded-t-[20px] bg-elev border-t border-x border-border-strong p-5 animate-sheet-up ${
          scrollable ? "max-h-[82vh] overflow-y-auto" : ""
        }`}
      >
        {children}
      </div>
    </>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  const containerRef = useOverlayBehavior(open, onClose);
  if (!open) return null;
  return (
    <>
      <Scrim onClose={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed left-0 top-0 bottom-0 z-50 w-[82%] max-w-[320px] bg-elev rounded-r-[20px] pt-16 pb-4 px-4 flex flex-col animate-slide-in overflow-y-auto"
      >
        {children}
      </div>
    </>
  );
}

export function AlertDialog({
  open,
  onClose,
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  const containerRef = useOverlayBehavior(open, onClose);
  if (!open) return null;
  return (
    <>
      <Scrim onClose={onClose} />
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed z-50 inset-x-5 bottom-11 mx-auto max-w-[420px] rounded-2xl bg-elev border border-border-strong p-5 animate-sheet-up"
      >
        {children}
      </div>
    </>
  );
}

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[19px] font-bold text-text-1">{title}</h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 active:bg-surface-2"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
