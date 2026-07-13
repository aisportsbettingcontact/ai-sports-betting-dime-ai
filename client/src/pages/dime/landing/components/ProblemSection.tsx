/** Problem — data everywhere, no decision system. */

import { PROBLEM } from "../landing-content";
import { SectionHead } from "./shared";

export default function ProblemSection() {
  return (
    <section className="sec" id="problem" aria-label="The problem">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead eyebrow={PROBLEM.eyebrow} headline={PROBLEM.headline} sub={PROBLEM.sub} />
          <div className="cards3" style={{ marginTop: "clamp(24px, 4vw, 40px)" }}>
            {PROBLEM.items.map((item) => (
              <div className="pcard" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
