# PR #244 post-merge governance evidence

This package freezes the read-only production observations collected after
merge commit `58232f3036aef1a3cfc49284c589fda5c8798d09` deployed to both Railway
application services.

## Outcome

- Railway application and backend SHA parity: `PASS`
- Health and database circuit parity: `PASS`
- Production feed parity: `PASS` (16 of 16 game cards)
- Fresh browser errors: `0`
- Provider: `frozen/no-provider`
- Trace and Research Alpha: disabled
- Research Alpha kill switch: enabled
- Pricing registry: `not_configured`, zero approved entries
- Pricing gate: `REVISE`
- Post-merge governance exception: `OPEN`

The exception does not rewrite PR #244's historical review state.
`prez-ai-sports-betting` must review the exact merge commit and explicitly
accept the six assertions in `observation.json`. A missing verdict remains
`null` and cannot authorize subsequent work.

The candidate configuration observation contains only secret-safe state and
code-derived settings. Neither provider endpoint was invoked. No Railway
deployment, variable change, pricing entry, provider activation, tracing,
shadow traffic, route activation, model training, or Research Alpha change was
performed.
