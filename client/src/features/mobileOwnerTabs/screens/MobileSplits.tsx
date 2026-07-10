/**
 * MobileSplits — Owner-only betting splits view, Dime AI design.
 * Mirrors the "SPLITS TAB" card from the Dime standalone reference
 * (dime-ai design bundle, phone "stack" tier): per-game card with team
 * identity rows, stacked Run Line / Total / Moneyline markets, each with
 * Tickets + Money percentage bars, and sharp-money signal chips.
 *
 * Data: trpc.games.liveSplits — live VSiN DK splits straight from
 * server/vsinBettingSplitsScraper.ts (5-min cache), book lines joined
 * from the games table best-effort.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { MobileDataState } from "../components/MobileDataState";
import { mobileOwnerTabLogger } from "../logger";
import { BarChart3 } from "lucide-react";

// ── Dime dark tokens (design-system/dime-ai/MASTER.md + splits reference) ────
const T = {
  canvas: "#0B0B0F",
  surface: "#101016",
  border: "rgba(237,237,242,0.12)",
  text1: "#EDEDF2",
  text2: "#9A9AA8",
  text3: "#6A6A78",
  mint: "#45E0A8",
  mintSoft: "rgba(69,224,168,0.12)",
  mintBrd: "rgba(69,224,168,0.35)",
  track: "rgba(237,237,242,0.10)",
  barInk: "#0B0B0F",
  mono: "'IBM Plex Mono', monospace",
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

interface SharpSignal {
  side: string;
  market: string;
  moneyPct: number;
  ticketsPct: number;
}

function PctBar({ bar, barH }: { bar: SplitBar; barH: number }) {
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
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.9px", textTransform: "uppercase", color: T.text3 }}>{bar.heading}</span>
        <span style={{ fontSize: 11, color: T.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bar.labelB}</span>
      </div>
      <div style={{ display: "flex", height: barH, borderRadius: 6, overflow: "hidden", background: T.track }} aria-hidden="true">
        <div
          style={{
            flexGrow: a, flexBasis: 0, minWidth: 46, background: T.mint,
            display: "flex", alignItems: "center", padding: "0 7px",
            transition: "flex-grow 160ms ease",
          }}
        >
          <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.barInk }}>{a}%</span>
        </div>
        <div
          style={{
            flexGrow: b, flexBasis: 0, minWidth: 46,
            display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 7px",
            transition: "flex-grow 160ms ease",
          }}
        >
          <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.text1 }}>{b}%</span>
        </div>
      </div>
    </div>
  );
}

function TeamLogo({ url, alt, size }: { url: string | null; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: "50%", flex: "none",
          background: T.track, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: T.text2,
        }}
      >
        {alt.slice(0, 3).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, objectFit: "contain", flex: "none" }}
      onError={() => setFailed(true)}
    />
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
  const { cards, displayDate } = useMemo(() => {
    const rows = splitsQuery.data?.rows;
    if (!rows || rows.length === 0) return { cards: [], displayDate: today };
    const todayRows = rows.filter((r) => r.gameDate === today);
    const activeDate = todayRows.length > 0 ? today : [...rows].map((r) => r.gameDate).sort()[0];
    const activeRows = todayRows.length > 0 ? todayRows : rows.filter((r) => r.gameDate === activeDate);

    const built = activeRows.map((r) => {
      const awayTeam = r.awayAbbrev ? MLB_BY_ABBREV.get(r.awayAbbrev) : undefined;
      const homeTeam = r.homeAbbrev ? MLB_BY_ABBREV.get(r.homeAbbrev) : undefined;
      const awayNick = awayTeam?.nickname ?? r.awayName;
      const homeNick = homeTeam?.nickname ?? r.homeName;

      const markets: SplitMarketBlock[] = [];
      const signals: SharpSignal[] = [];

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
        if (betsPct != null && moneyPct != null && Math.abs(moneyPct - betsPct) >= 15) {
          signals.push({
            side: moneyPct > betsPct ? labelA : labelB,
            market: title,
            moneyPct: moneyPct > betsPct ? moneyPct : 100 - moneyPct,
            ticketsPct: moneyPct > betsPct ? betsPct : 100 - betsPct,
          });
        }
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

      const maxDivergence = signals.reduce((m, s) => Math.max(m, s.moneyPct - s.ticketsPct), 0);

      return {
        key: r.vsinGameId,
        chip: r.gameDate === today ? (r.startTimeEst ?? "Today") : "Tomorrow",
        teams: [
          { city: awayTeam?.city ?? "", nick: awayNick, logo: awayTeam?.logoUrl ?? null, ml: r.awayML },
          { city: homeTeam?.city ?? "", nick: homeNick, logo: homeTeam?.logoUrl ?? null, ml: r.homeML },
        ],
        markets,
        signals,
        maxDivergence,
      };
    });

    // Sharpest money divergence first — same spirit as the old STEAM sort
    built.sort((a, b) => b.maxDivergence - a.maxDivergence);
    return { cards: built.filter((c) => c.markets.length > 0), displayDate: activeDate };
  }, [splitsQuery.data, today]);

  const isEmpty = !splitsQuery.isLoading && !splitsQuery.isError && cards.length === 0;

  useEffect(() => {
    if (isEmpty) mobileOwnerTabLogger.log("mobile_splits_empty_state_rendered", "splits", { date: today });
  }, [isEmpty, today]);

  return (
    <div className="flex flex-col h-full min-h-full" style={{ background: T.canvas }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-sm"
        style={{ background: "rgba(11,11,15,0.95)", borderBottom: `1px solid ${T.border}`, padding: "12px 16px" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.2px", color: T.text1 }}>
              MLB Betting Splits
            </h1>
            <p style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
              {displayDate} • VSiN DK
              {splitsQuery.data?.fetchedAt
                ? ` • updated ${new Date(splitsQuery.data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </p>
          </div>
          <BarChart3 className="w-5 h-5" style={{ color: T.text3 }} />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
            {cards.map((card) => (
              <section
                key={card.key}
                aria-label={`${card.teams[0].nick} at ${card.teams[1].nick} betting splits`}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {/* match identity */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <span
                      style={{
                        display: "inline-flex", alignItems: "center", padding: "3px 10px",
                        borderRadius: 9, border: `1px solid ${T.mintBrd}`, background: T.mintSoft,
                        color: T.mint, fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
                      }}
                    >
                      {card.chip}
                    </span>
                  </div>
                  {card.teams.map((tm, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <TeamLogo url={tm.logo} alt={tm.nick} size={36} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                        {tm.city && <span style={{ fontSize: 12, color: T.text2, whiteSpace: "nowrap" }}>{tm.city}</span>}
                        <span style={{ fontSize: 15, fontWeight: 600, color: T.text1, whiteSpace: "nowrap" }}>{tm.nick}</span>
                      </div>
                      {tm.ml != null && (
                        <span
                          style={{
                            marginLeft: "auto", fontFamily: T.mono, fontSize: 16,
                            fontWeight: 600, lineHeight: 1, color: T.text1,
                          }}
                        >
                          {fmtSigned(tm.ml)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* markets */}
                {card.markets.map((mk) => (
                  <div
                    key={mk.title}
                    role="group"
                    aria-label={mk.title}
                    style={{
                      minWidth: 0, borderTop: `1px solid ${T.border}`, paddingTop: 14,
                      display: "flex", flexDirection: "column", gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: T.text1 }}>
                        {mk.title}
                      </span>
                      {(mk.bookA != null || mk.bookB != null) && (
                        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text2, whiteSpace: "nowrap" }}>
                          {mk.bookA ?? "—"} / {mk.bookB ?? "—"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {mk.bars.map((bar) => (
                        <PctBar key={bar.heading} bar={bar} barH={20} />
                      ))}
                    </div>
                  </div>
                ))}

                {/* sharp-money signals */}
                {card.signals.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.9px", textTransform: "uppercase", color: T.text3, textAlign: "center" }}>
                      Sharp Money
                    </div>
                    {card.signals.map((sig) => (
                      <div
                        key={`${sig.market}-${sig.side}`}
                        role="group"
                        aria-label={`Sharp money on ${sig.side}, ${sig.market}: ${sig.moneyPct} percent of money versus ${sig.ticketsPct} percent of tickets.`}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          border: `1px solid ${T.mintBrd}`, borderRadius: 10, padding: "9px 12px", minWidth: 0,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {sig.side}
                          </span>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, color: T.text3, whiteSpace: "nowrap" }}>{sig.market}</span>
                            <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.mint, whiteSpace: "nowrap" }}>
                              {sig.moneyPct}% $ vs {sig.ticketsPct}% tix
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </MobileDataState>
      </div>
    </div>
  );
}
