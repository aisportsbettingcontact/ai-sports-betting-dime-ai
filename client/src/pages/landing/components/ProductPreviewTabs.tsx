import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  MOCK_MARKET_ROWS,
  MOCK_SPLIT_ROWS,
  MOCK_EDGE_ROWS,
} from "../lib/mock-data";

type Tab = "projections" | "splits" | "edges";

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      tabIndex={0}
    >
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-[#1a2030] border border-white/10 text-[11px] text-[#d1d5db] whitespace-nowrap z-50 pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfBadge({ conf }: { conf: "HIGH" | "MED" | "LOW" }) {
  const colors = {
    HIGH: "bg-[#39FF14]/15 text-[#39FF14]",
    MED: "bg-amber-500/15 text-amber-400",
    LOW: "bg-white/8 text-[#6b7280]",
  };
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide ${colors[conf]}`}>
      {conf}
    </span>
  );
}

// ── Model Projections tab ─────────────────────────────────────────────────────
function ProjectionsTab() {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-white/8">
            {["MATCHUP", "BOOK LINE", "MODEL LINE", "FAIR ODDS", "WIN PROB", "ROI", "CONF"].map((h) => (
              <th key={h} className="text-left py-2 px-3 text-[10px] font-bold text-[#4b5563] tracking-widest">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MOCK_MARKET_ROWS.map((row) => (
            <>
              <tr
                key={row.id}
                className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors"
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                <td className="py-3 px-3 font-bold text-white">{row.matchup}</td>
                <td className="py-3 px-3 text-[#9ca3af]">{row.spread.book}</td>
                <td className="py-3 px-3 font-bold" style={{ color: "#39FF14" }}>{row.spread.model}</td>
                <td className="py-3 px-3 text-[#9ca3af]">{row.moneyline.bookHome}</td>
                <td className="py-3 px-3 text-white tabular-nums">
                  {row.moneyline.roi !== null ? `${(52 + (row.moneyline.roi ?? 0)).toFixed(1)}%` : "50.0%"}
                </td>
                <td className="py-3 px-3 tabular-nums">
                  {row.spread.roi !== null ? (
                    <span style={{ color: "#39FF14" }} className="font-bold">+{row.spread.roi}%</span>
                  ) : (
                    <span className="text-[#6b7280]">NO EDGE</span>
                  )}
                </td>
                <td className="py-3 px-3"><ConfBadge conf={row.confidence} /></td>
              </tr>
              {expanded === row.id && (
                <tr key={`${row.id}-exp`} className="bg-white/3">
                  <td colSpan={7} className="px-3 pb-3 pt-1">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                      <div><span className="text-[#6b7280] block">Sport</span><span className="text-white font-bold">{row.sport}</span></div>
                      <div><span className="text-[#6b7280] block">Game Time</span><span className="text-white font-bold">{row.gameTime}</span></div>
                      <div><span className="text-[#6b7280] block">Total (Book)</span><span className="text-white font-bold">{row.total.book}</span></div>
                      <div><span className="text-[#6b7280] block">Total (Model)</span><span className="font-bold" style={{ color: "#39FF14" }}>{row.total.model}</span></div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Betting Splits tab ────────────────────────────────────────────────────────
function SplitBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-bold tabular-nums text-white w-8 text-right">{pct}%</span>
    </div>
  );
}

const SIGNAL_LABELS: Record<string, { label: string; color: string }> = {
  MONEY_DIVERGENCE: { label: "Money Divergence", color: "#39FF14" },
  PUBLIC_HEAVY: { label: "Public Heavy", color: "#f59e0b" },
  STEAM_MOVE: { label: "Steam Move", color: "#38bdf8" },
  REVERSE_LINE: { label: "Reverse Line Movement", color: "#a78bfa" },
  NO_SIGNAL: { label: "No Clear Signal", color: "#6b7280" },
};

function SplitsTab() {
  return (
    <div className="space-y-4">
      {MOCK_SPLIT_ROWS.map((row) => {
        const sig = SIGNAL_LABELS[row.signal];
        return (
          <div
            key={row.id}
            className="rounded-lg border border-white/8 p-4"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <span className="text-[13px] font-bold text-white">{row.matchup}</span>
                <span className="ml-2 text-[11px] text-[#6b7280]">{row.market}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{ background: `${sig.color}20`, color: sig.color }}
                >
                  {sig.label}
                </span>
                {row.sharpSide && (
                  <span className="text-[10px] text-[#9ca3af]">
                    Sharp: <span className="font-bold text-white">{row.sharpSide}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] text-[#6b7280] block mb-1 font-semibold tracking-wide uppercase">{row.awayTeam}</span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-[#9ca3af]">
                    <span className="w-14">Tickets</span>
                    <SplitBar pct={row.awayTickets} color="#9ca3af" />
                  </div>
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: row.awayMoney > row.homeMoney ? "#39FF14" : "#9ca3af" }}>
                    <span className="w-14 text-[#9ca3af]">Money</span>
                    <SplitBar pct={row.awayMoney} color={row.awayMoney > row.homeMoney ? "#39FF14" : "#6b7280"} />
                  </div>
                </div>
              </div>
              <div>
                <span className="text-[10px] text-[#6b7280] block mb-1 font-semibold tracking-wide uppercase">{row.homeTeam}</span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-[#9ca3af]">
                    <span className="w-14">Tickets</span>
                    <SplitBar pct={row.homeTickets} color="#9ca3af" />
                  </div>
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: row.homeMoney > row.awayMoney ? "#39FF14" : "#9ca3af" }}>
                    <span className="w-14 text-[#9ca3af]">Money</span>
                    <SplitBar pct={row.homeMoney} color={row.homeMoney > row.awayMoney ? "#39FF14" : "#6b7280"} />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-4 text-[11px] text-[#6b7280]">
              <span>Open: <span className="text-white font-semibold">{row.openingLine}</span></span>
              <span>Current: <span className="text-white font-semibold">{row.currentLine}</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Market Edges tab ──────────────────────────────────────────────────────────
function EdgesTab() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-white/8">
            {["MATCHUP", "MARKET", "BOOK", "NO-VIG", "MODEL", "EDGE %", "ROI %", "CONF", "UPDATED"].map((h) => (
              <th key={h} className="text-left py-2 px-3 text-[10px] font-bold text-[#4b5563] tracking-widest whitespace-nowrap">
                <Tooltip text={
                  h === "NO-VIG" ? "Book price with vig removed, true implied probability" :
                  h === "EDGE %" ? "Gap between model probability and market probability" :
                  h === "ROI %" ? "Expected return per unit wagered" : h
                }>
                  <span className="cursor-help border-b border-dashed border-[#4b5563]">{h}</span>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MOCK_EDGE_ROWS.map((row) => (
            <tr key={row.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
              <td className="py-3 px-3 font-bold text-white whitespace-nowrap">{row.matchup}</td>
              <td className="py-3 px-3 text-[#9ca3af] whitespace-nowrap">{row.market}</td>
              <td className="py-3 px-3 text-white tabular-nums">{row.bookPrice}</td>
              <td className="py-3 px-3 text-[#9ca3af] tabular-nums">{row.noVigPrice}</td>
              <td className="py-3 px-3 font-bold tabular-nums" style={{ color: "#39FF14" }}>{row.modelPrice}</td>
              <td className="py-3 px-3 tabular-nums">
                {row.edgePct !== null ? (
                  <span style={{ color: "#39FF14" }} className="font-bold">+{row.edgePct}%</span>
                ) : <span className="text-[#6b7280]">—</span>}
              </td>
              <td className="py-3 px-3 tabular-nums">
                {row.roiPct !== null ? (
                  <span style={{ color: "#39FF14" }} className="font-bold">+{row.roiPct}%</span>
                ) : <span className="text-[#6b7280]">NO EDGE</span>}
              </td>
              <td className="py-3 px-3"><ConfBadge conf={row.confidence} /></td>
              <td className="py-3 px-3 text-[#6b7280] tabular-nums">{row.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string }[] = [
  { id: "projections", label: "Model Projections" },
  { id: "splits", label: "Betting Splits" },
  { id: "edges", label: "Market Edges" },
];

export default function ProductPreviewTabs() {
  const [active, setActive] = useState<Tab>("projections");
  const shouldReduce = useReducedMotion();

  return (
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            Built For Fast Betting Decisions.
          </h2>
          <p className="text-[#9ca3af] text-lg max-w-2xl mx-auto">
            Switch between projections, splits, and market edges to see how the
            platform turns raw betting data into actionable intelligence.
          </p>
        </motion.div>

        {/* Tab bar */}
        <div
          className="flex gap-1 p-1 rounded-lg mb-6 w-fit mx-auto"
          role="tablist"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active === tab.id}
              onClick={() => setActive(tab.id)}
              className={`px-4 py-2 rounded-md text-[13px] font-bold transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#39FF14] ${
                active === tab.id
                  ? "text-white"
                  : "text-[#6b7280] hover:text-[#9ca3af]"
              }`}
              style={
                active === tab.id
                  ? { background: "rgba(255,255,255,0.08)", borderBottom: "2px solid #39FF14" }
                  : {}
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div
          className="rounded-xl border border-white/8 overflow-hidden"
          style={{ background: "rgba(10,14,22,0.95)" }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={shouldReduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              role="tabpanel"
              className="p-4 sm:p-6"
            >
              {active === "projections" && <ProjectionsTab />}
              {active === "splits" && <SplitsTab />}
              {active === "edges" && <EdgesTab />}
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="text-center text-[11px] text-[#4b5563] mt-4">
          Sample data for illustration. Real-time data available after login.
        </p>
      </div>
    </section>
  );
}
