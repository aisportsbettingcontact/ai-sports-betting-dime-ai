/**
 * BettingSplitsDemo.tsx
 *
 * Landing page interactive demo that EXACTLY replicates the real BettingSplitsPanel
 * desktop layout used in the live app.
 *
 * Visual rules (matching BettingSplitsPanel exactly):
 *   - 3-column layout: SPREAD | TOTAL | MONEYLINE (separated by 1px dividers)
 *   - Each column: centered title with horizontal rules → labels row → Tickets bar → Handle bar
 *   - Pill bars: away segment (left, rounded-left) + home segment (right, rounded-right)
 *     with % labels INSIDE each segment, flush left/right respectively
 *   - SPREAD/TOTAL/ML tab switcher on mobile (< lg), 3-column on desktop (>= lg)
 *   - IntersectionObserver triggers bar animation on first scroll-into-view
 *   - Real SEA vs KC May 23 data with actual MLB logos
 *
 * Data (DraftKings NJ, May 23 2026, SEA @ KC):
 *   SPREAD:  SEA -1.5 (+131) / KC +1.5 (-154)  | Tickets: SEA 38% / KC 62%  | Handle: SEA 45% / KC 55%
 *   TOTAL:   8.5 O/U                             | Tickets: OVER 52% / UNDER 48% | Handle: OVER 61% / UNDER 39%
 *   ML:      SEA -130 / KC +109                  | Tickets: SEA 55% / KC 45%  | Handle: SEA 67% / KC 33%
 */

import { useState, useRef, useEffect } from "react";

// ── Team logos ────────────────────────────────────────────────────────────────
const SEA_LOGO = "https://www.mlbstatic.com/team-logos/136.svg";
const KC_LOGO  = "https://www.mlbstatic.com/team-logos/118.svg";

// ── Logo filter (matches app's TeamLogo filter) ───────────────────────────────
const LOGO_FILTER =
  "brightness(1.7) contrast(1.08) saturate(1.35) drop-shadow(0 0 4px rgba(255,255,255,0.28))";

// ── Label stroke (matches app's LABEL_STROKE) ─────────────────────────────────
const LABEL_STROKE =
  "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)";

// ── Market data ───────────────────────────────────────────────────────────────
type MarketKey = "spread" | "total" | "ml";

interface MarketData {
  title: string;
  awayLabel: string;
  homeLabel: string;
  totalValue?: number;
  ticketsAway: number; // away (or OVER) pct
  handleAway: number;  // away (or OVER) pct
}

const MARKETS: Record<MarketKey, MarketData> = {
  spread: {
    title: "Spread",
    awayLabel: "SEA (-1.5)",
    homeLabel: "KC (+1.5)",
    ticketsAway: 38,
    handleAway: 45,
  },
  total: {
    title: "Total",
    awayLabel: "OVER",
    homeLabel: "UNDER",
    totalValue: 8.5,
    ticketsAway: 52,
    handleAway: 61,
  },
  ml: {
    title: "Moneyline",
    awayLabel: "SEA (-130)",
    homeLabel: "KC (+109)",
    ticketsAway: 55,
    handleAway: 67,
  },
};

const MARKET_KEYS: MarketKey[] = ["spread", "total", "ml"];

// ── TeamLogo ──────────────────────────────────────────────────────────────────
function TeamLogo({ src, alt, size }: { src: string; alt: string; size: number }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        filter: LOGO_FILTER,
        mixBlendMode: "screen",
        flexShrink: 0,
      }}
      loading="lazy"
      decoding="async"
    />
  );
}

// ── SplitBar — pill bar matching real app's SplitBar exactly ─────────────────
interface SplitBarProps {
  label: string;
  awayPct: number;
  homePct: number;
  awayColor: string;
  homeColor: string;
  animate: boolean;
}

function SplitBar({ label, awayPct, homePct, awayColor, homeColor, animate }: SplitBarProps) {
  const away = animate ? awayPct : 0;
  const home = animate ? homePct : 0;
  const isAwayFull = awayPct >= 100;
  const isHomeFull = homePct >= 100;
  const showDivider = !isAwayFull && !isHomeFull && awayPct > 0 && homePct > 0;

  const awaySegStyle: React.CSSProperties = isAwayFull
    ? { flex: 1, background: awayColor, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0 8px", overflow: "hidden" }
    : away > 0
    ? { flexGrow: away, flexShrink: 1, flexBasis: 0, minWidth: awayPct < 10 ? 44 : 38, background: awayColor, borderRadius: "9999px 0 0 9999px", display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0 8px", overflow: "hidden", transition: "flex-grow 0.7s ease" }
    : { display: "none" };

  const homeSegStyle: React.CSSProperties = isHomeFull
    ? { flex: 1, background: homeColor, borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", overflow: "hidden" }
    : home > 0
    ? { flexGrow: home, flexShrink: 1, flexBasis: 0, minWidth: homePct < 10 ? 44 : 38, background: homeColor, borderRadius: "0 9999px 9999px 0", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", overflow: "hidden", transition: "flex-grow 0.7s ease" }
    : { display: "none" };

  const awayLabelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#ffffff",
    fontWeight: 800,
    letterSpacing: "0.04em",
    lineHeight: 1,
    whiteSpace: "nowrap",
    textAlign: "left",
    textShadow: LABEL_STROKE,
  };

  const homeLabelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#ffffff",
    fontWeight: 800,
    letterSpacing: "0.04em",
    lineHeight: 1,
    whiteSpace: "nowrap",
    textAlign: "right",
    textShadow: LABEL_STROKE,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <span
        style={{
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          fontWeight: 700,
          fontSize: 11,
          color: "rgba(255,255,255,0.80)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          height: 28,
          display: "flex",
          flexDirection: "row",
          borderRadius: "9999px",
          border: "1.5px solid rgba(255,255,255,0.15)",
          boxSizing: "border-box",
          width: "100%",
        }}
      >
        {/* Away segment */}
        {!isAwayFull && !isHomeFull && away > 0 && (
          <div style={awaySegStyle}>
            <span style={awayLabelStyle}>{awayPct}%</span>
          </div>
        )}
        {/* Divider */}
        {showDivider && (
          <div style={{ width: 1.5, background: "rgba(255,255,255,0.3)", flexShrink: 0, alignSelf: "stretch" }} />
        )}
        {/* Home segment */}
        {!isAwayFull && !isHomeFull && home > 0 && (
          <div style={homeSegStyle}>
            <span style={homeLabelStyle}>{homePct}%</span>
          </div>
        )}
        {/* Full-bar cases */}
        {isAwayFull && !isHomeFull && (
          <div style={{ flex: 1, background: awayColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "9999px" }}>
            <span style={{ ...awayLabelStyle, textAlign: "center" }}>100%</span>
          </div>
        )}
        {isHomeFull && !isAwayFull && (
          <div style={{ flex: 1, background: homeColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "9999px" }}>
            <span style={{ ...homeLabelStyle, textAlign: "center" }}>100%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MarketBlock — single column matching real app's MarketBlock ───────────────
interface MarketBlockProps {
  market: MarketData;
  awayColor: string;
  homeColor: string;
  animate: boolean;
}

function MarketBlock({ market, awayColor, homeColor, animate }: MarketBlockProps) {
  const awayTickets = market.ticketsAway;
  const homeTickets = 100 - market.ticketsAway;
  const awayHandle  = market.handleAway;
  const homeHandle  = 100 - market.handleAway;
  const isTotalMarket = market.totalValue !== undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 8,
        padding: "10px 12px",
      }}
    >
      {/* Title with horizontal rules — matches MarketBlock exactly */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontWeight: 800,
            fontSize: 13,
            color: "#ffffff",
            whiteSpace: "nowrap",
          }}
        >
          {market.title}
        </span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
      </div>

      {/* Labels row */}
      {isTotalMarket ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.95)", fontWeight: 700, letterSpacing: "0.06em" }}>OVER</span>
          <span style={{ fontSize: 16, color: "#ffffff", fontWeight: 700 }}>{market.totalValue}</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.95)", fontWeight: 700, letterSpacing: "0.06em" }}>UNDER</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.95)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {market.awayLabel}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.95)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", textAlign: "right" }}>
            {market.homeLabel}
          </span>
        </div>
      )}

      {/* Tickets bar */}
      <SplitBar
        label="Tickets"
        awayPct={awayTickets}
        homePct={homeTickets}
        awayColor={awayColor}
        homeColor={homeColor}
        animate={animate}
      />

      {/* Handle bar */}
      <SplitBar
        label="Handle"
        awayPct={awayHandle}
        homePct={homeHandle}
        awayColor={awayColor}
        homeColor={homeColor}
        animate={animate}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BettingSplitsDemo() {
  const [animate, setAnimate] = useState(false);
  const [mobileMarket, setMobileMarket] = useState<MarketKey>("spread");
  const containerRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver — trigger bar animation on first scroll-into-view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          console.log("[BettingSplitsDemo] [STATE] Entered viewport — triggering bar animation");
          setAnimate(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // SEA teal (visible on dark bg, distinct from KC blue)
  const awayColor = "#005C5C";
  const homeColor = "#004687"; // KC Royals blue

  return (
    <div
      ref={containerRef}
      style={{
        background: "#0d1117",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      {/* ── Header: game info ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {/* Away team */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TeamLogo src={SEA_LOGO} alt="SEA" size={28} />
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Away</div>
            <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 700 }}>Seattle</div>
          </div>
        </div>

        {/* Game info center */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#39FF14", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            ⚾ MLB · DraftKings NJ
          </div>
          <div style={{ fontSize: 18, color: "#ffffff", fontWeight: 800, letterSpacing: "-0.02em", margin: "2px 0" }}>
            0 – 5
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Final · May 23
          </div>
        </div>

        {/* Home team */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
          <TeamLogo src={KC_LOGO} alt="KC" size={28} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Home</div>
            <div style={{ fontSize: 13, color: "#ffffff", fontWeight: 700 }}>Kansas City</div>
          </div>
        </div>
      </div>

      {/* ── Mobile: 3-way toggle + single active market ───────────────────── */}
      <div className="lg:hidden" style={{ padding: "8px 8px 0 8px" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {MARKET_KEYS.map((m) => {
            const label = m === "spread" ? "SPREAD" : m === "total" ? "TOTAL" : "MONEYLINE";
            const isActive = m === mobileMarket;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  console.log(`[BettingSplitsDemo] [INPUT] Mobile market tab clicked: ${m}`);
                  setMobileMarket(m);
                }}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  borderRadius: 4,
                  border: isActive ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)",
                  background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                  color: isActive ? "#ffffff" : "rgba(255,255,255,0.4)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {/* Active market block */}
        <MarketBlock
          market={MARKETS[mobileMarket]}
          awayColor={awayColor}
          homeColor={homeColor}
          animate={animate}
        />
      </div>

      {/* ── Desktop: full 3-column layout (matches BettingSplitsPanel isDesktop branch) ── */}
      <div className="hidden lg:flex" style={{ alignItems: "stretch", width: "100%" }}>
        {/* Spread */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MarketBlock market={MARKETS.spread} awayColor={awayColor} homeColor={homeColor} animate={animate} />
        </div>
        {/* Divider */}
        <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
        {/* Total */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MarketBlock market={MARKETS.total} awayColor={awayColor} homeColor={homeColor} animate={animate} />
        </div>
        {/* Divider */}
        <div style={{ width: 1, background: "rgba(255,255,255,0.07)", flexShrink: 0, alignSelf: "stretch", margin: "8px 0" }} />
        {/* Moneyline */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MarketBlock market={MARKETS.ml} awayColor={awayColor} homeColor={homeColor} animate={animate} />
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.01)",
        }}
      >
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
          Source: VSiN · DraftKings NJ
        </span>
        <span style={{ fontSize: 10, color: "#39FF14", fontWeight: 700 }}>
          LIVE SPLITS DATA
        </span>
      </div>
    </div>
  );
}
