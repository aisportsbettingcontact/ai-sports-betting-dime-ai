/** Feature grid — real product surface, whitelisted claims only. */

import { FEATURES } from "../landing-content";
import { SectionHead, TeleFrame } from "./shared";

export default function FeatureGrid() {
  return (
    <section className="sec" id="features" aria-label="Features">
      <div className="wrap">
        <TeleFrame label="SURFACE // BOARD · CHAT · GRADING · PIPELINE" />
        <div className="sec-body">
          <SectionHead eyebrow={FEATURES.eyebrow} headline={FEATURES.headline} />
          <div className="feat-grid" style={{ marginTop: "clamp(24px, 4vw, 40px)" }}>
            {FEATURES.items.map((f) => (
              <div className="feat" key={f.title}>
                <span className="tele-head">{f.tele}</span>
                <h3>{f.title}</h3>
                <p>{f.copy}</p>
              </div>
            ))}
          </div>
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
