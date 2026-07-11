"use client";

import { SPLITS_DATA } from "@/lib/data/seed";
import { TeamLogo } from "@/components/icons";
import { SplitBar } from "@/components/ui/bars";
import { useTheme } from "@/lib/theme";
import { fmtOdds } from "@/lib/format";
import type { SplitsMarket, SplitsTeam } from "@/lib/types";

export function SplitsTab() {
  const data = SPLITS_DATA;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[1880px] mx-auto px-4 md:px-6 pt-4 pb-8">
        <h1 className="text-[17px] font-semibold text-text-1 m-0 mb-3">MLB Betting Splits</h1>

        {/* Sized to this panel's own width via container queries, not viewport width — the
            sidebar shares the viewport, so a viewport-width breakpoint here would trigger the
            row layout while the panel itself is still too narrow for 5 columns. */}
        <div className="@container rounded-2xl border border-sp-border bg-sp-surface p-4 @2xl:p-5">
          <div className="grid grid-cols-1 @5xl:grid-cols-[minmax(150px,auto)_repeat(3,minmax(0,1fr))_minmax(170px,auto)] gap-5 @5xl:gap-4">
            <MatchIdentity away={data.away} home={data.home} status={data.status} />
            {data.markets.map((m) => (
              <MarketColumn key={m.title} market={m} />
            ))}
            <EdgeColumn />
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchIdentity({ away, home, status }: { away: SplitsTeam; home: SplitsTeam; status: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="self-start rounded-full bg-mint-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-mint">
        {status}
      </span>
      {[away, home].map((t) => (
        <div key={t.name} className="flex items-center gap-2.5">
          <TeamLogo src={t.logo} alt={t.alt} size={36} />
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] text-sp-text-2 truncate">{t.city}</span>
            <span className="text-[14px] font-semibold text-sp-text-1 truncate">{t.name}</span>
          </div>
          <span className="ml-auto text-[28px] font-semibold tabular-nums-font text-sp-text-1">{t.score}</span>
        </div>
      ))}
    </div>
  );
}

function MarketColumn({ market }: { market: SplitsMarket }) {
  const { oddsFormat } = useTheme();
  return (
    <div className="flex flex-col gap-3 border-t @5xl:border-t-0 @5xl:border-l border-sp-border pt-4 @5xl:pt-0 @5xl:pl-4">
      <div className="text-[16px] font-semibold text-sp-text-1 text-center">{market.title}</div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <MarketSideHeader
          label={market.sideLabels.a}
          book={fmtOdds(market.book.a, oddsFormat)}
          model={fmtOdds(market.model.a, oddsFormat)}
          highlighted={market.modelHighlight === "A"}
        />
        <MarketSideHeader
          label={market.sideLabels.b}
          book={fmtOdds(market.book.b, oddsFormat)}
          model={fmtOdds(market.model.b, oddsFormat)}
          highlighted={market.modelHighlight === "B"}
        />
      </div>
      <SplitBar
        heading="Tickets"
        aLabel={market.sideLabels.a}
        bLabel={market.sideLabels.b}
        aPct={market.tickets.a}
        bPct={market.tickets.b}
      />
      <SplitBar
        heading="Money"
        aLabel={market.sideLabels.a}
        bLabel={market.sideLabels.b}
        aPct={market.money.a}
        bPct={market.money.b}
      />
    </div>
  );
}

function MarketSideHeader({
  label,
  book,
  model,
  highlighted,
}: {
  label: string;
  book: string;
  model: string;
  highlighted: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 items-center">
      <span className="text-[11.5px] font-medium text-sp-text-2 truncate w-full text-center">{label}</span>
      <span className="text-[10px] uppercase tracking-wide text-sp-text-3">Book</span>
      <span className="text-[14px] font-semibold text-sp-text-1 tabular-nums-font">{book}</span>
      <span className="text-[10px] uppercase tracking-wide text-sp-text-3 mt-0.5">Model</span>
      <span
        className="text-[13px] font-semibold tabular-nums-font rounded-full px-2 py-0.5"
        style={
          highlighted
            ? { background: "var(--sp-mint-soft)", border: "1px solid var(--sp-mint-border)", color: "var(--sp-mint)" }
            : { color: "var(--sp-text-1)" }
        }
      >
        {model}
      </span>
    </div>
  );
}

function EdgeColumn() {
  const data = SPLITS_DATA;
  return (
    <div className="flex flex-col gap-2.5 border-t @5xl:border-t-0 @5xl:border-l border-sp-border pt-4 @5xl:pt-0 @5xl:pl-4">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-text-3">Edge</span>
      {data.edges.map((e) => (
        <div
          key={e.label}
          className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
          style={{ borderColor: "var(--sp-mint-border)" }}
        >
          <TeamLogo src={e.teamLogo} alt={e.teamAlt} size={22} />
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-sp-text-1 truncate">{e.label}</span>
            <span className="text-[11px] text-sp-text-3 truncate">{e.marketName}</span>
          </div>
          <span className="ml-auto flex-none text-[12px] font-semibold text-sp-mint tabular-nums-font">{e.roi}</span>
        </div>
      ))}
    </div>
  );
}
