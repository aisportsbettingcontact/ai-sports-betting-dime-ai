import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { MOCK_MARKET_ROWS } from "../lib/mock-data";

// ── Live update badge ─────────────────────────────────────────────────────────
function LiveBadge({ seconds }: { seconds: number }) {
  const shouldReduce = useReducedMotion();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#9ca3af] font-mono tabular-nums">
      <span
        className="w-1.5 h-1.5 rounded-full bg-[#39FF14]"
        style={
          shouldReduce
            ? {}
            : { animation: "pulse-green 2s ease-in-out infinite" }
        }
      />
      Updated {seconds}s ago
    </span>
  );
}

// ── ROI / Edge badge ──────────────────────────────────────────────────────────
function RoiBadge({ roi }: { roi: number | null }) {
  if (roi === null)
    return (
      <span className="text-[11px] font-semibold text-[#6b7280] tracking-wide">
        NO EDGE
      </span>
    );
  return (
    <span
      className="text-[11px] font-bold tabular-nums"
      style={{ color: "#39FF14" }}
    >
      +{roi.toFixed(1)}% ROI
    </span>
  );
}

// ── Single market cell ────────────────────────────────────────────────────────
function MarketCell({
  label,
  book,
  model,
  roi,
}: {
  label: string;
  book: string;
  model: string;
  roi: number | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[110px]">
      <span className="text-[10px] font-bold text-[#6b7280] tracking-widest uppercase">
        {label}
      </span>
      <span className="text-[12px] font-bold text-white">{book}</span>
      <span
        className="text-[12px] font-bold"
        style={{ color: "#39FF14" }}
      >
        {model}
      </span>
      <RoiBadge roi={roi} />
    </div>
  );
}

// ── Dashboard preview card ────────────────────────────────────────────────────
function DashboardPreview() {
  const shouldReduce = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Subtle odds tick every 4s
  useEffect(() => {
    if (shouldReduce) return;
    const interval = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(interval);
  }, [shouldReduce]);

  // Auto-expand first row briefly
  useEffect(() => {
    if (!loaded || shouldReduce) return;
    const t1 = setTimeout(() => setExpandedRow("lad-sd"), 1400);
    const t2 = setTimeout(() => setExpandedRow(null), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loaded, shouldReduce]);

  const rows = MOCK_MARKET_ROWS.slice(0, 4);

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-white/10"
      style={{
        background:
          "linear-gradient(145deg, rgba(15,20,30,0.98) 0%, rgba(10,14,22,0.98) 100%)",
        boxShadow:
          "0 0 60px rgba(57,255,20,0.06), 0 24px 64px rgba(0,0,0,0.6)",
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-white tracking-widest uppercase">
            AI Sports Betting
          </span>
          <span className="text-[10px] text-[#6b7280]">· Model Feed</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full bg-[#39FF14]"
            style={
              shouldReduce
                ? {}
                : { animation: "pulse-green 2s ease-in-out infinite" }
            }
          />
          <span className="text-[11px] text-[#9ca3af]">LIVE</span>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_100px_100px_120px] gap-2 px-4 py-2 border-b border-white/5">
        {["MATCHUP", "SPREAD", "TOTAL", "MONEYLINE"].map((h) => (
          <span
            key={h}
            className="text-[10px] font-bold text-[#4b5563] tracking-widest uppercase"
          >
            {h}
          </span>
        ))}
      </div>

      {/* Skeleton → content */}
      {!loaded ? (
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div>
          {rows.map((row, idx) => {
            const isExpanded = expandedRow === row.id;
            // Subtle tick offset for odds animation
            const tickOffset = tick % 2 === 0 && idx === 0 ? 1 : 0;
            return (
              <motion.div
                key={row.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.3 }}
                className={`border-b border-white/5 last:border-0 cursor-pointer transition-colors duration-150 ${
                  isExpanded ? "bg-white/4" : "hover:bg-white/3"
                }`}
                onClick={() =>
                  setExpandedRow(isExpanded ? null : row.id)
                }
              >
                <div className="grid grid-cols-[1fr_100px_100px_120px] gap-2 px-4 py-3 items-start">
                  {/* Matchup */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-bold text-white">
                      {row.matchup}
                    </span>
                    <span className="text-[11px] text-[#6b7280]">
                      {row.gameTime}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide ${
                          row.confidence === "HIGH"
                            ? "bg-[#39FF14]/15 text-[#39FF14]"
                            : row.confidence === "MED"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-white/8 text-[#6b7280]"
                        }`}
                      >
                        {row.confidence}
                      </span>
                      <LiveBadge seconds={row.updatedSecondsAgo + tickOffset} />
                    </div>
                  </div>

                  {/* Spread */}
                  <MarketCell
                    label="BOOK"
                    book={row.spread.book}
                    model={row.spread.model}
                    roi={row.spread.roi}
                  />

                  {/* Total */}
                  <MarketCell
                    label="BOOK"
                    book={row.total.book}
                    model={row.total.model}
                    roi={row.total.roi}
                  />

                  {/* Moneyline */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-[#6b7280] tracking-widest uppercase">
                      BOOK
                    </span>
                    <span className="text-[12px] font-bold text-white">
                      {row.moneyline.bookHome}
                    </span>
                    <span
                      className="text-[12px] font-bold"
                      style={{ color: "#39FF14" }}
                    >
                      {row.moneyline.modelHome}
                    </span>
                    <RoiBadge roi={row.moneyline.roi} />
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="px-4 pb-3 pt-0"
                  >
                    <div className="rounded-lg bg-white/5 border border-white/8 p-3 grid grid-cols-3 gap-4 text-[11px]">
                      <div>
                        <span className="text-[#6b7280] block mb-1">Away ML</span>
                        <span className="text-white font-bold">{row.moneyline.bookAway}</span>
                        <span className="block" style={{ color: "#39FF14" }}>{row.moneyline.modelAway}</span>
                      </div>
                      <div>
                        <span className="text-[#6b7280] block mb-1">Sport</span>
                        <span className="text-white font-bold">{row.sport}</span>
                      </div>
                      <div>
                        <span className="text-[#6b7280] block mb-1">Confidence</span>
                        <span className="text-white font-bold">{row.confidence}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Hero section ──────────────────────────────────────────────────────────────
export default function Hero() {
  const shouldReduce = useReducedMotion();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      className="relative min-h-screen flex flex-col justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(57,255,20,0.07) 0%, transparent 60%), linear-gradient(180deg, #080c12 0%, #050810 100%)",
      }}
    >
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: copy */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex flex-col gap-6"
          >
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 self-start">
              <span
                className="w-2 h-2 rounded-full bg-[#39FF14]"
                style={
                  shouldReduce
                    ? {}
                    : { animation: "pulse-green 2s ease-in-out infinite" }
                }
              />
              <span className="text-[11px] font-bold text-[#39FF14] tracking-widest uppercase">
                AI-Powered Betting Intelligence
              </span>
            </div>

            {/* H1 */}
            <h1
              className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.05]"
              style={{ letterSpacing: "-0.04em" }}
            >
              Find The Edge
              <br />
              <span style={{ color: "#39FF14" }}>Before The Market</span>
              <br />
              Moves.
            </h1>

            {/* Subheadline */}
            <p className="text-[#9ca3af] text-lg leading-relaxed max-w-xl">
              Access AI-powered model projections, betting splits, no-vig fair
              odds, ROI signals, and market edge tools in one clean sports
              betting intelligence dashboard.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="/feed"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
                style={{ background: "#39FF14", letterSpacing: "-0.01em" }}
                onClick={(e) => {
                  e.preventDefault();
                  window.location.href = "/feed";
                }}
              >
                View Today's Edges
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <button
                onClick={() => scrollToSection("how-it-works")}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm text-white border border-white/15 bg-white/5 hover:bg-white/10 transition-all duration-150 active:scale-[0.98]"
                style={{ letterSpacing: "-0.01em" }}
              >
                See How It Works
              </button>
            </div>

            {/* Trust microcopy */}
            <p className="text-[12px] text-[#6b7280]">
              No guaranteed outcomes. Just sharper data, cleaner probabilities,
              and faster market comparison.
            </p>
          </motion.div>

          {/* Right: dashboard preview */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          >
            <DashboardPreview />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
