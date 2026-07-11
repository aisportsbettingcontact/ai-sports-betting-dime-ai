"use client";

import { useDimeApp } from "@/lib/store";
import { CreditsPill } from "@/components/credits-pill";
import { Avatar } from "@/components/avatar";
import { HistoryIcon } from "@/components/icons";
import { AccountMenu } from "@/components/account-menu";

export function MobileHeader() {
  const { state, dispatch } = useDimeApp();

  return (
    <header className="relative flex-none h-14 mt-[52px] flex items-center justify-between px-3 z-20 w-full max-w-[680px] mx-auto md:hidden">
      <button
        type="button"
        aria-label="Open chat history"
        onClick={() => dispatch({ type: "OPEN_SHEET", sheet: "history" })}
        className="w-11 h-11 rounded-xl flex items-center justify-center text-text-2 active:bg-surface-2"
      >
        <HistoryIcon size={21} />
      </button>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <CreditsPill onOpen={() => dispatch({ type: "OPEN_SHEET", sheet: "credits" })} />
      </div>

      <button
        type="button"
        aria-label="Open account menu"
        aria-expanded={state.avatarMenuOpen}
        onClick={() => dispatch({ type: "TOGGLE_AVATAR_MENU" })}
        className="w-11 h-11 rounded-full flex items-center justify-center"
      >
        <Avatar
          size={32}
          alt="Prez Bets profile photo"
          className="border-2"
          style={{ borderColor: "var(--border-strong)" }}
        />
      </button>

      {state.avatarMenuOpen && <AccountMenu />}
    </header>
  );
}
