# ISSUE-003 — Reconcile three contradictory price sets

**Wave:** 1 — Customer truth · **Effort:** S · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-002
**Doctrine:** D6 (artifact law) · D15 #8 · §19 compliance gate

---

## Scope

Three price sets ship simultaneously. Live checkout charges **$49.99 / $99.99 / $199.99** (Pro /
Sharp / Max). The bot prerender advertises **$99 / $249 / $499** (Pro / Sharp / **Operator** — a tier
that no longer exists) with live checkout links and schema.org `offers`. The objections block sells
"≈ $3.30 a day". And the **HONESTY LAW header itself is stale**, blessing the prerender's numbers.

The prerender is served to bots only — including `claude-web`, `openai`, `perplexitybot`, `chatgpt`
— so nobody is overcharged in-flow, but **every indexed, social, and AI-assistant surface states a
wrong price.**

Fix: make `TIERS` the single source and **generate** the prerender's pricing from it, so the
duplication becomes structurally impossible rather than resynced once.

## Files

- Modify: `client/src/pages/dime/landing/landing-content.ts` (HONESTY LAW header; objections block; add Free Preview + Founder as non-checkout tiers using the existing `action: {type:"scroll"|"apply"}` variants at `:289`)
- Modify: `server/landingPrerender.ts` (derive the pricing table, the schema.org `offers`, and the pricing FAQ answer from `TIERS`)
- Create: `server/landingPricingParity.test.ts`

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Every price string rendered by `landingPrerender.ts` is **derived from `TIERS`**, not literal
- [ ] The schema.org `offers` block and the pricing FAQ answer both derive from `TIERS`
- [ ] The string `Operator` appears **nowhere** in customer-facing copy or prerender output
- [ ] `/checkout?plan=…` links in the prerender use **real** plan ids (`dime-pro` / `dime-sharp` / `dime-max`), not `pro`/`sharp`/`operator`
- [ ] The HONESTY LAW header lists the **live** prices
- [ ] A test asserts prerender-vs-`TIERS` price parity and **fails** if a price is hardcoded — verified by the TDD red-green cycle
- [ ] The unverified `"124 enforcement tests"` claim at `landingPrerender.ts:384` is either recounted and corrected, or removed

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# Red: the parity test must fail before the fix
npx vitest run server/landingPricingParity.test.ts 2>&1 | tail -20     # expect FAIL

# Green: after
npx vitest run server/landingPricingParity.test.ts 2>&1 | tail -5      # expect PASS
npx vitest run server/landingPrerender.test.ts 2>&1 | tail -5          # expect PASS (no regression)

# No stale tier name anywhere customer-facing
git grep -n "Operator" -- client/src server/landingPrerender.ts        # expect: no hits

# Live check after deploy
curl -s -A "Googlebot/2.1" https://aisportsbettingmodels.com/ | grep -oE '\$[0-9]+(\.[0-9]+)?' | sort -u
```

## Depends on

None. **Independently shippable today.**

## If the ruling differs

If DR-002 is ruled the other way (raise prices to $99/$249/$499), this becomes a Stripe price
migration with grandfathering and customer comms — a materially larger, higher-risk issue that
needs its own plan.

## Notes

**Stopgap available.** If the generated approach will take more than a day, delete the prerender's
price block, `offers`, and pricing FAQ immediately. **A missing price is not a false price.**
