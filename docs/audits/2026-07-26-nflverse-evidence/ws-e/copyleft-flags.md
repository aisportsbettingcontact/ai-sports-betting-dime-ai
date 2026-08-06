# Copyleft flags — WS-E Task 5, Step 1

Scope: the 90 packages in `evidence/installed-manifest.csv` (the hard-dependency closure of
nflverse 1.0.3, nflreadr 1.5.1, nflfastR 5.2.0, nflseedR 2.0.2, nfl4th 1.0.7, nflplotR 1.6.0).
Full per-package classification: `evidence/ws-e/license-inventory.csv`.

## Method

1. Took the `license` field verbatim from `installed-manifest.csv` for all 90 packages (15
   distinct strings).
2. Normalized each string to an SPDX expression using the literal grammar of R's own
   `DESCRIPTION` License-field syntax (`Writing R Extensions`): `|` = alternative → SPDX `OR`;
   `(>= N)` = version-or-later → SPDX `N.0-or-later`. Cross-checked the result against R
   4.6.1's own `tools:::analyze_license()` (installed locally at
   `/opt/homebrew/Cellar/r/4.6.1/lib/R`, invoked 2026-07-26) — see `notes.md` for the two
   version-range cases where R's own tool computes a different (narrower) expression than the
   standard `-or-later` idiom, and why I kept `-or-later` in the CSV.
3. For every package whose License field was itself ambiguous or pointed at `file LICENSE`
   (`stringi`), and for every package shipping a `LICENSE.note` (`bslib`, `cli`, `farver`,
   `fastmap`, `rlang`, `vctrs` — the complete set, found via
   `find sources -maxdepth 2 -iname LICENSE.note`), I read the actual file contents rather than
   trusting the declared field. Two of those reads changed the classification below.
4. `license_file_present` in the CSV was computed by scanning the filesystem live
   (`sources/<pkg>/LICENSE*` or `LICENCE*` at top level) — not hand-transcribed — and
   cross-validated: every package whose declared license contains a `+ file LICENSE` / `| file
   LICENSE` token has `license_file_present=yes`, and every package without that token has
   `license_file_present=no`, with zero exceptions across all 90 rows.

## Strong copyleft (GPL family) — `copyleft=yes` — 14 of 90 packages

| package | license_declared | spdx_normalized | how it enters the closure (hard-dep chain from a target, per `evidence/ws-a/dep-edges.csv`) |
|---|---|---|---|
| gsubfn | `GPL (>= 2)` | GPL-2.0-or-later | `nflseedR` →(Imports) `gsubfn` — **direct** dependency of a target package |
| proto | `GPL-2` | GPL-2.0-only | `nflseedR` → `gsubfn` →(Depends) `proto` |
| base64enc | `GPL-2 \| GPL-3` | GPL-2.0-only OR GPL-3.0-only | `nflplotR` →(Imports) `gt` →(Imports) `base64enc` |
| bitops | `GPL (>= 2)` | GPL-2.0-or-later | `nflplotR` → `gt` →(Imports) `bitops` |
| htmltools | `GPL (>= 2)` | GPL-2.0-or-later | `nflplotR` → `gt` →(Imports) `htmltools` |
| Rcpp | `GPL (>= 2)` | GPL-2.0-or-later | `nflplotR` →(Imports) `magick` →(Imports+LinkingTo) `Rcpp` |
| digest | `GPL (>= 2)` | GPL-2.0-or-later | `nflfastR`/`nflseedR` →(Imports) `future` →(Imports) `digest` |
| rmarkdown | `GPL-3` | GPL-3.0-only | `nflplotR` → `gt` →(Imports) `htmlwidgets` →(Imports) `rmarkdown` |
| knitr | `GPL` (bare) | GPL-2.0-only OR GPL-3.0-only (ambiguous — see below) | …→ `htmlwidgets`/`rmarkdown` →(Imports) `knitr` |
| highr | `GPL` (bare) | GPL-2.0-only OR GPL-3.0-only (ambiguous) | …→ `knitr` →(Imports) `highr` |
| mime | `GPL` (bare) | GPL-2.0-only OR GPL-3.0-only (ambiguous) | …→ `rmarkdown` →(Imports) `bslib` →(Imports) `mime` |
| snakecase | `GPL-3` | GPL-3.0-only | `nfl4th`/`nflfastR` →(Imports) `janitor` →(Imports) `snakecase` |
| timechange | `GPL (>= 3)` | GPL-3.0-or-later | `nfl4th`/`nflfastR` → `janitor` →(Imports) `lubridate` →(Imports) `timechange` |
| stringi | `file LICENSE` | see "unusual grant" below | `nfl4th`/`nflfastR` → `janitor` →(Imports) `stringi` (also via `stringr`) |

Every edge cited above is `Imports`, `Depends`, or `LinkingTo` (never `Suggests`) at every hop —
confirmed against `evidence/ws-a/dep-edges.csv` row by row, not inferred. `evidence/ws-a/reachability.txt`
independently confirms all 90 installed packages, including these 14, sit inside the hard-dependency
closure of the 6 targets (zero orphans), so none of this is incidental/unused cruft.

None of the copyleft exposure originates in nflverse's *own* code: all six target packages
(`nflverse`, `nflreadr`, `nflfastR`, `nflseedR`, `nfl4th`, `nflplotR`) declare `MIT + file LICENSE`,
confirmed against each one's own `LICENSE` file (`YEAR: … / COPYRIGHT HOLDER: …` MIT stub) in
`sources/<pkg>/LICENSE`. The GPL packages are all transitive tooling: report/HTML generation
(`gt`, `htmltools`, `htmlwidgets`, `rmarkdown`, `knitr`, `highr`, `bslib`→`mime`, `base64enc`,
`bitops`), a string/name-cleaning helper (`janitor`→`snakecase`), date handling
(`lubridate`→`timechange`), parallelism (`future`→`digest`), an R/C++ bridge (`Rcpp`, pulled in by
`magick`), and one SQL-style string-interpolation package pulled directly by `nflseedR`
(`gsubfn`→`proto`).

## Weak copyleft (LGPL / MPL) — `copyleft=weak` — 4 of 90 packages

| package | license_declared | spdx_normalized | how it enters the closure |
|---|---|---|---|
| globals | `LGPL (>= 2.1)` | LGPL-2.1-or-later | `nflfastR`/`nflseedR` →(Imports) `future` →(Imports) `globals` |
| parallelly | `LGPL (>= 2.1)` | LGPL-2.1-or-later | `nflfastR`/`nflseedR` → `future` →(Imports) `parallelly` |
| data.table | `MPL-2.0 \| file LICENSE` | MPL-2.0 | **Direct** `Imports` of `nfl4th`, `nflfastR`, `nflplotR`, `nflreadr`, `nflseedR` (5 of the 6 targets) and of `xgboost` |
| vctrs | `MIT + file LICENSE` | see "unusual grant" below | Deep transitive (tidyverse plumbing: `dplyr`, `tibble`, `tidyr`, `ggplot2`, `gt`, `stringr`, `purrr`, `hms`, `pillar`, `furrr`, `tidyselect` — 11 hard requirers) |

`data.table` is the single most consequential entry on this list for a real-money product: it is a
**direct, first-order** dependency of five of the six audited nflverse packages (verified in
`evidence/ws-a/dep-edges.csv`: `nfl4th,data.table,Imports`; `nflfastR,data.table,Imports`;
`nflplotR,data.table,Imports`; `nflreadr,data.table,Imports`; `nflseedR,data.table,Imports`), not a
distant transitive dependency several levels down. `data.table`'s `LICENSE` file was read in full
(373 lines) and is the unmodified Mozilla Public License Version 2.0 text — no dual-license or
proprietary surprise.

## Two "unusual grants" found only by reading LICENSE files (not visible from the declared field)

### `stringi` — declared `file LICENSE`, actual content is mixed

`stringi`'s `DESCRIPTION` License field is just `file LICENSE` (R's own `tools:::analyze_license()`
returns `is_FOSS: NA` for that string alone — it cannot be resolved without reading the file). The
`sources/stringi/LICENSE` file (493 lines) turns out to bundle **four** different grants:

1. stringi's own R/C++ code: a BSD-3-Clause-pattern notice — "Copyright (c) 2013-2025, Marek
   Gagolewski … Redistribution and use in source and binary forms, with or without modification,
   are permitted provided that the following conditions are met: 1. Redistributions of source
   code must retain the above copyright notice … 3. Neither the name of the copyright holder nor
   the names of its contributors may be used to endorse or promote products derived from this
   software without specific prior written permission." (source: `sources/stringi/LICENSE`, read
   2026-07-26).
2. `stri_stats_latex()` (`src/stri_stats.cpp`), adapted from Kile's LaTeX Word Count algorithm,
   under **GPL, version 2 or later**: "This program is free software; you can redistribute it
   and/or modify it under the terms of the GNU General Public License as published by the Free
   Software Foundation; either version 2 of the License, or (at your option) any later version."
   (same file). This is a real GPL-2.0-or-later grant covering one specific bundled function —
   not the package's primary license, but present in the shipped source.
3. The bundled ICU4C library under the Unicode License v3 / classic ICU License — both permissive,
   MIT-equivalent terms.
4. Several public-domain / BSD-style word-break dictionaries (Chinese/Japanese, Lao, Burmese) and
   the IANA time zone database (explicitly public domain).

Because a real GPL grant is present in the shipped package (item 2), I classified `stringi`
`copyleft=yes` in the CSV rather than folding it into "no" — flagging visibility over
under-statement, per the brief's "never paraphrase weaker than it says." The package's primary/
majority license remains permissive (BSD-3-Clause equivalent).

### `vctrs` — declared `MIT + file LICENSE`, but ships MPL-2.0 files

`sources/vctrs/LICENSE.note` (verbatim, including the source's own curly apostrophes): "The
implementation of vec_order() is based on data.table’s forder() and their earlier contribution to
R’s order(). This warrants placing specific files in the vctrs package under the MPL-2.0 license
used by data.table. Files named with the pattern of `src/order-*.c` and `src/order-*.h` are
additionally under the MPL-2.0 license." (source:
`sources/vctrs/LICENSE.note`, read 2026-07-26). Classified `copyleft=weak` in the CSV for the same
reason as `stringi` above — the file-level MPL-2.0 grant is real, even though the package as a whole
is MIT.

(The other four packages shipping a `LICENSE.note` — `bslib`, `cli`, `farver`, `fastmap`, `rlang` —
were also read in full; all of their bundled third-party notices are permissive-only — MIT, BSD-2-
Clause, Apache-2.0, or public domain — so none changed those packages' classification.)

## AGPL check (explicit)

Searched case-insensitively for `AGPL` and `Affero` across every `DESCRIPTION` and every
`LICENSE*`/`LICENCE*` file in all 90 `sources/<pkg>/` directories
(`grep -rliE "AGPL|Affero" sources --include=DESCRIPTION --include='LICENSE*' --include='LICENCE*'`,
run 2026-07-26). Two files matched: `sources/data.table/LICENSE` and `sources/vctrs/LICENSE.note`.
Both are false positives on inspection — in both files the string appears only inside the MPL-2.0
license text's own definition of "Secondary License" (§1.12), not as a grant of any code:

> "Secondary License" means either the GNU General Public License, Version 2.0, the GNU Lesser
> General Public License, Version 2.1, the GNU Affero General Public License, Version 3.0, or any
> later versions of those licenses.

(source: `sources/data.table/LICENSE` lines 67–71, identical text at `sources/vctrs/LICENSE.note`
lines 75–79; both are local files staged by Task 0, read 2026-07-26.)

**No AGPL-licensed package exists anywhere in this 90-package closure.** This matters because AGPL
is the one common license in this family whose copyleft trigger is *network use*, not just
distribution/conveyance — its absence is what makes the "internal server-side use" framing below
possible to even discuss for this stack.

Also checked explicitly for **CeCILL** and **EPL ("Eclipse Public License")** with the same
grep pattern across all 90 packages' `DESCRIPTION` + `LICENSE*`/`LICENCE*` files: zero hits for
either. Neither appears in `installed-manifest.csv`'s 15 distinct license strings either.

## The distribution question (descriptive only — no legal conclusion)

GPL/LGPL/MPL-family copyleft obligations are conventionally understood (FSF's own GPL FAQ, MPL 2.0
§3.1–3.2) to attach on **distribution / conveyance** of the covered work (or a work built on it) to
a third party — not on purely private or internal use. Two scenarios are worth naming plainly,
without a conclusion about which one currently describes Dime AI's deployment:

- **Scenario A — server-side/internal use.** The 90-package R stack runs on infrastructure Dime AI
  operates, to compute outputs (e.g., projections, play-by-play derived stats) that Dime AI's own
  application layer then serves to end users as data/JSON/UI — not by handing end users the R
  packages, their source, or their compiled object code. Under the common reading of GPL/LGPL/MPL
  (as opposed to AGPL), running software privately/internally and only exposing its *output* is
  not "distribution" of the software itself, so the copyleft obligations (source-availability,
  share-alike, etc.) are not conventionally understood to be triggered. This reading depends on no
  AGPL package being present — confirmed above — since AGPL specifically closes this "SaaS loophole"
  by extending its trigger to network-interactive use, which none of these 14+4 packages carries.
- **Scenario B — actually distributing the code.** If Dime AI ships or redistributes any of these
  packages' source or compiled code to a third party — e.g., bundling R plus these packages into a
  customer-facing artifact, handing a Docker image containing them to an external party, or
  publishing a modified fork of one of them — the copyleft terms of whichever package(s) are
  distributed would attach to that act, and each license's specific mechanics (GPL §5/§6
  source-offer requirements, LGPL's relinking allowance for the LGPL-only packages, MPL's
  file-level "Larger Work" carve-out for `data.table`/`vctrs`) would need to be worked through
  per package, not as a single blanket answer.

Which scenario currently applies to Dime AI's actual deployment is a factual/architectural question
this workstream did not investigate (out of scope for a package-and-license inventory) and is listed
as a counsel-review item in `commercial-posture.md`.

## Tally

| copyleft | count |
|---|---|
| yes (GPL family) | 14 |
| weak (LGPL/MPL) | 4 |
| no (permissive) | 72 |
| **total** | **90** |

All 6 target packages: `copyleft=no` (MIT). Full per-package detail: `license-inventory.csv`.
