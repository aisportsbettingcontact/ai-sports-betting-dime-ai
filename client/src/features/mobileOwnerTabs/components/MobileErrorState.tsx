/**
 * MobileErrorState — Controlled error state for mobile owner tabs.
 * States the problem and offers a recovery path. Greys only — MASTER.md
 * reserves red for nothing and mint for signal, and an error is neither.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";

export function MobileErrorState({
  message = "This didn't load. Retry below.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-in fade-in duration-[160ms]">
      <div
        className="w-12 h-12 rounded-full border flex items-center justify-center mb-4"
        style={{
          background: "var(--dime-surface-raised)",
          borderColor: "var(--dime-border-strong)",
        }}
      >
        <AlertTriangle className="w-5 h-5" style={{ color: "var(--dime-text-secondary)" }} />
      </div>
      <p
        className="text-sm text-center max-w-[240px] leading-relaxed mb-4"
        style={{ color: "var(--dime-text-body)" }}
      >
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-medium rounded-lg border px-3 py-2 cursor-pointer"
          style={{
            color: "var(--dime-text-primary)",
            borderColor: "var(--dime-border-strong)",
            background: "transparent",
            transition: "background var(--dime-t) var(--dime-ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--dime-row-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
