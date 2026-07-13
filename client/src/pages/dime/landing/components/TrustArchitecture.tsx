/** Trust architecture — methodology, not fine print. */

import { TRUST } from "../landing-content";

export default function TrustArchitecture() {
  return (
    <section className="sec" id="trust" aria-label="Methodology and trust">
      <div className="wrap">
        <div className="sec-body">
          <div className="trust-module">
            <span className="mono mono--mint" style={{ display: "block", marginBottom: 12 }}>{TRUST.eyebrow}</span>
            <h2>{TRUST.moduleHeadline}</h2>
            <p>{TRUST.moduleCopy}</p>
            <ul className="trust-list">
              {TRUST.principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
