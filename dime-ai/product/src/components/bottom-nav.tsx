"use client";

import { useDimeApp } from "@/lib/store";
import { BOTTOM_NAV } from "@/lib/data/seed";
import { NavIcon } from "@/components/icons";

export function BottomNav() {
  const { state, dispatch } = useDimeApp();

  return (
    <nav
      aria-label="Primary"
      className="md:hidden flex-none flex items-stretch justify-around border-t border-border bg-canvas px-2 pt-1.5"
      style={{ paddingBottom: 30 }}
    >
      {BOTTOM_NAV.map((item) => {
        const active = state.tab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => dispatch({ type: "SET_TAB", tab: item.key })}
            className="flex flex-col items-center gap-1 py-1 px-3 min-w-[56px]"
          >
            <NavIcon tab={item.key} size={22} className={active ? "text-mint" : "text-text-3"} />
            <span
              className="text-[10.5px]"
              style={{
                color: active ? "var(--text-1)" : "var(--text-3)",
                fontWeight: active ? 600 : 500,
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
