import type { Confidence } from "@/lib/types";

/**
 * Confidence badge for prop rows. Only "High" gets the mint treatment —
 * Medium/Low stay neutral so mint keeps a single meaning (this app's
 * strongest model signal), not a generic "info" color.
 */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const isHigh = confidence === "High";
  return (
    <span
      className={`flex-none rounded-[10px] border px-2.5 py-[3px] text-[11px] font-semibold ${
        isHigh
          ? "bg-mint-soft border-mint-border text-mint"
          : "border-border-strong text-text-2"
      }`}
    >
      {confidence} confidence
    </span>
  );
}
