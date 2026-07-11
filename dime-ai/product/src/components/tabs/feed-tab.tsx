"use client";

import { useDimeApp } from "@/lib/store";
import { FEED_GAMES, FEED_UPDATED } from "@/lib/data/seed";
import { TeamLogo } from "@/components/icons";
import { ChevronRightIcon } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import { fmtOdds } from "@/lib/format";
import type { FeedGame, League } from "@/lib/types";

const FILTERS: { value: "all" | League; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mlb", label: "MLB" },
  { value: "nba", label: "NBA" },
  { value: "soccer", label: "Soccer" },
];

export function FeedTab() {
  const { state, dispatch, openMatchAnalysis } = useDimeApp();
  const games = state.feedFilter === "all" ? FEED_GAMES : FEED_GAMES.filter((g) => g.league === state.feedFilter);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="@container w-full max-w-[1120px] mx-auto px-4 md:px-6 pt-4 pb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="text-[17px] font-semibold text-text-1 m-0">AI Model Projections</h1>
          <span className="text-[12px] text-text-3 tabular-nums-font whitespace-nowrap">{FEED_UPDATED}</span>
        </div>

        <div
          role="radiogroup"
          aria-label="Filter by league"
          className="flex gap-1.5 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0"
        >
          {FILTERS.map((f) => {
            const active = state.feedFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => dispatch({ type: "SET_FEED_FILTER", filter: f.value })}
                className="px-3.5 py-1.5 rounded-full text-[13px] whitespace-nowrap border"
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

        <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-3">
          {games.map((g) => (
            <FeedCard key={g.id} game={g} onOpen={() => openMatchAnalysis(g.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedCard({ game, onOpen }: { game: FeedGame; onOpen: () => void }) {
  const { oddsFormat } = useTheme();
  return (
    <div className="rounded-[14px] border border-sp-border bg-sp-surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-text-3">{game.comp}</span>
        <span className="text-[11px] text-sp-text-3 tabular-nums-font whitespace-nowrap">{game.sims}</span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-1">
        {[game.away, game.home].map((team) => (
          <div key={team.name} className="grid grid-cols-[20px_88px_1fr_42px] items-center gap-2.5">
            <TeamLogo src={team.logo} alt={team.alt} size={20} />
            <span className="text-[14px] font-semibold text-sp-text-1 truncate">{team.name}</span>
            <div className="h-1 rounded-full bg-sp-track overflow-hidden" aria-hidden>
              <div
                className={`h-full rounded-full ${team.lead ? "bg-sp-mint" : ""}`}
                style={{ width: `${team.pct}%`, background: team.lead ? undefined : "var(--sp-text-3)" }}
              />
            </div>
            <span className="text-[14px] font-bold text-sp-text-1 tabular-nums-font text-right">{team.pct}%</span>
          </div>
        ))}
      </div>

      <div className="border-t border-sp-border mt-2 px-4 pt-2.5 pb-1">
        <div className="grid grid-cols-[1fr_56px_56px_56px] gap-2 mb-1.5">
          {["Market", "Book", "Fair", "Edge"].map((h) => (
            <span key={h} className="text-[10px] font-semibold uppercase tracking-wide text-sp-text-3">
              {h}
            </span>
          ))}
        </div>
        {game.markets.map((m) => {
          const positive = !m.edge.trim().startsWith("−") && !m.edge.trim().startsWith("-");
          return (
            <div key={m.label} className="grid grid-cols-[1fr_56px_56px_56px] gap-2 py-1 items-center">
              <span className="text-[13px] font-semibold text-sp-text-1 truncate">{m.label}</span>
              <span className="text-[14px] font-semibold text-sp-text-1 tabular-nums-font">{fmtOdds(m.book, oddsFormat)}</span>
              <span className="text-[14px] font-semibold text-sp-text-1 tabular-nums-font">{fmtOdds(m.fair, oddsFormat)}</span>
              <span
                className="text-[14px] font-bold tabular-nums-font"
                style={{ color: positive ? "var(--sp-mint)" : "var(--sp-text-2)" }}
              >
                {m.edge}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between px-4 py-3 border-t border-sp-border min-h-11 active:bg-surface-2"
      >
        <span className="text-[13px] font-medium text-sp-text-2">Open model analysis</span>
        <ChevronRightIcon size={14} className="text-sp-text-3" />
      </button>
    </div>
  );
}
