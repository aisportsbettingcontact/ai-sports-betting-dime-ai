"use client";

import { useDimeApp } from "@/lib/store";
import { SIDE_NAV, SIDE_RECENTS } from "@/lib/data/seed";
import { CreditsPill } from "@/components/credits-pill";
import { Avatar } from "@/components/avatar";
import { GearIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import type { Tab } from "@/lib/types";

const NAV_TAB: Partial<Record<(typeof SIDE_NAV)[number]["key"], Tab>> = {
  proj: "feed",
  splits: "splits",
  props: "props",
};

export function Sidebar() {
  const { state, dispatch, newChat, loadRecent } = useDimeApp();
  const showToast = useToast();

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden md:flex md:w-60 lg:w-64 xl:w-72 flex-none flex-col bg-side-bg border-r border-border p-2 overflow-y-auto"
    >
      <div className="text-[17px] font-bold tracking-[-0.2px] text-text-1 px-3 pt-2.5 pb-4">
        AI Sports Betting
      </div>

      <nav aria-label="Product" className="flex flex-col gap-0.5">
        {SIDE_NAV.map((item) => {
          const targetTab = NAV_TAB[item.key];
          const active = item.key === "new" ? state.tab === "chat" && state.messages.length === 0 : targetTab === state.tab;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (item.key === "new") newChat();
                else if (targetTab) dispatch({ type: "SET_TAB", tab: targetTab });
                else showToast(`${item.label} is coming soon`);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] min-h-10 text-left"
              style={{
                background: active ? "var(--mint-soft)" : "transparent",
                boxShadow: active ? "inset 2px 0 0 var(--mint)" : "none",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--text-1)" : "var(--text-2)",
              }}
            >
              {item.plus && (
                <span aria-hidden className="text-mint font-bold text-[15px] leading-none">
                  +
                </span>
              )}
              <span className="min-w-0 text-[13.5px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-3 pt-5 pb-2 text-[11px] font-semibold tracking-widest uppercase text-text-3">
        Recent Chats
      </div>
      <div className="flex flex-col gap-px" role="list" aria-label="Recent chats">
        {SIDE_RECENTS.map((title) => (
          <button
            key={title}
            role="listitem"
            type="button"
            onClick={() => loadRecent(title)}
            className="px-3 py-2 rounded-lg text-[12.5px] leading-[1.4] font-medium text-text-2 text-left w-full active:bg-surface-2"
          >
            {title}
          </button>
        ))}
      </div>

      <span className="flex-1 min-h-4" />

      <div className="mb-2.5 mx-2 w-fit">
        <CreditsPill onOpen={() => dispatch({ type: "OPEN_SHEET", sheet: "credits" })} />
      </div>

      <div className="flex items-center gap-2.5 px-2 pt-2 border-t border-border">
        <button
          type="button"
          aria-label={`${state.displayName} profile`}
          onClick={() => dispatch({ type: "SET_TAB", tab: "profile" })}
          className="flex-none w-10 h-10 rounded-full flex items-center justify-center"
        >
          <Avatar size={32} alt={`${state.displayName} profile`} className="border border-border-strong" />
        </button>
        <div className="flex flex-col gap-px min-w-0">
          <span className="text-[11px] font-bold tracking-wide uppercase text-text-1 whitespace-nowrap">
            {state.displayName}
          </span>
          <span className="text-[11px] text-text-3">Pro</span>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Open settings"
          onClick={() => dispatch({ type: "SET_TAB", tab: "profile" })}
          className="w-10 h-10 rounded-[10px] flex items-center justify-center text-text-3 active:bg-surface-2"
        >
          <GearIcon />
        </button>
      </div>
    </aside>
  );
}
