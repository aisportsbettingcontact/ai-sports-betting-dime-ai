# MASTER.md Pre-Delivery Checklist — feed mobile pass (2026-08-05)

Scored for the MOBILE presentation (<768px) of `/feed/model/*` on
`feat/feed-mobile-refine` (stacked on `feat/feed-desktop-refine`).

| Item | Verdict | Evidence |
| --- | --- | --- |
| Mint ONLY on signal | **PASS** | Scrolled dark 375 full-slate: mint = edge chips, LIVE tag+dot, nav active dot, Chat pill — exactly the law's signal set. PASS card now zero-mint at mobile too (fix 2; probe: opacity 0.82, tokens remapped) |
| `--mint-on-light` for mint text on light | **PASS** | Light captures: edge-chip text + LIVE label render the dark-mint ink ramp (`--mint-ink` chain from the desktop pass, now unconditional); no raw #45E0A8 text on white |
| Familjen Grotesk + IBM Plex Mono; no legacy fonts | **PASS** (per 2026-07-24 supersede: pass = Familjen-only, Plex Mono NOT loaded) | `client/index.html` loads Familjen only; mono micro-labels use the system-mono stack via `--dime-font-mono`. Capture caveat: the harness's proxy blocks the fonts CDN, so shots render fallback sans — noted, does not change what the app requests |
| All icons SVG; no emoji icons | **PASS** | Lucide + brand-kit SVG throughout; no emoji introduced |
| `cursor-pointer` on clickables | **PASS** | Inherited from the desktop pass; unchanged elements (touch surface — hover cursor n/a but rule intact) |
| Hover states on 160ms brand curve | **PASS** | No new hover surfaces; press/hover states captured (`state-hover-*`, `state-press-*`) run the inherited 160ms curve |
| Text contrast ≥4.5:1 both themes | **PASS** | Desktop pass's dimmed-LIVE `color-mix` fix is now unconditional; PASS-card label remap to `--foreground` compensates the 0.82 dim (probe + light captures) |
| Focus states visible (3px ring) | **PASS** | `feedm-dark-state-focus-visible.png` |
| `prefers-reduced-motion` respected | **PASS** | `feedm-dark-state-reduced-motion.png`; live pulse collapses to a static dot (motion-review.md) |
| Responsive 375/768/1024/1440; no horizontal scroll on mobile | **PASS** | run-report: zero horizontal overflow across 320/375/390/430 (+ light) and all states; 1440 desktop probe 3-up, no overflow; 768/1024 governed by the stacked desktop PR's evidence |
| Real `<button>`/`<a>` + ARIA | **PASS** | No structural changes; per-card labeled summary regions inherited from PR #365 |
