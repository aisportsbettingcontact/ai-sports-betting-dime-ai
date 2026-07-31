/** Footer — responsible-gaming legal block is REQUIRED on this surface. */

import { Link } from "wouter";
import { FOOTER_LEGAL } from "../landing-content";

export default function FooterSection() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            {/* The real wordmark asset, not a typeset lockup (owner directive
                2026-07-31). Tailered Sports, Inc. is the company; dime is the
                product, and the product mark is what belongs here. */}
            <img
              className="foot-logo"
              src="/brand/dime-wordmark-on-dark.svg"
              alt="dime"
              width={92}
              height={26}
            />
            <span className="mono foot-company">Tailered Sports, Inc.</span>
          </div>
          <div className="foot-links">
            <a href="#mechanism">How it works</a>
            <a href="#signals">Signals</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
        <p className="foot-legal">{FOOTER_LEGAL}</p>
      </div>
    </footer>
  );
}
