"use client";

import { effectiveCredits, effectiveTier, useDimeApp } from "@/lib/store";
import { BottomSheet, SheetHeader } from "@/components/ui/sheet";
import { PillButton } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { CREDIT_ACTIVITY, MEMBERSHIP } from "@/lib/data/seed";
import { useToast } from "@/components/ui/toast";

export function CreditsSheet() {
  const { state, dispatch } = useDimeApp();
  const showToast = useToast();
  const tier = effectiveTier(state.scenario, state.credits);
  const n = effectiveCredits(state.scenario, state.credits);
  const isUnlimited = tier === "unlimited";

  const resetLine = state.membershipCanceled
    ? `${MEMBERSHIP.planName} plan · Credits available until ${MEMBERSHIP.renewDate}`
    : `${MEMBERSHIP.planName} plan · Credits reset ${MEMBERSHIP.renewDate}`;
  const usageEstimate = isUnlimited ? "No usage limits on your plan" : `≈ ${Math.floor(n / 40)} analyses remaining`;

  const attention =
    tier === "low" || tier === "critical" || tier === "zero" || tier === "error"
      ? {
          title:
            tier === "error" ? "Balance unavailable." : tier === "zero" ? "You're out of credits." : "Running low.",
          body:
            tier === "error"
              ? "We couldn't reach your balance. Analyses are paused until it refreshes."
              : tier === "zero"
              ? "Add credits or upgrade your plan to keep running analyses."
              : `At your recent pace this covers about ${Math.floor(n / 40)} more analyses.`,
        }
      : null;

  return (
    <BottomSheet
      open={state.creditsOpen}
      onClose={() => dispatch({ type: "CLOSE_SHEETS" })}
      ariaLabel="Credits"
      scrollable
    >
      <SheetHeader title="Credits" onClose={() => dispatch({ type: "CLOSE_SHEETS" })} />

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[34px] font-bold tabular-nums-font text-text-1">{isUnlimited ? "∞" : fmt(n)}</span>
        {!isUnlimited && <span className="text-[13px] text-text-2">credits</span>}
      </div>
      <p className="text-[13px] text-text-3 mb-4">
        {usageEstimate} · {resetLine}
      </p>

      {attention && (
        <div className="rounded-xl border border-border-strong px-3.5 py-3 mb-4">
          <div className="text-[14px] font-bold text-text-1">{attention.title}</div>
          <div className="text-[13px] text-text-2 mt-0.5">{attention.body}</div>
        </div>
      )}

      <div className="flex gap-2.5 mb-5">
        <PillButton
          tone="mint"
          onClick={() => {
            dispatch({ type: "ADD_CREDITS", amount: 1000 });
            showToast("1,000 credits added");
          }}
        >
          Add 1,000 credits
        </PillButton>
        <PillButton tone="outline" onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "membership" })}>
          Manage plan
        </PillButton>
      </div>

      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-3 mb-1">Recent usage</h3>
      <div className="flex flex-col">
        {CREDIT_ACTIVITY.map((entry, i) => (
          <div
            key={entry.label + i}
            className={`flex items-center justify-between gap-3 py-3 ${i > 0 ? "border-t border-border" : ""}`}
          >
            <div className="min-w-0">
              <div className="text-[13.5px] text-text-1 truncate">{entry.label}</div>
              <div className="text-[11.5px] text-text-3">{entry.time}</div>
            </div>
            <span
              className="flex-none text-[13.5px] font-semibold tabular-nums-font"
              style={{ color: entry.positive ? "var(--mint)" : "var(--text-2)" }}
            >
              {entry.amount}
            </span>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
