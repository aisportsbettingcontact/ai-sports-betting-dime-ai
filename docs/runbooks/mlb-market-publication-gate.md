# MLB per-market publication gate — runbook

**Status:** mechanism merged, enforcement OFF. Flipping it on is an owner decision.

The 2026 season model audit ruled **all nine MLB gate markets BACKTEST-ONLY**
(`docs/audits/mlb-model-audit-2026/GATE-TABLE.json`) and wrote nine `publish_*`
verdict rows into `mlb_calibration_constants`. Nothing read them for six weeks.
This gate reads them.

## The flag

`MLB_MARKET_GATE_MODE` — a Railway service variable on `dime-ai`. Three values,
read at call time, unset/unrecognized → `off`.

| Value | DB read | Output changed | Use |
|---|---|---|---|
| `off` (default) | no | no | today's behavior, byte-identical |
| `log` | yes | **no** | validate the loader against real rows before anyone sees a change |
| `on` | yes | **yes** | gated markets' model fields are nulled |

Only `on` nulls anything. `off` performs zero database work, so merging the
mechanism adds no query load, no latency, and no new failure surface.

## Rollout ladder

1. **Merge with the flag unset.** Confirm the feed is unchanged. There is
   nothing to verify beyond "nothing happened" — that is the point.
2. **Set `MLB_MARKET_GATE_MODE=log`.** Railway restarts the service. Watch the
   logs for one line per snapshot load (30s TTL, so roughly every 30s under
   traffic):
   ```
   [MlbMarketGates] mode=log source=fresh gated=[fg_ml,fg_rl,...] missing=[]
   ```
   - `gated=[]` with `missing=[publish_...×9]` means **the rows are not there**.
     Enforcing would then be a silent no-op. Resolve before going further.
   - `gated=[...nine keys...]` confirms the audit's verdict rows are live.
3. **Decide the product question below.** It is not an engineering question.
4. **Set `MLB_MARKET_GATE_MODE=on`.** Effective on every replica within one
   snapshot TTL (≤30s) after restart.

**Rollback is a variable edit, `on` → `off`.** No deploy, no cache purge, no
migration. That is the whole reason the flag exists.

## ⚠️ Decide this BEFORE flipping to `on`

The subscriber feed renders exactly **three** of the nine markets — Run Line,
Total, and Moneyline (`fg_rl`, `fg_total`, `fg_ml`). All three are currently
gated `0`. With `on`, all three null, and the card falls through to the
`verdictOf(null)` branch, which renders **PASS**.

That is wrong, and it is the same class of defect as the `unplayable ≠ pass`
fix in PR #413: *"we have no publishable model for this game"* is not the same
statement as *"the model says pass on this game."* One is an absence, the other
is a recommendation.

So flipping to `on` without a distinct "not published" card state would ship a
misleading claim to paying subscribers. Two honest options:

- **A — add the state first.** Route a `/ui-loop` change for a "model
  withheld" treatment, then flip. Correct, and slower.
- **B — flip selected markets only.** Set the rows for the markets you are
  willing to withhold and leave the feed's three at `1`. The gate is per-market
  precisely so this is possible.

Do not flip all nine and accept PASS semantics.

## Flipping an individual market

The rows are plain key/value rows; no migration is involved.

```sql
-- publish a market
UPDATE mlb_calibration_constants
   SET previousValue = currentValue,
       currentValue  = 1,
       updateSource  = 'MANUAL',
       lastUpdatedAt = UNIX_TIMESTAMP() * 1000
 WHERE paramName = 'publish_fg_total';

-- withhold a market
UPDATE mlb_calibration_constants
   SET previousValue = currentValue,
       currentValue  = 0,
       updateSource  = 'MANUAL',
       lastUpdatedAt = UNIX_TIMESTAMP() * 1000
 WHERE paramName = 'publish_fg_total';
```

The nine paramNames: `publish_fg_ml`, `publish_fg_rl`, `publish_fg_total`,
`publish_f5_ml`, `publish_f5_rl`, `publish_f5_total`, `publish_nrfi_yrfi`,
`publish_k_props`, `publish_hr_props`.

A row change takes effect within one snapshot TTL (≤30s). No restart needed.

## Failure policy — fail-open, deliberately

| Situation | Behavior |
|---|---|
| Row absent | market publishes (documented intent) |
| Row malformed / empty / non-numeric | market publishes, `WARN` |
| DB read throws or exceeds 1s | last **successful** snapshot at any age; if none ever loaded, all markets publish; `[MlbMarketGates][CRITICAL]` |

This gate is an **editorial signal about backtest confidence, not an access
control boundary.** The security boundary is `stripGameModelFields()`, which is
pure, in-memory, and unaffected by database faults — so a gate failure can never
leak model IP to an anonymous caller.

Failing closed would convert a transient TiDB blip into a total product outage
for paying subscribers at exactly the moment `db.ts`'s `_lastGoodCache` is
serving stale rows specifically to keep the feed alive. Fail-open degrades to
today's shipped behavior, which is the safest degradation target for a change
whose premise is "the default preserves today's behavior."

The stale-snapshot fallback has **no age limit**, on purpose: an hours-old
snapshot still reflects the owner's last intent better than reverting to
all-published, and an expiry would let a long outage silently un-gate the feed.

If a regulatory obligation ever requires the opposite trade-off, add a fourth
value `on-strict` that fails closed. Do **not** change what `on` means.

## What is covered

| Surface | Procedure | Gated |
|---|---|---|
| Feed | `games.list` | yes — no owner exemption, deliberately |
| K props | `strikeoutProps.getByGame` / `.getByGames` | yes, owner-exempt |
| HR props | `hrProps.getByGame` / `.getByGames` | yes, owner-exempt |
| Dime Chat | `dimeChatContext` retrieval | yes |
| Owner backtest routers | `mlbBacktest.*` (`ownerProcedure`) | no — the BACKTEST-ONLY audience |

`games.list` has no owner exemption on purpose: `/admin/model-results` consumes
it only for game ids and team names, and exempting owners there would create a
verification blind spot — an owner loading `/feed` must see what a subscriber
sees.

## What this does NOT fix

- `server/mlbModelRunner.ts:4337-4338` still writes `publishedToFeed: true,
  publishedModel: true` unconditionally. The gate is a **read-side** control.
- `server/mlbPublicationGate.ts` is still dead code. It is a decision-*producing*
  scorer (n≥30, acc≥0.70, ROI>0, ECE<0.05) whose criteria are not the criteria
  that produced `GATE-TABLE.json`; wiring it would have meant enforcing a
  different rule than the audit's. Left untouched, still unreferenced.
