/** Footer — responsible-gaming legal block is REQUIRED on this surface. */

import { Link } from "wouter";
import { FOOTER_LEGAL } from "../landing-content";
import { Wordmark } from "./shared";

export default function FooterSection() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <span className="lockup">AI Sports Betting</span>
            <span className="mono">
              powered by <Wordmark fontSize={14} />
            </span>
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
