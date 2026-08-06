# Notes — WS-E Task 5

## Evidence gaps

### `nflfastr.nflverse.com` does not resolve

Listed in this task's approved network scope. Tried twice, both times DNS resolution failure:

```
$ curl -sSL --max-time 20 -o ... -w "HTTP %{http_code}\n" "https://nflfastr.nflverse.com/"
curl: (6) Could not resolve host: nflfastr.nflverse.com
HTTP 000
```

(first attempt and retry both 2026-07-26). Confirmed this wasn't a general network outage in the
same window — `curl -sS -o /dev/null -w "HTTP %{http_code}" https://github.com/` returned `HTTP
200` immediately before and after.

`nflfastR`'s own CRAN `DESCRIPTION` (`sources/nflfastR/DESCRIPTION`, local, Task-0-staged) states
its canonical site is `URL: https://nflfastr.com/, https://github.com/nflverse/nflfastR` — no
`nflverse.com` subdomain at all. This strongly suggests the `nflfastr.nflverse.com` hostname in this
task's allowlist is stale (nflfastR's pkgdown site may have moved to `nflfastr.com` at some point,
or the subdomain was never provisioned). Per the evidence-first protocol, I did **not** fetch
`nflfastr.com`, since it is not in this task's approved network scope, and expanding network scope
unilaterally wasn't authorized. Everything nflfastR-specific in `data-licensing.md` was sourced
instead from `sources/nflfastR/DESCRIPTION` (local) and
`raw.githubusercontent.com/nflverse/nflfastR/master/README.md` (an explicitly in-scope host), both
of which turned out to be more directly useful for the provenance narrative than a pkgdown homepage
would have been anyway (the README's "Special thanks" section is where the concrete data-source
credits live).

**Impact on Step 5 acceptance:** none of the load-bearing quotes in `data-licensing.md` or
`commercial-posture.md` depend on this host — the data-licensing (CC-BY-4.0) and code-license (MIT)
findings both come from `nflreadr.nflverse.com`, `api.github.com`, and `raw.githubusercontent.com`,
all of which resolved and were fetched successfully. This gap only means I have no direct pkgdown-
site quote *specifically* attributed to an `nflfastr.nflverse.com` URL; the equivalent content was
obtained from in-scope alternates as described above.

## Methodology notes

### SPDX normalization vs. R's own `tools:::analyze_license()`

R 4.6.1 is installed locally on this machine (`/opt/homebrew/Cellar/r/4.6.1`), so I cross-checked
every distinct License-field string against R's own canonical license-analysis tool
(`tools:::analyze_license()`, the same function `R CMD check --as-cran` uses) rather than relying
solely on my own reading of the `Writing R Extensions` License-field grammar. For most strings the
two agree exactly (e.g. `MIT + file LICENSE` → `MIT`; `Apache License (>= 2)` → `Apache-2.0`;
`BSD_3_clause + file LICENSE` → `BSD-3-Clause`). Two cases diverge, and I want the divergence on the
record rather than silently picking one:

For `GPL (>= 2)` and bare `GPL`, R's tool computes `spdx: "GPL-2.0-only OR GPL-3.0-only"` — not the
more common `-or-later` idiom. This is because R's bundled license database
(`share/licenses/license.db`, inspected directly: `grep -n "^Name:" license.db`) only contains two
GPL entries at all — "GNU General Public License" version 2 and version 3 — so its expansion of
`(>= 2)` is literally "whichever of the two GPL versions I know about are >= 2," i.e. a closed set
`{GPL-2, GPL-3}`, not an open-ended "this version or any later one" grant. I used the standard
`-or-later` SPDX idiom (`GPL-2.0-or-later`) in the CSV instead, because it's the more literal and
more standard reading of the DESCRIPTION file's own `(>= 2)` syntax (it doesn't arbitrarily cap the
grant at a version number that happens to be the newest one R's own bundled database knows about),
and it's what most SPDX tooling outside the R ecosystem would produce for the same input. For bare
`GPL` (no operator at all — `highr`, `knitr`, `mime`), I kept R's own closed-set answer
(`GPL-2.0-only OR GPL-3.0-only (ambiguous)`) rather than inventing an "-or-later" reading with no
operator to hang it off of, and flagged it as ambiguous in both the CSV cell and
`copyleft-flags.md`, since the DESCRIPTION genuinely states no version at all.

Full `tools:::analyze_license()` output for all 15 distinct license strings was captured during this
audit (not persisted as a separate artifact — reproducible in ~1 second via
`Rscript -e 'tools:::analyze_license("GPL (>= 2)")'` etc. against this same R installation) and used
to sanity-check every row of `license-inventory.csv`, not just the two divergent cases.

### "Unlimited" (labeling package's alternative license)

`labeling`'s License field is `MIT + file LICENSE | Unlimited` — MIT *or*, at the licensee's choice,
"Unlimited." `Unlimited` is not a named entry in R's own `share/licenses/license.db` (verified:
`grep "^Name:" license.db` lists 30 named licenses, no "Unlimited" among them), but
`tools:::analyze_license("Unlimited")` still resolves it as a recognized, standardizable R license
string with `is_FOSS: TRUE`, `restricts_use: FALSE`, and `spdx: ""` (no SPDX equivalent — it's an
R-specific convention, not a real SPDX identifier). I normalized `labeling` to `MIT OR Unlimited` in
the CSV. This doesn't change `labeling`'s practical classification (`copyleft=no` either way — MIT
alone is already fully permissive) but is recorded here since I could not source CRAN's own prose
definition of "Unlimited" without leaving this task's approved network scope (`cran.r-project.org`
is not on the allowlist), so I'm relying on R's locally-installed `tools` package behavior
(`is_FOSS`/`restricts_use` flags) rather than a quotable external definition.

### `license_file_present` computed live, not transcribed

The CSV's `license_file_present` column was generated by a Python script scanning
`sources/<pkg>/` on the filesystem at build time (`os.listdir`, matching any top-level file whose
name starts with `LICENSE` or `LICENCE`, case-insensitive) — not hand-typed from an earlier `find`
command's output, to eliminate transcription risk across 90 rows. Cross-validated automatically: for
every one of the 90 rows, `license_file_present=yes` if and only if the declared license string
contains a `+ file LICENSE` or `| file LICENSE` token, or is exactly `file LICENSE` — zero
exceptions. Script: `build_inventory.py` (scratch working file, not part of the deliverable set;
logic and constants are fully reproduced in `copyleft-flags.md`'s Method section for anyone
re-deriving the CSV).

### `license_declared` verbatim-match check

After generating `license-inventory.csv`, I ran an automated diff against
`installed-manifest.csv`: all 90 `license_declared` cells match the manifest's `license` field
byte-for-byte, all 90 packages appear exactly once, `copyleft` is one of `{yes,no,weak}` and
`license_file_present` is one of `{yes,no}` for every row, and `spdx_normalized` is non-empty for
every row. Zero mismatches.

## Other caveats

- `data.table`'s `MPL-2.0 | file LICENSE` and the `MPL-2.0 | file LICENSE` pattern generally: I read
  `sources/data.table/LICENSE` in full (373 lines) and confirmed it is the unmodified, unmodified-
  by-dual-licensing MPL-2.0 text — no proprietary/commercial dual-license surprise.
- I read every `LICENSE.note` file in the closure (6 total: `bslib`, `cli`, `farver`, `fastmap`,
  `rlang`, `vctrs` — the complete set per `find sources -maxdepth 2 -iname LICENSE.note`), not just
  a sample, since these are exactly where a "declared license doesn't match shipped content"
  surprise would hide. Only `vctrs` changed classification (MPL-2.0 fragment); the other five bundle
  permissive-only third-party notices (MIT, BSD-2-Clause, Apache-2.0, public domain).
- I did **not** read all 64 `MIT + file LICENSE` packages' `LICENSE` files individually line-by-line
  — instead I checked the line count of every top-level `LICENSE` file across all 90 packages in one
  pass (`wc -l`) as an anomaly-detection proxy: the standard MIT stub is exactly 2 lines
  (`YEAR: …` / `COPYRIGHT HOLDER: …`), and every file that was *not* 2 lines (`stringi` 493,
  `data.table` 373, `utf8`/`xgboost` ~201-202, `yaml` 3, `bigD`/`commonmark`/others still 2) was
  individually opened and read in full, as documented in `copyleft-flags.md` and
  `license-inventory.csv`. Every anomaly found this way turned out to be either the full text of a
  named permissive/copyleft license (Apache-2.0 for `utf8`/`xgboost`, MPL-2.0 for `data.table`) or a
  slightly longer MIT-family stub with an extra `ORGANIZATION:` line (`yaml`) — nothing hidden.
- `stringi`'s `Authors@R`/`DESCRIPTION` also carries `License_is_FOSS: yes` as an explicit
  self-declared field (a real, if non-standard, `DESCRIPTION` field CRAN recognizes for exactly this
  "License: file LICENSE" situation) — consistent with, and additional first-party confirmation of,
  the "primarily permissive" reading in `copyleft-flags.md`.

## Acceptance self-check (re-run at end of task)

- `license-inventory.csv`: 90 data rows (`tail -n +2 ... | wc -l` → 90), header matches the required
  contract exactly: `package,license_declared,spdx_normalized,copyleft,license_file_present`.
- Every quoted term in `data-licensing.md` and `commercial-posture.md` carries an explicit URL (or,
  for the handful of local-file citations — `sources/nflfastR/DESCRIPTION`,
  `sources/stringi/LICENSE`, `sources/vctrs/LICENSE.note`, `sources/data.table/LICENSE` — an
  explicit local file path, since those aren't network resources) and an access/read date
  (2026-07-26 throughout).
- Scanned my own quotes a second time for paraphrase-presented-as-quote: every `>` blockquote or
  inline double-quoted string in `copyleft-flags.md`, `data-licensing.md`, and
  `commercial-posture.md` was checked character-by-character against the corresponding source file
  in `evidence/ws-e/raw/` or `sources/`. One correction made during self-review: the "Game/Schedule"
  cadence row originally risked silently "fixing" the source's typo ("updates very 5 minutes",
  presumably meant "every"); left verbatim with `[sic]` noted instead of silently correcting it,
  since the instruction is to quote exactly, not to clean up the source's own grammar.
