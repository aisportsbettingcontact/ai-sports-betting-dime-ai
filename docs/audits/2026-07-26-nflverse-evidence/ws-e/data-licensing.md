# Data licensing and provenance — WS-E Task 5, Steps 2–3

All access dates below are **2026-07-26** (local machine date; some server response headers show
2026-07-27 UTC — same fetch session, timezone artifact only). Raw fetched artifacts (JSON/HTML/MD)
are archived under `evidence/ws-e/raw/` for re-verification.

This document is about the **data** the R packages fetch at runtime (from GitHub Releases), which
is licensed separately from the **code** of the 90 R packages themselves (covered in
`license-inventory.csv` / `copyleft-flags.md`). nflverse's own documentation draws this exact line —
see the "code vs. data" quote in Step 2 below.

---

## Step 2 — Data licensing

### `nflverse/nflverse-data` — the repository whose GitHub Releases nflreadr downloads from

Queried `https://api.github.com/repos/nflverse/nflverse-data/license` (2026-07-26). GitHub's
license-detection API returned:

```
"license": {
  "key": "cc-by-4.0",
  "name": "Creative Commons Attribution 4.0 International",
  "spdx_id": "CC-BY-4.0",
  "url": "https://api.github.com/licenses/cc-by-4.0"
}
```

detected from the repo's own `LICENSE.md`
(`https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md`, retrieved via the API's
`download_url` at `https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md`,
2026-07-26). I decoded and read the full 18,647-character file: it is the unmodified **Creative
Commons Attribution 4.0 International Public License** text. Repo metadata
(`https://api.github.com/repos/nflverse/nflverse-data`, 2026-07-26): description "Automated
nflverse data repository", `homepage: https://www.nflverse.com`, default branch `main`.

Confirmed **no** "NonCommercial"/"non-commercial" string anywhere in that license text (`grep -ic`
on the decoded file → 0 hits). The operative attribution clause (Section 3(a) of the license text
itself, quoted exactly):

> "a. Attribution.
>
>    1. If You Share the Licensed Material (including in modified form), You must:
>
>         a. retain the following if it is supplied by the Licensor with the Licensed Material:
>              i. identification of the creator(s) of the Licensed Material and any others
>                 designated to receive attribution, in any reasonable manner requested by the
>                 Licensor (including by pseudonym if designated);
>             ii. a copyright notice;
>            iii. a notice that refers to this Public License;
>             iv. a notice that refers to the disclaimer of warranties;
>              v. a URI or hyperlink to the Licensed Material to the extent reasonably
>                 practicable;
>         b. indicate if You modified the Licensed Material and retain an indication of any
>            previous modifications; and
>         c. indicate the Licensed Material is licensed under this Public License, and include
>            the text of, or the URI or hyperlink to, this Public License."

(source: `https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md`, Section 3(a),
2026-07-26 — archived at `evidence/ws-e/raw/nflverse-data-LICENSE.md`)

The license also carries a **Section 4 — Sui Generis Database Rights** clause, relevant because
nflverse-data is fundamentally structured/tabular data (a database in the EU legal sense): "Where
the Licensed Rights include Sui Generis Database Rights that apply to Your use of the Licensed
Material: a. … Section 2(a)(1) grants You the right to extract, reuse, reproduce, and Share all or
a substantial portion of the contents of the database; … c. You must comply with the conditions in
Section 3(a) if You Share all or a substantial portion of the contents of the database." (same
source, Section 4).

GitHub's own structured summary of this license (`https://api.github.com/licenses/cc-by-4.0`,
2026-07-26) is a useful plain-language cross-check of the legal text above:

> description: "Permits almost any use subject to providing credit and license notice. Frequently
> used for media assets and educational materials. The most common license for Open Access
> scientific publications. Not recommended for software."
> permissions: `["commercial-use", "modifications", "distribution", "private-use"]`
> conditions: `["include-copyright", "document-changes"]`
> limitations: `["liability", "trademark-use", "patent-use", "warranty"]`

("Not recommended for software" is choosealicense.com's own general caveat about CC-BY-4.0 as a
license *category* — it is not a statement about nflverse specifically; noted here descriptively,
not as a finding about applicability.)

### `nflverse/nflverse-pbp` — the repo that builds/updates play-by-play + stats releases

Queried `https://api.github.com/repos/nflverse/nflverse-pbp` (2026-07-26; this endpoint returns repo
metadata including a `license` field — no separate `/license` sub-resource call was needed since the
top-level object already carries it). Description: "builds play by play and player stats for
nflverse/nflverse-data". `license.spdx_id`: **`CC-BY-4.0`** (same license as nflverse-data). Default
branch `master`.

### The code/data distinction, in nflverse's own words

`https://nflreadr.nflverse.com/index.html` (nflreadr's pkgdown homepage), retrieved 2026-07-26,
contains an explicit `## Terms of Use` (`id="terms-of-use"`) section, quoted in full:

> "The R code for this package is released as open source under the [MIT License](https://nflreadr.nflverse.com/LICENSE.html). NFL data accessed by this package belong to their
> respective owners, and are governed by their terms of use."

(source: `https://nflreadr.nflverse.com/index.html`, line containing `id="terms-of-use"`,
2026-07-26 — archived at `evidence/ws-e/raw/nflreadr-index.html`, line 207)

This is the single clearest first-party statement of the code/data split the brief asked me to keep
sharp: **nflreadr's own maintainers state that the package's MIT license covers only the R code**,
and that the **underlying NFL data is not something nflreadr's own license purports to control** —
the data "belong to their respective owners" and are "governed by their terms of use" (nflreadr's
own words — "their," not "nflverse's"). I fetched the linked `LICENSE.html`
(`https://nflreadr.nflverse.com/LICENSE.html`, 2026-07-26) and confirmed it is the plain MIT text,
"Copyright (c) 2021 nflreadr authors" — nothing about data.

**This creates a real tension worth flagging, not resolving here** (see `commercial-posture.md`):
nflverse-data's own `LICENSE.md` asserts CC-BY-4.0 over "this repository" (i.e., nflverse's
packaging/compilation of the data into CSV/parquet/rds releases), while nflreadr's Terms of Use
page separately disclaims that nflverse controls the rights to the *underlying* NFL/third-party data
itself. Both statements can be true simultaneously (a compiler/aggregator can hold rights in their
own compilation/formatting choices via CC-BY while the underlying facts/feeds remain subject to
whatever terms their original sources impose) — but it means CC-BY-4.0 should not be read as a
clean, first-party grant of rights *from the NFL*.

I found no "terms of use," "data license," or similar page anywhere else in nflreadr's pkgdown site
nav. The full article list is in `https://nflreadr.nflverse.com/pkgdown.yml` (fetched 2026-07-26,
archived at `evidence/ws-e/raw/nflreadr-pkgdown.yml`): 22 data-dictionary articles plus
`exporting_nflreadr` and `nflverse_data_schedule` — no dedicated licensing/terms article beyond the
homepage section quoted above. I also checked
`https://nflreadr.nflverse.com/articles/dictionary_ftn_charting.html` (2026-07-26, since FTN is a
named commercial third-party data vendor per Step 3 below) — it is a field dictionary table only,
no licensing language.

### Builder/infrastructure repos (found while tracing provenance — explicitly out of scope, noted for completeness)

These are **not** part of the 90-package closure and **not** where the released data's license
lives (that's `nflverse-data`'s own `LICENSE.md`, above) — they are the separate GitHub Actions
build-tooling repos that produce the release assets. Listed because one of them carries a copyleft
license on its own build code, which is a distinct fact from the data's CC-BY-4.0 license and worth
a counsel-review note:

| repo | description (GitHub) | repo-level license (GitHub detection) |
|---|---|---|
| `nflverse/pfr_scrapR` | "builds pfr data for nflverse/nflverse-data" | **GPL-3.0** |
| `nflverse/ngs-data` | "builds next gen stats data for nflverse/nflverse-data" | MIT |
| `nflverse/nflverse-rosters` | "builds roster data for nflverse/nflverse-data" | Other / NOASSERTION (no SPDX-detectable license) |
| `nflverse/nflfastR-raw` | "Repository for raw .json that powers nflfastR" | none detected |
| `nflverse/nflverse-pbp-internal` | "internal package for scraping raw pbp" | none detected |

(all queried via `gh api repos/nflverse/<repo>`, 2026-07-26). None of these five repos' code ships
inside the 90-package CRAN closure under audit; they run as GitHub Actions jobs that *produce* the
release assets nflreadr downloads. I flag `pfr_scrapR`'s GPL-3.0 only because it is a data point a
counsel review would want if Dime AI ever consumes or vendors that build tooling itself, rather than
only consuming the published data outputs — see `commercial-posture.md`.

---

## Step 3 — Provenance chain

### Where the data originates

The provenance is **mixed** — part directly from the NFL's own public web properties, part scraped
via community-built tooling, part from named third-party vendors. Evidence, precisely sourced:

- **Play-by-play data → nfl.com, accessed via scraping.** `nflfastR`'s own CRAN `DESCRIPTION`
  (local file, `sources/nflfastR/DESCRIPTION`, staged by Task 0, read 2026-07-26): "A set of
  functions to access National Football League play-by-play data from
  \<https://www.nfl.com/\>." Its README
  (`https://raw.githubusercontent.com/nflverse/nflfastR/master/README.md`, 2026-07-26) opens: "
  `nflfastR` is a set of functions to efficiently scrape NFL play-by-play data. `nflfastR`
  expands upon the features of nflscrapR" — and credits, in its "Special thanks" section: "To Nick
  Shoemaker for finding and making available JSON-formatted NFL play-by-play back to 1999
  (`nflfastR` uses this source for 1999 and 2000 and previously also used it for 2001-2010)" and
  "To Lau Sze Yui for developing a scraping function to access JSON-formatted NFL play-by-play
  beginning in 2001," and traces its lineage to "the original `nflscrapR` team, Maksim Horowitz,
  Ronald Yurko, and Samuel Ventura, without whose contributions and inspiration this package would
  not exist." (archived at `evidence/ws-e/raw/nflfastR-README.md`)
- **"Scraped," in nflverse's own words, at the repository level.** `nflverse-data`'s README
  (`https://raw.githubusercontent.com/nflverse/nflverse-data/main/README.md`, 2026-07-26): "This
  repository holds automated data releases for nflverse projects (i.e. all of the data
  powered/scraped via GitHub Actions)." (archived at `evidence/ws-e/raw/nflverse-data-README.md`)
- **NFL Next Gen Stats (NGS)** — a named, presumably-NFL-operated source: per the automation-status
  article (below), "Player level weekly stats provided by NFL Next Gen Stats update every night…"
  and historically fed participation data (see cadence section).
- **Pro Football Reference ("PFR")** — a third-party site, scraped by the `pfr_scrapR` repo (see
  Step 2 table); feeds snap counts, advanced stats, and draft picks.
- **FTN Fantasy** — a named commercial third-party data vendor: nflfastR's README credits "Aaron
  Schatz and FTN Fantasy for providing charting data to correctly mark scrambles in the 1999-2005
  seasons," and (per Step 3 cadence detail below) FTN is now the sole source for participation data
  since the original NGS participation feed died.
- **Lee Sharpe** — credited for "curating a resource for game information" (schedules).

### Update automation

Confirmed mechanism: **GitHub Actions**, per `nflverse-data`'s own README ("… powered/scraped via
GitHub Actions") and directly observable workflow names referenced from the automation-status page
(`https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html`, 2026-07-26; archived at
`evidence/ws-e/raw/nflverse_data_schedule.html`), e.g.
`nflverse/nflverse-pbp/update_data.yaml`, `nflverse/pfr_scrapR/update_snap_counts.yaml`,
`nflverse/pfr_scrapR/update_draft_picks.yaml`, `nflverse/pfr_scrapR/update_advanced_stats.yaml`,
`nflverse/ngs-data/update_ngs.yaml`, `nflverse/nflverse-rosters/update_rosters.yaml`,
`nflverse/nflverse-rosters/update_injuries.yaml`, `nflverse/nflverse-rosters/update_depth_charts.yaml`,
`nflverse/nflverse-players/update_players.yaml`, `nflverse/nflverse-pbp-internal/release_raw_pbp.yaml`.

Per-feed cadence, quoted from that same article (all accessed 2026-07-26):

| feed | cadence (verbatim) |
|---|---|
| Play-by-play | "We update this on a nightly basis after each game day (and additionally at specific points on game days) during the season." Raw JSON "usually available within 15 minutes after a game has ended." Final/corrected data: "it is recommended to update the data again during the night from Wednesday to Thursday in order to also receive the stat corrections that the NFL will incorporate from Monday to Wednesday at the latest." |
| Player/team stats | "computed on the same schedule as play-by-play data" |
| FTN charting | "updates every day at 0, 6, 12, 18 UTC during the season. The actual availability of new data depends on the update schedule of FTN." |
| Participation | "Participation data prior to 2023 is from NFL NGS. The data source died during the 2023 season. Participation data from 2023 onwards is courtesy of FTN and is provided after all post-season games are completed. It does not update during the season!" |
| Game/Schedule | "updates very 5 minutes during the season." [sic, verbatim from source — presumably "every"] |
| Rosters | "updates every day at 7AM UTC." |
| NGS weekly player stats | "update every night (in the range of 3 am - 5 am ET) during the season. The actual availability of new data depends on the update schedule of NGS." |
| PFR snap counts | "updates every day at 0, 6, 12, 18 UTC during the season. The actual availability of new data depends on the update schedule of PFR." |
| PFR advanced stats | "updates every day at 7AM UTC during the season. The actual availability of new data depends on the update schedule of PFR." |
| Depth charts | "update every day at 7AM UTC throughout the year. Please note that the data source has changed after the 2024 season." |
| **Injuries** | "Our data source died after the 2024 season. At the moment, there is no 2025 data and there is no ETA yet as to when we will be able to make injury data available again." |

The last two rows are load-bearing for a betting product's risk posture: this is nflverse's own,
current (article `last_built: 2026-04-20T17:32Z` per `pkgdown.yml`) admission that **two of its
upstream feeds have already died outright** — participation data's original NGS source (replaced by
FTN, with reduced in-season freshness: no longer updates during the season) and injury data (no
replacement source at all, as of the article's last build). This is direct evidence that "an
upstream source disappearing" is not a hypothetical risk for this pipeline — it has already happened
twice.

### Availability single point of failure

- **Distribution channel:** GitHub Releases on `nflverse/nflverse-data`, confirmed by
  `nflverse-data`'s own README: "You can download data hosted here with the `{nflreadr}` package,
  or manually download and access the \[releases\]
  (https://github.com/nflverse/nflverse-data/releases) page." and by `nflverse-pbp`'s README
  (`https://raw.githubusercontent.com/nflverse/nflverse-pbp/master/README.md`, 2026-07-26): "The
  data itself is now being automatically pushed to GitHub releases at
  https://github.com/nflverse/nflverse-data/releases, which reduces repository bloat… If you would
  like to read directly from URLs, linking to nflverse-data release URLs is now the best way to do
  so." (archived at `evidence/ws-e/raw/nflverse-pbp-README.md`)
- **No CDN/mirror layer described anywhere in the docs reviewed** — release assets are served
  directly from GitHub's release-asset storage. `nflreadr` (an R package that itself is one of the
  90 audited here) is a thin HTTP client over these URLs; it has no independent data source of its
  own. A GitHub-wide or `nflverse/nflverse-data`-specific outage, rate-limit, repo deletion/rename,
  or release-asset removal is therefore a single point of failure for every one of the six target
  packages' data-loading functions (`load_pbp()`, `load_rosters()`, etc.) — there is no documented
  fallback data source.
- The org-level description on `https://github.com/nflverse` (`nflverse.com` redirects here — `curl
  -sSI https://nflverse.com/` returned `HTTP/2 301` with `location: https://github.com/nflverse`,
  confirmed 2026-07-26) states: "Most data is stored in releases of the nflverse/nflverse-data
  repository, in various formats (csv, parquet, rds, qs being the primary ones). These can be
  accessed by any platform or programming language via the web URLs." — i.e., the data is plain
  static files over HTTP, not an authenticated/rate-managed API with an SLA.

---

## Network-scope gap (recorded per evidence-first protocol)

`nflfastr.nflverse.com` (listed in this task's allowed network scope) **does not resolve** —
`curl: (6) Could not resolve host: nflfastr.nflverse.com`, tried twice (2026-07-26), both failures.
Sanity-checked that DNS/network access itself was working at the time (`github.com` returned HTTP
200 in the same window). `nflfastR`'s own `DESCRIPTION` `URL:` field states its actual site is
`https://nflfastr.com/` (no `nflverse.com` subdomain) — suggesting the allowlisted hostname for this
task may simply be stale/incorrect. I did **not** fetch `nflfastr.com`, since it is outside this
task's approved network scope, and did not unilaterally expand scope. Everything nflfastR-specific
in this document (its DESCRIPTION Description field, its README, its provenance credits) was instead
sourced from `sources/nflfastR/DESCRIPTION` (local, Task-0-staged) and
`raw.githubusercontent.com/nflverse/nflfastR/master/README.md` (in-scope host), both of which are
listed as allowed. See `notes.md` for the full gap record.
