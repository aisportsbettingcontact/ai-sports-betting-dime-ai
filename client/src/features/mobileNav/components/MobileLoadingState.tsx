/**
 * MobileLoadingState — Polished skeleton loading for the mobile screens.
 * Surfaces and type follow the Dime tokens (design-system/dime-ai/MASTER.md);
 * the pulse is disabled under prefers-reduced-motion via dime-mobile.css.
 */
export function MobileLoadingState({
  label = "Loading...",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6 animate-in fade-in duration-[160ms]">
      <p className="dime-mono-label mb-2">{label}</p>
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="rounded-xl border p-4 animate-pulse"
          style={{
            background: "var(--dime-surface-card)",
            borderColor: "var(--dime-border)",
          }}
        >
          <div
            className="h-3 w-24 rounded mb-3"
            style={{ background: "var(--dime-surface-raised)" }}
          />
          <div
            className="h-4 w-48 rounded mb-2"
            style={{ background: "var(--dime-surface-raised)", opacity: 0.8 }}
          />
          <div
            className="h-3 w-32 rounded"
            style={{ background: "var(--dime-surface-raised)", opacity: 0.6 }}
          />
        </div>
      ))}
    </div>
  );
}
