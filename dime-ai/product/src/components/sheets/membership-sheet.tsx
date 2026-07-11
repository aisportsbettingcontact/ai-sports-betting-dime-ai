"use client";

import { useDimeApp } from "@/lib/store";
import { BottomSheet, SheetHeader } from "@/components/ui/sheet";
import { PillButton } from "@/components/ui/button";
import { MEMBERSHIP } from "@/lib/data/seed";
import { useToast } from "@/components/ui/toast";

export function MembershipSheet() {
  const { state, dispatch } = useDimeApp();
  const showToast = useToast();

  const statusLine = state.membershipCanceled ? `Cancels ${MEMBERSHIP.renewDate}` : `Renews ${MEMBERSHIP.renewDate}`;

  return (
    <BottomSheet open={state.membershipOpen} onClose={() => dispatch({ type: "CLOSE_SHEETS" })} ariaLabel="Membership">
      <SheetHeader title="Membership" onClose={() => dispatch({ type: "CLOSE_SHEETS" })} />

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[22px] font-bold text-text-1">{MEMBERSHIP.planName}</span>
        <span className="text-[14px] text-text-2 tabular-nums-font">{MEMBERSHIP.price}</span>
      </div>
      <p className="text-[13px] text-text-3 mb-4">{statusLine}</p>

      <ul className="flex flex-col gap-2 mb-5">
        {MEMBERSHIP.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13.5px] text-text-2">
            <span aria-hidden className="text-mint font-bold">
              ✓
            </span>
            {f}
          </li>
        ))}
      </ul>

      <div className="flex gap-2.5">
        <PillButton tone="mint" onClick={() => showToast("Elite checkout is coming soon")}>
          Upgrade to Elite
        </PillButton>
        <PillButton
          tone="outline"
          onClick={() => {
            dispatch({ type: "TOGGLE_MEMBERSHIP_CANCELED" });
            showToast(
              state.membershipCanceled ? "Membership resumed" : `Membership will end ${MEMBERSHIP.renewDate}`
            );
          }}
        >
          {state.membershipCanceled ? "Resume membership" : "Cancel membership"}
        </PillButton>
      </div>
    </BottomSheet>
  );
}
