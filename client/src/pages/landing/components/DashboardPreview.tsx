/**
 * DashboardPreview.tsx
 *
 * Section 2 of the landing page (immediately after Hero).
 * Shows a visual mock of the dashboard to give visitors an immediate
 * product impression before they read any feature copy.
 *
 * Design: dark card with a mock game-card grid, odds columns, and
 * model projection indicators — all static/decorative, no real data.
 */

import { motion, useReducedMotion } from "framer-motion";

// ─── Mock data for the preview ─────────────────────────────────────────────────

const MOCK_GAMES = [
  {
    id: 1,
    sport: "MLB",
    status: "Today · 7:05 PM ET",
    away: { abbr: "NYY", name: "New York Yankees", score: null },
    home: { abbr: "BOS", name: "Boston Red Sox", score: null },
    dkLine: { away: -118, home: +100 },
    modelLine: { away: -131, home: +111 },
    total: { line: 9.0, ou: "O" },
    signal: { team: "NYY", pct: 8 },
    splits: { awayMoney: 62, homeMoney: 38 },
  },
  {
    id: 2,
    sport: "MLB",
    status: "Today · 7:10 PM ET",
    away: { abbr: "LAD", name: "Los Angeles Dodgers", score: null },
    home: { abbr: "CHC", name: "Chicago Cubs", score: null },
    dkLine: { away: -145, home: +123 },
    modelLine: { away: -158, home: +134 },
    total: { line: 8.5, ou: "U" },
    signal: { team: "LAD", pct: 6 },
    splits: { awayMoney: 71, homeMoney: 29 },
  },
  {
    id: 3,
    sport: "WC",
    status: "Today · 3:00 PM ET",
    away: { abbr: "BRA", name: "Brazil", score: null },
    home: { abbr: "ARG", name: "Argentina", score: null },
    dkLine: { away: +140, home: +195 },
    modelLine: { away: +128, home: +210 },
    total: { line: 2.5, ou: "O" },
    signal: { team: "BRA", pct: 5 },
    splits: { awayMoney: 55, homeMoney: 45 },
  },
];

function formatOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function SignalBadge({ pct, team }: { pct: number; team: string }) {
  const color = pct >= 7 ? "#39FF14" : pct >= 4 ? "#facc15" : "#9ca3af";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 7px",
        borderRadius: "999px",
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: "11px",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {team} +{pct}%
    </span>
  );
}

function MoneyBar({ away, home }: { away: number; home: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#6b7280" }}>
        <span>{away}%</span>
        <span>{home}%</span>
      </div>
      <div style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${away}%`,
            background: "linear-gradient(90deg, #39FF14, #22c55e)",
            borderRadius: "2px",
          }}
        />
      </div>
    </div>
  );
}

function GameRow({ game }: { game: (typeof MOCK_GAMES)[0] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto auto",
        alignItems: "center",
        gap: "clamp(8px, 2vw, 20px)",
        padding: "clamp(10px, 2vw, 14px) clamp(12px, 2.5vw, 20px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Teams */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
        <div style={{ fontSize: "10px", color: "#4b5563", fontWeight: 600, letterSpacing: "0.05em" }}>
          {game.sport} · {game.status}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "9px",
                fontWeight: 700,
                color: "#d1d5db",
                flexShrink: 0,
              }}
            >
              {game.away.abbr.slice(0, 2)}
            </span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#e5e7eb", whiteSpace: "nowrap" }}>
              {game.away.abbr}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "9px",
                fontWeight: 700,
                color: "#d1d5db",
                flexShrink: 0,
              }}
            >
              {game.home.abbr.slice(0, 2)}
            </span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#e5e7eb", whiteSpace: "nowrap" }}>
              {game.home.abbr}
            </span>
          </div>
        </div>
      </div>

      {/* DK Odds */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
        <div style={{ fontSize: "9px", color: "#4b5563", fontWeight: 600, letterSpacing: "0.05em", textAlign: "right" }}>
          DK ODDS
        </div>
        <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 600 }}>{formatOdds(game.dkLine.away)}</div>
        <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 600 }}>{formatOdds(game.dkLine.home)}</div>
      </div>

      {/* Model Odds */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
        <div style={{ fontSize: "9px", color: "#4b5563", fontWeight: 600, letterSpacing: "0.05em", textAlign: "right" }}>
          MODEL
        </div>
        <div style={{ fontSize: "12px", color: "#39FF14", fontWeight: 700 }}>{formatOdds(game.modelLine.away)}</div>
        <div style={{ fontSize: "12px", color: "#39FF14", fontWeight: 700 }}>{formatOdds(game.modelLine.home)}</div>
      </div>

      {/* Edge */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
        <div style={{ fontSize: "9px", color: "#4b5563", fontWeight: 600, letterSpacing: "0.05em" }}>SIGNAL</div>
        <SignalBadge pct={game.signal.pct} team={game.signal.team} />
      </div>

      {/* Money splits */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
        <div style={{ fontSize: "9px", color: "#4b5563", fontWeight: 600, letterSpacing: "0.05em" }}>SPLITS</div>
        <MoneyBar away={game.splits.awayMoney} home={game.splits.homeMoney} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPreview() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      style={{
        padding: "0 clamp(16px, 4vw, 64px) clamp(3rem, 6vw, 5rem)",
        background: "#050810",
      }}
    >
      <div className="max-w-screen-xl mx-auto">
        {/* Section label */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-6"
        >
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#39FF14",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            The Dashboard
          </p>
          <h2
            className="font-bold text-white"
            style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)", letterSpacing: "-0.03em" }}
          >
            Everything You Need. One Screen.
          </h2>
          <p className="text-[#6b7280] mt-2" style={{ fontSize: "clamp(0.85rem, 1.3vw, 1rem)", maxWidth: "48ch", margin: "8px auto 0" }}>
            Model odds, book odds, sharp money signals, and betting splits — side by side before every bet.
          </p>
        </motion.div>

        {/* Dashboard mock */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{
            borderRadius: "16px",
            border: "1px solid rgba(57,255,20,0.15)",
            background: "linear-gradient(145deg, rgba(10,14,22,0.98) 0%, rgba(5,8,16,1) 100%)",
            boxShadow: "0 0 80px rgba(57,255,20,0.06), 0 24px 64px rgba(0,0,0,0.6)",
            overflow: "hidden",
          }}
        >
          {/* Browser chrome bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              background: "rgba(255,255,255,0.03)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", gap: "5px" }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <div key={c} style={{ width: "10px", height: "10px", borderRadius: "50%", background: c }} />
              ))}
            </div>
            <div
              style={{
                flex: 1,
                height: "20px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                paddingLeft: "8px",
                maxWidth: "280px",
                margin: "0 auto",
              }}
            >
              <span style={{ fontSize: "10px", color: "#4b5563" }}>aisportsbettingmodels.com/feed</span>
            </div>
          </div>

          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              gap: "0",
              padding: "0 16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.01)",
              overflowX: "auto",
            }}
          >
            {["MLB", "World Cup 2026", "NBA"].map((tab, i) => (
              <div
                key={tab}
                style={{
                  padding: "10px 16px",
                  fontSize: "12px",
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? "#39FF14" : "#6b7280",
                  borderBottom: i === 0 ? "2px solid #39FF14" : "2px solid transparent",
                  whiteSpace: "nowrap",
                  cursor: "default",
                }}
              >
                {tab}
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto auto",
              gap: "clamp(8px, 2vw, 20px)",
              padding: "8px clamp(12px, 2.5vw, 20px)",
              background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {["MATCHUP", "DK ODDS", "MODEL", "SIGNAL", "SPLITS"].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  color: "#374151",
                  letterSpacing: "0.1em",
                  textAlign: h === "MATCHUP" ? "left" : "right",
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Game rows */}
          <div>
            {MOCK_GAMES.map((game) => (
              <GameRow key={game.id} game={game} />
            ))}
          </div>

          {/* Footer bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px clamp(12px, 2.5vw, 20px)",
              background: "rgba(255,255,255,0.02)",
              borderTop: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <span style={{ fontSize: "10px", color: "#374151" }}>
              Showing 3 of 14 games today
            </span>
            <span
              style={{
                fontSize: "10px",
                color: "#39FF14",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#39FF14",
                  display: "inline-block",
                  boxShadow: "0 0 4px #39FF14",
                }}
              />
              Live data · Updated 2 min ago
            </span>
          </div>
        </motion.div>

        {/* Callout below preview */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-wrap justify-center gap-6 mt-8"
        >
          {[
            { label: "AI Model Projections", desc: "Dixon-Coles Poisson + Monte Carlo" },
            { label: "Sharp Market Signals", desc: "No-vig fair odds vs. book price" },
            { label: "Betting Splits", desc: "Public money % and ticket count" },
          ].map(({ label, desc }) => (
            <div key={label} className="flex items-start gap-3 text-left" style={{ maxWidth: "220px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#39FF14",
                  marginTop: "6px",
                  flexShrink: 0,
                  boxShadow: "0 0 6px rgba(57,255,20,0.5)",
                }}
              />
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#e5e7eb" }}>{label}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{desc}</div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
