"use client";

import { useDimeApp } from "@/lib/store";
import { AlertDialog } from "@/components/ui/sheet";
import { PillButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function LogoutSheet() {
  const { state, dispatch } = useDimeApp();
  const showToast = useToast();

  return (
    <AlertDialog open={state.logoutOpen} onClose={() => dispatch({ type: "CLOSE_SHEETS" })} ariaLabel="Log out of Dime AI?">
      <h2 className="text-[18px] font-bold text-text-1 mb-2">Log out of Dime AI?</h2>
      <p className="text-[13.5px] text-text-2 mb-5">Your conversations and saved analysis stay on your account.</p>
      <div className="flex gap-2.5">
        <PillButton tone="outline" onClick={() => dispatch({ type: "CLOSE_SHEETS" })}>
          Cancel
        </PillButton>
        <PillButton
          tone="invert"
          onClick={() => {
            dispatch({ type: "CLOSE_SHEETS" });
            showToast("Logged out");
          }}
        >
          Log out
        </PillButton>
      </div>
    </AlertDialog>
  );
}
