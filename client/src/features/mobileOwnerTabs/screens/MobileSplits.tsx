/**
 * MobileSplits — MLB betting splits view.
 * Per-game card: "Away vs Home" matchup row, then stacked Run Line / Total /
 * Moneyline markets, each with Tickets + Money percentage bars.
 * All-black background; the white border lives ONLY on the split-percentage
 * bars. Team logos and cards carry no border (cards separated by a hairline).
 *
 * Data: trpc.games.liveSplits — live VSiN DK splits straight from
 * server/vsinBettingSplitsScraper.ts (5-min cache); book lines joined from
 * the games table best-effort; team logos arrive as server-fetched data URIs.
 * Nothing is rendered that isn't in that payload.
 */
import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { MobileDataState } from "../components/MobileDataState";
import { mobileOwnerTabLogger } from "../logger";
import { BarChart3 } from "lucide-react";

const T = {
  canvas: "#000000",
  surface: "#000000",
  barBorder: "#FFFFFF",              // white border — split-percentage bars ONLY
  cardBorder: "rgba(237,237,242,0.12)", // hairline card definition (reference value)
  divider: "rgba(237,237,242,0.12)",    // internal market separators
  text1: "#EDEDF2",
  body: "#C9C9D4",
  text2: "#9A9AA8",
  text3: "#6A6A78",
  mint: "#45E0A8",
  track: "rgba(237,237,242,0.10)",
  barInk: "#0B0B0F",
  mono: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
};

// IBM Plex Mono micro-label (labels only, never values)
const microLabel: React.CSSProperties = {
  fontFamily: T.mono,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.text3,
};

const fmtSigned = (v: string | number) => {
  const s = String(v).trim();
  return s.startsWith("+") || s.startsWith("-") ? s : Number(s) > 0 ? `+${s}` : s;
};

interface SplitBar {
  heading: "Tickets" | "Money";
  labelA: string;
  labelB: string;
  a: number; // away/Over pct
  b: number; // home/Under pct
}

interface SplitMarketBlock {
  title: string;
  bookA: string | null;
  bookB: string | null;
  bars: SplitBar[];
}

function PctBar({ bar }: { bar: SplitBar }) {
  const a = Math.max(0, Math.min(100, bar.a));
  const b = Math.max(0, Math.min(100, bar.b));
  return (
    <div
      role="img"
      aria-label={`${bar.heading}: ${bar.labelA} ${a} percent, ${bar.labelB} ${b} percent.`}
      style={{ display: "flex", flexDirection: "column", gap: 5 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: T.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bar.labelA}</span>
        <span style={microLabel}>{bar.heading}</span>
        <span style={{ fontSize: 11, color: T.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bar.labelB}</span>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "flex", height: 22, borderRadius: 6, overflow: "hidden",
          background: T.track, border: `1px solid ${T.barBorder}`,
        }}
      >
        <div style={{ flexGrow: a, flexBasis: 0, minWidth: 46, background: T.mint, display: "flex", alignItems: "center", padding: "0 7px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.barInk }}>{a}%</span>
        </div>
        <div style={{ flexGrow: b, flexBasis: 0, minWidth: 46, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 7px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text1 }}>{b}%</span>
        </div>
      </div>
    </div>
  );
}

function TeamLogo({ dataUri, alt, size }: { dataUri: string | null; alt: string; size: number }) {
  if (dataUri) {
    return (
      <img
        src={dataUri}
        alt={`${alt} logo`}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", flex: "none" }}
      />
    );
  }
  // No-logo fallback: bare abbreviation, no border or tile
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color: T.text2,
      }}
    >
      {alt.slice(0, 3).toUpperCase()}
    </span>
  );
}

export function MobileSplits() {
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const splitsQuery = trpc.games.liveSplits.useQuery(undefined, {
    staleTime: 60_000,
    retry: 2,
  });

  useEffect(() => {
    mobileOwnerTabLogger.log("mobile_splits_data_fetch_started", "splits", { date: today });
  }, [today]);

  useEffect(() => {
    if (!splitsQuery.isLoading) {
      if (splitsQuery.isError) {
        mobileOwnerTabLogger.log("mobile_splits_data_fetch_failed", "splits", { error: splitsQuery.error?.message });
      } else {
        mobileOwnerTabLogger.log("mobile_splits_data_fetch_completed", "splits", { games: splitsQuery.data?.rows.length ?? 0 });
      }
    }
  }, [splitsQuery.isLoading, splitsQuery.isError]);

  // Scraper returns today + tomorrow merged. Prefer today's slate; if VSiN has
  // already rolled over to tomorrow-only, show the earliest available date.
  const cards = useMemo(() => {
    const rows = splitsQuery.data?.rows;
    const logos = splitsQuery.data?.logos ?? {};
    if (!rows || rows.length === 0) return [];
    const todayRows = rows.filter((r) => r.gameDate === today);
    const activeDate = todayRows.length > 0 ? today : [...rows].map((r) => r.gameDate).sort()[0];
    const activeRows = todayRows.length > 0 ? todayRows : rows.filter((r) => r.gameDate === activeDate);

    return activeRows
      .map((r) => {
        const awayTeam = r.awayAbbrev ? MLB_BY_ABBREV.get(r.awayAbbrev) : undefined;
        const homeTeam = r.homeAbbrev ? MLB_BY_ABBREV.get(r.homeAbbrev) : undefined;
        const awayNick = awayTeam?.nickname ?? r.awayName;
        const homeNick = homeTeam?.nickname ?? r.homeName;

        const markets: SplitMarketBlock[] = [];

        const pushMarket = (
          title: string,
          bookA: string | null,
          bookB: string | null,
          labelA: string,
          labelB: string,
          betsPct: number | null,
          moneyPct: number | null
        ) => {
          if (betsPct == null && moneyPct == null) return;
          const bars: SplitBar[] = [];
          if (betsPct != null) bars.push({ heading: "Tickets", labelA, labelB, a: betsPct, b: 100 - betsPct });
          if (moneyPct != null) bars.push({ heading: "Money", labelA, labelB, a: moneyPct, b: 100 - moneyPct });
          markets.push({ title, bookA, bookB, bars });
        };

        pushMarket(
          "Run Line",
          r.awayBookSpread != null ? fmtSigned(r.awayBookSpread) : null,
          r.homeBookSpread != null ? fmtSigned(r.homeBookSpread) : null,
          r.awayBookSpread != null ? `${awayNick} (${fmtSigned(r.awayBookSpread)})` : awayNick,
          r.homeBookSpread != null ? `${homeNick} (${fmtSigned(r.homeBookSpread)})` : homeNick,
          r.spreadAwayBetsPct,
          r.spreadAwayMoneyPct
        );
        pushMarket(
          "Total",
          r.bookTotal != null ? `o${r.bookTotal}` : null,
          r.bookTotal != null ? `u${r.bookTotal}` : null,
          "Over",
          "Under",
          r.totalOverBetsPct,
          r.totalOverMoneyPct
        );
        pushMarket(
          "Moneyline",
          r.awayML != null ? fmtSigned(r.awayML) : null,
          r.homeML != null ? fmtSigned(r.homeML) : null,
          r.awayML != null ? `${awayNick} (${fmtSigned(r.awayML)})` : awayNick,
          r.homeML != null ? `${homeNick} (${fmtSigned(r.homeML)})` : homeNick,
          r.mlAwayBetsPct,
          r.mlAwayMoneyPct
        );

        return {
          key: r.vsinGameId,
          away: { nick: awayNick, logo: (r.awayAbbrev && logos[r.awayAbbrev]) || null },
          home: { nick: homeNick, logo: (r.homeAbbrev && logos[r.homeAbbrev]) || null },
          markets,
        };
      })
      .filter((c) => c.markets.length > 0);
  }, [splitsQuery.data, today]);

  const isEmpty = !splitsQuery.isLoading && !splitsQuery.isError && cards.length === 0;

  useEffect(() => {
    if (isEmpty) mobileOwnerTabLogger.log("mobile_splits_empty_state_rendered", "splits", { date: today });
  }, [isEmpty, today]);

  return (
    <div className="flex flex-col h-full min-h-full" style={{ background: T.canvas }}>
      <header
        className="sticky top-0 z-40"
        style={{ background: T.canvas, borderBottom: `1px solid ${T.divider}`, padding: "12px 16px" }}
      >
        <div className="flex items-center justify-between">
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.2px", color: T.text1 }}>
            MLB Betting Splits
          </h1>
          <BarChart3 className="w-5 h-5" style={{ color: T.text3 }} aria-hidden="true" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        <MobileDataState
          isLoading={splitsQuery.isLoading}
          isError={splitsQuery.isError}
          isEmpty={isEmpty}
          loadingLabel="Loading splits..."
          emptyMessage="No splits available for today."
          errorMessage="Splits could not be loaded."
          onRetry={() => splitsQuery.refetch()}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
            {cards.map((card) => (
              <section
                key={card.key}
                aria-label={`${card.away.nick} vs ${card.home.nick} betting splits`}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.cardBorder}`,
                  borderRadius: 16,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {/* matchup: Away vs Home in one row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 0 }}>
                  <TeamLogo dataUri={card.away.logo} alt={card.away.nick} size={36} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: T.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {card.away.nick}
                  </span>
                  <span style={{ fontSize: 13, color: T.text2, flex: "none" }}>vs</span>
                  <TeamLogo dataUri={card.home.logo} alt={card.home.nick} size={36} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: T.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {card.home.nick}
                  </span>
                </div>

                {/* markets */}
                {card.markets.map((mk) => (
                  <div
                    key={mk.title}
                    role="group"
                    aria-label={mk.title}
                    style={{
                      minWidth: 0, borderTop: `1px solid ${T.divider}`, paddingTop: 14,
                      display: "flex", flexDirection: "column", gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: T.text1 }}>
                        {mk.title}
                      </span>
                      {(mk.bookA != null || mk.bookB != null) && (
                        <span style={{ fontSize: 13, color: T.body, whiteSpace: "nowrap" }}>
                          {mk.bookA ?? "—"} / {mk.bookB ?? "—"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {mk.bars.map((bar) => (
                        <PctBar key={bar.heading} bar={bar} />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </MobileDataState>
      </div>
    </div>
  );
}
