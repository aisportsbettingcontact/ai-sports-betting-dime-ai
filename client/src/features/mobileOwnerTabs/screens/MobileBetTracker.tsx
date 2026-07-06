/**
 * MobileBetTracker — Owner-only bet tracking view.
 * Connects to betTracker.listWithStats (handicapperProcedure).
 * Shows recent bets, P&L summary, and win rate.
 */
import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { MobileDataState } from "../components/MobileDataState";
import { mobileOwnerTabLogger } from "../logger";
import { Receipt, TrendingUp, TrendingDown, Target, DollarSign } from "lucide-react";

export function MobileBetTracker() {
  const betsQuery = trpc.betTracker.listWithStats.useQuery(
    undefined,
    { staleTime: 60_000, retry: 2 }
  );

  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_bet_tracker_data_fetch_started", "props");
  }, []);

  useEffect(() => {
    if (!betsQuery.isLoading) {
      if (betsQuery.isError) {
        mobileOwnerTabLogger.log("mobile_bet_tracker_data_fetch_failed", "props", {
          error: betsQuery.error?.message,
        });
      } else {
        mobileOwnerTabLogger.log("mobile_bet_tracker_data_fetch_completed", "props", {
          totalBets: (betsQuery.data as any)?.list?.length ?? 0,
        });
      }
    }
  }, [betsQuery.isLoading, betsQuery.isError]);

  const data = betsQuery.data as any;
  const bets = data?.list ?? [];
  const stats = data?.stats ?? null;
  const isEmpty = !betsQuery.isLoading && !betsQuery.isError && bets.length === 0;

  useEffect(() => {
    if (isEmpty) mobileOwnerTabLogger.log("mobile_bet_tracker_empty_state_rendered", "props");
  }, [isEmpty]);

  // Compute quick stats
  const quickStats = useMemo(() => {
    if (!stats) return null;
    return {
      totalBets: stats.totalBets ?? bets.length,
      wins: stats.wins ?? 0,
      losses: stats.losses ?? 0,
      pushes: stats.pushes ?? 0,
      winRate: stats.winPct ?? (stats.wins && stats.totalGraded ? ((stats.wins / stats.totalGraded) * 100).toFixed(1) : "0.0"),
      netUnits: stats.netUnits ?? 0,
      roi: stats.roi ?? 0,
    };
  }, [stats, bets]);

  return (
    <div className="flex flex-col h-full min-h-full bg-[#0f0f1a]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f1a]/95 backdrop-blur-sm border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Bet Tracker</h1>
            <p className="text-[10px] text-zinc-500 mt-0.5">All tracked wagers</p>
          </div>
          <Receipt className="w-5 h-5 text-zinc-500" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        <MobileDataState
          isLoading={betsQuery.isLoading}
          isError={betsQuery.isError}
          isEmpty={isEmpty}
          loadingLabel="Loading bets..."
          emptyMessage="No tracked bets yet. Add bets from the main feed."
          errorMessage="Could not load bet tracker data."
          onRetry={() => betsQuery.refetch()}
        >
          {/* Stats Summary */}
          {quickStats && (
            <div className="px-4 pt-4 pb-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-3 text-center">
                  <Target className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-white">{quickStats.winRate}%</p>
                  <p className="text-[9px] text-zinc-500">Win Rate</p>
                </div>
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-3 text-center">
                  <DollarSign className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className={`text-lg font-bold ${Number(quickStats.netUnits) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(quickStats.netUnits) >= 0 ? "+" : ""}{Number(quickStats.netUnits).toFixed(1)}u
                  </p>
                  <p className="text-[9px] text-zinc-500">Net Units</p>
                </div>
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-3 text-center">
                  {Number(quickStats.roi) >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400 mx-auto mb-1" />
                  )}
                  <p className={`text-lg font-bold ${Number(quickStats.roi) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(quickStats.roi) >= 0 ? "+" : ""}{Number(quickStats.roi).toFixed(1)}%
                  </p>
                  <p className="text-[9px] text-zinc-500">ROI</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-zinc-500">
                <span>{quickStats.totalBets} total</span>
                <span className="text-emerald-400">{quickStats.wins}W</span>
                <span className="text-red-400">{quickStats.losses}L</span>
                <span className="text-zinc-400">{quickStats.pushes}P</span>
              </div>
            </div>
          )}

          {/* Recent Bets List */}
          <div className="flex flex-col gap-2 px-4 py-3">
            {bets.slice(0, 20).map((bet: any) => {
              const isWin = bet.result === "win";
              const isLoss = bet.result === "loss";
              const isPush = bet.result === "push";
              const isPending = !bet.result || bet.result === "pending";

              return (
                <div
                  key={bet.id}
                  className={`rounded-xl border p-3 ${
                    isWin ? "bg-emerald-500/5 border-emerald-500/20" :
                    isLoss ? "bg-red-500/5 border-red-500/20" :
                    isPush ? "bg-zinc-500/5 border-zinc-500/20" :
                    "bg-zinc-900/40 border-zinc-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-zinc-200 truncate max-w-[60%]">
                      {bet.pick || bet.description || `${bet.awayTeam} @ ${bet.homeTeam}`}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      isWin ? "text-emerald-400 bg-emerald-400/10" :
                      isLoss ? "text-red-400 bg-red-400/10" :
                      isPush ? "text-zinc-400 bg-zinc-400/10" :
                      "text-amber-400 bg-amber-400/10"
                    }`}>
                      {isPending ? "PENDING" : bet.result?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500">
                      {bet.sport} • {bet.market || bet.betType} • {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                    </span>
                    <span className="text-[10px] text-zinc-500">{bet.gameDate}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </MobileDataState>
      </div>
    </div>
  );
}
