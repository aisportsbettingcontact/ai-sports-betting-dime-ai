export default function LandingFooter() {

  return (
    <footer
      className="text-center border-t"
      style={{
        padding: "2.5rem clamp(16px, 4vw, 64px)",
        borderColor: "rgba(255,255,255,0.06)",
        background: "#050810",
      }}
    >
      <p className="text-[12px] text-[#4b5563]">
        © 2026 Tailered Sports, Inc. All rights reserved.
      </p>
      <p className="text-[11px] text-[#374151] mt-1">
        Not financial advice. Bet responsibly.
      </p>
    </footer>
  );
}
