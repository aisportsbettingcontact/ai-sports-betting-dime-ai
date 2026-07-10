/** Final CTA plate. */

import { FINAL_CTA } from "../landing-content";
import { Wordmark } from "./shared";

export default function FinalCTA() {
  return (
    <div className="wrap">
      <div className="plate">
        <span className="mono">{FINAL_CTA.mono}</span>
        <h2>{FINAL_CTA.headline}</h2>
        <p>{FINAL_CTA.copy}</p>
        <a
          href="/checkout?plan=pro"
          className="btn btn--mint"
          data-cta-id="final-get-access"
          data-cta-location="final-cta"
          data-plan="pro"
          data-mode="paid"
        >
          {FINAL_CTA.cta} — <Wordmark fontSize={17} />
        </a>
      </div>
    </div>
  );
}
