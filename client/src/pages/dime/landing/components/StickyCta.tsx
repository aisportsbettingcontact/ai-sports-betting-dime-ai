/**
 * Sticky CTA bar — docks after the hero leaves the viewport, hides near
 * pricing (so it never covers the thing it points to), dismissible.
 */

import { useEffect, useRef, useState } from "react";

export default function StickyCta() {
  const [on, setOn] = useState(false);
  const dismissed = useRef(false);

  useEffect(() => {
    const update = () => {
      if (dismissed.current) return;
      const hero = document.getElementById("top");
      const pricing = document.getElementById("pricing");
      if (!hero || !pricing) return;
      const heroGone = hero.getBoundingClientRect().bottom < 0;
      const pricingNear = pricing.getBoundingClientRect().top < window.innerHeight * 0.75;
      setOn(heroGone && !pricingNear);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div className={on ? "slipbar on" : "slipbar"} role="complementary" aria-label="Subscribe" aria-hidden={!on}>
      <span className="price num">≈ $3.30 / day</span>
      <span className="lead" aria-hidden="true" />
      <a
        href="#pricing"
        className="btn btn--mint"
        tabIndex={on ? 0 : -1}
        data-cta-id="sticky-get-access"
        data-cta-location="sticky-bar"
        data-plan="monthly"
        data-mode="paid"
      >
        Get Access →
      </a>
      <button
        type="button"
        className="x"
        aria-label="Dismiss"
        tabIndex={on ? 0 : -1}
        onClick={() => {
          dismissed.current = true;
          setOn(false);
        }}
      >
        ×
      </button>
    </div>
  );
}
