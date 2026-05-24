import { useState, useEffect, useRef } from "react";

// ─── Real game data: SEA @ KC — May 23, 2026 (Final: SEA 0, KC 5) ────────────
// Source: mlb_schedule_history anGameId=288452, DK NJ pre-game odds
// Splits from VSiN (as shown in the app on game day)

const SEA_LOGO = "https://www.mlbstatic.com/team-logos/136.svg";
const KC_LOGO  = "https://www.mlbstatic.com/team-logos/118.svg";

const LOGO_FILTER = "brightness(1.7) contrast(1.08) saturate(1.35) drop-shadow(0 0 4px rgba(255,255,255,0.28))";

type MarketKey = "spread" | "total" | "ml";

interface MarketData {
  label: string;
  awayLabel: string;
  homeLabel: string;
  awayOdds: string;
  homeOdds: string;
  awayTickets: number;
  homeTickets: number;
  awayMoney: number;
  homeMoney: number;
  signal: string;
  signalColor: string;
  sharpSide: string | null;
  openLine: string;
  closeLine: string;
}

const GAME_DATA: Record<MarketKey, MarketData> = {
  spread: {
    label: "RUN LINE",
    awayLabel: "SEA -1.5",
    homeLabel: "KC +1.5",
    awayOdds: "+131",
    homeOdds: "-154",
    awayTickets: 51,
    homeTickets: 49,
    awayMoney: 73,
    homeMoney: 27,
    signal: "Money Divergence",
    signalColor: "#39FF14",
    sharpSide: "SEA",
    openLine: "SEA -1.5 (+125)",
    closeLine: "SEA -1.5 (+131)",
  },
  total: {
    label: "TOTAL",
    awayLabel: "OVER 8.5",
    homeLabel: "UNDER 8.5",
    awayOdds: "-109",
    homeOdds: "-111",
    awayTickets: 54,
    homeTickets: 46,
    awayMoney: 47,
    homeMoney: 53,
    signal: "No Clear Signal",
    signalColor: "#6b7280",
    sharpSide: null,
    openLine: "8.5 (-110/-110)",
    closeLine: "8.5 (-109/-111)",
  },
  ml: {
    label: "MONEYLINE",
    awayLabel: "SEA ML",
    homeLabel: "KC ML",
    awayOdds: "-130",
    homeOdds: "+109",
    awayTickets: 20,
    homeTickets: 80,
    awayMoney: 32,
    homeMoney: 68,
    signal: "Public Heavy",
    signalColor: "#f59e0b",
    sharpSide: null,
    openLine: "SEA -135",
    closeLine: "SEA -130",
  },
};

const MARKET_TABS: { key: MarketKey; label: string }[] = [
  { key: "spread", label: "SPREAD" },
  { key: "total",  label: "TOTAL" },
  { key: "ml",     label: "MONEYLINE" },
];

// ─── Animated bar ─────────────────────────────────────────────────────────────
function AnimatedBar({
  pct,
  color,
  animate,
}: {
  pct: number;
  color: string;
  animate: boolean;
}) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!animate) { setWidth(0); return; }
    const t = setTimeout(() => setWidth(pct), 60);
    return () => clearTimeout(t);
  }, [pct, animate]);

  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: color,
            transition: animate ? "width 0.7s cubic-bezier(0.4,0,0.2,1)" : "none",
            boxShadow: color === "#39FF14" ? `0 0 6px ${color}60` : undefined,
          }}
        />
      </div>
      <span
        className="text-[12px] font-bold tabular-nums w-9 text-right"
        style={{ color: "#e5e7eb" }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ─── Team logo ────────────────────────────────────────────────────────────────
function TeamLogo({ src, alt, size = 36 }: { src: string; alt: string; size?: number }) {
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function BettingSplitsDemo() {
  const [activeMarket, setActiveMarket] = useState<MarketKey>("spread");
  const [animate, setAnimate] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Trigger bar animation on mount and on tab switch
  useEffect(() => {
    setAnimate(false);
    const t = setTimeout(() => setAnimate(true), 30);
    return () => clearTimeout(t);
  }, [activeMarket]);

  // IntersectionObserver: trigger animation when scrolled into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setAnimate(true); },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const d = GAME_DATA[activeMarket];

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-white/10 overflow-hidden select-none"
      style={{
        background: "linear-gradient(145deg, #0d1117 0%, #0a0f1a 100%)",
        boxShadow: "0 0 40px rgba(57,255,20,0.04), 0 16px 48px rgba(0,0,0,0.6)",
      }}
    >
      {/* ── Game header ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/8"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        {/* Away team */}
        <div className="flex items-center gap-2.5 flex-1">
          <TeamLogo src={SEA_LOGO} alt="Seattle Mariners" size={32} />
          <div>
            <div className="text-[11px] text-[#6b7280] font-semibold tracking-wide uppercase leading-none">Seattle</div>
            <div className="text-[13px] font-bold text-white leading-tight">Mariners</div>
          </div>
        </div>
        {/* Game info */}
        <div className="flex flex-col items-center gap-0.5 px-3">
          <span className="text-[10px] text-[#6b7280] font-semibold tracking-widest uppercase">FINAL</span>
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-black text-white tabular-nums">0</span>
            <span className="text-[14px] text-[#4b5563] font-bold">–</span>
            <span className="text-[22px] font-black text-white tabular-nums">5</span>
          </div>
          <span className="text-[9px] text-[#4b5563] font-medium tracking-wide">MAY 23, 2026</span>
        </div>
        {/* Home team */}
        <div className="flex items-center gap-2.5 flex-1 justify-end">
          <div className="text-right">
            <div className="text-[11px] text-[#6b7280] font-semibold tracking-wide uppercase leading-none">Kansas City</div>
            <div className="text-[13px] font-bold text-white leading-tight">Royals</div>
          </div>
          <TeamLogo src={KC_LOGO} alt="Kansas City Royals" size={32} />
        </div>
      </div>

      {/* ── Market tab switcher ──────────────────────────────────────────────── */}
      <div
        className="flex border-b border-white/8"
        style={{ background: "rgba(0,0,0,0.2)" }}
      >
        {MARKET_TABS.map((tab) => {
          const isActive = tab.key === activeMarket;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveMarket(tab.key)}
              className="flex-1 py-2.5 text-[10px] font-bold tracking-widest uppercase transition-all duration-200 cursor-pointer"
              style={{
                color: isActive ? "#39FF14" : "#6b7280",
                borderBottom: isActive ? "2px solid #39FF14" : "2px solid transparent",
                background: isActive ? "rgba(57,255,20,0.04)" : "transparent",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Splits content ───────────────────────────────────────────────────── */}
      <div className="p-4 space-y-4">
        {/* Signal badge + sharp side */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span
            className="text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide"
            style={{
              background: `${d.signalColor}18`,
              color: d.signalColor,
              border: `1px solid ${d.signalColor}30`,
            }}
          >
            {d.signal}
          </span>
          {d.sharpSide && (
            <span className="text-[10px] text-[#9ca3af]">
              Sharp Action: <span className="font-bold text-white">{d.sharpSide}</span>
            </span>
          )}
        </div>

        {/* Odds row */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-lg p-3 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <TeamLogo src={SEA_LOGO} alt="SEA" size={20} />
              <span className="text-[11px] text-[#9ca3af] font-semibold">{d.awayLabel}</span>
            </div>
            <span
              className="text-[18px] font-black tabular-nums"
              style={{ color: d.awayOdds.startsWith("+") ? "#39FF14" : "#e5e7eb" }}
            >
              {d.awayOdds}
            </span>
          </div>
          <div
            className="rounded-lg p-3 text-center"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <TeamLogo src={KC_LOGO} alt="KC" size={20} />
              <span className="text-[11px] text-[#9ca3af] font-semibold">{d.homeLabel}</span>
            </div>
            <span
              className="text-[18px] font-black tabular-nums"
              style={{ color: d.homeOdds.startsWith("+") ? "#39FF14" : "#e5e7eb" }}
            >
              {d.homeOdds}
            </span>
          </div>
        </div>

        {/* Tickets row */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-[#6b7280] tracking-widest uppercase">TICKETS</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#9ca3af] w-10 shrink-0 font-semibold">SEA</span>
              <AnimatedBar pct={d.awayTickets} color="#9ca3af" animate={animate} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#9ca3af] w-10 shrink-0 font-semibold">KC</span>
              <AnimatedBar pct={d.homeTickets} color="#9ca3af" animate={animate} />
            </div>
          </div>
        </div>

        {/* Money row */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-[#6b7280] tracking-widest uppercase">MONEY</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#9ca3af] w-10 shrink-0 font-semibold">SEA</span>
              <AnimatedBar
                pct={d.awayMoney}
                color={d.awayMoney > d.homeMoney ? "#39FF14" : "#6b7280"}
                animate={animate}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#9ca3af] w-10 shrink-0 font-semibold">KC</span>
              <AnimatedBar
                pct={d.homeMoney}
                color={d.homeMoney > d.awayMoney ? "#39FF14" : "#6b7280"}
                animate={animate}
              />
            </div>
          </div>
        </div>

        {/* Footer: open/close line */}
        <div
          className="flex flex-wrap gap-4 pt-3 border-t text-[10px] text-[#6b7280]"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <span>Open: <span className="text-white font-semibold">{d.openLine}</span></span>
          <span>Close: <span className="text-white font-semibold">{d.closeLine}</span></span>
          <span className="ml-auto text-[#39FF14] font-semibold">⚾ MLB · DraftKings NJ</span>
        </div>
      </div>
    </div>
  );
}
