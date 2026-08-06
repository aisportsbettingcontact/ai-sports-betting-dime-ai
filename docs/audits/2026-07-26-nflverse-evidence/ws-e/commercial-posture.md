# Commercial posture memo — WS-E Task 5, Step 4

**For a real-money sports-betting product (Dime AI).** This memo is descriptive: it flags and
quotes what the evidence says, and explicitly marks everything below that needs a legal
determination. It contains no legal conclusions. All access dates 2026-07-26; full sourcing in
`data-licensing.md` and `copyleft-flags.md`.

## 1. Attribution obligations found

`nflverse/nflverse-data` (the GitHub Releases repo every one of the six audited packages ultimately
reads from) is licensed **CC-BY-4.0** (`https://api.github.com/repos/nflverse/nflverse-data/license`,
confirmed independently on `nflverse/nflverse-pbp` too). CC-BY-4.0 is an **attribution-conditioned**
license — permissive on use, but not unconditional. The operative condition, quoted from the
license text itself (`nflverse-data`'s own `LICENSE.md`, Section 3(a)):

> "If You Share the Licensed Material (including in modified form), You must: … retain … i.
> identification of the creator(s) of the Licensed Material and any others designated to receive
> attribution … ii. a copyright notice; iii. a notice that refers to this Public License; iv. a
> notice that refers to the disclaimer of warranties; v. a URI or hyperlink to the Licensed
> Material to the extent reasonably practicable; … indicate if You modified the Licensed Material
> … \[and\] indicate the Licensed Material is licensed under this Public License, and include the
> text of, or the URI or hyperlink to, this Public License."

GitHub's own structured summary of the same license
(`https://api.github.com/licenses/cc-by-4.0`) lists the condition compactly as
`["include-copyright", "document-changes"]`, alongside granted permissions
`["commercial-use", "modifications", "distribution", "private-use"]`.

**Practical reading (descriptive, not legal advice):** attribution is conditioned on "Sharing" the
Licensed Material — i.e., it applies if/when Dime AI redistributes the data itself (or a
substantial portion of the underlying database, per the license's Section 4 Sui Generis Database
Rights clause) to others, including via a public-facing product surface. Whether Dime AI's actual
use (e.g., computing derived projections server-side and showing only the derived output, versus
re-publishing nflverse tables/fields directly) trips this condition is exactly the kind of
line-drawing exercise flagged for counsel in Section 5. I found no evidence in this audit's
approved sources that Dime AI currently displays any nflverse/CC-BY attribution notice — that was
out of this workstream's scope to check (it would require reviewing the Dime AI application
codebase/UI, not the nflverse package/data chain), and is listed as an action item below.

## 2. Non-commercial clause search — **none found**

Searched explicitly, everywhere this audit had access:

- All 90 packages' `DESCRIPTION` and `LICENSE*`/`LICENCE*` files (`sources/<pkg>/`):
  `grep -rliE "non-commercial|noncommercial|commercial use|commercial purposes"` → **0 hits**.
- `nflverse/nflverse-data`'s full `LICENSE.md` text (CC-BY-4.0, 18,647 characters, read in full):
  `grep -ic "non-commercial\|noncommercial"` → **0 hits**. CC-BY-4.0 is the "BY" variant of the
  Creative Commons family, not "BY-NC" — the absence is structural, not just undetected.
- GitHub's independent structured classification of the same license
  (`https://api.github.com/licenses/cc-by-4.0`) lists `"commercial-use"` as an affirmatively
  **granted** permission, not a restriction.
- `nflreadr`'s pkgdown homepage "Terms of Use" section, `LICENSE.html` page, and the
  `nflverse_data_schedule.html` automation-status article — read in full, no NC-style language
  anywhere.
- `dictionary_ftn_charting.html` (checked specifically because FTN Fantasy is a named commercial
  third-party vendor in the provenance chain) — field dictionary only, no licensing language at
  all, commercial or otherwise.
- The `github.com/nflverse` org profile page — no NC language.

**Conclusion of the search (descriptive, not a clearance): no non-commercial restriction was found
anywhere in the license chain this audit could reach.** This is *not* the same statement as "this
data is cleared for use in a real-money betting product" — see the code/data tension in Section 3
and the counsel-review list in Section 5, in particular the open question of whether nflverse's own
CC-BY-4.0 grant is actually nflverse's to give over NFL-originated data in the first place.

## 3. The code/data tension (restated from `data-licensing.md`)

Two first-party statements exist side by side and are worth holding in tension rather than
collapsing into one:

1. `nflverse-data`'s `LICENSE.md`: the repository (i.e., nflverse's own packaging of the data into
   release files) is CC-BY-4.0 — commercial use permitted, attribution required, no NC clause.
2. `nflreadr`'s own "Terms of Use" page: "The R code for this package is released as open source
   under the MIT License. NFL data accessed by this package belong to their respective owners,
   and are governed by their terms of use." (`https://nflreadr.nflverse.com/index.html`,
   2026-07-26) — nflverse's own maintainers explicitly decline to assert that their licensing
   covers the underlying data's actual ownership/terms.

Read together: nflverse licenses *its own compilation* permissively and without an NC clause, while
simultaneously disclaiming that this covers whatever rights the NFL (or FTN Fantasy, or Pro
Football Reference — see `data-licensing.md` Step 3 for the full source list) holds or asserts in
the underlying data. Neither nfl.com's, NFL Next Gen Stats', Pro Football Reference's, nor FTN
Fantasy's own terms of service were reviewed in this audit — none of those hosts were in this
task's approved network scope (`api.github.com`, `github.com`, `raw.githubusercontent.com`,
`nflverse.com`, `nflreadr.nflverse.com`, `nflfastr.nflverse.com` — see `notes.md`).

## 4. NFL trademark / data-rights caveats (descriptive, not legal advice)

- CC-BY-4.0 itself explicitly carves trademark out of its own grant: "Patent and trademark rights
  are not licensed under this Public License." (`nflverse-data`'s `LICENSE.md`, Section 2(b)(2),
  quoted exactly, 2026-07-26). So even taking nflverse-data's CC-BY-4.0 grant at face value for the
  *data*, it says nothing whatsoever about the right to use "NFL," team names/logos, "Next Gen
  Stats," or any other mark that appears in or alongside that data.
- I searched every fetched document and all 90 `DESCRIPTION` files for any trademark or
  affiliation/endorsement disclaimer (e.g., a "not affiliated with or endorsed by the NFL"-style
  notice, which some sports-data open-source projects do carry). **None was found anywhere in
  nflverse's own documentation** — the only "trademark" hits anywhere in the evidence are the
  CC-BY-4.0 license text's own boilerplate (quoted above, and its parallel clause protecting
  Creative Commons' own "Creative Commons" mark). This absence is itself worth noting to counsel:
  nflverse does not appear to publish its own position on NFL trademark use.
- General background (explicitly not sourced from this audit's evidence, flagged as such,
  supplied only as context a counsel review would independently verify): professional sports
  leagues, including the NFL, are widely understood to hold registered trademarks in league/team
  names, logos, and named products (e.g., "Next Gen Stats"), and to maintain official data-
  distribution relationships with specific commercial partners for certain feeds — particularly
  real-time/live data used in wagering contexts, which is a materially different (and more
  scrutinized) use case than the historical/analytical use nflverse's own documentation describes.
  This audit found nothing in nflverse's own docs asserting or disclaiming an official NFL
  relationship either way; the provenance chain documented in `data-licensing.md` (community
  scraping tools, `nflscrapR` lineage, "Nick Shoemaker," "Lau Sze Yui," GitHub Actions automation)
  reads as an unofficial/community pipeline, not a licensed commercial data-feed partnership.

## 5. For counsel review

1. **Distribution scenario (GPL/LGPL/MPL exposure).** Determine which scenario in
   `copyleft-flags.md` ("server-side/internal use" vs. "actually distributing the code")
   describes Dime AI's real deployment of the 14 GPL + 4 weak-copyleft packages, and what follows
   from that for each package's specific terms (GPL source-offer mechanics; LGPL relinking;
   `data.table`/`vctrs`'s MPL-2.0 file-level share-alike). `data.table` is the highest-priority
   item here — it is a *direct* dependency of 5 of the 6 audited target packages.
2. **Does nflverse actually hold the rights it's licensing under CC-BY-4.0?** nflreadr's own docs
   disclaim that NFL data "belong to their respective owners" — CC-BY-4.0's own preamble
   ("Considerations for licensors … Licensors should also secure all rights necessary before
   applying our licenses") puts the burden on the licensor. Whether nflverse's compilation/
   database-rights layer is sufficient to support Dime AI relying on the CC-BY-4.0 grant for
   NFL-originated facts/data (as opposed to just nflverse's own formatting/compilation of them) is
   a legal question this audit cannot answer.
3. **Upstream terms of service not reviewed.** NFL.com, NFL Next Gen Stats, Pro Football Reference,
   and FTN Fantasy each appear in the provenance chain as original data sources or vendors (see
   `data-licensing.md` Step 3); none of their own terms of use/service were in this task's network
   scope and none were reviewed. Recommend direct review, particularly for FTN Fantasy (a
   commercial vendor) and for whatever NFL.com or Next Gen Stats terms govern scraped access to
   their public JSON/web endpoints.
4. **Data-source stability / product risk.** nflverse's own docs admit two upstream feeds have
   already died with no replacement or a degraded replacement: injury data ("no ETA yet as to when
   we will be able to make injury data available again," as of the article's last build) and
   pre-2023 participation data (replaced by FTN, no longer updating in-season). If Dime AI's
   product depends on either feed, this is a live product/operational risk, not just a licensing
   one.
5. **Attribution implementation.** If Dime AI's product surfaces nflverse-derived data in a way
   that counts as "Sharing" under CC-BY-4.0 Section 3(a) (see Section 1 above), determine the
   concrete attribution text/placement needed. This audit did not check whether the Dime AI
   codebase currently implements any such notice (out of scope for a package/data-licensing
   inventory).
6. **NFL trademark clearance.** Separate from the data-licensing analysis entirely (CC-BY-4.0
   explicitly excludes trademark/patent rights from its grant) — confirm Dime AI's use of "NFL,"
   team names/logos, player names, and terms like "Next Gen Stats" in a real-money betting product
   has its own trademark/fair-use clearance, independent of this data-licensing chain.
7. **`pfr_scrapR`'s GPL-3.0 license.** This build-tooling repo (not part of the 90-package closure,
   not the license governing the released data) is itself GPL-3.0-licensed. Immaterial if Dime AI
   only ever consumes nflverse-data's published release outputs; becomes relevant only if Dime AI
   ever vendors, forks, or redistributes that repo's own scraping code.
8. **Bare/ambiguous `GPL` packages.** `highr`, `knitr`, and `mime` declare a bare `License: GPL`
   with no version qualifier at all (not even `(>= 2)`). I normalized this to "GPL-2.0-only OR
   GPL-3.0-only (ambiguous)" — matching what R's own `tools:::analyze_license()` computes locally —
   but the DESCRIPTION file itself states no version. Confirm this reading is acceptable if
   Scenario B (distribution) in `copyleft-flags.md` ever becomes operative for these packages.
9. **Embedded/file-level licenses inside otherwise-permissive packages.** `stringi` ships one
   function (`stri_stats_latex()`) under GPL-2.0-or-later inside an otherwise BSD-3-Clause-style
   package; `vctrs` ships two files (`src/order-*.c`, `src/order-*.h`) under MPL-2.0 inside an
   otherwise-MIT package (see `copyleft-flags.md` for full detail and exact quotes). Confirm these
   narrow, file-scoped grants don't change Dime AI's compliance posture under whichever
   distribution scenario applies.
