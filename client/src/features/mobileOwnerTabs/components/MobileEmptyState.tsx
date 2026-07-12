/**
 * MobileEmptyState — Clean, intentional empty state for mobile owner tabs.
 * Shows a message when no data is available for a given tab.
 * Surfaces and type follow the Dime tokens (design-system/dime-ai/MASTER.md).
 */
import { CircleOff } from "lucide-react";

export function MobileEmptyState({
  message = "No data connected yet.",
  icon: Icon = CircleOff,
}: {
  message?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-in fade-in duration-[160ms]">
      <div
        className="w-12 h-12 rounded-full border flex items-center justify-center mb-4"
        style={{
          background: "var(--dime-surface-raised)",
          borderColor: "var(--dime-border-strong)",
          // lucide icons stroke with currentColor — color the wrapper.
          color: "var(--dime-text-muted)",
        }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <p
        className="text-sm text-center max-w-[240px] leading-relaxed"
        style={{ color: "var(--dime-text-body)" }}
      >
        {message}
      </p>
    </div>
  );
}
