/** Landing v2 nav — sticky, mono links, single mint action.
 *  ≤820px the inline section links collapse into a real menu button
 *  (MASTER.md menu spec) so the six jump links stay reachable on a
 *  ~5800px page (audit D-LANDING-NAV). */

import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./shared";

const SECTIONS = [
  { href: "#console", label: "Console" },
  { href: "#chat-demo", label: "Dime Chat" },
  { href: "#mechanism", label: "How it works" },
  { href: "#signals", label: "Signals" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        btnRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap nav-inner">
        <a href="#top" aria-label="dime home" style={{ textDecoration: "none" }}>
          <Wordmark />
        </a>
        <div className="nav-links">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href}>
              {s.label}
            </a>
          ))}
        </div>
        <button
          ref={btnRef}
          type="button"
          className="nav-menu-btn"
          aria-label="Page sections"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {/* three-line glyph, brand-kit stroke style — SVG, not emoji */}
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
            <path d="M1 1h16M1 7h16M1 13h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {menuOpen && (
          <div ref={menuRef} className="nav-menu" role="menu" aria-label="Page sections">
            {SECTIONS.map((s) => (
              <a key={s.href} href={s.href} role="menuitem" onClick={() => setMenuOpen(false)}>
                {s.label}
              </a>
            ))}
          </div>
        )}
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
