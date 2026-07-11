import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface overflow-hidden ${className}`}
      {...props}
    />
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`border-t border-border ${className}`} />;
}
