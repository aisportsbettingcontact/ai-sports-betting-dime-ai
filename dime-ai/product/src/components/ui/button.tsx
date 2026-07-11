import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: number;
  variant?: "default" | "danger";
};

/** Circular icon-only button. Always requires aria-label from the caller. */
export function IconButton({ size = 40, className = "", children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full text-text-3 active:bg-surface-2 disabled:cursor-default disabled:opacity-100 ${className}`}
      style={{ width: size, height: size, flex: "none" }}
      {...props}
    >
      {children}
    </button>
  );
}

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "mint" | "outline" | "invert" | "plain";
  children: ReactNode;
};

const TONE_CLASSES: Record<NonNullable<PillButtonProps["tone"]>, string> = {
  mint: "bg-mint text-on-mint active:opacity-85",
  outline: "border border-border-strong text-text-1 active:bg-surface-2",
  invert: "bg-text-1 text-canvas active:opacity-85",
  plain: "bg-surface border border-border text-text-1 active:bg-surface-2",
};

/** Full pill CTA button used across sheets (Save, Add credits, Cancel, etc.). */
export function PillButton({ tone = "outline", className = "", children, ...props }: PillButtonProps) {
  return (
    <button
      type="button"
      className={`flex-1 min-h-11 rounded-full px-4 text-[14px] font-semibold flex items-center justify-center transition-opacity disabled:opacity-60 ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Full-width list row button, e.g. sidebar nav items, menu rows, sheet rows. */
export function RowButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`w-full flex items-center gap-2 min-h-11 rounded-lg text-left active:bg-surface-2 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
