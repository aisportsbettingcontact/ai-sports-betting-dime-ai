# MASTER.md Pre-Delivery Checklist — splits mobile pass (2026-08-05)

Scored for the MOBILE presentation (<768px) of `/betting-splits/:sport` on
`feat/splits-mobile-refine` (desktop pass merged to `main` via PR #367).

| Item | Verdict | Evidence |
| --- | --- | --- |
| Mint ONLY on signal | **PASS with recorded exception** | Mobile mint set: away bar segments (side-encoding — OPEN DECISION 1, owner call pending, unchanged by this pass), LIVE tag+dot, nav active dot, Chat pill. No mint added anywhere by this pass |
| `--mint-on-light` for mint text on light | **PASS** | Light captures: `--dime-mint-text`/`--dime-mint-border` ramps inherited from the desktop pass render dark-mint ink on white; no raw mint text |
| Familjen Grotesk + IBM Plex Mono; no legacy fonts | **PASS** (per 2026-07-24 supersede: pass = Familjen-only, Plex Mono NOT loaded) | App loads Familjen only; mono micro-labels via `--dime-font-mono` system stack. Capture caveat: harness proxy blocks the fonts CDN → shots show fallback sans |
| All icons SVG; no emoji icons | **PASS** | Lucide + licensed crests; no emoji |
| `cursor-pointer` on clickables | **PASS** | Inherited; unchanged (touch surface) |
| Hover states on 160ms brand curve | **PASS** | Press/hover captures run the inherited `--dime-t`/`--dime-ease`; zero motion lines in this diff |
| Text contrast ≥4.5:1 both themes | **PASS** | Bar labels 700-weight on mint/black (desktop-pass guarantee, now on complete bars); history 4px-cell type keeps its sizes — only padding changed; light captures re-verified |
| Focus states visible (3px ring) | **PASS** | `splitsm-dark-state-focus-visible.png`; NEW: both scroll panes are now focusable named groups (they had no keyboard access at all before) |
| `prefers-reduced-motion` respected | **PASS** | `splitsm-dark-state-reduced-motion.png`; reveal/press kills unchanged |
| Responsive 375/768/1024/1440; no horizontal scroll on mobile | **PASS** | run-report: zero horizontal overflow across 320/375/390/430 (+light, +states). P0 pane amputation fixed (probes: `scrollWidth == clientWidth`). ≥768 governed by the merged desktop pass |
| Real `<button>`/`<a>` + ARIA | **PASS** | Toggles/pills remain real buttons; scroll containers gain `role="group"` + labels (a11y net-positive; no structural regressions) |
