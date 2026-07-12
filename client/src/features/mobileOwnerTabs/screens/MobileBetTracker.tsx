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
    <div
      className="flex flex-col h-full min-h-full"
      style={{ background: "var(--dime-bg)" }}
    >
      {/* Header — solid chrome surface + 1px border, matching the /chat mobile bar */}
      <header
        className="sticky top-0 z-40 border-b px-4 py-3"
        style={{
          background: "var(--dime-surface-sidebar)",
          borderColor: "var(--dime-border)",
          paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-lg font-bold tracking-tight"
              style={{ color: "var(--dime-text-primary)" }}
            >
              Bet Tracker
            </h1>
            <p className="dime-mono-label mt-0.5">All tracked wagers</p>
          </div>
          <Receipt className="w-5 h-5" style={{ color: "var(--dime-text-muted)" }} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-4">
        <MobileDataState
          isLoading={betsQuery.isLoading}
          isError={betsQuery.isError}
          isEmpty={isEmpty}
          loadingLabel="Loading bets..."
          emptyMessage="No tracked bets yet. Add bets from the main feed."
          errorMessage="Could not load bet tracker data."
          onRetry={() => betsQuery.refetch()}
        >
          {/* Stats Summary — MASTER.md stat pattern: mono micro-label over a bold
              value; mint ONLY when the value is signal, grey for negative. */}
          {quickStats && (
            <div className="px-4 pt-4 pb-2">
              <div className="grid grid-cols-3 gap-2">
                <div
                  className="rounded-xl border p-3 text-center"
                  style={{ background: "var(--dime-surface-card)", borderColor: "var(--dime-border)" }}
                >
                  <Target className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--dime-text-muted)" }} />
                  <p className="text-lg font-bold" style={{ color: "var(--dime-text-primary)" }}>
                    {quickStats.winRate}%
                  </p>
                  <p className="dime-mono-label">Win Rate</p>
                </div>
                <div
                  className="rounded-xl border p-3 text-center"
                  style={{ background: "var(--dime-surface-card)", borderColor: "var(--dime-border)" }}
                >
                  <DollarSign className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--dime-text-muted)" }} />
                  <p
                    className="text-lg font-bold"
                    style={{
                      color: Number(quickStats.netUnits) >= 0
                        ? "var(--dime-mint-text)"
                        : "var(--dime-text-secondary)",
                    }}
                  >
                    {Number(quickStats.netUnits) >= 0 ? "+" : ""}{Number(quickStats.netUnits).toFixed(1)}u
                  </p>
                  <p className="dime-mono-label">Net Units</p>
                </div>
                <div
                  className="rounded-xl border p-3 text-center"
                  style={{ background: "var(--dime-surface-card)", borderColor: "var(--dime-border)" }}
                >
                  {Number(quickStats.roi) >= 0 ? (
                    <TrendingUp className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--dime-mint-text)" }} />
                  ) : (
                    <TrendingDown className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--dime-text-muted)" }} />
                  )}
                  <p
                    className="text-lg font-bold"
                    style={{
                      color: Number(quickStats.roi) >= 0
                        ? "var(--dime-mint-text)"
                        : "var(--dime-text-secondary)",
                    }}
                  >
                    {Number(quickStats.roi) >= 0 ? "+" : ""}{Number(quickStats.roi).toFixed(1)}%
                  </p>
                  <p className="dime-mono-label">ROI</p>
                </div>
              </div>
              <div
                className="flex items-center justify-center gap-4 mt-3 text-[10px] uppercase"
                style={{
                  fontFamily: "var(--dime-font-mono)",
                  letterSpacing: "0.08em",
                  color: "var(--dime-text-muted)",
                }}
              >
                <span>{quickStats.totalBets} total</span>
                <span style={{ color: "var(--dime-mint-text)" }}>{quickStats.wins}W</span>
                <span style={{ color: "var(--dime-text-secondary)" }}>{quickStats.losses}L</span>
                <span>{quickStats.pushes}P</span>
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
                  className="rounded-xl border p-3"
                  style={{
                    // Mint marks wins (signal). Losses are grey and the whole
                    // row de-emphasizes to 82% — never red (MASTER.md:48).
                    background: isWin ? "var(--dime-mint-dim)" : "var(--dime-surface-card)",
                    borderColor: isWin ? "var(--dime-mint-border)" : "var(--dime-border)",
                    opacity: isLoss ? 0.82 : 1,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-[12px] font-medium truncate max-w-[60%]"
                      style={{ color: "var(--dime-text-primary)" }}
                    >
                      {bet.pick || bet.description || `${bet.awayTeam} @ ${bet.homeTeam}`}
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-lg uppercase"
                      style={{
                        fontFamily: "var(--dime-font-mono)",
                        letterSpacing: "0.08em",
                        color: isWin
                          ? "var(--dime-mint-text)"
                          : isPush || isPending
                            ? "var(--dime-text-muted)"
                            : "var(--dime-text-secondary)",
                        background: isWin ? "var(--dime-mint-dim)" : "var(--dime-surface-raised)",
                      }}
                    >
                      {isPending ? "PENDING" : bet.result?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[10px] uppercase"
                      style={{
                        fontFamily: "var(--dime-font-mono)",
                        letterSpacing: "0.08em",
                        color: "var(--dime-text-muted)",
                      }}
                    >
                      {bet.sport} • {bet.market || bet.betType} • {bet.odds > 0 ? `+${bet.odds}` : bet.odds}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{
                        fontFamily: "var(--dime-font-mono)",
                        letterSpacing: "0.08em",
                        color: "var(--dime-text-muted)",
                      }}
                    >
                      {bet.gameDate}
                    </span>
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
