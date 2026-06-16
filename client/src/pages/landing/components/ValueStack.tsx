import { motion, useReducedMotion } from "framer-motion";

const VALUES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 3v18h18" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M7 16l4-4 4 4 4-8" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "AI Model Projections",
    desc: "Probability-based win/loss projections built from Dixon-Coles Poisson models and Monte Carlo simulation. Every game, every market.",
    tag: "Core",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#39FF14" strokeWidth="1.8"/>
        <path d="M12 7v5l3 3" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    title: "Real-Time Betting Splits",
    desc: "See where public money is going and where sharp action is concentrated. Identify line movement before you place your bet.",
    tag: "Live",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="#39FF14" strokeWidth="1.8"/>
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="#39FF14" strokeWidth="1.8"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="#39FF14" strokeWidth="1.8"/>
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="#39FF14" strokeWidth="1.8"/>
      </svg>
    ),
    title: "Book vs. Model Comparison",
    desc: "Every projection is displayed side by side with the current market line. See where the model disagrees with the book — before you commit.",
    tag: "Core",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "K Props and Player Props",
    desc: "Strikeout projections and player prop analysis built from pitcher-specific models and park-adjusted data.",
    tag: "MLB",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
        <rect x="9" y="3" width="6" height="4" rx="1" stroke="#39FF14" strokeWidth="1.8"/>
        <path d="M9 12h6M9 16h4" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    title: "Daily Lineups and Cheat Sheets",
    desc: "Confirmed starting lineups, pitcher assignments, and pre-game cheat sheets delivered before first pitch.",
    tag: "Daily",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="#39FF14" strokeWidth="1.8"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    title: "MLB and World Cup 2026",
    desc: "Full MLB season coverage plus complete World Cup 2026 group stage and knockout round projections. More sports in development.",
    tag: "Multi-Sport",
  },
];

const TAG_COLORS: Record<string, string> = {
  Core: "rgba(57,255,20,0.12)",
  Live: "rgba(250,204,21,0.12)",
  MLB: "rgba(59,130,246,0.12)",
  Daily: "rgba(168,85,247,0.12)",
  "Multi-Sport": "rgba(236,72,153,0.12)",
};

const TAG_TEXT: Record<string, string> = {
  Core: "#39FF14",
  Live: "#facc15",
  MLB: "#60a5fa",
  Daily: "#c084fc",
  "Multi-Sport": "#f472b6",
};

export default function ValueStack() {
  const shouldReduce = useReducedMotion();

  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="font-bold text-white"
            style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
          >
            Everything You Need to Read the Board
            <br />
            <span style={{ color: "#39FF14" }}>Before You Bet.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
            One platform. Every signal that matters. No noise.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {VALUES.map((v, i) => (
            <motion.div
              key={v.title}
              initial={shouldReduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              className="rounded-xl p-6 flex flex-col gap-3 group"
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)",
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(57,255,20,0.2)";
                (e.currentTarget as HTMLDivElement).style.background = "rgba(57,255,20,0.03)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
                (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)";
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "10px",
                    background: "rgba(57,255,20,0.08)",
                    border: "1px solid rgba(57,255,20,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {v.icon}
                </div>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "999px",
                    fontSize: "10px",
                    fontWeight: 700,
                    background: TAG_COLORS[v.tag] ?? "rgba(255,255,255,0.08)",
                    color: TAG_TEXT[v.tag] ?? "#9ca3af",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.tag}
                </span>
              </div>
              <h3 className="font-bold text-white" style={{ fontSize: "15px" }}>
                {v.title}
              </h3>
              <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "13px" }}>
                {v.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
