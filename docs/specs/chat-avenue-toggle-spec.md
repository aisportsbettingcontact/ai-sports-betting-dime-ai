# Chat Avenue Toggle — build spec (owner-directed)

## What

A 3-segment toggle in the top-middle header of the Dime AI Chat interface, on
mobile, tablet, and desktop:

- `AI MODEL PROJECTIONS`
- `BETTING SPLITS`
- `ODDS + LINE MOVEMENT`

Exactly one segment is active at all times. Default: `AI MODEL PROJECTIONS`.
Selection persists across sessions (localStorage key `dime.chat.avenue`).

## Where

- Desktop/tablet: `client/src/pages/DimeChat.tsx` — top middle of the chat
  header (read the file to find the header region; center the toggle between
  any left/right header elements; it must not collide with them at tablet
  widths — stack or compress gracefully).
- Mobile: `client/src/features/mobileNav/screens/MobileChat.tsx` — top middle
  header section of the mobile chat screen.
- One shared component: `client/src/components/DimeAvenueToggle.tsx` (+ a
  small CSS file or co-located styles following whichever pattern the chat
  surfaces already use).

## Visual language (owner-specified, overrides default token mapping)

Reuse the element language of the floating tab menu
(`client/src/features/mobileNav/MobileFloatingNav.tsx` + `mobileFloatingNav.css`,
the Feed/Tools/Chat/Tracker/Profile pill): same pill/segment geometry idiom,
same font family (Familjen Grotesk), same radius/motion feel, 160ms
transitions per `design-system/dime-ai/MASTER.md`. Motion: background/color
transition only, 160ms, no bounces.

Colors (exact, owner-directed):
- Non-active segment, light mode: **black background, bold white text**.
- Non-active segment, dark mode: **white background, bold black text**.
- Active segment, both modes: **mint `#45E0A8` background, bold black text**.
- No gradients, no purple, no neon green, no gold. Bold = 700 weight.
- Labels are uppercase as written above; at narrow widths compress to
  shorter labels (`PROJECTIONS` / `SPLITS` / `ODDS + LINES`) rather than
  wrapping — never two-line segments.

## Accessibility

`role="tablist"` / `role="tab"`, `aria-selected`, arrow-key navigation,
visible focus ring consistent with existing focus styles.

## Behavior — avenue-scoped retrieval architecture

Shared module `client/src/lib/dimeChatAvenue.ts` exporting:

- `type DimeChatAvenue = "model_projections" | "betting_splits" | "odds_line_movement"`
- `DIME_CHAT_AVENUES` metadata (id, full label, compact label, scope suffix)
- `loadDimeChatAvenue()` / `saveDimeChatAvenue()` (localStorage, safe on SSR/no-storage)
- `applyDimeAvenueScope(messageText, avenue): string` — appends the avenue's
  scope suffix to the outgoing message text
- `buildDimeChatRequestBody(messages, avenue)` — returns the POST body with
  BOTH `messages` and a forward-compatible `avenue` field

Wire into the chat send path (both DimeChat.tsx and MobileChat.tsx use
`POST /api/dime/chat`; find the shared send code and thread the avenue
through it):

1. The `avenue` field goes in the JSON body. The server currently ignores it
   (reads only `messages`) — this is the forward-compatible native channel
   for the upcoming server-side per-avenue retrievers. Harmless today.
2. The scope suffix is appended to the submitted message text and is VISIBLE
   in the user's sent bubble (transparency requirement — never silently
   mutate what the user appears to have said differently from what was sent).
   Exact suffixes (chosen to engage the existing server-side answer router's
   text classification today):
   - model_projections: ` — scope: today's model projections slate`
   - betting_splits: ` — scope: betting splits (bets % and money %)`
   - odds_line_movement: ` — scope: odds history and line movement`

## Hard constraints

- DO NOT modify anything under `server/` or `ml/` — those retrieval/routing
  sources are governance-pinned; native avenue scoping ships separately.
- TypeScript strict; `pnpm run check` must pass; prettier-clean.
- Tests: add `client/src/lib/dimeChatAvenue.test.ts` in the existing
  DOM-free style (see `client/src/features/mobileNav/mobileFloatingNav.test.ts`
  for the idiom): cover avenue metadata completeness, load/save round-trip
  with a stubbed storage, scope-suffix application, and request-body shape.
- Do not add dependencies.
