/**
 * MobileErrorState — Controlled error state for mobile owner tabs.
 * Shows a user-friendly error message with optional retry.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";

export function MobileErrorState({
  message = "Could not be loaded.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-in fade-in duration-300">
      <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-900/40 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-red-400" />
      </div>
      <p className="text-sm text-zinc-400 text-center max-w-[240px] leading-relaxed mb-4">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}
