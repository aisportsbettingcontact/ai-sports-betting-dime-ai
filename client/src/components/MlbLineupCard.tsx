/**
 * MlbLineupCard
 *
 * Displays a single MLB game's confirmed starting lineups, pitchers, and weather.
 *
 * Layout: ALWAYS side-by-side (Away | Home) on ALL screen sizes.
 *
 * Mobile compact row design (pixel-verified for iPhone SE 375px):
 *   Each column = ~167px. Row layout:
 *   [num:12px] [gap:4px] [avatar:28px] [gap:4px] → flex-col:
 *     Line 1: [name: ~119px budget at 11px bold — fits "Giancarlo Stanton" (17 chars)]
 *     Line 2: [pos badge] [bats indicator]
 *
 * Desktop row design (≥640px):
 *   [num] [avatar:36px] [pos] [name] [bats] — single line, larger font
 *
 * Photo: transparent-background PNG via Cloudinary e_background_removal,f_png.
 * Rounded bottom corners on avatar images for a polished cutout look.
 */

import { useState, useEffect, useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { trpc } from "@/lib/trpc";
import { teamLogoGradient } from "@/lib/teamLogoCircle";

// Types matching the DB schema
export interface LineupPlayer {
  battingOrder: number;
  position: string;
  name: string;
  bats: string; // 'R' | 'L' | 'S'
  rotowireId: number | null;
  mlbamId: number | null;
}

export interface MlbLineupRow {
  id: number;
  gameId: number;
  scrapedAt: number;
  awayPitcherName: string | null;
  awayPitcherHand: string | null;
  awayPitcherEra: string | null;
  awayPitcherRotowireId: number | null;
  awayPitcherMlbamId: number | null;
  awayPitcherConfirmed: boolean | null;
  homePitcherName: string | null;
  homePitcherHand: string | null;
  homePitcherEra: string | null;
  homePitcherRotowireId: number | null;
  homePitcherMlbamId: number | null;
  homePitcherConfirmed: boolean | null;
  awayLineup: string | null;
  homeLineup: string | null;
  awayLineupConfirmed: boolean | null;
  homeLineupConfirmed: boolean | null;
  weatherIcon: string | null;
  weatherTemp: string | null;
  weatherWind: string | null;
  weatherPrecip: number | null;
  weatherDome: boolean | null;
  umpire: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── MLB headshot CDN ──────────────────────────────────────────────────────────
// e_background_removal removes the gray studio background (Cloudinary AI).
// f_png forces PNG output so the alpha channel is preserved.
// d_ fallback uses the generic headshot if the player-specific one is missing.
const mlbPhoto = (id: number | null | undefined): string | null => {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
};

// ─── Types ─────────────────────────────────────────────────────────────────────
interface MlbLineupCardProps {
  awayTeam: string;   // abbreviation e.g. "NYY"
  homeTeam: string;   // abbreviation e.g. "SF"
  startTime: string;  // e.g. "7:05 PM ET"
  lineup: MlbLineupRow | null | undefined;
}

// ─── useIsMobile hook ──────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ─── PlayerAvatar ──────────────────────────────────────────────────────────────
// No circle container — display the raw MLB headshot PNG with transparent bg.
// Bottom corners are rounded to give a natural cutout look.
function PlayerAvatar({ mlbamId, size }: { mlbamId: number | null | undefined; size: number }) {
  const url = mlbPhoto(mlbamId);
  if (!url) {
    return (
      <div
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          background: "transparent",
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "block",
        objectFit: "contain",
        borderRadius: `0 0 ${Math.round(size * 0.35)}px ${Math.round(size * 0.35)}px`,
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

// ─── PitcherSection ────────────────────────────────────────────────────────────
// Compact on mobile, full on desktop
function PitcherSection({
  name,
  hand,
  era,
  mlbamId,
  confirmed,
  isMobile,
}: {
  name: string | null | undefined;
  hand: string | null | undefined;
  era: string | null | undefined;
  mlbamId: number | null | undefined;
  confirmed: boolean | null | undefined;
  isMobile: boolean;
}) {
  const displayName = name ?? "TBD";
  const displayEra = era ?? "—";

  if (isMobile) {
    // Compact mobile pitcher: avatar + name stacked
    return (
      <div
        style={{
          padding: "8px 8px 6px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <div
          style={{
            fontSize: 7,
            fontWeight: 600,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "#FFFFFF",
            marginBottom: 5,
          }}
        >
          Starting Pitcher
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <PlayerAvatar mlbamId={mlbamId} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: 12,
                fontWeight: 800,
                color: "#FFFFFF",
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              {displayEra}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 3 }}>
              {hand && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    padding: "1px 4px",
                    borderRadius: 2,
                    background: "#101820",
                    color: "#FFFFFF",
                    border: "1px solid #182433",
                  }}
                >
                  {hand}HP
                </span>
              )}
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                  color: confirmed ? "#39FF14" : "#FFFF33",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: confirmed ? "#39FF14" : "#FFFF33",
                    display: "inline-block",
                  }}
                />
                {confirmed ? "Conf" : "Expected"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop pitcher
  return (
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "#FFFFFF",
          marginBottom: 5,
        }}
      >
        Starting Pitcher
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PlayerAvatar mlbamId={mlbamId} size={44} />
        <div style={{ textAlign: "left" }}>
          <div
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: 16,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.1,
            }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
            {displayEra}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 5 }}>
            {hand && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "#101820",
                  color: "#FFFFFF",
                  border: "1px solid #182433",
                  display: "inline-block",
                }}
              >
                {hand}HP
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: confirmed ? "#39FF14" : "#FFFF33",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: confirmed ? "#39FF14" : "#FFFF33",
                  display: "inline-block",
                }}
              />
              {confirmed ? "Confirmed" : "Expected"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BattingOrderHeader ───────────────────────────────────────────────────────
function BattingOrderHeader({ confirmed, isMobile }: { confirmed: boolean | null | undefined; isMobile: boolean }) {
  const isConfirmed = confirmed === true;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: isMobile ? "5px 8px 3px" : "7px 12px 4px",
        borderBottom: "1px solid rgba(24,36,51,0.6)",
      }}
    >
      <span
        style={{
          fontSize: isMobile ? 7 : 8,
          fontWeight: 700,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        Batting Order
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: isMobile ? 7 : 8,
          fontWeight: 600,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          color: isConfirmed ? "#39FF14" : "#FFFF33",
        }}
      >
        <span
          style={{
            width: isMobile ? 4 : 5,
            height: isMobile ? 4 : 5,
            borderRadius: "50%",
            background: isConfirmed ? "#39FF14" : "#FFFF33",
            display: "inline-block",
          }}
        />
        {isConfirmed ? "Confirmed" : "Expected"}
      </span>
    </div>
  );
}

// ─── LineupRows ────────────────────────────────────────────────────────────────
// isMobile=true: two-line compact rows (name on top, pos+bats below)
// isMobile=false: single-line full rows
function LineupRows({ players, isMobile }: { players: LineupPlayer[]; isMobile: boolean }) {
  if (players.length === 0) {
    return (
      <div
        style={{
          padding: "10px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 60,
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "#FFFFFF",
            fontWeight: 600,
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          Lineup Pending
        </span>
      </div>
    );
  }

  if (isMobile) {
    // MOBILE: Two-line compact rows
    return (
      <div style={{ padding: "4px 6px" }}>
        {players.map((p, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: "5px 0",
              borderBottom: i < players.length - 1 ? "1px solid rgba(24,36,51,0.5)" : "none",
            }}
          >
            {/* Batting order number */}
            <span
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: 10,
                fontWeight: 700,
                color: "#FFFFFF",
                width: 11,
                flexShrink: 0,
                textAlign: "right",
              }}
            >
              {p.battingOrder}
            </span>

            {/* Player headshot — 36px on mobile */}
            <PlayerAvatar mlbamId={p.mlbamId} size={36} />

            {/* Two-line text column */}
            <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
              {/* Line 1: Player name */}
              <div
                style={{
                  fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#FFFFFF",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.2,
                }}
              >
                {p.name}
              </div>
              {/* Line 2: Position pill + Bats indicator */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 2,
                }}
              >
                {/* Position pill */}
                <span
                  style={{
                    fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    color: "#7EB8D4",
                    background: "rgba(30,60,90,0.6)",
                    padding: "1px 4px",
                    borderRadius: 3,
                    border: "1px solid rgba(30,80,120,0.4)",
                    lineHeight: 1.4,
                  }}
                >
                  {p.position}
                </span>
                {/* Handedness indicator — white for all */}
                <span
                  style={{
                    fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#FFFFFF",
                    letterSpacing: "0.5px",
                  }}
                >
                  {p.bats}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // DESKTOP: Single-line full rows
  return (
    <div style={{ padding: "8px 14px" }}>
      {players.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 0",
            borderBottom: i < players.length - 1 ? "1px solid rgba(24,36,51,0.6)" : "none",
          }}
        >
          {/* Batting order number */}
          <span
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              color: "#FFFFFF",
              width: 14,
              flexShrink: 0,
              textAlign: "right",
            }}
          >
            {p.battingOrder}
          </span>

          {/* Player headshot */}
          <PlayerAvatar mlbamId={p.mlbamId} size={36} />

          {/* Position badge — styled pill */}
          <span
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "#7EB8D4",
              background: "rgba(30,60,90,0.6)",
              padding: "2px 5px",
              borderRadius: 3,
              border: "1px solid rgba(30,80,120,0.4)",
              flexShrink: 0,
              textAlign: "center",
              minWidth: 28,
            }}
          >
            {p.position}
          </span>

          {/* Player name */}
          <span
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: 14,
              fontWeight: 800,
              color: "#FFFFFF",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            {p.name}
          </span>

          {/* Bats indicator — white */}
          <span
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: 12,
              fontWeight: 800,
              color: "#FFFFFF",
              flexShrink: 0,
              width: 12,
              textAlign: "right",
              letterSpacing: "0.5px",
            }}
          >
            {p.bats}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── WeatherStrip ──────────────────────────────────────────────────────────────
function WeatherStrip({ lineup }: { lineup: MlbLineupRow }) {
  const { weatherIcon, weatherTemp, weatherWind, weatherPrecip, weatherDome } = lineup;

  if (weatherDome) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 18px",
          background: "#0C1219",
        }}
      >
        <span style={{ fontSize: 16 }}>🏟️</span>
        <span
          style={{
            fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Dome
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Indoor stadium</span>
      </div>
    );
  }

  if (!weatherTemp && !weatherWind && weatherPrecip == null) return null;

  const precipColor =
    weatherPrecip == null
      ? "#FFFFFF"
      : weatherPrecip === 0
      ? "#39FF14"
      : weatherPrecip < 30
      ? "#FFCC00"
      : "#FF2D55";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: "10px 18px",
        background: "#0C1219",
      }}
    >
      {(weatherIcon || weatherTemp || weatherWind) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {weatherIcon && <span style={{ fontSize: 20, lineHeight: 1 }}>{weatherIcon}</span>}
          <div>
            {weatherTemp && (
              <div
                style={{
                  fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#FFFFFF",
                }}
              >
                {weatherTemp}
              </div>
            )}
            {weatherWind && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                {weatherWind}
              </div>
            )}
          </div>
        </div>
      )}
      {weatherPrecip != null && (
        <>
          <div style={{ width: 1, height: 28, background: "#1E3048" }} />
          <div>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "center",
                color: precipColor,
              }}
            >
              {weatherPrecip}%
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "1px",
                textTransform: "uppercase",
                marginTop: 1,
                textAlign: "center",
              }}
            >
              Precip
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── EnvSignalsStrip ──────────────────────────────────────────────────────────
// Displays park factor, bullpen ERA/FIP, and umpire K/BB modifiers.
// Fetches data via trpc.games.mlbEnvSignals — renders nothing if all nulls.
function EnvSignalsStrip({
  awayTeam,
  homeTeam,
  umpireName,
}: {
  awayTeam: string;
  homeTeam: string;
  umpireName: string | null | undefined;
}) {
  const { data } = trpc.games.mlbEnvSignals.useQuery(
    { homeTeam, awayTeam, umpireName: umpireName ?? null },
    { staleTime: 5 * 60 * 1000, retry: false }
  );

  if (!data) return null;
  const { parkFactor, awayBullpen, homeBullpen, umpire } = data;
  if (!parkFactor && !awayBullpen && !homeBullpen && !umpire) return null;

  // Park factor color: >1.05 = hitter park (red), <0.95 = pitcher park (green), else neutral
  const pf = parkFactor?.parkFactor3yr ?? null;
  const pfColor = pf == null ? '#888' : pf > 1.05 ? '#FF5C5C' : pf < 0.95 ? '#39FF14' : '#FFCC00';
  const pfLabel = pf == null ? '—' : pf.toFixed(3);
  const pfTag = pf == null ? '' : pf > 1.05 ? 'HITTER' : pf < 0.95 ? 'PITCHER' : 'NEUTRAL';

  // Umpire modifier arrows
  const kMod = umpire?.kModifier ?? null;
  const bbMod = umpire?.bbModifier ?? null;
  const kArrow = kMod == null ? '' : kMod > 1.05 ? ' ▲' : kMod < 0.95 ? ' ▼' : ' ─';
  const bbArrow = bbMod == null ? '' : bbMod > 1.05 ? ' ▲' : bbMod < 0.95 ? ' ▼' : ' ─';
  const kColor = kMod == null ? '#888' : kMod > 1.05 ? '#FF5C5C' : kMod < 0.95 ? '#39FF14' : '#FFCC00';
  const bbColor = bbMod == null ? '#888' : bbMod > 1.05 ? '#FF5C5C' : bbMod < 0.95 ? '#39FF14' : '#FFCC00';

  const cell = (label: string, value: string, color: string, sub?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif", fontSize: 13, fontWeight: 700, color }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>{sub}</div>}
      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 1 }}>
        {label}
      </div>
    </div>
  );

  const divider = <div style={{ width: 1, height: 32, background: '#1E3048', flexShrink: 0 }} />;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 16,
        padding: '10px 18px',
        background: '#080C12',
        borderTop: '1px solid #182433',
      }}
    >
      {/* Park Factor */}
      {pf != null && (
        <>
          {cell(`${parkFactor?.venueName?.split(' ').slice(-2).join(' ') ?? 'PARK'} PF`, pfLabel, pfColor, pfTag)}
          {(awayBullpen || homeBullpen || umpire) && divider}
        </>
      )}

      {/* Away Bullpen */}
      {awayBullpen?.eraBullpen != null && (
        <>
          {cell(`${awayTeam} BULL ERA`, awayBullpen.eraBullpen.toFixed(2), '#A0C4FF')}
          {divider}
          {cell(`${awayTeam} BULL FIP`, (awayBullpen.fipBullpen ?? 0).toFixed(2), '#A0C4FF')}
          {(homeBullpen || umpire) && divider}
        </>
      )}

      {/* Home Bullpen */}
      {homeBullpen?.eraBullpen != null && (
        <>
          {cell(`${homeTeam} BULL ERA`, homeBullpen.eraBullpen.toFixed(2), '#FFD580')}
          {divider}
          {cell(`${homeTeam} BULL FIP`, (homeBullpen.fipBullpen ?? 0).toFixed(2), '#FFD580')}
          {umpire && divider}
        </>
      )}

      {/* Umpire */}
      {umpire && (
        <>
          {cell('HP UMP K-MOD', `${(kMod ?? 1).toFixed(3)}${kArrow}`, kColor, umpire.umpireName.split(' ').pop())}
          {divider}
          {cell('HP UMP BB-MOD', `${(bbMod ?? 1).toFixed(3)}${bbArrow}`, bbColor)}
        </>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function MlbLineupCard({ awayTeam, homeTeam, startTime, lineup }: MlbLineupCardProps) {
  const isMobile = useIsMobile(640);

  const awayInfo = MLB_BY_ABBREV.get(awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(homeTeam);

  // Debug: log team resolution on mount (dev only — gated to prevent production noise)
  if (process.env.NODE_ENV === 'development' && typeof window !== "undefined") {
    if (awayInfo) {
      console.log(`[MlbLineupCard] AWAY ${awayTeam} → mlbId=${awayInfo.mlbId} logo=${awayInfo.logoUrl} primary=${awayInfo.primaryColor}`);
    } else {
      console.warn(`[MlbLineupCard] AWAY ${awayTeam} → NOT FOUND in MLB_BY_ABBREV`);
    }
    if (homeInfo) {
      console.log(`[MlbLineupCard] HOME ${homeTeam} → mlbId=${homeInfo.mlbId} logo=${homeInfo.logoUrl} primary=${homeInfo.primaryColor}`);
    } else {
      console.warn(`[MlbLineupCard] HOME ${homeTeam} → NOT FOUND in MLB_BY_ABBREV`);
    }
  }

  // [STEP] Compute logo circle gradients using exact Discord /lineups algorithm (pickLogoBg + darkShade)
  const awayLogoGradient = teamLogoGradient(
    awayInfo?.primaryColor ?? "#444",
    awayInfo?.secondaryColor,
    (awayInfo as any)?.tertiaryColor
  );
  const homeLogoGradient = teamLogoGradient(
    homeInfo?.primaryColor ?? "#444",
    homeInfo?.secondaryColor,
    (homeInfo as any)?.tertiaryColor
  );
  // Keep awayColor/homeColor for gradient top bar and pill accents (unchanged)
  const awayColor = awayInfo?.primaryColor ?? "#444";
  const awayDark = awayInfo?.secondaryColor ?? "#222";
  const homeColor = homeInfo?.primaryColor ?? "#444";
  const homeDark = homeInfo?.secondaryColor ?? "#222";

  const awayLineup = useMemo((): LineupPlayer[] => {
    if (!lineup?.awayLineup) return [];
    try { return JSON.parse(lineup.awayLineup) as LineupPlayer[]; } catch { return []; }
  }, [lineup?.awayLineup]);

  const homeLineup = useMemo((): LineupPlayer[] => {
    if (!lineup?.homeLineup) return [];
    try { return JSON.parse(lineup.homeLineup) as LineupPlayer[]; } catch { return []; }
  }, [lineup?.homeLineup]);

  const awayCity = awayInfo?.city ?? awayTeam;
  const awayNickname = awayInfo?.nickname ?? awayTeam;
  const homeCity = homeInfo?.city ?? homeTeam;
  const homeNickname = homeInfo?.nickname ?? homeTeam;

  return (
    <div
      style={{
        background: "#090E14",
        borderRadius: 12,
        border: "1px solid #182433",
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      {/* Color top bar */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${awayColor} 48%, ${homeColor} 52%)`,
        }}
      />

      {/* ── Matchup header — always side-by-side ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: isMobile ? "8px 10px 6px" : "14px 18px 12px",
          borderBottom: "1px solid #182433",
          gap: isMobile ? 6 : 10,
        }}
      >
        {/* Away team — left-aligned */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 12 }}>
          <div
            style={{
              width: isMobile ? 28 : 42,
              height: isMobile ? 28 : 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: awayLogoGradient,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <img
              src={awayInfo?.logoUrl}
              alt={awayTeam}
              style={{
                width: isMobile ? Math.round(28 * 0.65) : Math.round(42 * 0.65),
                height: isMobile ? Math.round(28 * 0.65) : Math.round(42 * 0.65),
                objectFit: "contain",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: isMobile ? 11 : 13,
                fontWeight: 900,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                lineHeight: 1.1,
              }}
            >
              {awayCity}
            </div>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: isMobile ? 9 : 11,
                fontWeight: 400,
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.5px",
                marginTop: 1,
              }}
            >
              {awayNickname}
            </div>
            <div
              style={{
                fontSize: isMobile ? 7 : 8,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                padding: isMobile ? "1px 4px" : "1px 6px",
                borderRadius: 3,
                marginTop: isMobile ? 2 : 4,
                display: "inline-block",
                background: `${awayColor}22`,
                color: "#FFFFFF",
                border: `1px solid ${awayColor}44`,
              }}
            >
              Away
            </div>
          </div>
        </div>

        {/* Center: time + @ */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: isMobile ? 10 : 12,
              fontWeight: 700,
              color: "#FFFFFF",
              letterSpacing: "1px",
              whiteSpace: "nowrap",
            }}
          >
            {startTime}
          </div>
          <div
            style={{
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              fontSize: isMobile ? 9 : 10,
              color: "#FFFFFF",
              letterSpacing: "3px",
              marginTop: 3,
            }}
          >
            @
          </div>
        </div>

        {/* Home team — right-aligned */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 12, flexDirection: "row-reverse" }}>
          <div
            style={{
              width: isMobile ? 28 : 42,
              height: isMobile ? 28 : 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: homeLogoGradient,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <img
              src={homeInfo?.logoUrl}
              alt={homeTeam}
              style={{
                width: isMobile ? Math.round(28 * 0.65) : Math.round(42 * 0.65),
                height: isMobile ? Math.round(28 * 0.65) : Math.round(42 * 0.65),
                objectFit: "contain",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: isMobile ? 11 : 13,
                fontWeight: 900,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                lineHeight: 1.1,
              }}
            >
              {homeCity}
            </div>
            <div
              style={{
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                fontSize: isMobile ? 9 : 11,
                fontWeight: 400,
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.5px",
                marginTop: 1,
              }}
            >
              {homeNickname}
            </div>
            <div
              style={{
                fontSize: isMobile ? 7 : 8,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                padding: isMobile ? "1px 4px" : "1px 6px",
                borderRadius: 3,
                marginTop: isMobile ? 2 : 4,
                display: "inline-block",
                background: `${homeColor}22`,
                color: "#FFFFFF",
                border: `1px solid ${homeColor}44`,
              }}
            >
              Home
            </div>
          </div>
        </div>
      </div>

      {/* ── Pitchers — always side-by-side ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          borderBottom: "1px solid #182433",
        }}
      >
        <PitcherSection
          name={lineup?.awayPitcherName}
          hand={lineup?.awayPitcherHand}
          era={lineup?.awayPitcherEra}
          mlbamId={lineup?.awayPitcherMlbamId}
          confirmed={lineup?.awayPitcherConfirmed}
          isMobile={isMobile}
        />
        <div style={{ background: "#182433" }} />
        <PitcherSection
          name={lineup?.homePitcherName}
          hand={lineup?.homePitcherHand}
          era={lineup?.homePitcherEra}
          mlbamId={lineup?.homePitcherMlbamId}
          confirmed={lineup?.homePitcherConfirmed}
          isMobile={isMobile}
        />
      </div>

      {/* ── Batting lineups — always side-by-side ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          borderBottom: "1px solid #182433",
        }}
      >
        <div>
          <BattingOrderHeader confirmed={lineup?.awayLineupConfirmed} isMobile={isMobile} />
          <LineupRows players={awayLineup} isMobile={isMobile} />
        </div>
        <div style={{ background: "#182433" }} />
        <div>
          <BattingOrderHeader confirmed={lineup?.homeLineupConfirmed} isMobile={isMobile} />
          <LineupRows players={homeLineup} isMobile={isMobile} />
        </div>
      </div>

      {/* Weather */}
      {lineup && <WeatherStrip lineup={lineup} />}

      {/* Environment Signals: park factor, bullpen ERA/FIP, umpire K/BB modifiers */}
      <EnvSignalsStrip
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        umpireName={lineup?.umpire ?? null}
      />
    </div>
  );
}
