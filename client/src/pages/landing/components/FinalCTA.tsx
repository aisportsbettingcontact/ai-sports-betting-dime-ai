import { motion, useReducedMotion } from "framer-motion";

export default function FinalCTA() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="w-full text-center relative overflow-hidden"
      style={{
        padding: "5rem clamp(16px, 4vw, 64px)",
        background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(57,255,20,0.07) 0%, rgba(5,8,16,0) 70%), rgba(5,8,16,1)",
      }}
    >
      {/* Radial glow */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "60vw",
          height: "40vw",
          maxWidth: "600px",
          maxHeight: "400px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(57,255,20,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="max-w-screen-sm mx-auto flex flex-col items-center gap-6 relative z-10">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-6"
        >
          <h2
            className="font-black text-white"
            style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)", letterSpacing: "-0.04em" }}
          >
            Get Early Access.
            <br />
            <span style={{ color: "#39FF14" }}>Before the Public Launch.</span>
          </h2>
          <p className="text-[#9ca3af]" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
            We're opening access to a select group of serious bettors first. Reserve your spot now.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/#waitlist"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: "#39FF14", fontSize: "15px", boxShadow: "0 0 28px rgba(57,255,20,0.3)" }}
            >
              Join the Waitlist
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-semibold text-white transition-all hover:bg-white/10 active:scale-[0.98]"
              style={{ border: "1px solid rgba(255,255,255,0.15)", fontSize: "15px" }}
            >
              View Today&apos;s Projections
            </a>
          </div>
          <p className="text-[#4b5563] text-[12px]">No credit card required. No commitment. Invite-only access.</p>
        </motion.div>
      </div>
    </section>
  );
}
