/**
 * BettingSplitsDemo.tsx — Mobile-exact replica of real BettingSplitsPanel SPLITS tab.
 * Data: SEA @ KC, May 23 2026.
 * NO final score shown.
 */
import { useState, useRef, useEffect } from "react";

const SEA_LOGO = "https://www.mlbstatic.com/team-logos/136.svg";
const KC_LOGO  = "https://www.mlbstatic.com/team-logos/118.svg";
const SEA_COLOR = "#005C5C";
const KC_COLOR  = "#004687";
const LOGO_FILTER = "brightness(1.7) contrast(1.08) saturate(1.35) drop-shadow(0 0 4px rgba(255,255,255,0.28))";
const LABEL_STROKE = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.8)";

const MOBILE_AWAY_LABEL_STYLE: React.CSSProperties = { fontSize: 10, color: "#ffffff", fontWeight: 800, letterSpacing: "0.04em", lineHeight: 1, whiteSpace: "nowrap", display: "block", textAlign: "left", textShadow: LABEL_STROKE };
const MOBILE_HOME_LABEL_STYLE: React.CSSProperties = { fontSize: 10, color: "#ffffff", fontWeight: 800, letterSpacing: "0.04em", lineHeight: 1, whiteSpace: "nowrap", display: "block", textAlign: "right", textShadow: LABEL_STROKE };
const MOBILE_FULL_LABEL_STYLE: React.CSSProperties = { fontSize: 10, color: "#ffffff", fontWeight: 800, letterSpacing: "0.04em", lineHeight: 1, whiteSpace: "nowrap", display: "block", textAlign: "center", textShadow: LABEL_STROKE };

function mobileSegMinPx(pct: number): number { return pct < 10 ? 40 : 30; }

interface LabeledBarProps {
  awayPct: number | null; homePct: number | null;
  awayColor: string; homeColor: string;
  awayLineLabel: string; homeLineLabel: string; rowLabel: string;
}
function LabeledBar({ awayPct, homePct, awayColor, homeColor, awayLineLabel, homeLineLabel, rowLabel }: LabeledBarProps) {
  const hasData = awayPct != null && homePct != null;
  if (!hasData) return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 2, paddingRight: 2 }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>{awayLineLabel}</span>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{rowLabel}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>{homeLineLabel}</span>
      </div>
      <div style={{ width: "100%", height: 20, borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>|</span>
      </div>
    </div>
  );
  const away = awayPct ?? 0; const home = homePct ?? 0;
  const isAwayFull = away >= 100; const isHomeFull = home >= 100;
  const awaySegStyle: React.CSSProperties = isAwayFull
    ? { flex: 1, background: awayColor, borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0 4px", overflow: "hidden" }
    : isHomeFull ? { display: "none" }
    : away > 0 ? { flexGrow: away, flexShrink: 1, flexBasis: 0, minWidth: mobileSegMinPx(away), background: awayColor, borderRadius: "4px 0 0 4px", display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0 5px", overflow: "hidden" }
    : { display: "none" };
  const homeSegStyle: React.CSSProperties = isHomeFull
    ? { flex: 1, background: homeColor, borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 5px", overflow: "hidden" }
    : isAwayFull ? { display: "none" }
    : home > 0 ? { flexGrow: home, flexShrink: 1, flexBasis: 0, minWidth: mobileSegMinPx(home), background: homeColor, borderRadius: "0 4px 4px 0", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 5px", overflow: "hidden" }
    : { display: "none" };
  const showDivider = !isAwayFull && !isHomeFull && away > 0 && home > 0;
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 2, paddingRight: 2 }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 700, letterSpacing: "0.03em" }}>{awayLineLabel}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.85)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em" }}>{rowLabel}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 700, letterSpacing: "0.03em" }}>{homeLineLabel}</span>
      </div>
      <div style={{ height: 20, minWidth: 0, display: "flex", flexDirection: "row", borderRadius: 4, border: "1px solid rgba(255,255,255,0.12)", boxSizing: "border-box" }}>
        {away > 0 && !isAwayFull && !isHomeFull && <div style={awaySegStyle} className="transition-all duration-700"><span style={MOBILE_AWAY_LABEL_STYLE}>{away}%</span></div>}
        {showDivider && <div style={{ width: 1, background: "rgba(255,255,255,0.25)", flexShrink: 0, alignSelf: "stretch" }} />}
        {home > 0 && !isHomeFull && !isAwayFull && <div style={homeSegStyle} className="transition-all duration-700"><span style={MOBILE_HOME_LABEL_STYLE}>{home}%</span></div>}
        {isAwayFull && !isHomeFull && <div style={{ flex: 1, background: awayColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4 }} className="transition-all duration-700"><span style={MOBILE_FULL_LABEL_STYLE}>100%</span></div>}
        {isHomeFull && !isAwayFull && <div style={{ flex: 1, background: homeColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4 }} className="transition-all duration-700"><span style={MOBILE_FULL_LABEL_STYLE}>100%</span></div>}
        {isAwayFull && isHomeFull && (<><div style={{ flex: 1, background: awayColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px 0 0 4px" }}><span style={MOBILE_FULL_LABEL_STYLE}>100%</span></div><div style={{ flex: 1, background: homeColor, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0 4px 4px 0" }}><span style={MOBILE_FULL_LABEL_STYLE}>100%</span></div></>)}
      </div>
    </div>
  );
}

interface CompactMarketRowProps {
  ticketsPct: number | null; handlePct: number | null;
  awayColor: string; homeColor: string;
  awayLineLabel: string; homeLineLabel: string;
}
function CompactMarketRow({ ticketsPct, handlePct, awayColor, homeColor, awayLineLabel, homeLineLabel }: CompactMarketRowProps) {
  const bothZero = ticketsPct === 0 && handlePct === 0;
  const effectiveTickets = bothZero ? null : ticketsPct;
  const effectiveHandle  = bothZero ? null : handlePct;
  if (effectiveTickets == null && effectiveHandle == null) return null;
  const awayTickets = effectiveTickets != null ? effectiveTickets : null;
  const homeTickets = effectiveTickets != null ? 100 - effectiveTickets : null;
  const awayHandle  = effectiveHandle  != null ? effectiveHandle  : null;
  const homeHandle  = effectiveHandle  != null ? 100 - effectiveHandle  : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", padding: "2px 8px 4px 8px", gap: 6 }}>
      <LabeledBar awayPct={awayTickets} homePct={homeTickets} awayColor={awayColor} homeColor={homeColor} awayLineLabel={awayLineLabel} homeLineLabel={homeLineLabel} rowLabel="Tickets" />
      <LabeledBar awayPct={awayHandle} homePct={homeHandle} awayColor={awayColor} homeColor={homeColor} awayLineLabel={awayLineLabel} homeLineLabel={homeLineLabel} rowLabel="Money" />
    </div>
  );
}

type MobileMarket = "spread" | "total" | "ml";

function TeamLogo({ src, alt, size }: { src: string; alt: string; size: number }) {
  return <img src={src} alt={alt} width={size} height={size} style={{ width: size, height: size, objectFit: "contain", filter: LOGO_FILTER, mixBlendMode: "screen", flexShrink: 0 }} loading="lazy" decoding="async" />;
}

export default function BettingSplitsDemo() {
  const [activeMarket, setActiveMarket] = useState<MobileMarket>("spread");
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spreadTickets = visible ? 51 : null;
  const spreadMoney   = visible ? 73 : null;
  const totalTickets  = visible ? 52 : null;
  const totalMoney    = visible ? 47 : null;
  const mlTickets     = visible ? 55 : null;
  const mlMoney       = visible ? 67 : null;

  return (
    <div ref={containerRef} style={{ background: "linear-gradient(145deg, #0d1117 0%, #0a0f1a 100%)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden", width: "100%", boxShadow: "0 0 40px rgba(57,255,20,0.04), 0 16px 48px rgba(0,0,0,0.6)" }}>
      {/* Game header */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <TeamLogo src={SEA_LOGO} alt="SEA" size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1 }}>Seattle</div>
            <div style={{ fontSize: 12, color: "#ffffff", fontWeight: 700, lineHeight: 1.2 }}>Mariners</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, justifyContent: "flex-end", flexDirection: "row-reverse" }}>
          <TeamLogo src={KC_LOGO} alt="KC" size={28} />
          <div style={{ minWidth: 0, textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1 }}>Kansas City</div>
            <div style={{ fontSize: 12, color: "#ffffff", fontWeight: 700, lineHeight: 1.2 }}>Royals</div>
          </div>
        </div>
      </div>
      {/* SPLITS tab indicator */}
      <div style={{ display: "flex", alignItems: "center", padding: "4px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)", gap: 6 }}>
        <span style={{ fontSize: 9, color: "#39FF14", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>SPLITS</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>
      {/* Mobile layout */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%", padding: "4px 0" }}>
        {/* 3-way toggle */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 8px 4px 8px", gap: 4 }}>
          {(["spread", "total", "ml"] as MobileMarket[]).map((m) => {
            const label = m === "spread" ? "SPREAD" : m === "total" ? "TOTAL" : "MONEYLINE";
            const isActive = m === activeMarket;
            return (
              <button type="button" key={m} onClick={() => setActiveMarket(m)} style={{ flex: 1, padding: "3px 0", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 4, border: isActive ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)", background: isActive ? "rgba(255,255,255,0.12)" : "transparent", color: isActive ? "#ffffff" : "rgba(255,255,255,0.4)", cursor: "pointer", transition: "all 0.15s ease" }}>
                {label}
              </button>
            );
          })}
        </div>
        {activeMarket === "spread" && <CompactMarketRow ticketsPct={spreadTickets} handlePct={spreadMoney} awayColor={SEA_COLOR} homeColor={KC_COLOR} awayLineLabel="SEA (-1.5)" homeLineLabel="KC (+1.5)" />}
        {activeMarket === "total"  && <CompactMarketRow ticketsPct={totalTickets}  handlePct={totalMoney}  awayColor={SEA_COLOR} homeColor={KC_COLOR} awayLineLabel="OVER 8.5"  homeLineLabel="UNDER 8.5" />}
        {activeMarket === "ml"     && <CompactMarketRow ticketsPct={mlTickets}     handlePct={mlMoney}     awayColor={SEA_COLOR} homeColor={KC_COLOR} awayLineLabel="SEA (-130)" homeLineLabel="KC (+109)" />}
      </div>
    </div>
  );
}
