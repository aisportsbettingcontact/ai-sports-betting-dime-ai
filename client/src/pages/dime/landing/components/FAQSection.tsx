/** FAQ — native <details>/<summary> accordion (keyboard + SR accessible by default). */

import { FAQ } from "../landing-content";
import { SectionHead } from "./shared";

export default function FAQSection() {
  return (
    <section className="sec" id="faq" aria-label="Frequently asked questions">
      <div className="wrap">
        <div className="sec-body">
          {/* Eyebrow dropped: the headline carries this section (taste budget). */}
          <SectionHead headline={FAQ.headline} />
          <div className="faq-list" style={{ marginTop: "clamp(16px, 3vw, 28px)" }}>
            {FAQ.items.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>
                  <span className="marker" aria-hidden="true">+</span>
                  {item.q}
                </summary>
                <p className="faq-a">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
