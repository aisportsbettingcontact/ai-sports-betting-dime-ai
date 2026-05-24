import { motion, useReducedMotion } from "framer-motion";

export default function FinalCTA() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="py-24 px-4 sm:px-6 lg:px-8"
      style={{
        background:
          "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(57,255,20,0.07) 0%, transparent 70%), rgba(5,8,16,0.98)",
      }}
    >
      <div className="max-w-3xl mx-auto text-center">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-[#39FF14]"
              style={shouldReduce ? {} : { animation: "pulse-green 2s ease-in-out infinite" }}
            />
            <span className="text-[11px] font-bold text-[#39FF14] tracking-widest uppercase">
              Models Running Now
            </span>
          </div>

          <h2
            className="text-4xl sm:text-5xl font-bold text-white leading-[1.05]"
            style={{ letterSpacing: "-0.04em" }}
          >
            The Market Has Already
            <br />
            <span style={{ color: "#39FF14" }}>Moved On Today's Games.</span>
          </h2>

          <p className="text-[#9ca3af] text-lg max-w-xl">
            Every hour without the model is an hour the market has an information advantage over you.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <a
              href="/feed"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-base text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: "#39FF14", letterSpacing: "-0.01em" }}
            >
              View Today's Edges
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="#pricing"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-base text-white border border-white/15 bg-white/5 hover:bg-white/10 transition-all duration-150 active:scale-[0.98]"
              style={{ letterSpacing: "-0.01em" }}
            >
              View Pricing
            </a>
          </div>

          <p className="text-[11px] text-[#4b5563]">
            No guaranteed outcomes. Built for disciplined, data-driven bettors.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
