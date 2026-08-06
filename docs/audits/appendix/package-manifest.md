# Appendix A — Package manifest (90 packages)

Companion to `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md`. Every column is
joined verbatim from an evidence CSV; nothing here was retyped by hand.

`$ROOT` = `/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit`

| Column | Source |
|---|---|
| package, version, license declared, compiled | `$ROOT/evidence/installed-manifest.csv` |
| CRAN current, status, github dev | `$ROOT/evidence/ws-a/currency.csv` |
| SPDX, copyleft | `$ROOT/evidence/ws-e/license-inventory.csv` |
| hash verdict | `$ROOT/evidence/ws-b/hash-verification.csv` |
| acquisition channel | `$ROOT/evidence/acquisition-log.csv` |

## Roll-up

| Measure | Value |
|---|---|
| Packages in site-library under audit | 90 |
| Audit targets (roots) | 6 — nflverse, nflreadr, nflfastR, nflseedR, nfl4th, nflplotR |
| Hash verification verdicts | PASS 90 |
| CRAN currency | current 90 |
| Acquisition channel | current 90 |
| NeedsCompilation | yes 39, no 51 |
| Copyleft class | no 72, weak 4, yes 14 |

## Full manifest

Targets are marked **bold**. `dev` shows the upstream GitHub dev version where it differs
from CRAN (populated only for the 6 targets; empty for the other 84).

| # | package | installed | CRAN | status | dev | license (declared) | SPDX | copyleft | compiled | hash |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | R6 | 2.6.1 | 2.6.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 2 | RColorBrewer | 1.1-3 | 1.1-3 | current |  | Apache License 2.0 | Apache-2.0 | no | no | PASS |
| 3 | Rcpp | 1.1.2 | 1.1.2 | current |  | GPL (>= 2) | GPL-2.0-or-later | yes | yes | PASS |
| 4 | S7 | 0.2.2 | 0.2.2 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 5 | V8 | 8.2.0 | 8.2.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 6 | base64enc | 0.1-6 | 0.1-6 | current |  | GPL-2 \| GPL-3 | GPL-2.0-only OR GPL-3.0-only | yes | yes | PASS |
| 7 | bigD | 0.3.1 | 0.3.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 8 | bitops | 1.0-9 | 1.0-9 | current |  | GPL (>= 2) | GPL-2.0-or-later | yes | yes | PASS |
| 9 | bslib | 0.11.0 | 0.11.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 10 | cachem | 1.1.0 | 1.1.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 11 | cli | 3.6.6 | 3.6.6 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 12 | commonmark | 2.0.0 | 2.0.0 | current |  | BSD_2_clause + file LICENSE | BSD-2-Clause | no | yes | PASS |
| 13 | cpp11 | 0.5.5 | 0.5.5 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 14 | crayon | 1.5.3 | 1.5.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 15 | curl | 7.1.0 | 7.1.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 16 | data.table | 1.18.4 | 1.18.4 | current |  | MPL-2.0 \| file LICENSE | MPL-2.0 | weak | yes | PASS |
| 17 | digest | 0.6.39 | 0.6.39 | current |  | GPL (>= 2) | GPL-2.0-or-later | yes | yes | PASS |
| 18 | dplyr | 1.2.1 | 1.2.1 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 19 | evaluate | 1.0.5 | 1.0.5 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 20 | farver | 2.1.2 | 2.1.2 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 21 | fastmap | 1.2.0 | 1.2.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 22 | fastrmodels | 2.1.0 | 2.1.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 23 | fontawesome | 0.5.3 | 0.5.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 24 | fs | 2.1.0 | 2.1.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 25 | furrr | 0.4.0 | 0.4.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 26 | future | 1.75.0 | 1.75.0 | current |  | Apache License (>= 2) | Apache-2.0 | no | no | PASS |
| 27 | generics | 0.1.4 | 0.1.4 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 28 | ggpath | 1.1.1 | 1.1.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 29 | ggplot2 | 4.0.3 | 4.0.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 30 | globals | 0.19.1 | 0.19.1 | current |  | LGPL (>= 2.1) | LGPL-2.1-or-later | weak | no | PASS |
| 31 | glue | 1.8.1 | 1.8.1 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 32 | gsubfn | 0.7 | 0.7 | current |  | GPL (>= 2) | GPL-2.0-or-later | yes | no | PASS |
| 33 | gt | 1.3.0 | 1.3.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 34 | gtable | 0.3.6 | 0.3.6 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 35 | highr | 0.12 | 0.12 | current |  | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) | yes | no | PASS |
| 36 | hms | 1.1.4 | 1.1.4 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 37 | htmltools | 0.5.9 | 0.5.9 | current |  | GPL (>= 2) | GPL-2.0-or-later | yes | yes | PASS |
| 38 | htmlwidgets | 1.6.4 | 1.6.4 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 39 | isoband | 0.3.0 | 0.3.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 40 | janitor | 2.2.1 | 2.2.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 41 | jquerylib | 0.1.4 | 0.1.4 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 42 | jsonlite | 2.0.0 | 2.0.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 43 | juicyjuice | 0.1.0 | 0.1.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 44 | knitr | 1.51 | 1.51 | current |  | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) | yes | no | PASS |
| 45 | labeling | 0.4.3 | 0.4.3 | current |  | MIT + file LICENSE \| Unlimited | MIT OR Unlimited | no | no | PASS |
| 46 | lifecycle | 1.0.5 | 1.0.5 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 47 | listenv | 1.0.0 | 1.0.0 | current |  | Apache License (>= 2) | Apache-2.0 | no | no | PASS |
| 48 | litedown | 0.10 | 0.10 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 49 | lubridate | 1.9.5 | 1.9.5 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 50 | magick | 2.9.1 | 2.9.1 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 51 | magrittr | 2.0.5 | 2.0.5 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 52 | markdown | 2.0 | 2.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 53 | memoise | 2.0.1 | 2.0.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 54 | mime | 0.13 | 0.13 | current |  | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) | yes | yes | PASS |
| 55 | **nfl4th** | 1.0.7 | 1.0.7 | current | = CRAN | MIT + file LICENSE | MIT | no | no | PASS |
| 56 | **nflfastR** | 5.2.0 | 5.2.0 | current | 5.2.0.9012 | MIT + file LICENSE | MIT | no | no | PASS |
| 57 | **nflplotR** | 1.6.0 | 1.6.0 | current | = CRAN | MIT + file LICENSE | MIT | no | no | PASS |
| 58 | **nflreadr** | 1.5.1 | 1.5.1 | current | = CRAN | MIT + file LICENSE | MIT | no | no | PASS |
| 59 | **nflseedR** | 2.0.2 | 2.0.2 | current | 2.0.2.9000 | MIT + file LICENSE | MIT | no | no | PASS |
| 60 | **nflverse** | 1.0.3 | 1.0.3 | current | 1.0.3.9001 | MIT + file LICENSE | MIT | no | no | PASS |
| 61 | parallelly | 1.48.0 | 1.48.0 | current |  | LGPL (>= 2.1) | LGPL-2.1-or-later | weak | yes | PASS |
| 62 | pillar | 1.11.1 | 1.11.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 63 | pkgconfig | 2.0.3 | 2.0.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 64 | progressr | 1.0.0 | 1.0.0 | current |  | Apache License (>= 2) | Apache-2.0 | no | no | PASS |
| 65 | proto | 1.0.0 | 1.0.0 | current |  | GPL-2 | GPL-2.0-only | yes | no | PASS |
| 66 | purrr | 1.2.2 | 1.2.2 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 67 | rappdirs | 0.3.4 | 0.3.4 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 68 | reactR | 0.6.1 | 0.6.1 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 69 | reactable | 0.4.5 | 0.4.5 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 70 | rlang | 1.3.0 | 1.3.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 71 | rmarkdown | 2.31 | 2.31 | current |  | GPL-3 | GPL-3.0-only | yes | no | PASS |
| 72 | rstudioapi | 0.19.0 | 0.19.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 73 | sass | 0.4.10 | 0.4.10 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 74 | scales | 1.4.0 | 1.4.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 75 | snakecase | 0.11.1 | 0.11.1 | current |  | GPL-3 | GPL-3.0-only | yes | no | PASS |
| 76 | stringi | 1.8.7 | 1.8.7 | current |  | file LICENSE | BSD-3-Clause primary; bundles GPL-2.0-or-later + ICU (Unicode-License-v3, permissive) + public-domain data -- see LICENSE file | yes | yes | PASS |
| 77 | stringr | 1.6.0 | 1.6.0 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 78 | tibble | 3.3.1 | 3.3.1 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 79 | tidyr | 1.3.2 | 1.3.2 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 80 | tidyselect | 1.2.1 | 1.2.1 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 81 | timechange | 0.4.0 | 0.4.0 | current |  | GPL (>= 3) | GPL-3.0-or-later | yes | yes | PASS |
| 82 | tinytex | 0.60 | 0.60 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 83 | utf8 | 1.2.6 | 1.2.6 | current |  | Apache License (== 2.0) \| file LICENSE | Apache-2.0 | no | yes | PASS |
| 84 | vctrs | 0.7.3 | 0.7.3 | current |  | MIT + file LICENSE | MIT (package); MPL-2.0 additionally applies to src/order-*.c and src/order-*.h per LICENSE.note (code adapted from data.table) | weak | yes | PASS |
| 85 | viridisLite | 0.4.3 | 0.4.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 86 | withr | 3.0.3 | 3.0.3 | current |  | MIT + file LICENSE | MIT | no | no | PASS |
| 87 | xfun | 0.60 | 0.60 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 88 | xgboost | 3.2.1.1 | 3.2.1.1 | current |  | Apache License (== 2.0) \| file LICENSE | Apache-2.0 | no | yes | PASS |
| 89 | xml2 | 1.6.0 | 1.6.0 | current |  | MIT + file LICENSE | MIT | no | yes | PASS |
| 90 | yaml | 2.3.12 | 2.3.12 | current |  | BSD_3_clause + file LICENSE | BSD-3-Clause | no | yes | PASS |

## Copyleft detail

### Strong copyleft (GPL family) — 14 packages

| package | license (declared) | SPDX |
|---|---|---|
| Rcpp | GPL (>= 2) | GPL-2.0-or-later |
| base64enc | GPL-2 \| GPL-3 | GPL-2.0-only OR GPL-3.0-only |
| bitops | GPL (>= 2) | GPL-2.0-or-later |
| digest | GPL (>= 2) | GPL-2.0-or-later |
| gsubfn | GPL (>= 2) | GPL-2.0-or-later |
| highr | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) |
| htmltools | GPL (>= 2) | GPL-2.0-or-later |
| knitr | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) |
| mime | GPL | GPL-2.0-only OR GPL-3.0-only (ambiguous: no version given) |
| proto | GPL-2 | GPL-2.0-only |
| rmarkdown | GPL-3 | GPL-3.0-only |
| snakecase | GPL-3 | GPL-3.0-only |
| stringi | file LICENSE | BSD-3-Clause primary; bundles GPL-2.0-or-later + ICU (Unicode-License-v3, permissive) + public-domain data -- see LICENSE file |
| timechange | GPL (>= 3) | GPL-3.0-or-later |

### Weak copyleft (LGPL / MPL) — 4 packages

| package | license (declared) | SPDX |
|---|---|---|
| data.table | MPL-2.0 \| file LICENSE | MPL-2.0 |
| globals | LGPL (>= 2.1) | LGPL-2.1-or-later |
| parallelly | LGPL (>= 2.1) | LGPL-2.1-or-later |
| vctrs | MIT + file LICENSE | MIT (package); MPL-2.0 additionally applies to src/order-*.c and src/order-*.h per LICENSE.note (code adapted from data.table) |

Entry paths into the closure for every package above are traced hop-by-hop in
`$ROOT/evidence/ws-e/copyleft-flags.md`. All 6 targets are `MIT + file LICENSE`,
`copyleft=no`.
