/** Mechanism — Choose Market → Compare Price → Evaluate Edge → Decide. */

import { MECHANISM } from "../landing-content";
import { CtaRow, SectionHead, TeleFrame } from "./shared";

export default function Mechanism() {
  return (
    <section className="sec" id="mechanism" aria-label="How it works">
      <div className="wrap">
        <TeleFrame label="MECHANISM // CHOOSE → COMPARE → EVALUATE → DECIDE" />
        <div className="sec-body">
          <SectionHead eyebrow={MECHANISM.eyebrow} headline={MECHANISM.headline} sub={MECHANISM.sub} />
          <div className="mech-grid" style={{ marginTop: "clamp(24px, 4vw, 40px)" }}>
            {MECHANISM.steps.map((s) => (
              <div className="mech-step" key={s.num}>
                <span className="stepnum">{s.num}</span>
                <h3>{s.title}</h3>
                <p>{s.copy}</p>
                <span className="tele-foot">{s.tele}</span>
              </div>
            ))}
          </div>
          <CtaRow
            label="Ready when the math is"
            cta="Get Access"
            href="#pricing"
            ctaId="mechanism-get-access"
            location="mechanism"
          />
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
