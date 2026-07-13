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
          href="/login"
          className="btn btn--ghost"
          data-cta-id="nav-login"
          data-cta-location="nav"
          data-mode="paid"
          aria-label="Log in (username/password or Discord)"
        >
          Log in
        </a>
        {/* Ghost, not mint: the hero's Get access is the surface's single mint
            action (MASTER.md); once the hero scrolls away the sticky bar's mint
            takes over. Two simultaneous mint buttons broke the one-accent law.
            Contextual label: "Get access" is reserved for the hero + final CTA;
            this button scrolls to the pricing grid. */}
        <a
          href="#pricing"
          className="btn btn--ghost"
          data-cta-id="nav-see-plans"
          data-cta-location="nav"
          data-mode="paid"
        >
          See plans
        </a>
      </div>
    </nav>
  );
}
