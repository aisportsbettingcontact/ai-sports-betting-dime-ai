"use client";

import { useDimeApp } from "@/lib/store";
import { propProjections, PROPS_META, PROPS_UPDATED } from "@/lib/data/seed";
import { PropRow } from "@/components/chat/prop-row";

const FILTERS: { value: "all" | "high"; label: string }[] = [
  { value: "all", label: "All props" },
  { value: "high", label: "High confidence" },
];

export function PropsTab() {
  const { state, dispatch } = useDimeApp();
  const allProps = propProjections();
  const props = state.propsFilter === "high" ? allProps.filter((p) => p.confidence === "High") : allProps;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[720px] mx-auto px-4 md:px-6 pt-4 pb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="text-[17px] font-semibold text-text-1 m-0">Prop Projections</h1>
          <span className="text-[12px] text-text-3 tabular-nums-font whitespace-nowrap">{PROPS_UPDATED}</span>
        </div>

        <div role="radiogroup" aria-label="Filter by confidence" className="flex gap-1.5 mb-4">
          {FILTERS.map((f) => {
            const active = state.propsFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => dispatch({ type: "SET_PROPS_FILTER", filter: f.value })}
                className="px-3.5 py-1.5 rounded-full text-[13px] border whitespace-nowrap"
                style={{
                  background: active ? "var(--mint-soft)" : "transparent",
                  borderColor: active ? "var(--mint-border)" : "var(--border)",
                  color: active ? "var(--mint)" : "var(--text-2)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <section aria-label="Ranked player prop projections" className="rounded-2xl border border-border bg-surface overflow-hidden">
          {props.map((p, i) => (
            <PropRow
              key={p.player}
              prop={p}
              rank={i + 1}
              whyOpen={!!state.propsTabWhy[i]}
              onToggleWhy={() => dispatch({ type: "TOGGLE_PROPS_TAB_WHY", index: i })}
            />
          ))}
          <div className="px-4 py-2.5 bg-surface-2 text-[11px] text-text-3 tabular-nums-font">{PROPS_META}</div>
        </section>
      </div>
    </div>
  );
}
