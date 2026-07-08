/** Landing v2 nav — sticky, mono links, single mint action. */

import { Wordmark } from "./shared";

export default function Nav() {
  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap nav-inner">
        <a href="#top" aria-label="dime home" style={{ textDecoration: "none" }}>
          <Wordmark />
        </a>
        <div className="nav-links">
          <a href="#console">Console</a>
          <a href="#chat-demo">Dime Chat</a>
          <a href="#mechanism">How it works</a>
          <a href="#signals">Signals</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <a
          href="#pricing"
          className="btn btn--mint"
          data-cta-id="nav-get-access"
          data-cta-location="nav"
          data-mode="paid"
        >
          Get Access
        </a>
      </div>
    </nav>
  );
}
