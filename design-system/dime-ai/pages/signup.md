# Signup — Settlement Slip — Page Overrides

> **PROJECT:** Dime AI
> **Generated:** 2026-07-08 (authored from `dime-ai/SIGNUP-DIRECTION.md`)
> **Page Type:** Auth / Onboarding Flow

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/dime-ai/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Color Overrides — the mint extension (LAW)

- On the signup slip, mint marks **STATE CONFIRMATION** — the signup-domain analogue of edge
  signal: settled ledger rows' ✓ stamps, the final `STATUS — OPEN` value, the focus ring, the
  7px pulsing "settling" dot. Nothing else.
- Everything unsettled stays in grey tiers (`--text-muted` / `--text-secondary` /
  `--text-primary`); unmet password rules are grey dots, never red.
- Errors are grey mono `ERROR` stamps — mono label in `--text-secondary`, message in
  `--text-primary`, row bordered `#2E2E38`. **Never red.**
- No red, no gold, no Discord blurple anywhere on the slip (Discord glyph in currentColor grey).

### Layout / Component Overrides — slip structure

- One single mono-labeled ledger column: `min(440px, 100% − 32px)`, `--surface-card` on
  `#0B0B0F`, hairline-ruled rows (1px `--color-border`).
- Rows, in order: `PLAN` / `PAYMENT` / `HANDLE` / `EMAIL` / `PASSWORD` / `TERMS` / `STATUS` —
  IBM Plex Mono micro-labels (10–11px, 0.08em, uppercase) left, dotted leaders, values right.
- Familjen Grotesk 700 values over IBM Plex Mono micro-labels; no other typefaces.
- Dense grid: 12px row padding, 1px rules.

### Motion Overrides

- One curve only: `160ms cubic-bezier(0.16,1,0.3,1)`; settle-pulse 1.6s; gated behind
  `prefers-reduced-motion`. No confetti, no scale springs.

### Iconography

- Lucide icons only (e.g. AlertTriangle in grey for the legacy terms fallback) — no emojis.
