"use client";

import { useDimeApp } from "@/lib/store";
import { fmt } from "@/lib/format";
import { MEMBERSHIP } from "@/lib/data/seed";
import { Avatar } from "@/components/avatar";

export function AccountMenu() {
  const { state, dispatch } = useDimeApp();

  const close = () => dispatch({ type: "CLOSE_AVATAR_MENU" });

  return (
    <>
      <div onClick={close} aria-hidden className="fixed z-40" style={{ inset: "-200vh -200vw" }} />
      <div
        role="menu"
        aria-label="Account menu"
        className="absolute z-50 w-56 rounded-[14px] border border-border-strong bg-elev shadow-2xl overflow-hidden animate-fade-in"
        style={{ top: 54, right: 8 }}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border">
          <Avatar size={30} alt="" aria-hidden className="flex-none" />
          <div className="flex flex-col gap-px min-w-0">
            <span className="text-[13.5px] font-semibold text-text-1 truncate">{state.displayName}</span>
            <span className="text-[12px] text-text-3">@prez</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-border">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-mint flex-none" />
          <span className="text-[12.5px] font-medium text-text-2">
            {MEMBERSHIP.planName} · {state.membershipCanceled ? `Ends ${MEMBERSHIP.renewDate}` : "Active"}
          </span>
        </div>
        <button
          role="menuitem"
          type="button"
          onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "membership" })}
          className="w-full flex items-center justify-between px-3.5 py-3 min-h-11 active:bg-surface-2"
        >
          <span className="text-[13.5px] font-medium text-text-1">Upgrade</span>
          <span className="text-[12px] font-semibold text-mint">Elite</span>
        </button>
        <button
          role="menuitem"
          type="button"
          onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "credits" })}
          className="w-full flex items-center justify-between px-3.5 py-3 min-h-11 border-t border-border active:bg-surface-2"
        >
          <span className="text-[13.5px] font-medium text-text-1">Add credits</span>
          <span className="text-[12px] text-text-3 tabular-nums-font">{fmt(state.credits)}</span>
        </button>
        <button
          role="menuitem"
          type="button"
          onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "logout" })}
          className="w-full flex items-center px-3.5 py-3 min-h-11 border-t border-border active:bg-surface-2"
        >
          <span className="text-[13.5px] font-medium text-text-1">Log out</span>
        </button>
      </div>
    </>
  );
}
