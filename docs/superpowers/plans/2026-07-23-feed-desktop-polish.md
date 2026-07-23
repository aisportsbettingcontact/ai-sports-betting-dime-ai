# AI Model Projections — Desktop/Tablet Polish (Round 4, owner-approved 8 items)

> Executor: superpowers:subagent-driven-development, 3 sequential waves (same-file adjacency
> forbids parallel implementers). Owner approved all 8 items verbatim on 2026-07-23.
> Branch from origin/main (post-#160). DESKTOP AND TABLET ONLY; mobile <768 untouched.
> Brand law + apple-design discipline; ai-model-projections.md is page law — amendments
> below are owner-directed and must be recorded in that file as part of the work.

## Approved items
1. Equalized card rows: rows stretch equal height; summary vertically centered; expander pinned
   to card bottom. LAW AMENDMENT: 07-21 "start-aligned" -> "stretch" (annotate).
2. Unified score+matchup: one score row (logo · score · Away @ Home · score · logo), scores
   24px/700 tabular on the names' optical line; ballpark+time beneath unchanged. Frozen content
   rules intact (names only, no pitchers, header shows LIVE/FINAL only).
3. PASS-card law enforced: opacity 0.82, secondary text, zero mint, SAME structured summary grid
   ("No edge" occupies the chip slot); no left-aligned sentence layout divergence.
4. Live indicator to law: pulsing 7px mint dot + mono mint "LIVE · TOP N"; static under
   prefers-reduced-motion; light theme uses --mint-on-light + dot keyline.
5. Aligned summary mini-grid: fixed column tracks (MODEL EDGE | BOOK | MODEL | chip) so values
   align vertically across all cards; tabular-nums; ONE canonical edge-chip style.
6. Header rhythm: date nav centered directly under the 96px title band, scaled 15->17px; fixed
   24/32px rhythm steps to the league header; kill the dead band. LAW AMENDMENT: date-nav
   placement (annotate).
7. Expander hover: "VIEW FULL AI MODEL PROJECTIONS" rows get shell row-hover fill, 160ms curve.
8. Tablet 768-1023: apply ONLY #2 #3 #4 #5 #7 (breakpoint-agnostic); tablet keeps its column
   count + compact title. Desktop-only: #1 #6.

## Waves
- W1 card anatomy: items 2, 3, 4 (card header/summary region)
- W2 grid & alignment: items 1, 5 (+ verify 8-scoping of 5)
- W3 chrome: items 6, 7 (+ 8 scoping audit across all items)
- W4 close: feed e2e contract updates (extend existing harness or new spec), full gates,
  evidence screenshots (1024/1280/1440 + tablet 900), law-amendment annotations verified,
  finish (PR).

## Verification per wave
tsc; targeted vitest; visual smoke on prod-parity build with stubbed tRPC at 1440 + 900;
per-item PASS evidence screenshot. Controller re-runs gates between waves; task-review per wave;
final whole-branch review before PR.

## Out of scope
Mobile <768; data contract; card content/copy law; carousel logic; sidebar; bundle-affecting
new chunks (style/markup only). Follow-up queue unchanged (lazy SettingsModal first).
