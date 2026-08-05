# Builder resolution — the Dockerfile IS the builder; RAILPACK is not running

**Date:** 2026-08-05 · **Closes:** ISSUE-017 · **DRI:** Prez · **Investigator:** Fable 5 (executor)
**Method:** Railway build logs for deployment `4b55b680-474d-478a-9ff3-1c37afdfc736` (status
SUCCESS), read-only, plus direct reads of `Dockerfile`, `package.json`, `server/mlbDriftDetector.ts`,
`server/mlbModelRunner.ts`.

---

## Verdict: REFUTED. The earlier finding was wrong, and wrong in the alarming direction.

Gap **F7.7** and DR-014's fact **P2** both asserted that Railway builds with **RAILPACK** rather
than the Dockerfile, and concluded this "resolves the builder UNKNOWN **in the dangerous
direction**" — because the Python model runners hardcode `/usr/bin/python3`, which a Nixpacks-style
builder cannot provide, and that mismatch is the documented root cause of the historical
`spawn /usr/bin/python3 ENOENT` failure.

**The build log refutes this outright.** [VERIFIED]

```
[build 8/8]     RUN pnpm run build
[stage-2 2/8]   RUN apt-get update && apt-get install -y --no-install-recommends \
                    python3 python3-numpy python3-pandas python3-sc[ipy] …
[stage-2 3/8]   RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm …
[stage-2 4/8]   WORKDIR /app
[proddeps 6/6]  RUN pnpm install --prod --frozen-lockfile
[stage-2 5/8]   COPY --from=proddeps /app/node_modules ./node_modules
[stage-2 6/8]   COPY --from=build /app/dist ./dist
exporting to docker image format
containerimage.digest: sha256:cb8cf688d89349078552669ce5f41c012231d72728286ad2eff0f6a3ae5f7ac9
[1/1] Healthcheck succeeded!
```

**Zero occurrences of `railpack` or `nixpacks` anywhere in the 61-line build log.** Named Docker
build stages (`build`, `proddeps`, `stage-2`), a real `apt-get install`, and an OCI image digest.

### Why the earlier finding was believed

`get-service-config` reports `"builder":"RAILPACK"` for both services. That is a **stale persisted
dashboard field**. `railway.json` declares `"builder": "DOCKERFILE"`, and Railway's config-as-code
overrides the dashboard at deploy time — which is exactly the benign explanation the coherence
critic offered but could not confirm without a build-log read. It could not be settled from the
config API alone, and it was not.

### Why my corroborating inference was also wrong

I argued that a ~48-54 s deploy was "far too fast" for a Dockerfile that apt-installs chromium plus
numpy/pandas/scipy, and offered that as independent corroboration. **That inference was unsound.**
The apt layer is **Docker-layer-cached** — it only re-runs when the Dockerfile's earlier layers
change. A ~50 s cached build is entirely normal. I reasoned from duration to builder identity
without accounting for caching, and it produced a confident wrong answer.

---

## What is actually true — the full runtime chain, VERIFIED

| Link | Evidence |
|---|---|
| Python interpreter exists at `/usr/bin/python3` | `[stage-2 2/8] apt-get install python3 python3-numpy python3-pandas python3-scipy` |
| The model scripts reach the image | `package.json` `build:server` copies all five `.py` files into `dist/`; `Dockerfile:130` `COPY --from=build /app/dist ./dist` |
| The runner resolves them correctly | `mlbModelRunner.ts:46` `ENGINE_PATH = path.join(__dirname, "MLBAIModel.py")`; `__dirname` is `/app/dist` under the esbuild single-file bundle |
| The five runners present | `MLBAIModel.py`, `StrikeoutModel.py`, `nhl_model_engine.py`, `ActionNetworkHRPropsAPI.py`, `ActionNetworkF5NrfiAPI.py` |

**The Python model runners are not broken. There is no ENOENT risk. The historical failure the
Dockerfile exists to prevent is being prevented.**

## Two things this investigation found in passing

**1. `#362`'s KNOWN-FINDING-2 has already been remediated.** That PR reported 5 fixable CRITICAL
CVEs shipping in the production image — node-tar from the base image's global npm, and Go-stdlib
CVEs in esbuild binaries that shipped because the image was single-stage. The current Dockerfile is
**multi-stage** (`build` / `proddeps` / `stage-2`) with `pnpm install --prod --frozen-lockfile` and
an explicit `rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx
/usr/local/bin/corepack`. That is precisely the remediation ranked best in AUDIT §8. It is why
`Trivy` and `09-artifact-build-and-smoke` now pass.

**2. The `.dockerignore` change from PR #377 is consulted after all**, and therefore does real work.
My earlier note that it was "probably moot under RAILPACK" is withdrawn.

---

## The correction that matters: ISSUE-012 gets *worse*, not better

ISSUE-012 recorded an aggravating possibility: *under RAILPACK the drift detector's self-patch may
silently no-op, and an automation whose effect status is unknown is worse than one known to fire.*

The effect status is now known, and it is a third case neither option anticipated:

- `MODEL_PY = path.resolve(__dirname, "MLBAIModel.py")` → `/app/dist/MLBAIModel.py` at runtime
- That file **is** in the image, and the Dockerfile declares **no `USER`**, so the process runs as
  root and `/app/dist` **is writable**
- **So the self-patch fires, succeeds, and takes effect immediately — live, ungated.**

But the container filesystem is **ephemeral**, and this repo deploys roughly **13 times a day**.
So every recalibration the drift detector performs is **silently discarded at the next deploy**,
reverting to the constants baked into the image from git.

**The consequence is sharper than either "it works" or "it's broken":**

1. The ungated self-promotion risk is **real** — a bad recalibration ships itself to production
   with no proposal record and no approval, and serves customers until the next deploy.
2. Every adjustment is **erased within hours**, so the model oscillates between git-baked constants
   and drift-patched ones on a cadence set by unrelated merges.
3. `mlb_model_learning_log` records the recalibration as *having happened*. **The artifact says the
   model learned; the runtime reverted.** Record and reality disagree, and nothing reconciles them.

That third point is the doctrine failure: it is D15 #9 (generated output mistaken for completion)
sitting inside the loop that D16 criterion 3 depends on.

## Status changes

| Artifact | Was | Now |
|---|---|---|
| Audit §8 UNKNOWN "which Railway builder runs" | UNKNOWN | **RESOLVED — Dockerfile** [VERIFIED] |
| Gap **F7.7** | open, "dangerous direction" | **RESOLVED — safe direction** |
| DR-014 fact **P2** | VERIFIED (wrongly) | **REFUTED** |
| **ISSUE-017** | open | **CLOSED — premise refuted** |
| **ISSUE-012** | open | open, **re-scoped**: Phase 1 is no longer "does it fire" (it does) but "how many adjustments have been silently discarded, and does `mlb_model_learning_log` overstate what persisted" |
| PR #377's `.dockerignore` change | "probably moot" | **consulted and load-bearing** |

## Lesson filed

`os/memory/lessons/config-api-is-not-runtime-truth.md` — a configuration API reports what a field
*says*, not what the system *did*. Two independent signals (a stale config field and a build
duration) agreed with each other and were both wrong; one build-log read settled it.
