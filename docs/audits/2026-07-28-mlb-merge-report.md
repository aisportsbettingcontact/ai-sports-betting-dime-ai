# MLB Canonical Database — Task 5 Crosswalk Merge Report

Ground truth: `.superpowers/sdd/task-5-brief.md`, `docs/audits/2026-07-28-mlb-column-disposition.md`, `docs/audits/2026-07-28-mlb-reconciliation.md`.

## Execution summary (three runs)

`scripts/mlb-etl/merge_crosswalks.mts` was run three times against production via
`railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/merge_crosswalks.mts
[--dry-run]`:

| Run | Mode | teams→franchises (rows / cells) | players→people.br_id | rotowire_id | an_player_id | retrosheet_id | schedule_history.gamePk |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `--dry-run` (preview) | 30 / 180 | 1400 | 862 | 812 | 35 | 8936 |
| 2 | real (write) | 30 / 180 | 1400 | 862 | 812 | 35 | 8936 |
| 3 | real (idempotency proof) | **0** / 0 | **0** | **0** | **0** | **0** | **0** |

**Idempotency proof:** run 3 (a second real, non-dry-run invocation, executed immediately after
run 2 with no code or data changes in between) updated **zero** rows in every one of the six
crosswalk targets — every `UPDATE ... WHERE col IS NULL` found nothing left to update, confirming
the merge is safe to re-run. Console output of all three runs is preserved in
`.superpowers/sdd/task-5-report.md`.

The detailed per-crosswalk tables below (conflicts, unmatched-target lists, schedule_history
orientation/unmatched breakdown) come from a **fourth, read-only `--dry-run` pass taken after the
real merge landed** — the underlying comparison logic is identical whether a cell is called
"updated" (pre-merge, value was null) or "already consistent" (post-merge, value now matches),
so the conflict/unmatched lists below are byte-for-byte the same findings that governed runs 1-2;
only the updated/already-consistent split has shifted from "0 already-consistent" to "0 remaining
to update" now that the merge has landed. Cross-check: post-merge "already consistent" counts
below (30, 1400, 862, 812, 35, 8936-equivalent) equal the pre-merge "updated" counts in the table
above — the merge landed exactly what was previewed, nothing more, nothing less.

**Generated:** 2026-07-29T00:25:24.579Z (post-merge state, read-only verification pass)

## 1. `mlb_teams` → `mlb_franchises`

| Column | Updated | Already consistent | Conflicts | Unmatched targets |
|---|---:|---:|---:|---:|
| db_slug | 0 | 30 | 0 | 0 |
| mlb_code | 0 | 30 | 0 | 0 |
| abbrev | 0 | 29 | 1 | 0 |
| vsin_slug | 0 | 30 | 0 | 0 |
| an_slug | 0 | 30 | 0 | 0 |
| an_logo_slug | 0 | 30 | 0 | 0 |
| br_abbrev | 0 | 30 | 0 | 0 |
| name | 0 | 30 | 0 | 0 |
| mlbId null (finding) | 0 | 0 | 0 | 0 |
| mlbId not found in mlb_franchises | 0 | 0 | 0 | 0 |

**abbrev conflicts (1):**

| key | existing | attempted | source |
|---|---|---|---|
| team_id=109 | AZ | ARI |  |

## 2. `mlb_players` → `mlb_people.br_id`

| Column | Updated | Already consistent | Conflicts | Unmatched targets |
|---|---:|---:|---:|---:|
| br_id | 0 | 1400 | 0 | 0 |

Null-`mlbamId` legacy rows: **0**. `mlbamId`-present-but-no-matching-`mlb_people`-row: **3**.

Unmatched legacy players (3) written to `docs/audits/2026-07-28-unmatched-legacy-players.csv`.

## 3. Harvest crosswalks → `mlb_people` (rotowire_id / an_player_id / retrosheet_id)

First-seen-wins scan order: `mlb_lineups` (id ASC; per row: away pitcher, home pitcher, away lineup batters in array order, home lineup batters in array order) → `mlb_hr_props` (id ASC, an_player_id) → `mlb_strikeout_props` (id ASC, an_player_id then retrosheet_id).

## 3a. `rotowire_id`

| Column | Updated | Already consistent | Conflicts | Unmatched targets |
|---|---:|---:|---:|---:|
| rotowire_id | 0 | 862 | 0 | 0 |

Harvest-source conflicts (same mlbamId, different rotowireId seen later): **44**.

| mlbamId | first value | first source | later value | later source |
|---|---|---|---|---|
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#210016.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#510003.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#720004.awayLineup[5] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#720019.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#960006.awayLineup[5] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1050025.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1080524.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1110012.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1140031.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1200030.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1230042.awayLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1320017.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1380022.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1410022.awayLineup[5] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1500091.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1500286.homeLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1530028.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1620033.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1650019.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1651100.homeLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1651115.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1653734.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1740022.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1740734.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#1741276.awayLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3180481.homeLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3181907.homeLineup[4] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3304247.homeLineup[5] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3310210.homeLineup[7] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3311094.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3331722.homeLineup[7] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3333758.homeLineup[8] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3338567.awayLineup[8] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3450293.awayLineup[7] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3452816.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3482330.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3485963.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3486866.awayLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3489886.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3496566.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3546364.homeLineup[5] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3551101.homeLineup[6] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#3633210.awayLineup[7] |
| 691777 | 13211 | mlb_lineups#30011.homeLineup[5] | 17330 | mlb_lineups#6381068.awayLineup[5] |

## 3b. `an_player_id`

| Column | Updated | Already consistent | Conflicts | Unmatched targets |
|---|---:|---:|---:|---:|
| an_player_id | 0 | 812 | 0 | 1 |

**an_player_id unmatched targets (1):**

| key | reason |
|---|---|
| 671734 | mlbamId not in mlb_people |

Harvest-source conflicts: **1435**.

| mlbamId | first value | first source | later value | later source |
|---|---|---|---|---|
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#30514 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#30622 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#30874 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#31094 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#31362 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#31709 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#31875 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#32092 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#60030 |
| 677651 | 33913 | mlb_hr_props#30076 | 3912 | mlb_hr_props#120204 |
| 677651 | 33913 | mlb_hr_props#30076 | 3912 | mlb_hr_props#150155 |
| 677651 | 33913 | mlb_hr_props#30076 | 3912 | mlb_hr_props#180187 |
| 677651 | 33913 | mlb_hr_props#30076 | 3912 | mlb_hr_props#189108 |
| 472610 | 33913 | mlb_hr_props#77 | 3912 | mlb_hr_props#219016 |
| 472610 | 33913 | mlb_hr_props#77 | 3912 | mlb_hr_props#780225 |
| 472610 | 33913 | mlb_hr_props#77 | 3912 | mlb_hr_props#2490285 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#3003163 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#3150021 |
| 472610 | 33913 | mlb_hr_props#77 | 3912 | mlb_hr_props#4321576 |
| 691777 | 3461 | mlb_hr_props#30135 | 169185 | mlb_hr_props#4470036 |
| 472610 | 33913 | mlb_hr_props#77 | 3912 | mlb_hr_props#4530021 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#90074 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#150005 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#450002 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#450003 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 189315 | mlb_strikeout_props#450009 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 88483 | mlb_strikeout_props#450010 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#450012 |
| 661563 | 85118 | mlb_strikeout_props#180004 | 53380 | mlb_strikeout_props#450015 |
| 694477 | 191036 | mlb_strikeout_props#60069 | 197332 | mlb_strikeout_props#450019 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 3637 | mlb_strikeout_props#450021 |
| 500779 | 3207 | mlb_strikeout_props#90083 | 299395 | mlb_strikeout_props#450022 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 112027 | mlb_strikeout_props#450024 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#450025 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 33991 | mlb_strikeout_props#450026 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#450027 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#480001 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 109055 | mlb_strikeout_props#480003 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 105048 | mlb_strikeout_props#480004 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 87829 | mlb_strikeout_props#480005 |
| 663460 | 88483 | mlb_strikeout_props#90093 | 3729 | mlb_strikeout_props#480006 |
| 608331 | 53380 | mlb_strikeout_props#90197 | 302398 | mlb_strikeout_props#480007 |
| 682052 | 112027 | mlb_strikeout_props#90102 | 54282 | mlb_strikeout_props#480012 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#480013 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 3478 | mlb_strikeout_props#480014 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#480015 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 163119 | mlb_strikeout_props#480017 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 88441 | mlb_strikeout_props#480018 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 88248 | mlb_strikeout_props#510045 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#510059 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 189315 | mlb_strikeout_props#510062 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 123018 | mlb_strikeout_props#540013 |
| 694477 | 191036 | mlb_strikeout_props#60069 | 197332 | mlb_strikeout_props#540014 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 231817 | mlb_strikeout_props#540015 |
| 608331 | 53380 | mlb_strikeout_props#90197 | 302398 | mlb_strikeout_props#540018 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#540019 |
| 605280 | 53481 | mlb_strikeout_props#90108 | 190262 | mlb_strikeout_props#540020 |
| 571510 | 3232 | mlb_strikeout_props#90147 | 82605 | mlb_strikeout_props#540021 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#540022 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#540023 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 123577 | mlb_strikeout_props#540024 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 163119 | mlb_strikeout_props#540025 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#540026 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 105048 | mlb_strikeout_props#540028 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#540032 |
| 665795 | 82605 | mlb_strikeout_props#90104 | 3569 | mlb_strikeout_props#540036 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 168786 | mlb_strikeout_props#540037 |
| 607192 | 3558 | mlb_strikeout_props#90072 | 190998 | mlb_strikeout_props#540042 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#540060 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 59120 | mlb_strikeout_props#540082 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 3759 | mlb_strikeout_props#540084 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 80883 | mlb_strikeout_props#570003 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#570005 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#570006 |
| 680573 | 88591 | mlb_strikeout_props#90094 | 197016 | mlb_strikeout_props#570010 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 229864 | mlb_strikeout_props#570011 |
| 669947 | 106985 | mlb_strikeout_props#450020 | 3959 | mlb_strikeout_props#570012 |
| 661563 | 85118 | mlb_strikeout_props#180004 | 53380 | mlb_strikeout_props#570016 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 33991 | mlb_strikeout_props#570019 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#570020 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#570022 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 33867 | mlb_strikeout_props#570024 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 190530 | mlb_strikeout_props#570025 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 3232 | mlb_strikeout_props#570027 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 260345 | mlb_strikeout_props#570028 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 109046 | mlb_strikeout_props#570031 |
| 571927 | 3446 | mlb_strikeout_props#480011 | 3959 | mlb_strikeout_props#600002 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 284010 | mlb_strikeout_props#630011 |
| 660271 | 81561 | mlb_hr_props#74 | 260345 | mlb_strikeout_props#630029 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 33867 | mlb_strikeout_props#630031 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 128169 | mlb_strikeout_props#630037 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 2921 | mlb_strikeout_props#630042 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#630050 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#630052 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 298252 | mlb_strikeout_props#630054 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 54568 | mlb_strikeout_props#630055 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#630056 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 62315 | mlb_strikeout_props#630058 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#630059 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 54572 | mlb_strikeout_props#630060 |
| 622663 | 3092 | mlb_strikeout_props#90029 | 82582 | mlb_strikeout_props#630061 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 233948 | mlb_strikeout_props#630062 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 34009 | mlb_strikeout_props#630063 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 59119 | mlb_strikeout_props#630064 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 205994 | mlb_strikeout_props#630065 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#630067 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 58563 | mlb_strikeout_props#630068 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3650 | mlb_strikeout_props#630069 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 87825 | mlb_strikeout_props#630071 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 3207 | mlb_strikeout_props#630072 |
| 642547 | 54568 | mlb_strikeout_props#90141 | 190262 | mlb_strikeout_props#630073 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 88781 | mlb_strikeout_props#630074 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#630075 |
| 605540 | 54572 | mlb_strikeout_props#540065 | 197294 | mlb_strikeout_props#630076 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#630077 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 7747 | mlb_strikeout_props#630078 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 88591 | mlb_strikeout_props#630079 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#630080 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 3637 | mlb_strikeout_props#660018 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 34009 | mlb_strikeout_props#660021 |
| 694477 | 191036 | mlb_strikeout_props#60069 | 189716 | mlb_strikeout_props#690008 |
| 571927 | 3446 | mlb_strikeout_props#480011 | 3959 | mlb_strikeout_props#690018 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 233259 | mlb_strikeout_props#750016 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#780002 |
| 801403 | 237265 | mlb_strikeout_props#90185 | 54309 | mlb_strikeout_props#780003 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#780004 |
| 682052 | 112027 | mlb_strikeout_props#90102 | 54282 | mlb_strikeout_props#780005 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#780006 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 109046 | mlb_strikeout_props#780007 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 284030 | mlb_strikeout_props#780008 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#780009 |
| 669947 | 106985 | mlb_strikeout_props#450020 | 3446 | mlb_strikeout_props#780011 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#780013 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 168731 | mlb_strikeout_props#780016 |
| 663460 | 88483 | mlb_strikeout_props#90093 | 3729 | mlb_strikeout_props#780017 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#780018 |
| 608331 | 53380 | mlb_strikeout_props#90197 | 302398 | mlb_strikeout_props#780019 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 33991 | mlb_strikeout_props#780020 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#780022 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#780023 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 53481 | mlb_strikeout_props#780024 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 190530 | mlb_strikeout_props#780025 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#780026 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 165219 | mlb_strikeout_props#780027 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 3013 | mlb_strikeout_props#780028 |
| 669387 | 147494 | mlb_strikeout_props#270001 | 88469 | mlb_strikeout_props#780029 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#780030 |
| 650644 | 54282 | mlb_strikeout_props#90128 | 3092 | mlb_strikeout_props#780033 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 3478 | mlb_strikeout_props#780034 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 90063 | mlb_strikeout_props#780035 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#780038 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 106355 | mlb_strikeout_props#780039 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#780040 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 299395 | mlb_strikeout_props#780041 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 190621 | mlb_strikeout_props#810005 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 284010 | mlb_strikeout_props#810006 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#810009 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 2921 | mlb_strikeout_props#810011 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 126205 | mlb_strikeout_props#810013 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#810017 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#810019 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 127939 | mlb_strikeout_props#810021 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#810022 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#810024 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 54310 | mlb_strikeout_props#810028 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 88465 | mlb_strikeout_props#810030 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#810032 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#810033 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#810034 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#810035 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#810036 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#810038 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#810039 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#810042 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 53380 | mlb_strikeout_props#810044 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#810045 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 3207 | mlb_strikeout_props#810046 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 58563 | mlb_strikeout_props#810047 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 88781 | mlb_strikeout_props#810048 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 168786 | mlb_strikeout_props#810049 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#810051 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 62315 | mlb_strikeout_props#810052 |
| 642547 | 54568 | mlb_strikeout_props#90141 | 190262 | mlb_strikeout_props#810053 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 197040 | mlb_strikeout_props#810054 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#810055 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#810056 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 147483 | mlb_strikeout_props#810058 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 197294 | mlb_strikeout_props#810059 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 88591 | mlb_strikeout_props#810060 |
| 663362 | 163119 | mlb_strikeout_props#510022 | 80915 | mlb_strikeout_props#810061 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#810062 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#810063 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#810064 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#810065 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 87831 | mlb_strikeout_props#810066 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#810068 |
| 500779 | 3207 | mlb_strikeout_props#90083 | 237265 | mlb_strikeout_props#810077 |
| 663623 | 88781 | mlb_strikeout_props#90090 | 54392 | mlb_strikeout_props#810079 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#810080 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#810084 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 88483 | mlb_strikeout_props#810089 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#810091 |
| 680573 | 88591 | mlb_strikeout_props#90094 | 264587 | mlb_strikeout_props#810092 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#810093 |
| 621121 | 3402 | mlb_strikeout_props#90110 | 123735 | mlb_strikeout_props#810096 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 112027 | mlb_strikeout_props#810098 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#810099 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#810100 |
| 660271 | 81561 | mlb_hr_props#74 | 190998 | mlb_strikeout_props#810101 |
| 801403 | 237265 | mlb_strikeout_props#90185 | 54309 | mlb_strikeout_props#840001 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 169224 | mlb_strikeout_props#840002 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 168731 | mlb_strikeout_props#840004 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 53481 | mlb_strikeout_props#840005 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 190530 | mlb_strikeout_props#840009 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#840010 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 147478 | mlb_strikeout_props#840011 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#840013 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#840014 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#840015 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 165219 | mlb_strikeout_props#840016 |
| 663460 | 88483 | mlb_strikeout_props#90093 | 3729 | mlb_strikeout_props#840019 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 3013 | mlb_strikeout_props#840020 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#870001 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#870002 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 3478 | mlb_strikeout_props#870003 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#870006 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 33867 | mlb_strikeout_props#870007 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#870008 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#870009 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 197016 | mlb_strikeout_props#870010 |
| 669947 | 106985 | mlb_strikeout_props#450020 | 3446 | mlb_strikeout_props#870011 |
| 675911 | 165219 | mlb_strikeout_props#690031 | 165221 | mlb_strikeout_props#870012 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#870013 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 3210 | mlb_strikeout_props#870015 |
| 665795 | 82605 | mlb_strikeout_props#90104 | 3569 | mlb_strikeout_props#870016 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 140309 | mlb_strikeout_props#870017 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#870019 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 233948 | mlb_strikeout_props#870020 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 236983 | mlb_strikeout_props#870021 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#870022 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 299395 | mlb_strikeout_props#870023 |
| 686799 | 109046 | mlb_strikeout_props#90086 | 87763 | mlb_strikeout_props#870024 |
| 605483 | 3013 | mlb_strikeout_props#780059 | 190999 | mlb_strikeout_props#870025 |
| 650644 | 54282 | mlb_strikeout_props#90128 | 3092 | mlb_strikeout_props#870026 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#870027 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 88441 | mlb_strikeout_props#870028 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 127939 | mlb_strikeout_props#870029 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 59119 | mlb_strikeout_props#900001 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 233259 | mlb_strikeout_props#900002 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 128784 | mlb_strikeout_props#900003 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#900004 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#900005 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 190621 | mlb_strikeout_props#900006 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#900007 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#900008 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#900009 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#900010 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#900011 |
| 663978 | 33867 | mlb_strikeout_props#90099 | 87825 | mlb_strikeout_props#900012 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#900013 |
| 592791 | 3569 | mlb_strikeout_props#90001 | 3882 | mlb_strikeout_props#900014 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 59393 | mlb_strikeout_props#900015 |
| 701656 | 189716 | mlb_strikeout_props#810015 | 190631 | mlb_strikeout_props#900016 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#900018 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 34009 | mlb_strikeout_props#900019 |
| 607074 | 88443 | mlb_strikeout_props#810016 | 231725 | mlb_strikeout_props#900021 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 33821 | mlb_strikeout_props#900022 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#900023 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 88795 | mlb_strikeout_props#900024 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#900025 |
| 622663 | 3092 | mlb_strikeout_props#90029 | 82582 | mlb_strikeout_props#900026 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 54310 | mlb_strikeout_props#900028 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 147483 | mlb_strikeout_props#900031 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#900032 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 197040 | mlb_strikeout_props#900033 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 63290 | mlb_strikeout_props#900034 |
| 678394 | 128080 | mlb_strikeout_props#540053 | 3484 | mlb_strikeout_props#900035 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 168786 | mlb_strikeout_props#900036 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 88781 | mlb_strikeout_props#900038 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#900039 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 88465 | mlb_strikeout_props#900040 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 62315 | mlb_strikeout_props#900041 |
| 642547 | 54568 | mlb_strikeout_props#90141 | 190262 | mlb_strikeout_props#900042 |
| 695684 | 231725 | mlb_strikeout_props#630039 | 88443 | mlb_strikeout_props#900043 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#900044 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#900045 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#900046 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#900050 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#900053 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 3207 | mlb_strikeout_props#900054 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#900055 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#900056 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#900058 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#900060 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 88764 | mlb_strikeout_props#900062 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#900064 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#900065 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 5775 | mlb_strikeout_props#900066 |
| 691725 | 168786 | mlb_strikeout_props#90124 | 59401 | mlb_strikeout_props#900067 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 128185 | mlb_strikeout_props#900068 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 147534 | mlb_strikeout_props#900069 |
| 663623 | 88781 | mlb_strikeout_props#90090 | 54392 | mlb_strikeout_props#900070 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#900071 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#900072 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#900073 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 163045 | mlb_strikeout_props#900075 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 197294 | mlb_strikeout_props#900076 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#900078 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 112027 | mlb_strikeout_props#900079 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#900080 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#900081 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#900083 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#900084 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#900085 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#900086 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 3402 | mlb_strikeout_props#900087 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#930003 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 169224 | mlb_strikeout_props#930004 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#930007 |
| 621121 | 3402 | mlb_strikeout_props#90110 | 123735 | mlb_strikeout_props#930014 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#930020 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#930023 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 189814 | mlb_strikeout_props#930026 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#960009 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 165219 | mlb_strikeout_props#960013 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#960014 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#960015 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#960016 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 3210 | mlb_strikeout_props#960017 |
| 571927 | 3446 | mlb_strikeout_props#480011 | 3959 | mlb_strikeout_props#960020 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#960027 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 59119 | mlb_strikeout_props#960028 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#960029 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 236983 | mlb_strikeout_props#960030 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 54568 | mlb_strikeout_props#960031 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#960032 |
| 675911 | 165219 | mlb_strikeout_props#690031 | 165221 | mlb_strikeout_props#960033 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#960034 |
| 607074 | 88443 | mlb_strikeout_props#810016 | 3560 | mlb_strikeout_props#960035 |
| 622663 | 3092 | mlb_strikeout_props#90029 | 82582 | mlb_strikeout_props#960036 |
| 592791 | 3569 | mlb_strikeout_props#90001 | 3882 | mlb_strikeout_props#990001 |
| 681293 | 231285 | mlb_strikeout_props#450023 | 112028 | mlb_strikeout_props#990002 |
| 663978 | 33867 | mlb_strikeout_props#90099 | 168793 | mlb_strikeout_props#990003 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 88465 | mlb_strikeout_props#990004 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#990005 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#990008 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#990009 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#990010 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 147483 | mlb_strikeout_props#990012 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 165574 | mlb_strikeout_props#990013 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 34009 | mlb_strikeout_props#990015 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 190621 | mlb_strikeout_props#990016 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 62315 | mlb_strikeout_props#990017 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 88781 | mlb_strikeout_props#990018 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 233259 | mlb_strikeout_props#990019 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#990020 |
| 701656 | 189716 | mlb_strikeout_props#810015 | 190631 | mlb_strikeout_props#990021 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#990022 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#990023 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#990024 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#990026 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#990027 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 33821 | mlb_strikeout_props#990028 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 59393 | mlb_strikeout_props#990029 |
| 663978 | 33867 | mlb_strikeout_props#90099 | 87825 | mlb_strikeout_props#1020001 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 87831 | mlb_strikeout_props#1020002 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1020005 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 58563 | mlb_strikeout_props#1020006 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#1020007 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#1020009 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#1020010 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 168786 | mlb_strikeout_props#1020012 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#1020013 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 3448 | mlb_strikeout_props#1020014 |
| 678394 | 128080 | mlb_strikeout_props#540053 | 3484 | mlb_strikeout_props#1020015 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 128169 | mlb_strikeout_props#1020018 |
| 642547 | 54568 | mlb_strikeout_props#90141 | 190262 | mlb_strikeout_props#1020019 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#1020020 |
| 663623 | 88781 | mlb_strikeout_props#90090 | 54392 | mlb_strikeout_props#1020021 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#1020023 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1020028 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#1020030 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 3207 | mlb_strikeout_props#1020031 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 54310 | mlb_strikeout_props#1020032 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 147494 | mlb_strikeout_props#1020033 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1020035 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1020038 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 264587 | mlb_strikeout_props#1020039 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#1020040 |
| 691725 | 168786 | mlb_strikeout_props#90124 | 59401 | mlb_strikeout_props#1020041 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#1020042 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1020043 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 147534 | mlb_strikeout_props#1020044 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 3729 | mlb_strikeout_props#1020047 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1020048 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 197294 | mlb_strikeout_props#1020049 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 33991 | mlb_strikeout_props#1020050 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#1020054 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#1020055 |
| 500779 | 3207 | mlb_strikeout_props#90083 | 190178 | mlb_strikeout_props#1020057 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 190530 | mlb_strikeout_props#1020058 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1020059 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#1020061 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1020064 |
| 669387 | 147494 | mlb_strikeout_props#270001 | 88469 | mlb_strikeout_props#1020065 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 128185 | mlb_strikeout_props#1020066 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#1020067 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1020069 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 163045 | mlb_strikeout_props#1020070 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 302398 | mlb_strikeout_props#1020071 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1020074 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 54225 | mlb_strikeout_props#1020075 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#1020076 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#1020077 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#1020078 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#1020080 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#1020081 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1020084 |
| 650644 | 54282 | mlb_strikeout_props#90128 | 3092 | mlb_strikeout_props#1020085 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 147478 | mlb_strikeout_props#1020086 |
| 676962 | 82605 | mlb_strikeout_props#780021 | 168785 | mlb_strikeout_props#1050001 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1050002 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 107789 | mlb_strikeout_props#1050003 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#1080001 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#1080002 |
| 643377 | 128185 | mlb_strikeout_props#660048 | 3959 | mlb_strikeout_props#1080004 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 87829 | mlb_strikeout_props#1080006 |
| 686799 | 109046 | mlb_strikeout_props#90086 | 87763 | mlb_strikeout_props#1080007 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#1080008 |
| 675911 | 165219 | mlb_strikeout_props#690031 | 165221 | mlb_strikeout_props#1080009 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#1080010 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#1080011 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 169224 | mlb_strikeout_props#1080012 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 233950 | mlb_strikeout_props#1080013 |
| 663559 | 163045 | mlb_strikeout_props#930015 | 233948 | mlb_strikeout_props#1080014 |
| 690986 | 147530 | mlb_strikeout_props#90106 | 191036 | mlb_strikeout_props#1080015 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 197016 | mlb_strikeout_props#1080016 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 3560 | mlb_strikeout_props#1080017 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1080018 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#1080020 |
| 622663 | 3092 | mlb_strikeout_props#90029 | 82582 | mlb_strikeout_props#1080021 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1080022 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#1080023 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 88441 | mlb_strikeout_props#1080024 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#1080025 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 127939 | mlb_strikeout_props#1080026 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 299395 | mlb_strikeout_props#1080027 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 81561 | mlb_strikeout_props#1080028 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#1110002 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 127939 | mlb_strikeout_props#1110009 |
| 571927 | 3446 | mlb_strikeout_props#480011 | 3959 | mlb_strikeout_props#1110012 |
| 592791 | 3569 | mlb_strikeout_props#90001 | 3882 | mlb_strikeout_props#1110013 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 59119 | mlb_strikeout_props#1110014 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 88795 | mlb_strikeout_props#1110015 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1110016 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 3211 | mlb_strikeout_props#1110017 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#1110018 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 190600 | mlb_strikeout_props#1110023 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3560 | mlb_strikeout_props#1110024 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#1110025 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#1110026 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 231797 | mlb_strikeout_props#1140005 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 59393 | mlb_strikeout_props#1140007 |
| 696070 | 264587 | mlb_strikeout_props#900089 | 165574 | mlb_strikeout_props#1140008 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 34009 | mlb_strikeout_props#1140009 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 237848 | mlb_strikeout_props#1140010 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 63290 | mlb_strikeout_props#1140011 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 3637 | mlb_strikeout_props#1140012 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1140013 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1140014 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#1140016 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 3448 | mlb_strikeout_props#1170001 |
| 663978 | 33867 | mlb_strikeout_props#90099 | 87825 | mlb_strikeout_props#1170002 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 128169 | mlb_strikeout_props#1170003 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1170007 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#1170011 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1170013 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1170016 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1170020 |
| 642547 | 54568 | mlb_strikeout_props#90141 | 190262 | mlb_strikeout_props#1170026 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#1170029 |
| 689441 | 189868 | mlb_strikeout_props#510013 | 197332 | mlb_strikeout_props#1170031 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1170033 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3759 | mlb_strikeout_props#1170035 |
| 622663 | 3092 | mlb_strikeout_props#90029 | 88569 | mlb_strikeout_props#1170037 |
| 607074 | 88443 | mlb_strikeout_props#810016 | 3210 | mlb_strikeout_props#1170039 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#1200002 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1200003 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 3729 | mlb_strikeout_props#1200004 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 264587 | mlb_strikeout_props#1200005 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1200006 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#1200007 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#1200008 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1200010 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#1200011 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1200012 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 109046 | mlb_strikeout_props#1200014 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 197294 | mlb_strikeout_props#1200015 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 147534 | mlb_strikeout_props#1200016 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#1200017 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 165219 | mlb_strikeout_props#1200018 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1200019 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1200020 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 190178 | mlb_strikeout_props#1200021 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#1200022 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 112027 | mlb_strikeout_props#1200023 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#1200024 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#1200025 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#1200026 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 168786 | mlb_strikeout_props#1200027 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#1200028 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#1200033 |
| 686799 | 109046 | mlb_strikeout_props#90086 | 87763 | mlb_strikeout_props#1200038 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#1200039 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 127896 | mlb_strikeout_props#1200040 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 128185 | mlb_strikeout_props#1200041 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 233950 | mlb_strikeout_props#1200042 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 168731 | mlb_strikeout_props#1200043 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 63403 | mlb_strikeout_props#1200044 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1200045 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#1200046 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#1200048 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1200051 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1200052 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 147478 | mlb_strikeout_props#1200054 |
| 696136 | 3569 | mlb_strikeout_props#1080005 | 168785 | mlb_strikeout_props#1200055 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1200056 |
| 696136 | 3569 | mlb_strikeout_props#1080005 | 168785 | mlb_strikeout_props#1200059 |
| 643377 | 128185 | mlb_strikeout_props#660048 | 3959 | mlb_strikeout_props#1200063 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#1200065 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 169224 | mlb_strikeout_props#1200066 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1200067 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 147530 | mlb_strikeout_props#1200068 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 197016 | mlb_strikeout_props#1200069 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 127939 | mlb_strikeout_props#1200070 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1200071 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#1200072 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 299395 | mlb_strikeout_props#1200073 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 88795 | mlb_strikeout_props#1200074 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#1200075 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1200076 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 88441 | mlb_strikeout_props#1200078 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 231797 | mlb_strikeout_props#1230001 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1230002 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#1230003 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 3478 | mlb_strikeout_props#1230005 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#1230006 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 273391 | mlb_strikeout_props#1230007 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#1230008 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 3560 | mlb_strikeout_props#1230009 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1230010 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 34009 | mlb_strikeout_props#1230011 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#1230012 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 59393 | mlb_strikeout_props#1230013 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 165574 | mlb_strikeout_props#1230015 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 105048 | mlb_strikeout_props#1230016 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1230017 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#1230018 |
| 592791 | 3569 | mlb_strikeout_props#90001 | 3882 | mlb_strikeout_props#1230020 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#1230021 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1230022 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#1230023 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#1230024 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#1230026 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 233259 | mlb_strikeout_props#1230027 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 231797 | mlb_strikeout_props#1290005 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1290011 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 33821 | mlb_strikeout_props#1290012 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 63290 | mlb_strikeout_props#1290013 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 88465 | mlb_strikeout_props#1290015 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3210 | mlb_strikeout_props#1290016 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 3211 | mlb_strikeout_props#1290019 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 3637 | mlb_strikeout_props#1290020 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3759 | mlb_strikeout_props#1290021 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#1290024 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1290025 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1290027 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#1290030 |
| 660271 | 81561 | mlb_hr_props#74 | 190999 | mlb_strikeout_props#1290031 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 59401 | mlb_strikeout_props#1320001 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1320003 |
| 678394 | 128080 | mlb_strikeout_props#540053 | 3484 | mlb_strikeout_props#1320004 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#1320005 |
| 689441 | 189868 | mlb_strikeout_props#510013 | 197332 | mlb_strikeout_props#1320007 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#1320008 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 3448 | mlb_strikeout_props#1320009 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 3729 | mlb_strikeout_props#1320010 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 82605 | mlb_strikeout_props#1320012 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#1320014 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#1320015 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 54310 | mlb_strikeout_props#1320017 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 233389 | mlb_strikeout_props#1320020 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#1320021 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 168786 | mlb_strikeout_props#1320022 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#1320023 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#1320024 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#1320025 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1320026 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#1320029 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 165219 | mlb_strikeout_props#1320030 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1320031 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1320033 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1320034 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1320035 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1320037 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#1320038 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 190178 | mlb_strikeout_props#1320039 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 197294 | mlb_strikeout_props#1320040 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1320041 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 147534 | mlb_strikeout_props#1320042 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#1320043 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1320044 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#1320045 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 189814 | mlb_strikeout_props#1380003 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 7802 | mlb_strikeout_props#1380006 |
| 685299 | 54309 | mlb_strikeout_props#1020083 | 190178 | mlb_strikeout_props#1380020 |
| 676962 | 82605 | mlb_strikeout_props#780021 | 107363 | mlb_strikeout_props#1410001 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#1410019 |
| 689818 | 140309 | mlb_strikeout_props#1110020 | 233950 | mlb_strikeout_props#1410021 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1410023 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1410025 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 3478 | mlb_strikeout_props#1410028 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#1410031 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 147478 | mlb_strikeout_props#1410036 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#1410041 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 169224 | mlb_strikeout_props#1410047 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#1410051 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#1410058 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 88795 | mlb_strikeout_props#1410059 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#1410061 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 105048 | mlb_strikeout_props#1410063 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 147530 | mlb_strikeout_props#1410064 |
| 605135 | 3478 | mlb_strikeout_props#90095 | 63290 | mlb_strikeout_props#1410066 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 88441 | mlb_strikeout_props#1410067 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#1410068 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 88465 | mlb_strikeout_props#1410069 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 3560 | mlb_strikeout_props#1410070 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1410072 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#1410073 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1410076 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 33821 | mlb_strikeout_props#1410077 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3759 | mlb_strikeout_props#1410078 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 273391 | mlb_strikeout_props#1410079 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#1410080 |
| 690986 | 147530 | mlb_strikeout_props#90106 | 190631 | mlb_strikeout_props#1410081 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1440001 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#1440002 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#1440003 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 197302 | mlb_strikeout_props#1440004 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 197041 | mlb_strikeout_props#1440005 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 273280 | mlb_strikeout_props#1440008 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3210 | mlb_strikeout_props#1440010 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1440011 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1440012 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 59401 | mlb_strikeout_props#1440013 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 4086 | mlb_strikeout_props#1440014 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1440016 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 3211 | mlb_strikeout_props#1440017 |
| 685126 | 194244 | mlb_strikeout_props#1410004 | 140309 | mlb_strikeout_props#1440018 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#1440020 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1440021 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#1440022 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 54310 | mlb_strikeout_props#1440023 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1440024 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1440025 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#1440027 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 54392 | mlb_strikeout_props#1440028 |
| 607074 | 88443 | mlb_strikeout_props#810016 | 3210 | mlb_strikeout_props#1470003 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1470009 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#1470010 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#1470011 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#1470012 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 298252 | mlb_strikeout_props#1470017 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 3448 | mlb_strikeout_props#1470018 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 3729 | mlb_strikeout_props#1470020 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#1470021 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 82605 | mlb_strikeout_props#1470022 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1470023 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1470030 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 59119 | mlb_strikeout_props#1470031 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 147534 | mlb_strikeout_props#1470033 |
| 690928 | 87831 | mlb_strikeout_props#630070 | 236983 | mlb_strikeout_props#1470034 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1470035 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 108961 | mlb_strikeout_props#1470036 |
| 665795 | 82605 | mlb_strikeout_props#90104 | 88258 | mlb_strikeout_props#1470037 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#1470039 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1470040 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1470041 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#1470042 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 165219 | mlb_strikeout_props#1470043 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#1470044 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#1470047 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 147496 | mlb_strikeout_props#1470049 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 242372 | mlb_strikeout_props#1470050 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 190530 | mlb_strikeout_props#1470051 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#1470052 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#1470053 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 123018 | mlb_strikeout_props#1470054 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#1470055 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 54110 | mlb_strikeout_props#1470056 |
| 675911 | 165219 | mlb_strikeout_props#690031 | 3448 | mlb_strikeout_props#1470057 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 237254 | mlb_strikeout_props#1470059 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1470061 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1470062 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1470063 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#1470064 |
| 691725 | 168786 | mlb_strikeout_props#90124 | 3925 | mlb_strikeout_props#1470066 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 123735 | mlb_strikeout_props#1470067 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1470068 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 197016 | mlb_strikeout_props#1470069 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1470070 |
| 691951 | 284454 | mlb_strikeout_props#750025 | 87763 | mlb_strikeout_props#1470071 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 128185 | mlb_strikeout_props#1470072 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 190167 | mlb_strikeout_props#1470073 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 127939 | mlb_strikeout_props#1470075 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 165574 | mlb_strikeout_props#1470076 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1470077 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1470078 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#1470079 |
| 694346 | 3478 | mlb_strikeout_props#1140004 | 63290 | mlb_strikeout_props#1470080 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1470081 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#1470082 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 147478 | mlb_strikeout_props#1470083 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#1470084 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#1470085 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 165221 | mlb_strikeout_props#1470086 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 169224 | mlb_strikeout_props#1470088 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 147558 | mlb_strikeout_props#1470089 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#1470090 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 87829 | mlb_strikeout_props#1470091 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1470092 |
| 681347 | 123735 | mlb_strikeout_props#90035 | 231285 | mlb_strikeout_props#1470094 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 233259 | mlb_strikeout_props#1470095 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1470096 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 127939 | mlb_strikeout_props#1470100 |
| 669199 | 126190 | mlb_strikeout_props#1410012 | 147483 | mlb_strikeout_props#1470104 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 147530 | mlb_strikeout_props#1470105 |
| 676962 | 82605 | mlb_strikeout_props#780021 | 107363 | mlb_strikeout_props#1470106 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 273280 | mlb_strikeout_props#1470108 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1470109 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 273391 | mlb_strikeout_props#1470113 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 3637 | mlb_strikeout_props#1470115 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 109057 | mlb_strikeout_props#1470116 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1470118 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 231797 | mlb_strikeout_props#1470120 |
| 663568 | 3958 | mlb_strikeout_props#810057 | 233259 | mlb_strikeout_props#1470123 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1470124 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1470127 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1470128 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#1470129 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#1470130 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1470131 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 63166 | mlb_strikeout_props#1470135 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 59401 | mlb_strikeout_props#1470138 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 54392 | mlb_strikeout_props#1470139 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1470140 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1470141 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 82605 | mlb_strikeout_props#1470142 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1470143 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 87837 | mlb_strikeout_props#1470144 |
| 669194 | 109057 | mlb_strikeout_props#90041 | 105888 | mlb_strikeout_props#1470146 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1470148 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 190999 | mlb_strikeout_props#1470150 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1470151 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 128132 | mlb_strikeout_props#1470154 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 168786 | mlb_strikeout_props#1470157 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 197302 | mlb_strikeout_props#1470158 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1470160 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3210 | mlb_strikeout_props#1470162 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1470163 |
| 673540 | 229864 | mlb_strikeout_props#90210 | 147534 | mlb_strikeout_props#1470164 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 197040 | mlb_strikeout_props#1470165 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 3650 | mlb_strikeout_props#1470166 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#1470167 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1470170 |
| 665795 | 82605 | mlb_strikeout_props#90104 | 88258 | mlb_strikeout_props#1470171 |
| 805673 | 129356 | mlb_strikeout_props#840008 | 264587 | mlb_strikeout_props#1470173 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 87829 | mlb_strikeout_props#1470175 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1470177 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1470178 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 284454 | mlb_strikeout_props#1470179 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1470180 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#1470181 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#1470183 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#1470184 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 4086 | mlb_strikeout_props#1470186 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 7802 | mlb_strikeout_props#1470188 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 4308 | mlb_strikeout_props#1470189 |
| 691725 | 168786 | mlb_strikeout_props#90124 | 3925 | mlb_strikeout_props#1470191 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1470195 |
| 687562 | 197302 | mlb_strikeout_props#660011 | 3484 | mlb_strikeout_props#1470199 |
| 453286 | 4086 | mlb_strikeout_props#90127 | 284030 | mlb_strikeout_props#1470200 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 197041 | mlb_strikeout_props#1470203 |
| 650644 | 54282 | mlb_strikeout_props#90128 | 169220 | mlb_strikeout_props#1470206 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1470207 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#1470209 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1470210 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1470212 |
| 605288 | 3759 | mlb_strikeout_props#90154 | 233389 | mlb_strikeout_props#1470213 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#1470216 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1470217 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1470218 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 197016 | mlb_strikeout_props#1470219 |
| 683004 | 108961 | mlb_strikeout_props#90096 | 3951 | mlb_strikeout_props#1470220 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 242372 | mlb_strikeout_props#1470221 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#1470222 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 4308 | mlb_strikeout_props#1470223 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#1470225 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1470226 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3958 | mlb_strikeout_props#1470229 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1470230 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 197294 | mlb_strikeout_props#1470232 |
| 696270 | 283888 | mlb_strikeout_props#90105 | 87763 | mlb_strikeout_props#1470233 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 3637 | mlb_strikeout_props#1470234 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 231797 | mlb_strikeout_props#1470236 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 169224 | mlb_strikeout_props#1470237 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1470238 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 127939 | mlb_strikeout_props#1470239 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 3211 | mlb_strikeout_props#1470242 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#1470243 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 54477 | mlb_strikeout_props#1470244 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 3079 | mlb_strikeout_props#1470245 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#1470246 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 299395 | mlb_strikeout_props#1470249 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1470250 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#1470251 |
| 647336 | 54110 | mlb_strikeout_props#90115 | 59129 | mlb_strikeout_props#1470253 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 165574 | mlb_strikeout_props#1470254 |
| 694346 | 3478 | mlb_strikeout_props#1140004 | 63290 | mlb_strikeout_props#1470255 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#1470256 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#1470257 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 147478 | mlb_strikeout_props#1470258 |
| 676962 | 82605 | mlb_strikeout_props#780021 | 3882 | mlb_strikeout_props#1470259 |
| 669199 | 126190 | mlb_strikeout_props#1410012 | 147483 | mlb_strikeout_props#1470260 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 231285 | mlb_strikeout_props#1470261 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 189315 | mlb_strikeout_props#1470262 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1470263 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 231725 | mlb_strikeout_props#1470264 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 264195 | mlb_strikeout_props#1470265 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 64950 | mlb_strikeout_props#1470266 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 165221 | mlb_strikeout_props#1470269 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 273280 | mlb_strikeout_props#1470270 |
| 690986 | 147530 | mlb_strikeout_props#90106 | 190631 | mlb_strikeout_props#1470271 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 105048 | mlb_strikeout_props#1470272 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 273391 | mlb_strikeout_props#1470273 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 88465 | mlb_strikeout_props#1470274 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1470277 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 3525 | mlb_strikeout_props#1470278 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1470279 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1470282 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#1470283 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1470284 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 88441 | mlb_strikeout_props#1470286 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1470287 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 34009 | mlb_strikeout_props#1470290 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1470291 |
| 688107 | 197332 | mlb_strikeout_props#900048 | 54572 | mlb_strikeout_props#1470292 |
| 695684 | 231725 | mlb_strikeout_props#630039 | 3560 | mlb_strikeout_props#1470293 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 62315 | mlb_strikeout_props#1470295 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1470298 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 54392 | mlb_strikeout_props#1470299 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#1470300 |
| 663568 | 3958 | mlb_strikeout_props#810057 | 3729 | mlb_strikeout_props#1470301 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1470302 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 87837 | mlb_strikeout_props#1470305 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1470306 |
| 683003 | 58563 | mlb_strikeout_props#1170004 | 147522 | mlb_strikeout_props#1470307 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 284454 | mlb_strikeout_props#1470308 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1470309 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 197302 | mlb_strikeout_props#1470310 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1470311 |
| 678906 | 112028 | mlb_strikeout_props#630004 | 128132 | mlb_strikeout_props#1470314 |
| 805673 | 129356 | mlb_strikeout_props#840008 | 264587 | mlb_strikeout_props#1470317 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 87829 | mlb_strikeout_props#1470319 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3210 | mlb_strikeout_props#1470320 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1470321 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 87827 | mlb_strikeout_props#1470322 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1470324 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 54289 | mlb_strikeout_props#1470326 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 82605 | mlb_strikeout_props#1470327 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1470328 |
| 605540 | 54572 | mlb_strikeout_props#540065 | 197332 | mlb_strikeout_props#1470329 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 197041 | mlb_strikeout_props#1470331 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 190999 | mlb_strikeout_props#1470332 |
| 805673 | 129356 | mlb_strikeout_props#840008 | 190600 | mlb_strikeout_props#1470333 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1470334 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1470335 |
| 687562 | 197302 | mlb_strikeout_props#660011 | 3484 | mlb_strikeout_props#1470336 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 242528 | mlb_strikeout_props#1470337 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1470338 |
| 691951 | 284454 | mlb_strikeout_props#750025 | 283888 | mlb_strikeout_props#1470339 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 197040 | mlb_strikeout_props#1470340 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#1470342 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1470343 |
| 663567 | 54310 | mlb_strikeout_props#540005 | 123735 | mlb_strikeout_props#1500001 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 123018 | mlb_strikeout_props#1500003 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1500004 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#1500005 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1500007 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#1500008 |
| 694346 | 3478 | mlb_strikeout_props#1140004 | 242372 | mlb_strikeout_props#1500016 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 169220 | mlb_strikeout_props#1500025 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 63166 | mlb_strikeout_props#1500037 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 3232 | mlb_strikeout_props#1500038 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#1500039 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#1500042 |
| 694346 | 3478 | mlb_strikeout_props#1140004 | 242372 | mlb_strikeout_props#1500044 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 231797 | mlb_strikeout_props#1500046 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3958 | mlb_strikeout_props#1500047 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1500048 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#1500049 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 189814 | mlb_strikeout_props#1500050 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1500052 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 147496 | mlb_strikeout_props#1500053 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1500055 |
| 683352 | 231814 | mlb_strikeout_props#1500030 | 59129 | mlb_strikeout_props#1500058 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1500059 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#1500063 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1530002 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 189814 | mlb_strikeout_props#1530003 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 189315 | mlb_strikeout_props#1530006 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 3047 | mlb_strikeout_props#1530015 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1530016 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 231285 | mlb_strikeout_props#1530017 |
| 571578 | 5814 | mlb_strikeout_props#480009 | 3637 | mlb_strikeout_props#1530025 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 284010 | mlb_strikeout_props#1530027 |
| 689818 | 140309 | mlb_strikeout_props#1110020 | 233950 | mlb_strikeout_props#1530033 |
| 687562 | 197302 | mlb_strikeout_props#660011 | 3484 | mlb_strikeout_props#1530045 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 59119 | mlb_strikeout_props#1530046 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3210 | mlb_strikeout_props#1530047 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 54289 | mlb_strikeout_props#1530048 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1530049 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1530052 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1530055 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1530056 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#1530057 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1530059 |
| 690986 | 147530 | mlb_strikeout_props#90106 | 54572 | mlb_strikeout_props#1530061 |
| 702474 | 264587 | mlb_strikeout_props#1470027 | 197016 | mlb_strikeout_props#1530063 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 147478 | mlb_strikeout_props#1530065 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1530069 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1530071 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 80915 | mlb_strikeout_props#1530074 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 3211 | mlb_strikeout_props#1530076 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3650 | mlb_strikeout_props#1530078 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 284454 | mlb_strikeout_props#1530080 |
| 686613 | 54310 | mlb_strikeout_props#1470176 | 128132 | mlb_strikeout_props#1530088 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1530092 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 7802 | mlb_strikeout_props#1530093 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1530094 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 81393 | mlb_strikeout_props#1530095 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1530098 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 197041 | mlb_strikeout_props#1530099 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 87829 | mlb_strikeout_props#1530100 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#1530102 |
| 676106 | 147478 | mlb_strikeout_props#90092 | 108948 | mlb_strikeout_props#1530103 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 242528 | mlb_strikeout_props#1530105 |
| 605540 | 54572 | mlb_strikeout_props#540065 | 190631 | mlb_strikeout_props#1530107 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 264587 | mlb_strikeout_props#1530108 |
| 650644 | 54282 | mlb_strikeout_props#90128 | 169220 | mlb_strikeout_props#1530110 |
| 691951 | 284454 | mlb_strikeout_props#750025 | 283888 | mlb_strikeout_props#1530111 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 54225 | mlb_strikeout_props#1530113 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1530114 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#1530115 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#1530116 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1530118 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#1530119 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 4308 | mlb_strikeout_props#1530120 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 242372 | mlb_strikeout_props#1530122 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#1530123 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1530124 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#1530125 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 123018 | mlb_strikeout_props#1530126 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1530127 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 147534 | mlb_strikeout_props#1530128 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1530129 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 248256 | mlb_strikeout_props#1530130 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1530131 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 147496 | mlb_strikeout_props#1530132 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 237254 | mlb_strikeout_props#1530133 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 3232 | mlb_strikeout_props#1530135 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 80808 | mlb_strikeout_props#1530136 |
| 663567 | 54310 | mlb_strikeout_props#540005 | 123735 | mlb_strikeout_props#1530137 |
| 807743 | 242528 | mlb_strikeout_props#1470215 | 190178 | mlb_strikeout_props#1530139 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#1530140 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 165568 | mlb_strikeout_props#1530141 |
| 696270 | 283888 | mlb_strikeout_props#90105 | 87763 | mlb_strikeout_props#1530143 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 190999 | mlb_strikeout_props#1530144 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 232439 | mlb_strikeout_props#1530145 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#1530146 |
| 694346 | 3478 | mlb_strikeout_props#1140004 | 89881 | mlb_strikeout_props#1530148 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#1530149 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#1530150 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1530151 |
| 696149 | 168789 | mlb_strikeout_props#90007 | 237263 | mlb_strikeout_props#1530152 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 63166 | mlb_strikeout_props#1530153 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 231797 | mlb_strikeout_props#1530154 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1530155 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#1530156 |
| 813349 | 248256 | mlb_strikeout_props#90174 | 284010 | mlb_strikeout_props#1530158 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 273391 | mlb_strikeout_props#1530159 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 33937 | mlb_strikeout_props#1530160 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 168794 | mlb_strikeout_props#1530161 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 169224 | mlb_strikeout_props#1530162 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3958 | mlb_strikeout_props#1530163 |
| 643377 | 128185 | mlb_strikeout_props#660048 | 87827 | mlb_strikeout_props#1530165 |
| 571510 | 3232 | mlb_strikeout_props#90147 | 3882 | mlb_strikeout_props#1530166 |
| 676664 | 80808 | mlb_strikeout_props#1500034 | 54477 | mlb_strikeout_props#1530167 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 165574 | mlb_strikeout_props#1530169 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 147483 | mlb_strikeout_props#1530171 |
| 694297 | 165568 | mlb_strikeout_props#90215 | 59129 | mlb_strikeout_props#1530172 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 88569 | mlb_strikeout_props#1530173 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 127939 | mlb_strikeout_props#1530177 |
| 702273 | 197042 | mlb_strikeout_props#390015 | 140309 | mlb_strikeout_props#1530179 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 88465 | mlb_strikeout_props#1530180 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 3079 | mlb_strikeout_props#1530181 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 284010 | mlb_strikeout_props#1530182 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 190530 | mlb_strikeout_props#1530187 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1530190 |
| 625643 | 33937 | mlb_strikeout_props#90065 | 237258 | mlb_strikeout_props#1530191 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1530192 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 233259 | mlb_strikeout_props#1530193 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1530195 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 3525 | mlb_strikeout_props#1530197 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 273280 | mlb_strikeout_props#1530198 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 127939 | mlb_strikeout_props#1530201 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 197294 | mlb_strikeout_props#1530202 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1560002 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#1560003 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1560004 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#1560006 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1560009 |
| 663568 | 3958 | mlb_strikeout_props#810057 | 233259 | mlb_strikeout_props#1560010 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1560013 |
| 681190 | 190530 | mlb_strikeout_props#90070 | 80915 | mlb_strikeout_props#1560016 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1560019 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1560020 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 53462 | mlb_strikeout_props#1560021 |
| 702474 | 264587 | mlb_strikeout_props#1470027 | 329869 | mlb_strikeout_props#1560022 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3560 | mlb_strikeout_props#1560023 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1560024 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 63161 | mlb_strikeout_props#1560025 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 197041 | mlb_strikeout_props#1560026 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 3211 | mlb_strikeout_props#1560027 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 4308 | mlb_strikeout_props#1560028 |
| 681293 | 231285 | mlb_strikeout_props#450023 | 128132 | mlb_strikeout_props#1560030 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1560031 |
| 703615 | 105888 | mlb_strikeout_props#1530054 | 302364 | mlb_strikeout_props#1560034 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#1560036 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 88441 | mlb_strikeout_props#1560037 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 54289 | mlb_strikeout_props#1560038 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 264195 | mlb_strikeout_props#1560039 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1560040 |
| 678022 | 54282 | mlb_strikeout_props#1470185 | 302414 | mlb_strikeout_props#1560041 |
| 660271 | 81561 | mlb_hr_props#74 | 260345 | mlb_strikeout_props#1560043 |
| 805673 | 129356 | mlb_strikeout_props#840008 | 264587 | mlb_strikeout_props#1560047 |
| 669456 | 284030 | mlb_strikeout_props#1500002 | 54289 | mlb_strikeout_props#1560051 |
| 686613 | 54310 | mlb_strikeout_props#1470176 | 128132 | mlb_strikeout_props#1560056 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 4308 | mlb_strikeout_props#1560060 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 242528 | mlb_strikeout_props#1560062 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 33937 | mlb_strikeout_props#1590001 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#1590002 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 81393 | mlb_strikeout_props#1590004 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 7802 | mlb_strikeout_props#1590006 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1590008 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 88414 | mlb_strikeout_props#1590011 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1590012 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1590013 |
| 663567 | 54310 | mlb_strikeout_props#540005 | 123735 | mlb_strikeout_props#1590015 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 165568 | mlb_strikeout_props#1590017 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#1590020 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 169220 | mlb_strikeout_props#1590021 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1590024 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 5814 | mlb_strikeout_props#1590025 |
| 676664 | 80808 | mlb_strikeout_props#1500034 | 54477 | mlb_strikeout_props#1590026 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3958 | mlb_strikeout_props#1590030 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1590032 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 273391 | mlb_strikeout_props#1590035 |
| 625643 | 33937 | mlb_strikeout_props#90065 | 237258 | mlb_strikeout_props#1590036 |
| 694297 | 165568 | mlb_strikeout_props#90215 | 59129 | mlb_strikeout_props#1590039 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 4158 | mlb_strikeout_props#1590040 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 127939 | mlb_strikeout_props#1590041 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 3525 | mlb_strikeout_props#1590043 |
| 641778 | 5814 | mlb_strikeout_props#90081 | 190999 | mlb_strikeout_props#1590044 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 197294 | mlb_strikeout_props#1590045 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 147530 | mlb_strikeout_props#1590046 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 89881 | mlb_strikeout_props#1590047 |
| 571510 | 3232 | mlb_strikeout_props#90147 | 3882 | mlb_strikeout_props#1590048 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 82582 | mlb_strikeout_props#1590049 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 231797 | mlb_strikeout_props#1590051 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 3560 | mlb_strikeout_props#1590053 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 147522 | mlb_strikeout_props#1590054 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 108948 | mlb_strikeout_props#1590055 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 54392 | mlb_strikeout_props#1590056 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1590057 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 197302 | mlb_strikeout_props#1590059 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 88465 | mlb_strikeout_props#1590060 |
| 702273 | 197042 | mlb_strikeout_props#390015 | 140309 | mlb_strikeout_props#1590061 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 197016 | mlb_strikeout_props#1590062 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 231164 | mlb_strikeout_props#1590063 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 63166 | mlb_strikeout_props#1590064 |
| 668678 | 59129 | mlb_strikeout_props#90149 | 302364 | mlb_strikeout_props#1590065 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 105048 | mlb_strikeout_props#1590066 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 123577 | mlb_strikeout_props#1590067 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 300850 | mlb_strikeout_props#1590068 |
| 693855 | 3446 | mlb_strikeout_props#1410071 | 87827 | mlb_strikeout_props#1590069 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 231285 | mlb_strikeout_props#1590070 |
| 690928 | 87831 | mlb_strikeout_props#630070 | 168794 | mlb_strikeout_props#1590072 |
| 608566 | 4158 | mlb_strikeout_props#90008 | 80915 | mlb_strikeout_props#1590073 |
| 693686 | 326797 | mlb_strikeout_props#1200061 | 64950 | mlb_strikeout_props#1590074 |
| 665152 | 89881 | mlb_strikeout_props#360004 | 63290 | mlb_strikeout_props#1590078 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 165221 | mlb_strikeout_props#1590081 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3560 | mlb_strikeout_props#1590083 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 189814 | mlb_strikeout_props#1590085 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 63393 | mlb_strikeout_props#1590086 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1590089 |
| 681035 | 190262 | mlb_strikeout_props#540047 | 4308 | mlb_strikeout_props#1590090 |
| 687562 | 197302 | mlb_strikeout_props#660011 | 90063 | mlb_strikeout_props#1590091 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#1590092 |
| 687570 | 197016 | mlb_strikeout_props#600009 | 128169 | mlb_strikeout_props#1590094 |
| 690986 | 147530 | mlb_strikeout_props#90106 | 189716 | mlb_strikeout_props#1590095 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 128784 | mlb_strikeout_props#1590096 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1590097 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 3079 | mlb_strikeout_props#1590098 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#1590102 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 170933 | mlb_strikeout_props#1590103 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 3211 | mlb_strikeout_props#1620001 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 88469 | mlb_strikeout_props#1620002 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1620003 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 147534 | mlb_strikeout_props#1620004 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 3446 | mlb_strikeout_props#1620005 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1620006 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 197041 | mlb_strikeout_props#1620007 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 264587 | mlb_strikeout_props#1620008 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 59119 | mlb_strikeout_props#1620010 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59120 | mlb_strikeout_props#1620011 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 63161 | mlb_strikeout_props#1620013 |
| 666200 | 59401 | mlb_strikeout_props#90078 | 3925 | mlb_strikeout_props#1620014 |
| 701656 | 189716 | mlb_strikeout_props#810015 | 197332 | mlb_strikeout_props#1620015 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1620016 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 88795 | mlb_strikeout_props#1620017 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 3047 | mlb_strikeout_props#1620019 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 80808 | mlb_strikeout_props#1620020 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 190178 | mlb_strikeout_props#1620021 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 264195 | mlb_strikeout_props#1680001 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 169249 | mlb_strikeout_props#1680002 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 87829 | mlb_strikeout_props#1740001 |
| 605400 | 3925 | mlb_strikeout_props#60063 | 122610 | mlb_strikeout_props#1740003 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 302398 | mlb_strikeout_props#1740005 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 88764 | mlb_strikeout_props#1740006 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 233948 | mlb_strikeout_props#1740007 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 88258 | mlb_strikeout_props#1740008 |
| 668881 | 63161 | mlb_strikeout_props#1560053 | 7802 | mlb_strikeout_props#1740009 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 189282 | mlb_strikeout_props#1740010 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 166026 | mlb_strikeout_props#1740011 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 88441 | mlb_strikeout_props#1740012 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 128185 | mlb_strikeout_props#1740013 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#1740015 |
| 682052 | 112027 | mlb_strikeout_props#90102 | 169220 | mlb_strikeout_props#1740016 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#1740017 |
| 680570 | 231164 | mlb_strikeout_props#900057 | 283888 | mlb_strikeout_props#1740019 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 33937 | mlb_strikeout_props#1740021 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1740022 |
| 676664 | 80808 | mlb_strikeout_props#1500034 | 54477 | mlb_strikeout_props#1740023 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 165568 | mlb_strikeout_props#1740025 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 54225 | mlb_strikeout_props#1740027 |
| 660271 | 81561 | mlb_hr_props#74 | 260345 | mlb_strikeout_props#1770002 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 190631 | mlb_strikeout_props#1800001 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 237263 | mlb_strikeout_props#1800002 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 88569 | mlb_strikeout_props#1800003 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#1800004 |
| 696270 | 283888 | mlb_strikeout_props#90105 | 87763 | mlb_strikeout_props#1800005 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 165574 | mlb_strikeout_props#1800006 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 3525 | mlb_strikeout_props#1800007 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 231517 | mlb_strikeout_props#1800008 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 127939 | mlb_strikeout_props#1800009 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 147496 | mlb_strikeout_props#1800010 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 126205 | mlb_strikeout_props#1800011 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 147478 | mlb_strikeout_props#1800014 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 123018 | mlb_strikeout_props#1800016 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1800017 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1800018 |
| 663567 | 54310 | mlb_strikeout_props#540005 | 88408 | mlb_strikeout_props#1800019 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3958 | mlb_strikeout_props#1800020 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 63166 | mlb_strikeout_props#1800021 |
| 665871 | 88258 | mlb_strikeout_props#360005 | 3232 | mlb_strikeout_props#1800022 |
| 666157 | 169222 | mlb_strikeout_props#780001 | 169224 | mlb_strikeout_props#1800023 |
| 625643 | 33937 | mlb_strikeout_props#90065 | 197040 | mlb_strikeout_props#1800024 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 88414 | mlb_strikeout_props#1800025 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 4158 | mlb_strikeout_props#1800026 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 2921 | mlb_strikeout_props#1800027 |
| 694297 | 165568 | mlb_strikeout_props#90215 | 231814 | mlb_strikeout_props#1800028 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#1800029 |
| 688107 | 197332 | mlb_strikeout_props#900048 | 190631 | mlb_strikeout_props#1800031 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 284010 | mlb_strikeout_props#1800037 |
| 702275 | 3448 | mlb_strikeout_props#900061 | 197040 | mlb_strikeout_props#1800048 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 127939 | mlb_strikeout_props#1800053 |
| 693855 | 3446 | mlb_strikeout_props#1410071 | 147640 | mlb_strikeout_props#1800058 |
| 687562 | 197302 | mlb_strikeout_props#660011 | 189985 | mlb_strikeout_props#1860001 |
| 643377 | 128185 | mlb_strikeout_props#660048 | 106355 | mlb_strikeout_props#1860002 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 190998 | mlb_strikeout_props#1860003 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 126205 | mlb_strikeout_props#1860005 |
| 683003 | 58563 | mlb_strikeout_props#1170004 | 237263 | mlb_strikeout_props#1860006 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 197038 | mlb_strikeout_props#1860007 |
| 645261 | 59120 | mlb_strikeout_props#90006 | 147483 | mlb_strikeout_props#1860008 |
| 607067 | 3882 | mlb_strikeout_props#120007 | 3232 | mlb_strikeout_props#1860010 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 165574 | mlb_strikeout_props#1860011 |
| 665152 | 89881 | mlb_strikeout_props#360004 | 63290 | mlb_strikeout_props#1860012 |
| 663567 | 54310 | mlb_strikeout_props#540005 | 231285 | mlb_strikeout_props#1860013 |
| 663903 | 87825 | mlb_strikeout_props#60059 | 237254 | mlb_strikeout_props#1860016 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 123018 | mlb_strikeout_props#1860018 |
| 672282 | 147481 | mlb_strikeout_props#60072 | 88795 | mlb_strikeout_props#1860019 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 165568 | mlb_strikeout_props#1860020 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 88569 | mlb_strikeout_props#1860021 |
| 700241 | 168794 | mlb_strikeout_props#60053 | 88414 | mlb_strikeout_props#1860022 |
| 676917 | 147496 | mlb_strikeout_props#90136 | 53462 | mlb_strikeout_props#1860023 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 232439 | mlb_strikeout_props#1860024 |
| 694738 | 233389 | mlb_strikeout_props#90114 | 105048 | mlb_strikeout_props#1860025 |
| 641743 | 7704 | mlb_strikeout_props#600007 | 140309 | mlb_strikeout_props#1890001 |
| 615698 | 87837 | mlb_strikeout_props#1740028 | 63166 | mlb_strikeout_props#1890002 |
| 693686 | 326797 | mlb_strikeout_props#1200061 | 54289 | mlb_strikeout_props#1890003 |
| 571510 | 3232 | mlb_strikeout_props#90147 | 264195 | mlb_strikeout_props#1920001 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 264587 | mlb_strikeout_props#1920002 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 169249 | mlb_strikeout_props#1920003 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 63161 | mlb_strikeout_props#1920005 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 123577 | mlb_strikeout_props#1920006 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 147534 | mlb_strikeout_props#1920007 |
| 694297 | 165568 | mlb_strikeout_props#90215 | 3047 | mlb_strikeout_props#1920009 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#1920011 |
| 681293 | 231285 | mlb_strikeout_props#450023 | 128132 | mlb_strikeout_props#1920013 |
| 676974 | 147483 | mlb_strikeout_props#90084 | 166026 | mlb_strikeout_props#1920014 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#1920015 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 3079 | mlb_strikeout_props#1920016 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 88441 | mlb_strikeout_props#1920019 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3650 | mlb_strikeout_props#1920020 |
| 669372 | 88569 | mlb_strikeout_props#180003 | 112027 | mlb_strikeout_props#1920021 |
| 641793 | 53462 | mlb_strikeout_props#90012 | 54392 | mlb_strikeout_props#1920022 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 87829 | mlb_strikeout_props#1920023 |
| 680570 | 231164 | mlb_strikeout_props#900057 | 283888 | mlb_strikeout_props#1920024 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 4158 | mlb_strikeout_props#1920026 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 190631 | mlb_strikeout_props#1920027 |
| 693855 | 3446 | mlb_strikeout_props#1410071 | 87827 | mlb_strikeout_props#1920028 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#1920029 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 64950 | mlb_strikeout_props#1920030 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 165221 | mlb_strikeout_props#1920031 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 284010 | mlb_strikeout_props#1920032 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#1920033 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 3446 | mlb_strikeout_props#1920034 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 3951 | mlb_strikeout_props#1920035 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 189282 | mlb_strikeout_props#1920036 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 88469 | mlb_strikeout_props#1920037 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 63258 | mlb_strikeout_props#1920038 |
| 686613 | 54310 | mlb_strikeout_props#1470176 | 140328 | mlb_strikeout_props#1920040 |
| 702070 | 233948 | mlb_strikeout_props#90155 | 3729 | mlb_strikeout_props#1920041 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 170933 | mlb_strikeout_props#1920042 |
| 688107 | 197332 | mlb_strikeout_props#900048 | 197294 | mlb_strikeout_props#1920043 |
| 608566 | 4158 | mlb_strikeout_props#90008 | 80808 | mlb_strikeout_props#1920044 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 3569 | mlb_strikeout_props#1920045 |
| 668881 | 63161 | mlb_strikeout_props#1560053 | 169224 | mlb_strikeout_props#1920047 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 54309 | mlb_strikeout_props#1920048 |
| 682052 | 112027 | mlb_strikeout_props#90102 | 82582 | mlb_strikeout_props#1920049 |
| 656492 | 54392 | mlb_strikeout_props#300018 | 273391 | mlb_strikeout_props#1920050 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 59119 | mlb_strikeout_props#1920051 |
| 696270 | 283888 | mlb_strikeout_props#90105 | 87763 | mlb_strikeout_props#1920052 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 231814 | mlb_strikeout_props#1920053 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#1920054 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 127939 | mlb_strikeout_props#1920055 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#1920056 |
| 660604 | 183714 | mlb_strikeout_props#1560017 | 122610 | mlb_strikeout_props#1920057 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 197041 | mlb_strikeout_props#1920058 |
| 657746 | 129356 | mlb_strikeout_props#90156 | 190600 | mlb_strikeout_props#1920059 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#1920060 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 168789 | mlb_strikeout_props#1920061 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#1920062 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 2921 | mlb_strikeout_props#1920063 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 88764 | mlb_strikeout_props#1920064 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 80883 | mlb_strikeout_props#1920065 |
| 686218 | 190998 | mlb_strikeout_props#60051 | 190999 | mlb_strikeout_props#1920066 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#1920067 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 33937 | mlb_strikeout_props#1920068 |
| 676664 | 80808 | mlb_strikeout_props#1500034 | 54477 | mlb_strikeout_props#1920069 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#1920070 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 197332 | mlb_strikeout_props#1920071 |
| 686790 | 3759 | mlb_strikeout_props#810040 | 54225 | mlb_strikeout_props#1920073 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#1920075 |
| 656427 | 59119 | mlb_strikeout_props#90069 | 62315 | mlb_strikeout_props#1920076 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 87837 | mlb_strikeout_props#1920077 |
| 607536 | 54309 | mlb_strikeout_props#90031 | 3525 | mlb_strikeout_props#1920080 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 81393 | mlb_strikeout_props#1920081 |
| 683352 | 231814 | mlb_strikeout_props#1500030 | 301409 | mlb_strikeout_props#1920082 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#1920084 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 33991 | mlb_strikeout_props#1920085 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 231164 | mlb_strikeout_props#1920086 |
| 681517 | 236983 | mlb_strikeout_props#300024 | 87831 | mlb_strikeout_props#1920087 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 88465 | mlb_strikeout_props#1950001 |
| 680736 | 190999 | mlb_strikeout_props#510075 | 5814 | mlb_strikeout_props#1950002 |
| 696070 | 264587 | mlb_strikeout_props#900089 | 128169 | mlb_strikeout_props#1950003 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 3925 | mlb_strikeout_props#1950004 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 53380 | mlb_strikeout_props#1950005 |
| 656876 | 63393 | mlb_strikeout_props#90144 | 128185 | mlb_strikeout_props#1950007 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 189985 | mlb_strikeout_props#1950010 |
| 625643 | 33937 | mlb_strikeout_props#90065 | 3448 | mlb_strikeout_props#1950011 |
| 621111 | 54477 | mlb_strikeout_props#90112 | 80915 | mlb_strikeout_props#1950012 |
| 679883 | 264584 | mlb_strikeout_props#90168 | 3958 | mlb_strikeout_props#1950013 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 189716 | mlb_strikeout_props#1950014 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#1950015 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#1950017 |
| 547179 | 3525 | mlb_strikeout_props#60064 | 197013 | mlb_strikeout_props#1950019 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 147496 | mlb_strikeout_props#1950020 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#1950021 |
| 669461 | 87831 | mlb_strikeout_props#90142 | 298252 | mlb_strikeout_props#1950022 |
| 695505 | 169222 | mlb_strikeout_props#90097 | 87825 | mlb_strikeout_props#1950024 |
| 622491 | 33991 | mlb_strikeout_props#90113 | 147478 | mlb_strikeout_props#1950025 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 54310 | mlb_strikeout_props#1980001 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#1980002 |
| 678022 | 54282 | mlb_strikeout_props#1470185 | 169220 | mlb_strikeout_props#1980003 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 3882 | mlb_strikeout_props#1980004 |
| 607625 | 3958 | mlb_strikeout_props#90076 | 112151 | mlb_strikeout_props#2040001 |
| 687312 | 299395 | mlb_strikeout_props#1860017 | 197013 | mlb_strikeout_props#2040005 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 165568 | mlb_strikeout_props#2040007 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 169220 | mlb_strikeout_props#2040008 |
| 690928 | 87831 | mlb_strikeout_props#630070 | 168794 | mlb_strikeout_props#2040012 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#2040013 |
| 641927 | 128169 | mlb_strikeout_props#60066 | 165574 | mlb_strikeout_props#2040015 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 3211 | mlb_strikeout_props#2040018 |
| 650633 | 80915 | mlb_strikeout_props#60057 | 63283 | mlb_strikeout_props#2040019 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 231797 | mlb_strikeout_props#2040021 |
| 615698 | 87837 | mlb_strikeout_props#1740028 | 5787 | mlb_strikeout_props#2070002 |
| 669456 | 284030 | mlb_strikeout_props#1500002 | 54289 | mlb_strikeout_props#2100001 |
| 519242 | 3211 | mlb_strikeout_props#90023 | 34009 | mlb_strikeout_props#2130001 |
| 656288 | 63283 | mlb_strikeout_props#690044 | 4158 | mlb_strikeout_props#2130002 |
| 668909 | 147558 | mlb_strikeout_props#90039 | 126205 | mlb_strikeout_props#2130003 |
| 671737 | 165574 | mlb_strikeout_props#90018 | 264587 | mlb_strikeout_props#2130004 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 123018 | mlb_strikeout_props#2130006 |
| 608372 | 299395 | mlb_strikeout_props#90100 | 123577 | mlb_strikeout_props#2190001 |
| 571510 | 3232 | mlb_strikeout_props#90147 | 264195 | mlb_strikeout_props#2190002 |
| 669373 | 123018 | mlb_strikeout_props#90017 | 87829 | mlb_strikeout_props#2190003 |
| 683003 | 58563 | mlb_strikeout_props#1170004 | 237263 | mlb_strikeout_props#2190004 |
| 593958 | 3047 | mlb_strikeout_props#60076 | 231814 | mlb_strikeout_props#2190005 |
| 693645 | 302398 | mlb_strikeout_props#90027 | 88443 | mlb_strikeout_props#2190006 |
| 656550 | 53481 | mlb_strikeout_props#60075 | 165221 | mlb_strikeout_props#2190008 |
| 669432 | 63290 | mlb_strikeout_props#90131 | 190621 | mlb_strikeout_props#2190009 |
| 676282 | 126205 | mlb_strikeout_props#60062 | 189282 | mlb_strikeout_props#2190010 |
| 808963 | 300850 | mlb_strikeout_props#90118 | 260345 | mlb_strikeout_props#2190011 |
| 640455 | 54568 | mlb_strikeout_props#1470107 | 147534 | mlb_strikeout_props#2190012 |
| 608566 | 4158 | mlb_strikeout_props#90008 | 80808 | mlb_strikeout_props#2190013 |
| 663556 | 87827 | mlb_strikeout_props#90002 | 3446 | mlb_strikeout_props#2190014 |
| 702056 | 284030 | mlb_strikeout_props#630012 | 64950 | mlb_strikeout_props#2190016 |
| 663436 | 140309 | mlb_strikeout_props#90098 | 169249 | mlb_strikeout_props#2190017 |
| 681293 | 231285 | mlb_strikeout_props#450023 | 128132 | mlb_strikeout_props#2190018 |
| 682243 | 33991 | mlb_strikeout_props#810097 | 232439 | mlb_strikeout_props#2190019 |
| 669022 | 63166 | mlb_strikeout_props#60060 | 3079 | mlb_strikeout_props#2190020 |
| 682052 | 112027 | mlb_strikeout_props#90102 | 234037 | mlb_strikeout_props#2190021 |
| 805673 | 129356 | mlb_strikeout_props#840008 | 264587 | mlb_strikeout_props#2190022 |
| 695076 | 237254 | mlb_strikeout_props#90082 | 63161 | mlb_strikeout_props#2190023 |
| 669160 | 88414 | mlb_strikeout_props#90088 | 128784 | mlb_strikeout_props#2190024 |
| 680570 | 231164 | mlb_strikeout_props#900057 | 283888 | mlb_strikeout_props#2190025 |
| 657277 | 105048 | mlb_strikeout_props#90211 | 3650 | mlb_strikeout_props#2190026 |
| 675660 | 63403 | mlb_strikeout_props#150002 | 190631 | mlb_strikeout_props#2220001 |
| 687223 | 81393 | mlb_strikeout_props#1770001 | 54392 | mlb_strikeout_props#2220002 |
| 687473 | 273280 | mlb_strikeout_props#1320028 | 166026 | mlb_strikeout_props#2250001 |
| 663554 | 87829 | mlb_strikeout_props#240003 | 62315 | mlb_strikeout_props#2310001 |
| 608379 | 3729 | mlb_strikeout_props#90004 | 264584 | mlb_strikeout_props#2310002 |
| 683352 | 231814 | mlb_strikeout_props#1500030 | 301409 | mlb_strikeout_props#2310003 |
| 696270 | 283888 | mlb_strikeout_props#90105 | 87763 | mlb_strikeout_props#2310004 |
| 592662 | 3650 | mlb_strikeout_props#90026 | 197030 | mlb_strikeout_props#2310005 |
| 543243 | 3484 | mlb_strikeout_props#60058 | 80883 | mlb_strikeout_props#2310007 |
| 691587 | 166026 | mlb_strikeout_props#90056 | 170933 | mlb_strikeout_props#2310008 |
| 676664 | 80808 | mlb_strikeout_props#1500034 | 54477 | mlb_strikeout_props#2310009 |
| 656302 | 64950 | mlb_strikeout_props#90048 | 2921 | mlb_strikeout_props#2310010 |
| 677960 | 88443 | mlb_strikeout_props#90111 | 231517 | mlb_strikeout_props#2310011 |
| 676440 | 189282 | mlb_strikeout_props#90003 | 197041 | mlb_strikeout_props#2310012 |
| 607259 | 3446 | mlb_strikeout_props#90107 | 63393 | mlb_strikeout_props#2310013 |
| 684007 | 264195 | mlb_strikeout_props#90089 | 3569 | mlb_strikeout_props#2310014 |
| 694973 | 237263 | mlb_strikeout_props#90134 | 88469 | mlb_strikeout_props#2310015 |
| 693821 | 165221 | mlb_strikeout_props#90103 | 33937 | mlb_strikeout_props#2310016 |
| 687064 | 190621 | mlb_strikeout_props#90015 | 63258 | mlb_strikeout_props#2310017 |
| 663372 | 123577 | mlb_strikeout_props#90021 | 54309 | mlb_strikeout_props#2310019 |
| 680732 | 169249 | mlb_strikeout_props#90059 | 59393 | mlb_strikeout_props#2310020 |
| 686613 | 54310 | mlb_strikeout_props#1470176 | 140328 | mlb_strikeout_props#2310021 |
| 688107 | 197332 | mlb_strikeout_props#900048 | 197294 | mlb_strikeout_props#2310022 |
| 668881 | 63161 | mlb_strikeout_props#1560053 | 169224 | mlb_strikeout_props#2310023 |
| 808967 | 260345 | mlb_strikeout_props#90013 | 190998 | mlb_strikeout_props#2310024 |
| 690997 | 147534 | mlb_strikeout_props#60077 | 54568 | mlb_strikeout_props#2310025 |
| 693433 | 232439 | mlb_strikeout_props#60071 | 88441 | mlb_strikeout_props#2310026 |
| 669467 | 128784 | mlb_strikeout_props#90011 | 236983 | mlb_strikeout_props#2310027 |
| 543135 | 3079 | mlb_strikeout_props#90132 | 3951 | mlb_strikeout_props#2310028 |
| 702474 | 264587 | mlb_strikeout_props#1470027 | 197016 | mlb_strikeout_props#2310030 |
| 800048 | 197041 | mlb_strikeout_props#90116 | 88465 | mlb_strikeout_props#2310031 |
| 625643 | 33937 | mlb_strikeout_props#90065 | 3448 | mlb_strikeout_props#2310034 |
| 669358 | 63258 | mlb_strikeout_props#90075 | 88764 | mlb_strikeout_props#2310035 |
| 624133 | 80883 | mlb_strikeout_props#90109 | 284010 | mlb_strikeout_props#2310036 |
| 592791 | 3569 | mlb_strikeout_props#90001 | 63295 | mlb_strikeout_props#2310037 |
| 677952 | 88469 | mlb_strikeout_props#300006 | 58563 | mlb_strikeout_props#2310038 |
| 592332 | 2921 | mlb_strikeout_props#90014 | 4086 | mlb_strikeout_props#2310039 |
| 664285 | 62315 | mlb_strikeout_props#60054 | 189315 | mlb_strikeout_props#2310040 |
| 676083 | 170933 | mlb_strikeout_props#90123 | 59322 | mlb_strikeout_props#2310043 |
| 605488 | 82582 | mlb_strikeout_props#60074 | 302414 | mlb_strikeout_props#2310046 |
| 607200 | 59393 | mlb_strikeout_props#90122 | 197042 | mlb_strikeout_props#2310048 |
| 669854 | 140328 | mlb_strikeout_props#1920078 | 327557 | mlb_strikeout_props#2310049 |
| 694819 | 197294 | mlb_strikeout_props#90010 | 197332 | mlb_strikeout_props#2310050 |
| 671096 | 169224 | mlb_strikeout_props#90005 | 169222 | mlb_strikeout_props#2310052 |
| 669302 | 88441 | mlb_strikeout_props#90019 | 108948 | mlb_strikeout_props#2310054 |
| 594798 | 3951 | mlb_strikeout_props#90020 | 87837 | mlb_strikeout_props#2310055 |
| 667755 | 87763 | mlb_strikeout_props#90024 | 231164 | mlb_strikeout_props#2310056 |
| 687931 | 3650 | mlb_strikeout_props#1680004 | 54225 | mlb_strikeout_props#2310057 |
| 701542 | 231517 | mlb_strikeout_props#60056 | 53380 | mlb_strikeout_props#2310058 |
| 650911 | 122610 | mlb_strikeout_props#90025 | 3968 | mlb_strikeout_props#2310059 |
| 571945 | 81393 | mlb_strikeout_props#60052 | 273391 | mlb_strikeout_props#2340001 |
| 669923 | 108948 | mlb_strikeout_props#90040 | 33991 | mlb_strikeout_props#2370001 |
| 677958 | 87837 | mlb_strikeout_props#90179 | 5787 | mlb_strikeout_props#2370002 |
| 518876 | 105888 | mlb_strikeout_props#630017 | 165568 | mlb_strikeout_props#2370003 |
| 680694 | 88764 | mlb_strikeout_props#60067 | 89881 | mlb_strikeout_props#2370004 |
| 672456 | 189315 | mlb_strikeout_props#90218 | 231797 | mlb_strikeout_props#2370005 |
| 663969 | 59322 | mlb_strikeout_props#1020062 | 59120 | mlb_strikeout_props#2370006 |
| 554430 | 3968 | mlb_strikeout_props#660014 | 3925 | mlb_strikeout_props#2370007 |
| 656605 | 58563 | mlb_strikeout_props#60068 | 168789 | mlb_strikeout_props#2370008 |
| 453286 | 4086 | mlb_strikeout_props#90127 | 54289 | mlb_strikeout_props#2370009 |
| 674841 | 273391 | mlb_strikeout_props#1290004 | 147496 | mlb_strikeout_props#2370010 |
| 527048 | 3448 | mlb_strikeout_props#300019 | 3211 | mlb_strikeout_props#2370011 |
| 677944 | 88465 | mlb_strikeout_props#90091 | 147558 | mlb_strikeout_props#2370013 |
| 702273 | 197042 | mlb_strikeout_props#390015 | 7704 | mlb_strikeout_props#2370014 |
| 608331 | 53380 | mlb_strikeout_props#90197 | 3560 | mlb_strikeout_props#2370015 |
| 656849 | 63295 | mlb_strikeout_props#90057 | 3882 | mlb_strikeout_props#2370016 |
| 837227 | 327557 | mlb_strikeout_props#270003 | 54310 | mlb_strikeout_props#2370017 |
| 700712 | 231164 | mlb_strikeout_props#540097 | 147481 | mlb_strikeout_props#2370018 |
| 678022 | 54282 | mlb_strikeout_props#1470185 | 169220 | mlb_strikeout_props#2370019 |
| 801139 | 128080 | mlb_strikeout_props#540044 | 197302 | mlb_strikeout_props#2370020 |
| 687075 | 197332 | mlb_strikeout_props#90087 | 189716 | mlb_strikeout_props#2370021 |
| 641816 | 54225 | mlb_strikeout_props#60078 | 233389 | mlb_strikeout_props#2370022 |
| 675512 | 62315 | mlb_strikeout_props#1170025 | 231797 | mlb_strikeout_props#2460003 |
| 615698 | 87837 | mlb_strikeout_props#1740028 | 5787 | mlb_strikeout_props#2460008 |
| 669456 | 284030 | mlb_strikeout_props#1500002 | 54289 | mlb_strikeout_props#2460009 |
| 543037 | 88443 | mlb_strikeout_props#990007 | 3560 | mlb_strikeout_props#2460016 |
| 695611 | 82582 | mlb_strikeout_props#1230019 | 169220 | mlb_strikeout_props#2460020 |

## 3c. `retrosheet_id`

| Column | Updated | Already consistent | Conflicts | Unmatched targets |
|---|---:|---:|---:|---:|
| retrosheet_id | 0 | 35 | 0 | 1 |

**retrosheet_id unmatched targets (1):**

| key | reason |
|---|---|
| 671734 | mlbamId not in mlb_people |

Harvest-source conflicts: **0**.

## 4. `mlb_schedule_history.gamePk` population

| Metric | Count |
|---|---:|
| Total rows | 10485 |
| Spring training (out of scope) | 1373 |
| Cancelled | 4 |
| No AN-slug crosswalk | 4 |
| Eligible | 9104 |
| Matched — direct orientation | 5252 |
| Matched — swap orientation | 3684 |
| Total matched | 8936 |
| Already had non-null gamePk (skipped, idempotency) | 8936 |
| **Newly updated this run** | **0** |
| Conflicts (existing gamePk differs from computed match) | 0 |
| Truly unmatched | 168 |

### Orientation stats by season

| Season | Direct | Swap |
|---|---:|---:|
| 2023 | 1218 | 1248 |
| 2024 | 1243 | 1226 |
| 2025 | 1195 | 1210 |
| 2026 | 1596 | 0 |

### Unmatched (168)

| id | anGameId | gameDate | awaySlug | homeSlug | gameStatus | reason |
|---|---|---|---|---|---|---|
| 92 | 286128 | 2026-04-04 | chicago-cubs | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 107 | 286109 | 2026-04-03 | milwaukee-brewers | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1029 | 190898 | 2023-04-05 | chicago-cubs | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1043 | 190967 | 2023-04-06 | miami-marlins | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1046 | 190970 | 2023-04-06 | philadelphia-phillies | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1047 | 190971 | 2023-04-06 | new-york-yankees | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1048 | 190972 | 2023-04-06 | houston-astros | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1177 | 191799 | 2023-04-16 | san-francisco-giants | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1194 | 191831 | 2023-04-17 | cleveland-guardians | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1196 | 191833 | 2023-04-17 | philadelphia-phillies | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1582 | 192098 | 2023-04-21 | miami-marlins | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1679 | 192415 | 2023-04-28 | detroit-tigers | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1681 | 192417 | 2023-04-28 | washington-nationals | pittsburgh-pirates | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1698 | 192457 | 2023-04-29 | new-york-mets | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1714 | 192486 | 2023-04-30 | new-york-mets | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1737 | 192583 | 2023-05-02 | new-york-mets | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1912 | 193140 | 2023-05-14 | new-york-mets | washington-nationals | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1986 | 193436 | 2023-05-20 | new-york-mets | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2156 | 193943 | 2023-06-02 | tampa-bay-rays | boston-red-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2223 | 194098 | 2023-06-07 | philadelphia-phillies | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2227 | 194102 | 2023-06-07 | chicago-white-sox | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2237 | 194185 | 2023-06-08 | arizona-diamondbacks | washington-nationals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2301 | 194658 | 2023-06-13 | atlanta-braves | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2368 | 196208 | 2023-06-17 | boston-red-sox | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2421 | 196419 | 2023-06-21 | philadelphia-phillies | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2539 | 196714 | 2023-06-30 | st-louis-cardinals | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2609 | 196880 | 2023-07-05 | toronto-blue-jays | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2685 | 197176 | 2023-07-14 | tampa-bay-rays | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2704 | 197242 | 2023-07-15 | st-louis-cardinals | washington-nationals | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2739 | 197335 | 2023-07-18 | san-francisco-giants | cincinnati-reds | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2799 | 197466 | 2023-07-22 | new-york-mets | boston-red-sox | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 2862 | 197636 | 2023-07-26 | los-angeles-angels | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3018 | 198863 | 2023-08-07 | philadelphia-phillies | washington-nationals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3088 | 202320 | 2023-08-12 | pittsburgh-pirates | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3153 | 202486 | 2023-08-17 | cleveland-guardians | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3209 | 202616 | 2023-08-21 | los-angeles-angels | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3247 | 202711 | 2023-08-24 | cleveland-guardians | los-angeles-dodgers | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3517 | 204298 | 2023-09-11 | boston-red-sox | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3520 | 204301 | 2023-09-11 | kansas-city-royals | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3553 | 204461 | 2023-09-13 | boston-red-sox | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3568 | 204613 | 2023-09-14 | san-francisco-giants | colorado-rockies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3715 | 204990 | 2023-09-23 | atlanta-braves | washington-nationals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3716 | 204991 | 2023-09-23 | arizona-diamondbacks | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3758 | 205064 | 2023-09-26 | miami-marlins | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3785 | 205108 | 2023-09-28 | kansas-city-royals | detroit-tigers | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3798 | 205140 | 2023-09-29 | philadelphia-phillies | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4271 | 221966 | 2024-03-20 | detroit-tigers | minnesota-twins | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4272 | 221967 | 2024-03-20 | atlanta-braves | toronto-blue-jays | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4273 | 221968 | 2024-03-20 | miami-marlins | new-york-mets | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4276 | 221971 | 2024-03-20 | oakland-athletics | chicago-cubs | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4277 | 221972 | 2024-03-20 | arizona-diamondbacks | colorado-rockies | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4279 | 221974 | 2024-03-20 | st-louis-cardinals | washington-nationals | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4280 | 221975 | 2024-03-20 | philadelphia-phillies | baltimore-orioles | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4281 | 221976 | 2024-03-20 | pittsburgh-pirates | new-york-yankees | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4364 | 222059 | 2024-03-28 | new-york-mets | milwaukee-brewers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4366 | 222061 | 2024-03-28 | philadelphia-phillies | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4438 | 222260 | 2024-04-02 | new-york-mets | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4451 | 222293 | 2024-04-03 | atlanta-braves | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4458 | 222299 | 2024-04-03 | new-york-mets | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4502 | 222556 | 2024-04-07 | cleveland-guardians | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4550 | 222720 | 2024-04-10 | new-york-mets | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4554 | 222756 | 2024-04-11 | milwaukee-brewers | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4555 | 222757 | 2024-04-11 | detroit-tigers | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4567 | 222797 | 2024-04-12 | cleveland-guardians | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4630 | 223206 | 2024-04-16 | kansas-city-royals | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4656 | 223279 | 2024-04-18 | miami-marlins | chicago-cubs | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4669 | 223336 | 2024-04-19 | seattle-mariners | colorado-rockies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4802 | 223910 | 2024-04-29 | st-louis-cardinals | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4922 | 224387 | 2024-05-08 | new-york-mets | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 4993 | 224562 | 2024-05-13 | washington-nationals | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5003 | 224589 | 2024-05-14 | toronto-blue-jays | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5065 | 224732 | 2024-05-18 | atlanta-braves | san-diego-padres | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5112 | 224887 | 2024-05-22 | st-louis-cardinals | baltimore-orioles | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5142 | 225038 | 2024-05-24 | st-louis-cardinals | chicago-cubs | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5183 | 225418 | 2024-05-27 | new-york-mets | los-angeles-dodgers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5192 | 225448 | 2024-05-28 | pittsburgh-pirates | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5304 | 225783 | 2024-06-05 | cleveland-guardians | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5429 | 226172 | 2024-06-15 | oakland-athletics | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5569 | 228430 | 2024-06-25 | atlanta-braves | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5754 | 228987 | 2024-07-09 | st-louis-cardinals | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5755 | 228988 | 2024-07-09 | chicago-white-sox | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5902 | 229478 | 2024-07-23 | atlanta-braves | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5918 | 231815 | 2024-07-24 | atlanta-braves | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6082 | 230067 | 2024-08-06 | arizona-diamondbacks | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6085 | 230070 | 2024-08-06 | los-angeles-angels | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6126 | 231026 | 2024-08-09 | new-york-yankees | texas-rangers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6372 | 231589 | 2024-08-26 | toronto-blue-jays | boston-red-sox | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6404 | 231739 | 2024-08-28 | chicago-white-sox | texas-rangers | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6728 | 233181 | 2024-09-21 | boston-red-sox | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6780 | 233341 | 2024-09-25 | new-york-mets | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6794 | 233406 | 2024-09-26 | new-york-mets | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7278 | 250678 | 2025-03-18 | detroit-tigers | minnesota-twins | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7280 | 250680 | 2025-03-18 | philadelphia-phillies | pittsburgh-pirates | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7282 | 250682 | 2025-03-18 | los-angeles-angels | cincinnati-reds | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7283 | 250683 | 2025-03-18 | seattle-mariners | milwaukee-brewers | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7284 | 250684 | 2025-03-18 | houston-astros | washington-nationals | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7285 | 250685 | 2025-03-18 | toronto-blue-jays | baltimore-orioles | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7287 | 250687 | 2025-03-18 | cleveland-guardians | texas-rangers | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7509 | 251675 | 2025-04-06 | miami-marlins | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7573 | 252013 | 2025-04-11 | toronto-blue-jays | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7678 | 252551 | 2025-04-18 | washington-nationals | colorado-rockies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7742 | 252934 | 2025-04-23 | kansas-city-royals | colorado-rockies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7759 | 253013 | 2025-04-25 | detroit-tigers | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7762 | 253016 | 2025-04-25 | cleveland-guardians | boston-red-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7773 | 253061 | 2025-04-26 | toronto-blue-jays | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7817 | 253185 | 2025-04-29 | st-louis-cardinals | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7873 | 253338 | 2025-05-03 | new-york-mets | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7903 | 253383 | 2025-05-05 | cleveland-guardians | washington-nationals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7924 | 253443 | 2025-05-06 | colorado-rockies | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8009 | 253695 | 2025-05-13 | minnesota-twins | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8012 | 253698 | 2025-05-13 | philadelphia-phillies | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8115 | 253903 | 2025-05-20 | cleveland-guardians | minnesota-twins | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8129 | 253927 | 2025-05-21 | cleveland-guardians | minnesota-twins | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8130 | 253933 | 2025-05-21 | atlanta-braves | washington-nationals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8144 | 253965 | 2025-05-22 | boston-red-sox | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8153 | 254031 | 2025-05-23 | boston-red-sox | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8232 | 255814 | 2025-05-28 | philadelphia-phillies | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8323 | 256014 | 2025-06-04 | st-louis-cardinals | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8364 | 256116 | 2025-06-07 | arizona-diamondbacks | cincinnati-reds | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8507 | 256570 | 2025-06-18 | pittsburgh-pirates | detroit-tigers | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8514 | 256577 | 2025-06-18 | st-louis-cardinals | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8515 | 256578 | 2025-06-18 | milwaukee-brewers | chicago-cubs | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8823 | 257559 | 2025-07-09 | new-york-mets | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8840 | 257593 | 2025-07-10 | cleveland-guardians | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9000 | 258192 | 2025-07-25 | cleveland-guardians | kansas-city-royals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9295 | 259164 | 2025-08-18 | milwaukee-brewers | chicago-cubs | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10471 | 286068 | 2026-04-02 | toronto-blue-jays | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10851 | 260916 | 2025-08-03 | atlanta-braves | cincinnati-reds | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 528053 | 287445 | 2026-04-25 | colorado-rockies | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 673408 | 287603 | 2026-04-29 | houston-astros | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 673410 | 287605 | 2026-04-29 | san-francisco-giants | philadelphia-phillies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1171331 | 287890 | 2026-05-05 | milwaukee-brewers | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1171333 | 287892 | 2026-05-05 | new-york-mets | colorado-rockies | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 1637597 | 287980 | 2026-05-09 | tampa-bay-rays | boston-red-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 3163514 | 288411 | 2026-05-22 | st-louis-cardinals | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5167783 | 288445 | 2026-05-23 | tampa-bay-rays | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5167787 | 288449 | 2026-05-23 | detroit-tigers | baltimore-orioles | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 5232128 | 288525 | 2026-05-24 | st-louis-cardinals | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6187696 | 290426 | 2026-06-06 | boston-red-sox | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6462703 | 290628 | 2026-06-11 | atlanta-braves | chicago-white-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6573450 | 290692 | 2026-06-14 | detroit-tigers | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6677370 | 290795 | 2026-06-17 | san-francisco-giants | atlanta-braves | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6716742 | 290814 | 2026-06-18 | san-francisco-giants | atlanta-braves | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6819714 | 291176 | 2026-06-21 | toronto-blue-jays | chicago-cubs | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 6845176 | 291196 | 2026-06-22 | chicago-cubs | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 7080009 | 291322 | 2026-06-25 | arizona-diamondbacks | st-louis-cardinals | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 8553326 | 291711 | 2026-07-10 | milwaukee-brewers | pittsburgh-pirates | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9210005 | 291878 | 2026-07-17 | pittsburgh-pirates | cleveland-guardians | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9540013 | 291915 | 2026-07-18 | los-angeles-dodgers | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9750034 | 291976 | 2026-07-21 | pittsburgh-pirates | new-york-yankees | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 9750036 | 291978 | 2026-07-21 | baltimore-orioles | boston-red-sox | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10500096 | 292223 | 2026-07-27 | cleveland-guardians | cincinnati-reds | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710001 | 294548 | 2026-07-28 | cleveland-guardians | cincinnati-reds | complete | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710008 | 292277 | 2026-07-28 | cleveland-guardians | cincinnati-reds | inprogress | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710002 | 292271 | 2026-07-28 | philadelphia-phillies | miami-marlins | inprogress | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710003 | 292272 | 2026-07-28 | arizona-diamondbacks | pittsburgh-pirates | inprogress | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710004 | 292273 | 2026-07-28 | baltimore-orioles | detroit-tigers | inprogress | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710005 | 292274 | 2026-07-28 | texas-rangers | tampa-bay-rays | inprogress | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710006 | 292275 | 2026-07-28 | toronto-blue-jays | washington-nationals | weatherdelay | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710007 | 292276 | 2026-07-28 | atlanta-braves | new-york-mets | postponed | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710009 | 292278 | 2026-07-28 | kansas-city-royals | minnesota-twins | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710010 | 292279 | 2026-07-28 | new-york-yankees | chicago-white-sox | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710011 | 292280 | 2026-07-28 | chicago-cubs | st-louis-cardinals | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710012 | 292281 | 2026-07-28 | houston-astros | los-angeles-angels | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710013 | 292282 | 2026-07-28 | boston-red-sox | oakland-athletics | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710014 | 292283 | 2026-07-28 | colorado-rockies | san-diego-padres | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710015 | 292284 | 2026-07-28 | milwaukee-brewers | san-francisco-giants | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |
| 10710016 | 292285 | 2026-07-28 | seattle-mariners | los-angeles-dodgers | scheduled | no corresponding mlb_games row (postponed/never re-tracked or genuinely missing) |

