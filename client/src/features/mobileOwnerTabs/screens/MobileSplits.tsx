/**
 * MobileSplits — Owner-only betting splits view.
 * Connects to games.liveSplits — live VSiN MLB splits straight from the
 * scraper (vsinBettingSplitsScraper.ts), no DB refresh dependency.
 * Toggle between SPREAD/TOTAL/ML. Shows steam moves.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MobileDataState } from "../components/MobileDataState";
import { mobileOwnerTabLogger } from "../logger";
import { BarChart3, TrendingUp, TrendingDown } from "lucide-react";

type SplitMarket = "spread" | "total" | "ml";

export function MobileSplits() {
  const [market, setMarket] = useState<SplitMarket>("spread");

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const splitsQuery = trpc.games.liveSplits.useQuery(undefined, {
    staleTime: 60_000,
    retry: 2,
  });

  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_splits_data_fetch_started", "splits", { market, date: today });
  }, [today, market]);

  useEffect(() => {
    if (!splitsQuery.isLoading) {
      if (splitsQuery.isError) {
        mobileOwnerTabLogger.log("mobile_splits_data_fetch_failed", "splits", { error: splitsQuery.error?.message });
      } else {
        mobileOwnerTabLogger.log("mobile_splits_data_fetch_completed", "splits", { games: splitsQuery.data?.rows.length ?? 0, market });
      }
    }
  }, [splitsQuery.isLoading, splitsQuery.isError, market]);

  // Scraper returns today + tomorrow merged. Prefer today's slate; if VSiN has
  // already rolled over to tomorrow-only, show the earliest available date.
  const { splitRows, displayDate } = useMemo(() => {
    const rows = splitsQuery.data?.rows;
    if (!rows || rows.length === 0) return { splitRows: [], displayDate: today };
    const todayRows = rows.filter((r) => r.gameDate === today);
    const activeDate = todayRows.length > 0 ? today : [...rows].map((r) => r.gameDate).sort()[0];
    const activeRows = todayRows.length > 0 ? todayRows : rows.filter((r) => r.gameDate === activeDate);
    const fmtSigned = (v: string | number) => {
      const s = String(v).trim();
      return s.startsWith("+") || s.startsWith("-") ? s : Number(s) > 0 ? `+${s}` : s;
    };
    const mapped = activeRows
      .filter((r) => {
        if (market === "spread") return r.spreadAwayBetsPct != null;
        if (market === "total") return r.totalOverBetsPct != null;
        return r.mlAwayBetsPct != null;
      })
      .map((r) => {
        const away = r.awayAbbrev ?? r.awayName;
        const home = r.homeAbbrev ?? r.homeName;
        let betsPct = 50, moneyPct = 50, line = "-";
        if (market === "spread") {
          betsPct = r.spreadAwayBetsPct ?? 50;
          moneyPct = r.spreadAwayMoneyPct ?? 50;
          line = r.awayBookSpread != null ? `${away} ${fmtSigned(r.awayBookSpread)}` : "-";
        } else if (market === "total") {
          betsPct = r.totalOverBetsPct ?? 50;
          moneyPct = r.totalOverMoneyPct ?? 50;
          line = r.bookTotal != null ? `O/U ${r.bookTotal}` : "-";
        } else {
          betsPct = r.mlAwayBetsPct ?? 50;
          moneyPct = r.mlAwayMoneyPct ?? 50;
          line = r.awayML != null ? `${away} ${fmtSigned(r.awayML)}` : "-";
        }
        return { gameId: r.vsinGameId, away, home, betsPct, moneyPct, line };
      })
      .sort((a, b) => Math.abs(b.betsPct - b.moneyPct) - Math.abs(a.betsPct - a.moneyPct));
    return { splitRows: mapped, displayDate: activeDate };
  }, [splitsQuery.data, market, today]);

  const isEmpty = !splitsQuery.isLoading && !splitsQuery.isError && splitRows.length === 0;

  useEffect(() => {
    if (isEmpty) mobileOwnerTabLogger.log("mobile_splits_empty_state_rendered", "splits", { market, date: today });
  }, [isEmpty, market, today]);

  return (
    <div className="flex flex-col h-full min-h-full bg-[#0f0f1a]">
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Betting Splits</h1>
            <p className="text-[10px] text-zinc-500 mt-0.5">{displayDate} • MLB • VSiN DK</p>
          </div>
          <BarChart3 className="w-5 h-5 text-zinc-500" />
        </div>
        <div className="flex gap-1 bg-zinc-900/80 rounded-lg p-0.5">
          {(["spread", "total", "ml"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all ${
                market === m
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m === "ml" ? "MONEYLINE" : m.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        <MobileDataState
          isLoading={splitsQuery.isLoading}
          isError={splitsQuery.isError}
          isEmpty={isEmpty}
          loadingLabel="Loading splits..."
          emptyMessage={`No ${market} splits available for today.`}
          errorMessage="Splits could not be loaded."
          onRetry={() => splitsQuery.refetch()}
        >
          <div className="flex flex-col gap-3 px-4 py-4">
            {splitRows.map((row) => {
              const isSteam = Math.abs(row.betsPct - row.moneyPct) >= 15;
              return (
                <div key={row.gameId} className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-200">{row.away} @ {row.home}</span>
                      {isSteam && (
                        <span className="text-[9px] text-amber-400 font-medium px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">STEAM</span>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono">{row.line}</span>
                  </div>
                  <div className="mb-2">
                    <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Bets</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500/70 transition-all duration-500" style={{ width: `${row.betsPct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-300 w-8">{row.betsPct}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Money</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500/70 transition-all duration-500" style={{ width: `${row.moneyPct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-300 w-8">{row.moneyPct}%</span>
                    </div>
                  </div>
                  {isSteam && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400">
                      {row.moneyPct > row.betsPct ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      <span>Sharp money {row.moneyPct > row.betsPct ? "on" : "against"} {market === "total" ? "Over" : row.away}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </MobileDataState>
      </div>
    </div>
  );
}
