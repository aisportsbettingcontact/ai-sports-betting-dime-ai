/** Objection handling — the shipped Straight Answers layer, carried forward. */

import { OBJECTIONS } from "../landing-content";
import { CtaRow, SectionHead, TeleFrame } from "./shared";

export default function ObjectionHandling() {
  return (
    <section className="sec" id="answers" aria-label="Straight answers">
      <div className="wrap">
        <TeleFrame label="STRAIGHT.ANSWERS // NO SALES VOICE" />
        <div className="sec-body">
          <SectionHead eyebrow={OBJECTIONS.eyebrow} headline={OBJECTIONS.headline} sub={OBJECTIONS.sub} />
          <div style={{ marginTop: "clamp(20px, 3vw, 32px)" }}>
            {OBJECTIONS.items.map((item) => (
              <div className="qa" key={item.stamp}>
                <span className="qa-q">{item.q}</span>
                <p>{item.a}</p>
                <span className="qa-stamp">{item.stamp}</span>
              </div>
            ))}
          </div>
          <CtaRow
            label="Asked and answered"
            cta="Get Access"
            href="#pricing"
            ctaId="answers-get-access"
            location="objection-handling"
          />
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
