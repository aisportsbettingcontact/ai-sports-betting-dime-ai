/** Feature grid — real product surface, whitelisted claims only. */

import { FEATURES } from "../landing-content";
import { SectionHead } from "./shared";

export default function FeatureGrid() {
  return (
    <section className="sec" id="features" aria-label="Features">
      <div className="wrap">
        <div className="sec-body">
          {/* Eyebrow dropped: the headline carries this section (taste budget). */}
          <SectionHead headline={FEATURES.headline} />
          <div className="feat-grid" style={{ marginTop: "clamp(24px, 4vw, 40px)" }}>
            {FEATURES.items.map((f) => (
              <div className="feat" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
