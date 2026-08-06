# Market Definitions & Grading (frozen with the replay contract)

Population: game_type='R' primary (postseason F/D/L/W scored separately; All-Star excluded);
status_code='F'; 2026 capped at official_date <= 2026-07-27. Outcomes from mlb_games finals
and plays-derived aggregates (E3; verified 25/25 vs official scores).

| Market | Outcome | Push/exclusion |
|---|---|---|
| fg_ml | home wins (final_home > final_away) | the 1 tie game excluded (exclusion-ledger) |
| fg_rl | home −1.5 covers iff margin ≥ 2; away +1.5 iff margin ≤ 1 | none possible at 1.5; 2020-21 7-inn DH games excluded (ledger event 5) |
| fg_total | distribution of final_home+final_away; graded on line grid 6.5–11.5 + CRPS | 7-inn DH exclusion as above; no priced line exists (boundary) |
| f5_ml | score after 5 completed innings; home/away/tie | tie = push (excluded from binary hit; probability reported 3-way capable); innings<5 excluded |
| f5_rl | f5 home −0.5 covers iff f5_margin ≥ 1 | no push possible; innings<5 excluded |
| f5_total | distribution of f5 total; grid 3.5–6.5 + CRPS | innings<5 excluded |
| nrfi | inn1_runs = 0 → NRFI | innings<5 excluded |

Grading source of truth: game_outcomes.tsv (E3 ledger event 8), reconciled against
mlb_games official scores; the 2025 All-Star swing-off case is outside the population.
