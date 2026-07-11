export function Skeleton({ className = "", label }: { className?: string; label: string }) {
  return (
    <div
      aria-label={label}
      role="status"
      className={`animate-shimmer rounded-2xl bg-surface-2 ${className}`}
    />
  );
}
