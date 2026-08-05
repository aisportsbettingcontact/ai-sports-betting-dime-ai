# A config API reports what a field says, not what the system did — and two agreeing signals can both be wrong

**Verified 2026-08-05, by refuting my own finding.**

Railway's `get-service-config` reported `"builder":"RAILPACK"` for both services. I treated that as
VERIFIED, recorded it as gap F7.7 and DR-014 fact P2, and concluded it resolved an audit UNKNOWN "in
the dangerous direction" — because the Python model runners hardcode `/usr/bin/python3`, which a
Nixpacks-style builder cannot supply.

Then I found what looked like independent corroboration: deploys completing in ~48-54 s, which I
argued was "far too fast" for a Dockerfile that apt-installs chromium plus numpy/pandas/scipy.

**Both signals were wrong, and they agreed with each other, which made the conclusion feel solid.**

- The config field is **stale persisted dashboard state**. `railway.json` declares
  `"builder": "DOCKERFILE"` and Railway's config-as-code overrides the dashboard at deploy time.
- The duration argument ignored **Docker layer caching**. A cached `apt-get` layer does not re-run.
  ~50 s is normal, not anomalous.

One read of the actual build log settled it in seconds: named Docker stages, a real `apt-get
install`, an OCI image digest, and **zero occurrences of `railpack` or `nixpacks`**.

**Why it mattered:** the false finding propagated into four artifacts (the audit, the gap map,
DR-014, ISSUE-012) and made a healthy production path look broken. It also nearly buried the *real*
finding underneath it — the drift detector's self-patch does fire, writes successfully to a
root-owned ephemeral filesystem, and is then erased by the next of ~13 daily deploys, while
`mlb_model_learning_log` records that it learned.

**How to apply:**
1. **A config API answers "what is declared", never "what ran."** For build/deploy behaviour, read
   the build log. `OPERATING-RULES.md` §7 already says this: *code is intent, runtime is truth* —
   config is also only intent.
2. **Two agreeing weak signals are not one strong signal.** Ask what would make *both* wrong at
   once. Here, a single cause did: neither observed the build.
3. **Beware inference from duration, size, or timing** to a categorical claim about mechanism.
   Caching, warm starts, and CDNs break those inferences routinely.
4. When config-as-code and a dashboard field disagree, **config-as-code usually wins at deploy
   time** — and the dashboard field will keep reporting the stale value indefinitely.

Related: [[fixture-verified-is-not-production-verified]], [[numbers-in-narratives-are-usually-generated]].
