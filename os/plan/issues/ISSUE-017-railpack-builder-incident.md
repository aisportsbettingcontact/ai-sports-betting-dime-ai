# ISSUE-017 — Resolve RAILPACK-vs-Dockerfile and file the incident

**Wave:** 4 — Certification · **Effort:** S · **Status:** **CLOSED 2026-08-05 — premise REFUTED** · **DRI:** Prez
**Ruling dependency:** P2 (unowned by every record)
**Doctrine:** D15 #9 · gap F7.7 · production correctness

---

## Resolution (2026-08-05)

**CLOSED. The premise was wrong.** The Dockerfile IS the builder; RAILPACK is not running.
Build log for live deployment `4b55b680` shows `[stage-2 2/8] RUN apt-get install python3
python3-numpy python3-pandas python3-scipy`, named Docker stages, and an OCI image digest, with
**zero** `railpack`/`nixpacks` occurrences. `/usr/bin/python3` exists; all five `.py` runners are
copied into `dist/` by `build:server` and into the image by `Dockerfile:130`. **No ENOENT risk.**

Full finding, including what this changes for ISSUE-012: `os/audits/2026-08-05-builder-resolution.md`

---

## Original scope — SUPERSEDED, retained for the record

> **Everything below this line is the original, REFUTED framing.** It is kept so the record shows
> what was believed and when. It is not a current claim. See the Resolution above.

`railway.json` declares `"builder": "DOCKERFILE"`. The live Railway config for **both** services
reports `"builder": "RAILPACK"` — VERIFIED read-only *(this reading was wrong; the field is stale
dashboard state)*.

This resolves the Stage 1 audit's builder UNKNOWN **in the dangerous direction**. The Python model
runners hardcode `/usr/bin/python3` and `/usr/bin/python3.11`, and `Dockerfile:1-7` documents at
length that Nixpacks-style builders cannot provide those paths — that mismatch is the recorded root
cause of the historical `spawn /usr/bin/python3 ENOENT` failure the Dockerfile exists to prevent.

Corroborating oddity: a recent deploy completed in **~74 seconds**, fast for a Dockerfile that
apt-installs chromium plus numpy/pandas/scipy and runs a full Vite + esbuild build.

**One build-log read resolves this.** It is currently unowned by every decision record, including
DR-014.

## Files

- Investigate: Railway build logs for the current deployment (read-only)
- Modify (contingent): `railway.json` or the service config, so declared and actual agree
- Create: a numbered `INCIDENTS.md` entry

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] The actual builder is determined **from a build log**, not inferred
- [ ] Whether MLB model runs are succeeding in production **at all** is established — this is the real stake
- [ ] Declared intent (`railway.json`) and actual behaviour are reconciled in one direction or the other
- [ ] A numbered `INCIDENTS.md` entry is filed, with the tail of the file re-read immediately before writing to avoid the collision documented in `os/memory/lessons/incident-numbers-collide.md`
- [ ] If the model runners are failing silently, that is a **separate P0** and gets its own issue — do not fold it into this one

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# Read the build log for the live deployment (read-only Railway MCP)
# then confirm the runner actually executes in production:
curl -s https://aisportsbettingmodels.com/api/trpc/games.list?batch=1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('modelRunAt present:', 'modelRunAt' in str(d))"

git grep -n "usr/bin/python3" server/ | head
```

## Depends on

None. **Independently investigable today.**

## If the ruling differs

No record owned this. It surfaced during the DR-014 coherence review and was explicitly left
unassigned there, which is why it is an issue rather than a footnote.
