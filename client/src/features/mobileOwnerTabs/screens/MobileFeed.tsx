/**
 * MobileFeed — Owner-only intelligence feed.
 * Connects to real platform data:
 *   - games.list (MLB model projections)
 *   - wc2026.matchesByDate (World Cup projections + edges)
 * Shows top edges, recent model updates, and slate overview.
 */
import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { MobileDataState } from "../components/MobileDataState";
import { mobileOwnerTabLogger } from "../logger";
import { TrendingUp, Globe, Zap, Clock } from "lucide-react";

// ─── Feed Card Component ──────────────────────────────────────────────────────

function FeedCard({
  type,
  title,
  subtitle,
  sport,
  timestamp,
  value,
  valueColor = "text-[#45E0A8]",
}: {
  type: "edge" | "projection" | "alert" | "update";
  title: string;
  subtitle: string;
  sport: string;
  timestamp?: string;
  value?: string;
  valueColor?: string;
}) {
  const icons = {
    edge: <TrendingUp className="w-4 h-4 text-[#45E0A8]" />,
    projection: <Globe className="w-4 h-4 text-white" />,
    alert: <Zap className="w-4 h-4 text-white" />,
    update: <Clock className="w-4 h-4 text-white" />,
  };

  return (
    <div className="rounded-xl bg-black border border-white p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5 shrink-0">{icons[type]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white truncate">{title}</p>
            <p className="text-xs text-white mt-0.5 line-clamp-2">{subtitle}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] uppercase tracking-wider text-white font-medium bg-black px-1.5 py-0.5 rounded">
                {sport}
              </span>
              {timestamp && (
                <span className="text-[10px] text-white">{timestamp}</span>
              )}
            </div>
          </div>
        </div>
        {value && (
          <span className={`text-sm font-mono font-semibold shrink-0 ${valueColor}`}>
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Feed Screen ─────────────────────────────────────────────────────────

export function MobileFeed() {
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Fetch MLB games for today
  const mlbQuery = trpc.games.list.useQuery(
    { sport: "MLB" as any, gameDate: today },
    { staleTime: 60_000, retry: 2 }
  );

  // Fetch WC2026 matches for today
  const wcQuery = trpc.wc2026.matchesByDate.useQuery(
    { date: today },
    { staleTime: 60_000, retry: 2 }
  );

  const isLoading = mlbQuery.isLoading && wcQuery.isLoading;
  const isError = mlbQuery.isError && wcQuery.isError;

  // Log data fetch lifecycle
  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_feed_data_fetch_started", "feed", {
      data_source: "games.list + wc2026.matchesByDate",
      date: today,
    });
  }, [today]);

  useEffect(() => {
    if (!mlbQuery.isLoading && !wcQuery.isLoading) {
      if (mlbQuery.isError && wcQuery.isError) {
        mobileOwnerTabLogger.log("mobile_feed_data_fetch_failed", "feed", {
          mlb_error: mlbQuery.error?.message,
          wc_error: wcQuery.error?.message,
        });
      } else {
        mobileOwnerTabLogger.log("mobile_feed_data_fetch_completed", "feed", {
          mlb_games: (mlbQuery.data as any[])?.length ?? 0,
          wc_matches: (wcQuery.data as any[])?.length ?? 0,
        });
      }
    }
  }, [mlbQuery.isLoading, wcQuery.isLoading, mlbQuery.isError, wcQuery.isError]);

  // Build feed cards from real data
  const feedCards = useMemo(() => {
    const cards: Array<{
      id: string;
      type: "edge" | "projection" | "alert" | "update";
      title: string;
      subtitle: string;
      sport: string;
      timestamp?: string;
      value?: string;
      valueColor?: string;
    }> = [];

    // WC2026 edges
    const wcData = wcQuery.data as any[] | undefined;
    if (wcData && wcData.length > 0) {
      for (const match of wcData) {
        const odds = match.odds;
        if (!odds) {
          // Still add as projection card
          cards.push({
            id: `wc-proj-${match.matchId}`,
            type: "projection",
            title: `${match.homeTeam || "TBD"} vs ${match.awayTeam || "TBD"}`,
            subtitle: `R16 • ${match.venue || "TBD"}`,
            sport: "World Cup",
            timestamp: match.kickoffUtc
              ? new Date(match.kickoffUtc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : undefined,
          });
          continue;
        }

        // Calculate edge from model vs book ML
        const modelHomeMl = odds.model_home_ml;
        const bookHomeMl = odds.book_home_ml;
        if (modelHomeMl && bookHomeMl) {
          const modelProb = modelHomeMl < 0
            ? Math.abs(modelHomeMl) / (Math.abs(modelHomeMl) + 100)
            : 100 / (modelHomeMl + 100);
          const bookProb = bookHomeMl < 0
            ? Math.abs(bookHomeMl) / (Math.abs(bookHomeMl) + 100)
            : 100 / (bookHomeMl + 100);
          const edge = ((modelProb - bookProb) * 100).toFixed(1);

          if (Number(edge) > 5) {
            cards.push({
              id: `wc-edge-${match.matchId}`,
              type: "edge",
              title: `${match.homeTeam} ML Edge`,
              subtitle: `Model: ${modelHomeMl > 0 ? "+" : ""}${modelHomeMl} vs Book: ${bookHomeMl > 0 ? "+" : ""}${bookHomeMl}`,
              sport: "World Cup",
              value: `+${edge}%`,
              valueColor: "text-[#45E0A8]",
            });
          }
        }

        // Add projection card
        cards.push({
          id: `wc-proj-${match.matchId}`,
          type: "projection",
          title: `${match.homeTeam || "TBD"} vs ${match.awayTeam || "TBD"}`,
          subtitle: `R16 • ${match.venue || "TBD"}`,
          sport: "World Cup",
          timestamp: match.kickoffUtc
            ? new Date(match.kickoffUtc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : undefined,
        });
      }
    }

    // MLB model projections
    const mlbData = mlbQuery.data as any[] | undefined;
    if (mlbData && mlbData.length > 0) {
      const modeledGames = mlbData.filter((g: any) => g.modelRunAt);
      const publishedGames = mlbData.filter((g: any) => g.publishedToFeed);

      // Slate overview card
      cards.push({
        id: "mlb-slate",
        type: "update",
        title: `MLB Slate: ${mlbData.length} Games`,
        subtitle: `${modeledGames.length} modeled • ${publishedGames.length} published`,
        sport: "MLB",
        timestamp: "Today",
      });

      // Top edges from published games
      for (const game of publishedGames.slice(0, 5)) {
        if (game.modelSpread && game.spread) {
          const modelSpread = parseFloat(game.modelSpread);
          const bookSpread = parseFloat(game.spread);
          const diff = Math.abs(modelSpread - bookSpread);
          if (diff >= 1.0) {
            cards.push({
              id: `mlb-edge-${game.id}`,
              type: "edge",
              title: `${game.awayTeam} @ ${game.homeTeam}`,
              subtitle: `Model: ${modelSpread > 0 ? "+" : ""}${modelSpread.toFixed(1)} vs Book: ${bookSpread > 0 ? "+" : ""}${bookSpread.toFixed(1)}`,
              sport: "MLB",
              value: `${diff.toFixed(1)} pts`,
              valueColor: diff >= 2 ? "text-[#45E0A8]" : "text-white",
            });
          }
        }
      }
    }

    return cards;
  }, [wcQuery.data, mlbQuery.data]);

  const isEmpty = !isLoading && !isError && feedCards.length === 0;

  useEffect(() => {
    if (isEmpty) {
      mobileOwnerTabLogger.log("mobile_feed_empty_state_rendered", "feed", { date: today });
    }
  }, [isEmpty, today]);

  return (
    <div className="flex flex-col h-full min-h-full bg-black">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black backdrop-blur-sm border-b border-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Intelligence Feed</h1>
            <p className="text-[10px] text-white mt-0.5">
              {today} • Real-time model & market signals
            </p>
          </div>
          <span className="text-[10px] text-[#45E0A8] font-medium px-2 py-0.5 rounded-full bg-black border border-[#45E0A8]">
            LIVE
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-24">
        <MobileDataState
          isLoading={isLoading}
          isError={isError}
          isEmpty={isEmpty}
          loadingLabel="Loading feed..."
          emptyMessage="No feed data connected yet."
          errorMessage="Feed could not be loaded."
          onRetry={() => {
            mlbQuery.refetch();
            wcQuery.refetch();
          }}
        >
          <div className="flex flex-col gap-3 px-4 py-4">
            {feedCards.map((card) => (
              <FeedCard key={card.id} {...card} />
            ))}
          </div>
        </MobileDataState>
      </div>
    </div>
  );
}
