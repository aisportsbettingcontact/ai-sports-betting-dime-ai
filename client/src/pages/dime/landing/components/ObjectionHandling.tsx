/** Objection handling — the shipped Straight Answers layer, carried forward. */

import { OBJECTIONS } from "../landing-content";
import { CtaRow, SectionHead } from "./shared";

export default function ObjectionHandling() {
  return (
    <section className="sec" id="answers" aria-label="Straight answers">
      <div className="wrap">
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
            cta="Compare the plans"
            href="#pricing"
            ctaId="answers-compare-plans"
            location="objection-handling"
          />
        </div>
      </div>
    </section>
  );
}
