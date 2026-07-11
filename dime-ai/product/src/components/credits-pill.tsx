"use client";

import { effectiveCredits, effectiveTier, useDimeApp } from "@/lib/store";
import { fmt } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

export function CreditsPill({ onOpen }: { onOpen: () => void }) {
  const { state } = useDimeApp();
  const tier = effectiveTier(state.scenario, state.credits);
  const n = effectiveCredits(state.scenario, state.credits);

  if (state.scenario === "loading") {
    return <Skeleton label="Loading credit balance" className="h-8 w-28 rounded-full" />;
  }

  let label: string;
  let weight = "font-medium";
  let showDot = false;
  let showWarn = false;

  switch (tier) {
    case "normal":
      label = `${fmt(n)} credits`;
      showDot = true;
      break;
    case "low":
      label = `${fmt(n)} credits · Low`;
      weight = "font-semibold";
      showWarn = true;
      break;
    case "critical":
      label = `${fmt(n)} credits · Critical`;
      weight = "font-bold";
      showWarn = true;
      break;
    case "zero":
      label = "0 credits · Add";
      weight = "font-bold";
      showWarn = true;
      break;
    case "unlimited":
      label = "Unlimited";
      weight = "font-semibold";
      showDot = true;
      break;
    case "error":
    default:
      label = "Credits unavailable";
      break;
  }

  const aria =
    tier === "error"
      ? "Credits unavailable. Open credit details."
      : `${label}. Open credit details.`;

  return (
    <button
      type="button"
      aria-label={aria}
      onClick={onOpen}
      className={`h-8 max-w-[200px] flex items-center gap-1.5 px-3.5 rounded-full border border-border bg-surface text-text-1 whitespace-nowrap active:bg-surface-2 ${weight}`}
    >
      {showDot && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-mint flex-none" />}
      {showWarn && (
        <span aria-hidden className="text-[12px] font-bold leading-none flex-none">
          !
        </span>
      )}
      <span className="text-[13px] tracking-[0.1px] tabular-nums-font truncate">{label}</span>
    </button>
  );
}
