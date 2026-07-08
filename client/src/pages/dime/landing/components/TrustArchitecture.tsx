/** Trust architecture — methodology, not fine print. */

import { TRUST } from "../landing-content";
import { TeleFrame } from "./shared";

export default function TrustArchitecture() {
  return (
    <section className="sec" id="trust" aria-label="Methodology and trust">
      <div className="wrap">
        <TeleFrame label="METHOD // PASS IS A VALID OUTPUT" />
        <div className="sec-body">
          <div className="trust-module">
            <span className="mono mono--mint" style={{ display: "block", marginBottom: 12 }}>{TRUST.eyebrow}</span>
            <h3>{TRUST.moduleHeadline}</h3>
            <p>{TRUST.moduleCopy}</p>
            <ul className="trust-list">
              {TRUST.principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
