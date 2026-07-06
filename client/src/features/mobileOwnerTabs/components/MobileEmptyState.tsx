/**
 * MobileEmptyState — Clean, intentional empty state for mobile owner tabs.
 * Shows a message when no data is available for a given tab.
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
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-in fade-in duration-300">
      <div className="w-12 h-12 rounded-full bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-zinc-500" />
      </div>
      <p className="text-sm text-zinc-400 text-center max-w-[240px] leading-relaxed">
        {message}
      </p>
    </div>
  );
}
