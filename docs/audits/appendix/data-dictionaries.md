# Appendix D — nflverse data dictionaries (22 dictionaries, 1,286 field rows)

Source: the 22 `dictionary_*` datasets shipped by nflreadr 1.5.1, dumped verbatim to
`$ROOT/evidence/ws-f/dictionaries/*.csv`. Field counts below are `wc -l` minus header on
those files and match `nrow()` of the shipped dataset. Narrative per-dictionary detail —
key fields, documented season coverage, upstream provenance — is in
`$ROOT/evidence/ws-f/schema-summary.md`.

`$ROOT` = `/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit`

## Roll-up (descending by field count)

| dictionary | fields | loader | documented coverage |
|---|---:|---|---|
| `dictionary_pbp` | 372 | `nflreadr::load_pbp()` | since 1999 (load_pbp.Rd) |
| `dictionary_ff_opportunity` | 218 | `nflreadr::load_ff_opportunity()` | no start year stated in Rd |
| `dictionary_player_stats` | 114 | `nflreadr::load_player_stats()` | no start year stated in Rd |
| `dictionary_team_stats` | 102 | `nflreadr::load_team_stats()` | no start year stated in Rd |
| `dictionary_nextgen_stats` | 51 | `nflreadr::load_nextgen_stats()` | since 2016 |
| `dictionary_schedules` | 45 | `nflreadr::load_schedules()` | all available; nflverse game-id convention anchored at 1999 |
| `dictionary_players` | 39 | `nflreadr::load_players()` | not season-indexed (one row per player) |
| `dictionary_rosters` | 37 | `nflreadr::load_rosters()` | back to 1920 |
| `dictionary_draft_picks` | 36 | `nflreadr::load_draft_picks()` | since 1980 |
| `dictionary_ff_playerids` | 35 | `nflreadr::load_ff_playerids()` | static crosswalk, not season-indexed |
| `dictionary_ftn_charting` | 28 | `nflreadr::load_ftn_charting()` | since 2022 |
| `dictionary_pfr_passing` | 28 | `nflreadr::load_pfr_advstats() / load_pfr_passing()` | since 2018 / 2019 |
| `dictionary_participation` | 26 | `nflreadr::load_participation()` | since 2016; pre-2023 NGS, 2023+ FTN |
| `dictionary_ff_rankings` | 25 | `nflreadr::load_ff_rankings()` | weekly snapshot, not season-indexed |
| `dictionary_espn_qbr` | 23 | `nflreadr::load_espn_qbr()` | since 2006 |
| `dictionary_roster_status` | 19 | `(status-code lookup, no loader)` | n/a — 19 status codes, not fields |
| `dictionary_combine` | 18 | `nflreadr::load_combine()` | since 2000 |
| `dictionary_injuries` | 16 | `nflreadr::load_injuries()` | since 2009 — UPSTREAM FEED DEAD after 2024 |
| `dictionary_snap_counts` | 16 | `nflreadr::load_snap_counts()` | since 2012 |
| `dictionary_contracts` | 15 | `nflreadr::load_contracts()` | no seasons arg — full OverTheCap history |
| `dictionary_depth_charts` | 12 | `nflreadr::load_depth_charts()` | back to 2001 |
| `dictionary_trades` | 11 | `nflreadr::load_trades()` | no start year stated in Rd |
| **total** | **1286** | | |

`dictionary_roster_status` is structurally different from the other 21: its rows are status
*codes* (ACT, IR, PUP, ...), not fields of a data frame. `dictionary_ff_opportunity` is a
4-column dictionary documenting three sub-frames at once (weekly 146, pbp_pass 21, pbp_rush 10,
shared 41). Two frames have loaders but ship no dictionary at all — `load_teams()` and
`load_rosters_weekly()` — recorded as upstream documentation gaps in
`$ROOT/evidence/ws-f/schema-summary.md` sections 3 and 5.

## Full field lists

### `dictionary_pbp` — 372 rows (dictionary columns: `Field`, `Description`, `Type`)

```
play_id, game_id, old_game_id, home_team, away_team, season_type, week, posteam, posteam_type,
defteam, side_of_field, yardline_100, game_date, quarter_seconds_remaining,
half_seconds_remaining, game_seconds_remaining, game_half, quarter_end, drive, sp, qtr, down,
goal_to_go, time, yrdln, ydstogo, ydsnet, desc, play_type, yards_gained, shotgun, no_huddle,
qb_dropback, qb_kneel, qb_spike, qb_scramble, pass_length, pass_location, air_yards,
yards_after_catch, run_location, run_gap, field_goal_result, kick_distance, extra_point_result,
two_point_conv_result, home_timeouts_remaining, away_timeouts_remaining, timeout, timeout_team,
td_team, td_player_name, td_player_id, posteam_timeouts_remaining, defteam_timeouts_remaining,
total_home_score, total_away_score, posteam_score, defteam_score, score_differential,
posteam_score_post, defteam_score_post, score_differential_post, no_score_prob, opp_fg_prob,
opp_safety_prob, opp_td_prob, fg_prob, safety_prob, td_prob, extra_point_prob,
two_point_conversion_prob, ep, epa, total_home_epa, total_away_epa, total_home_rush_epa,
total_away_rush_epa, total_home_pass_epa, total_away_pass_epa, air_epa, yac_epa, comp_air_epa,
comp_yac_epa, total_home_comp_air_epa, total_away_comp_air_epa, total_home_comp_yac_epa,
total_away_comp_yac_epa, total_home_raw_air_epa, total_away_raw_air_epa,
total_home_raw_yac_epa, total_away_raw_yac_epa, wp, def_wp, home_wp, away_wp, wpa, vegas_wpa,
vegas_home_wpa, home_wp_post, away_wp_post, vegas_wp, vegas_home_wp, total_home_rush_wpa,
total_away_rush_wpa, total_home_pass_wpa, total_away_pass_wpa, air_wpa, yac_wpa, comp_air_wpa,
comp_yac_wpa, total_home_comp_air_wpa, total_away_comp_air_wpa, total_home_comp_yac_wpa,
total_away_comp_yac_wpa, total_home_raw_air_wpa, total_away_raw_air_wpa,
total_home_raw_yac_wpa, total_away_raw_yac_wpa, punt_blocked, first_down_rush, first_down_pass,
first_down_penalty, third_down_converted, third_down_failed, fourth_down_converted,
fourth_down_failed, incomplete_pass, touchback, interception, punt_inside_twenty,
punt_in_endzone, punt_out_of_bounds, punt_downed, punt_fair_catch, kickoff_inside_twenty,
kickoff_in_endzone, kickoff_out_of_bounds, kickoff_downed, kickoff_fair_catch, fumble_forced,
fumble_not_forced, fumble_out_of_bounds, solo_tackle, safety, penalty, tackled_for_loss,
fumble_lost, own_kickoff_recovery, own_kickoff_recovery_td, qb_hit, rush_attempt, pass_attempt,
sack, touchdown, pass_touchdown, rush_touchdown, return_touchdown, extra_point_attempt,
two_point_attempt, field_goal_attempt, kickoff_attempt, punt_attempt, fumble, complete_pass,
assist_tackle, lateral_reception, lateral_rush, lateral_return, lateral_recovery,
passer_player_id, passer_player_name, passing_yards, receiver_player_id, receiver_player_name,
receiving_yards, rusher_player_id, rusher_player_name, rushing_yards,
lateral_receiver_player_id, lateral_receiver_player_name, lateral_receiving_yards,
lateral_rusher_player_id, lateral_rusher_player_name, lateral_rushing_yards,
lateral_sack_player_id, lateral_sack_player_name, interception_player_id,
interception_player_name, lateral_interception_player_id, lateral_interception_player_name,
punt_returner_player_id, punt_returner_player_name, lateral_punt_returner_player_id,
lateral_punt_returner_player_name, kickoff_returner_player_name, kickoff_returner_player_id,
lateral_kickoff_returner_player_id, lateral_kickoff_returner_player_name, punter_player_id,
punter_player_name, kicker_player_name, kicker_player_id, own_kickoff_recovery_player_id,
own_kickoff_recovery_player_name, blocked_player_id, blocked_player_name,
tackle_for_loss_1_player_id, tackle_for_loss_1_player_name, tackle_for_loss_2_player_id,
tackle_for_loss_2_player_name, qb_hit_1_player_id, qb_hit_1_player_name, qb_hit_2_player_id,
qb_hit_2_player_name, forced_fumble_player_1_team, forced_fumble_player_1_player_id,
forced_fumble_player_1_player_name, forced_fumble_player_2_team,
forced_fumble_player_2_player_id, forced_fumble_player_2_player_name, solo_tackle_1_team,
solo_tackle_2_team, solo_tackle_1_player_id, solo_tackle_2_player_id,
solo_tackle_1_player_name, solo_tackle_2_player_name, assist_tackle_1_player_id,
assist_tackle_1_player_name, assist_tackle_1_team, assist_tackle_2_player_id,
assist_tackle_2_player_name, assist_tackle_2_team, assist_tackle_3_player_id,
assist_tackle_3_player_name, assist_tackle_3_team, assist_tackle_4_player_id,
assist_tackle_4_player_name, assist_tackle_4_team, tackle_with_assist,
tackle_with_assist_1_player_id, tackle_with_assist_1_player_name, tackle_with_assist_1_team,
tackle_with_assist_2_player_id, tackle_with_assist_2_player_name, tackle_with_assist_2_team,
pass_defense_1_player_id, pass_defense_1_player_name, pass_defense_2_player_id,
pass_defense_2_player_name, fumbled_1_team, fumbled_1_player_id, fumbled_1_player_name,
fumbled_2_player_id, fumbled_2_player_name, fumbled_2_team, fumble_recovery_1_team,
fumble_recovery_1_yards, fumble_recovery_1_player_id, fumble_recovery_1_player_name,
fumble_recovery_2_team, fumble_recovery_2_yards, fumble_recovery_2_player_id,
fumble_recovery_2_player_name, sack_player_id, sack_player_name, half_sack_1_player_id,
half_sack_1_player_name, half_sack_2_player_id, half_sack_2_player_name, return_team,
return_yards, penalty_team, penalty_player_id, penalty_player_name, penalty_yards,
replay_or_challenge, replay_or_challenge_result, penalty_type, defensive_two_point_attempt,
defensive_two_point_conv, defensive_extra_point_attempt, defensive_extra_point_conv,
safety_player_name, safety_player_id, season, cp, cpoe, series, series_success, series_result,
order_sequence, start_time, time_of_day, stadium, weather, nfl_api_id, play_clock,
play_deleted, play_type_nfl, special_teams_play, st_play_type, end_clock_time, end_yard_line,
fixed_drive, fixed_drive_result, drive_real_start_time, drive_play_count,
drive_time_of_possession, drive_first_downs, drive_inside20, drive_ended_with_score,
drive_quarter_start, drive_quarter_end, drive_yards_penalized, drive_start_transition,
drive_end_transition, drive_game_clock_start, drive_game_clock_end, drive_start_yard_line,
drive_end_yard_line, drive_play_id_started, drive_play_id_ended, away_score, home_score,
location, result, total, spread_line, total_line, div_game, roof, surface, temp, wind,
home_coach, away_coach, stadium_id, game_stadium, success, passer, passer_jersey_number,
rusher, rusher_jersey_number, receiver, receiver_jersey_number, pass, rush, first_down,
aborted_play, special, play, passer_id, rusher_id, receiver_id, name, jersey_number, id,
fantasy_player_name, fantasy_player_id, fantasy, fantasy_id, out_of_bounds,
home_opening_kickoff, qb_epa, xyac_epa, xyac_mean_yardage, xyac_median_yardage, xyac_success,
xyac_fd, xpass, pass_oe
```

### `dictionary_ff_opportunity` — 218 rows (dictionary columns: `Field`, `Type`, `Dataframe`, `Description`)

```
game_id, desc, rusher_player_id, full_name, posteam, posteam_type, run_location, run_gap,
run_gap_dir, surface, roof, position, era, rush_touchdown, first_down, qtr, down, goal_to_go,
shotgun, no_huddle, qb_dropback, qb_scramble, play_id, two_point_attempt, two_point_converted,
rush_attempt, first_down_rush, fumble_lost, season, week, rushing_yards, wind, temp,
yardline_100, half_seconds_remaining, game_seconds_remaining, fixed_drive, xpass, ydstogo,
score_differential, ep, vegas_wp, implied_total, rush_yards_exp, rush_touchdown_exp,
rush_first_down_exp, two_point_conv_exp, passer_player_id, passer_full_name, passer_position,
receiver_player_id, receiver_full_name, receiver_position, pass_location, complete_pass,
pass_touchdown, interception, qb_hit, pass_attempt, receiving_yards, first_down_pass,
yards_after_catch, relative_to_endzone, total_line, relative_to_sticks, air_yards,
pass_completion_exp, yards_after_catch_exp, yardline_exp, pass_touchdown_exp,
pass_first_down_exp, pass_interception_exp, player_id, rec_attempt, pass_air_yards,
rec_air_yards, pass_completions, receptions, pass_completions_exp, receptions_exp,
pass_yards_gained, rec_yards_gained, rush_yards_gained, pass_yards_gained_exp,
rec_yards_gained_exp, rush_yards_gained_exp, pass_touchdown, rec_touchdown, rush_touchdown,
rec_touchdown_exp, pass_two_point_conv, rec_two_point_conv, rush_two_point_conv,
pass_two_point_conv_exp, rec_two_point_conv_exp, rush_two_point_conv_exp, pass_first_down,
rec_first_down, rush_first_down, rec_first_down_exp, pass_interception, rec_interception,
rec_interception_exp, rec_fumble_lost, rush_fumble_lost, pass_fantasy_points_exp,
rec_fantasy_points_exp, rush_fantasy_points_exp, pass_fantasy_points, rec_fantasy_points,
rush_fantasy_points, total_yards_gained, total_yards_gained_exp, total_touchdown,
total_touchdown_exp, total_first_down, total_first_down_exp, total_fantasy_points,
total_fantasy_points_exp, pass_completions_diff, receptions_diff, pass_yards_gained_diff,
rec_yards_gained_diff, rush_yards_gained_diff, pass_touchdown_diff, rec_touchdown_diff,
rush_touchdown_diff, pass_two_point_conv_diff, rec_two_point_conv_diff,
rush_two_point_conv_diff, pass_first_down_diff, rec_first_down_diff, rush_first_down_diff,
pass_interception_diff, rec_interception_diff, pass_fantasy_points_diff,
rec_fantasy_points_diff, rush_fantasy_points_diff, total_yards_gained_diff,
total_touchdown_diff, total_first_down_diff, total_fantasy_points_diff, pass_attempt_team,
rec_attempt_team, rush_attempt_team, pass_air_yards_team, rec_air_yards_team,
pass_completions_team, receptions_team, pass_completions_exp_team, receptions_exp_team,
pass_yards_gained_team, rec_yards_gained_team, rush_yards_gained_team,
pass_yards_gained_exp_team, rec_yards_gained_exp_team, rush_yards_gained_exp_team,
pass_touchdown_team, rec_touchdown_team, rush_touchdown_team, pass_touchdown_exp_team,
rec_touchdown_exp_team, rush_touchdown_exp_team, pass_two_point_conv_team,
rec_two_point_conv_team, rush_two_point_conv_team, pass_two_point_conv_exp_team,
rec_two_point_conv_exp_team, rush_two_point_conv_exp_team, pass_first_down_team,
rec_first_down_team, rush_first_down_team, pass_first_down_exp_team, rec_first_down_exp_team,
rush_first_down_exp_team, pass_interception_team, rec_interception_team,
pass_interception_exp_team, rec_interception_exp_team, rec_fumble_lost_team,
rush_fumble_lost_team, pass_fantasy_points_exp_team, rec_fantasy_points_exp_team,
rush_fantasy_points_exp_team, pass_fantasy_points_team, rec_fantasy_points_team,
rush_fantasy_points_team, total_yards_gained_team, total_yards_gained_exp_team,
total_touchdown_team, total_touchdown_exp_team, total_first_down_team,
total_first_down_exp_team, total_fantasy_points_team, total_fantasy_points_exp_team,
pass_completions_diff_team, receptions_diff_team, pass_yards_gained_diff_team,
rec_yards_gained_diff_team, rush_yards_gained_diff_team, pass_touchdown_diff_team,
rec_touchdown_diff_team, rush_touchdown_diff_team, pass_two_point_conv_diff_team,
rec_two_point_conv_diff_team, rush_two_point_conv_diff_team, pass_first_down_diff_team,
rec_first_down_diff_team, rush_first_down_diff_team, pass_interception_diff_team,
rec_interception_diff_team, pass_fantasy_points_diff_team, rec_fantasy_points_diff_team,
rush_fantasy_points_diff_team, total_yards_gained_diff_team, total_touchdown_diff_team,
total_first_down_diff_team, total_fantasy_points_diff_team
```

### `dictionary_player_stats` — 114 rows (dictionary columns: `field`, `data_type`, `description`)

```
player_id, player_name, player_display_name, position, position_group, headshot_url, season,
week, season_type, team, opponent_team, completions, attempts, passing_yards, passing_tds,
passing_interceptions, sacks_suffered, sack_yards_lost, sack_fumbles, sack_fumbles_lost,
passing_air_yards, passing_yards_after_catch, passing_first_downs, passing_epa, passing_cpoe,
passing_2pt_conversions, pacr, carries, rushing_yards, rushing_tds, rushing_fumbles,
rushing_fumbles_lost, rushing_first_downs, rushing_epa, rushing_2pt_conversions, receptions,
targets, receiving_yards, receiving_tds, receiving_fumbles, receiving_fumbles_lost,
receiving_air_yards, receiving_yards_after_catch, receiving_first_downs, receiving_epa,
receiving_2pt_conversions, racr, target_share, air_yards_share, wopr, special_teams_tds,
def_tackles_solo, def_tackles_with_assist, def_tackle_assists, def_tackles_for_loss,
def_tackles_for_loss_yards, def_fumbles_forced, def_sacks, def_sack_yards, def_qb_hits,
def_interceptions, def_interception_yards, def_pass_defended, def_tds, def_fumbles,
def_safeties, misc_yards, fumble_recovery_own, fumble_recovery_yards_own, fumble_recovery_opp,
fumble_recovery_yards_opp, fumble_recovery_tds, penalties, penalty_yards, punt_returns,
punt_return_yards, kickoff_returns, kickoff_return_yards, fg_made, fg_att, fg_missed,
fg_blocked, fg_long, fg_pct, fg_made_0_19, fg_made_20_29, fg_made_30_39, fg_made_40_49,
fg_made_50_59, fg_made_60_, fg_missed_0_19, fg_missed_20_29, fg_missed_30_39, fg_missed_40_49,
fg_missed_50_59, fg_missed_60_, fg_made_list, fg_missed_list, fg_blocked_list,
fg_made_distance, fg_missed_distance, fg_blocked_distance, pat_made, pat_att, pat_missed,
pat_blocked, pat_pct, gwfg_made, gwfg_att, gwfg_missed, gwfg_blocked, gwfg_distance,
fantasy_points, fantasy_points_ppr
```

### `dictionary_team_stats` — 102 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, week, team, season_type, opponent_team, completions, attempts, passing_yards,
passing_tds, passing_interceptions, sacks_suffered, sack_yards_lost, sack_fumbles,
sack_fumbles_lost, passing_air_yards, passing_yards_after_catch, passing_first_downs,
passing_epa, passing_cpoe, passing_2pt_conversions, carries, rushing_yards, rushing_tds,
rushing_fumbles, rushing_fumbles_lost, rushing_first_downs, rushing_epa,
rushing_2pt_conversions, receptions, targets, receiving_yards, receiving_tds,
receiving_fumbles, receiving_fumbles_lost, receiving_air_yards, receiving_yards_after_catch,
receiving_first_downs, receiving_epa, receiving_2pt_conversions, special_teams_tds,
def_tackles_solo, def_tackles_with_assist, def_tackle_assists, def_tackles_for_loss,
def_tackles_for_loss_yards, def_fumbles_forced, def_sacks, def_sack_yards, def_qb_hits,
def_interceptions, def_interception_yards, def_pass_defended, def_tds, def_fumbles,
def_safeties, misc_yards, fumble_recovery_own, fumble_recovery_yards_own, fumble_recovery_opp,
fumble_recovery_yards_opp, fumble_recovery_tds, penalties, penalty_yards, timeouts,
punt_returns, punt_return_yards, kickoff_returns, kickoff_return_yards, fg_made, fg_att,
fg_missed, fg_blocked, fg_long, fg_pct, fg_made_0_19, fg_made_20_29, fg_made_30_39,
fg_made_40_49, fg_made_50_59, fg_made_60_, fg_missed_0_19, fg_missed_20_29, fg_missed_30_39,
fg_missed_40_49, fg_missed_50_59, fg_missed_60_, fg_made_list, fg_missed_list, fg_blocked_list,
fg_made_distance, fg_missed_distance, fg_blocked_distance, pat_made, pat_att, pat_missed,
pat_blocked, pat_pct, gwfg_made, gwfg_att, gwfg_missed, gwfg_blocked, gwfg_distance
```

### `dictionary_nextgen_stats` — 51 rows (dictionary columns: `field`, `data_type`, `description`)

```
season_type, player_display_name, player_position, team_abbr, player_gsis_id,
player_first_name, player_last_name, player_short_name, season, week, avg_time_to_throw,
avg_completed_air_yards, avg_intended_air_yards, avg_air_yards_differential, aggressiveness,
max_completed_air_distance, avg_air_yards_to_sticks, attempts, pass_yards, pass_touchdowns,
interceptions, passer_rating, completions, completion_percentage,
expected_completion_percentage, completion_percentage_above_expectation, avg_air_distance,
max_air_distance, player_jersey_number, avg_cushion, avg_separation,
percent_share_of_intended_air_yards, receptions, targets, catch_percentage, yards,
rec_touchdowns, avg_yac, avg_expected_yac, avg_yac_above_expectation, efficiency,
percent_attempts_gte_eight_defenders, avg_time_to_los, rush_attempts, rush_yards,
expected_rush_yards, rush_yards_over_expected, avg_rush_yards,
rush_yards_over_expected_per_att, rush_pct_over_expected, rush_touchdowns
```

### `dictionary_schedules` — 45 rows (dictionary columns: `field`, `data_type`, `description`)

```
game_id, season, game_type, week, gameday, weekday, gametime, away_team, away_score, home_team,
home_score, location, result, total, overtime, old_game_id, gsis, nfl_detail_id, pfr, pff,
espn, away_rest, home_rest, away_moneyline, home_moneyline, spread_line, away_spread_odds,
home_spread_odds, total_line, under_odds, over_odds, div_game, roof, surface, temp, wind,
away_qb_id, home_qb_id, away_qb_name, home_qb_name, away_coach, home_coach, referee,
stadium_id, stadium
```

### `dictionary_players` — 39 rows (dictionary columns: `field`, `data_type`, `description`)

```
gsis_id, display_name, common_first_name, first_name, last_name, short_name, football_name,
suffix, esb_id, nfl_id, pfr_id, pff_id, otc_id, espn_id, smart_id, birth_date, position_group,
position, ngs_position_group, ngs_position, headshot, college_name, college_conference,
jersey_number, latest_team, status, ngs_status, ngs_status_short_description, pff_position,
pff_status, draft_team, height, weight, rookie_season, last_season, years_of_experience,
draft_year, draft_round, draft_pick
```

### `dictionary_rosters` — 37 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, team, position, depth_chart_position, jersey_number, status, full_name, first_name,
last_name, birth_date, height, weight, college, high_school, gsis_id, espn_id, sportradar_id,
yahoo_id, rotowire_id, pff_id, pfr_id, fantasy_data_id, sleeper_id, years_exp, headshot_url,
ngs_position, week, game_type, status_description_abbr, football_name, esb_id, gsis_it_id,
smart_id, entry_year, rookie_year, draft_club, draft_number
```

### `dictionary_draft_picks` — 36 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, round, pick, team, gsis_id, pfr_player_id, cfb_player_id, pfr_player_name, hof,
position, category, side, college, age, to, allpro, probowls, seasons_started, w_av, car_av,
dr_av, games, pass_completions, pass_attempts, pass_yards, pass_tds, pass_ints, rush_atts,
rush_yards, rush_tds, receptions, rec_yards, rec_tds, def_solo_tackles, def_ints, def_sacks
```

### `dictionary_ff_playerids` — 35 rows (dictionary columns: `field`, `data_type`, `description`)

```
mfl_id, sportradar_id, fantasypros_id, gsis_id, pff_id, sleeper_id, nfl_id, espn_id, yahoo_id,
fleaflicker_id, cbs_id, rotowire_id, rotoworld_id, ktc_id, pfr_id, cfbref_id, stats_id,
stats_global_id, fantasy_data_id, name, merge_name, position, team, birthdate, age, draft_year,
draft_round, draft_pick, draft_ovr, twitter_username, height, weight, college, db_season,
swish_id
```

### `dictionary_ftn_charting` — 28 rows (dictionary columns: `field_name`, `field_type`, `ftn_field_name`, `order`, `description`)

```
ftn_game_id, nflverse_game_id, season, week, ftn_play_id, nflverse_play_id, starting_hash,
qb_location, n_offense_backfield, is_no_huddle, is_motion, is_play_action, is_screen_pass,
is_rpo, is_trick_play, is_qb_out_of_pocket, is_interception_worthy, is_throw_away, read_thrown,
is_catchable_ball, is_contested_ball, is_created_reception, is_drop, is_qb_sneak, n_blitzers,
n_pass_rushers, is_qb_fault_sack, date_pulled
```

### `dictionary_pfr_passing` — 28 rows (dictionary columns: `field`, `data_type`, `description`)

```
player, team, pfr_id, pass_attempts, batted_balls, throwaways, spikes, drops, drop_pct,
bad_throws, bad_throw_pct, on_tgt_throws, on_tgt_pct, season, pocket_time, times_blitzed,
times_hurried, times_hit, times_pressured, pressure_pct, rpo_plays, rpo_yards, rpo_pass_att,
rpo_pass_yards, rpo_rush_att, rpo_rush_yards, pa_pass_att, pa_pass_yards
```

### `dictionary_participation` — 26 rows (dictionary columns: `Field`, `Type`, `Description`)

```
nflverse_game_id, old_game_id, play_id, possession_team, offense_formation, offense_personnel,
defenders_in_box, defense_personnel, number_of_pass_rushers, players_on_play, offense_players,
defense_players, n_offense, n_defense, ngs_air_yards, time_to_throw, was_pressure, route,
defense_man_zone_type, defense_coverage_type, offense_names, defense_names, offense_positions,
defense_positions, offense_numbers, defense_numbers
```

### `dictionary_ff_rankings` — 25 rows (dictionary columns: `field`, `data_type`, `description`)

```
fp_page, page_type, ecr_type, player, id, pos, team, sportsdata_id, player_filename, yahoo_id,
cbs_id, player_image_url, player_square_image_url, mergename, tm, scrape_date, ecr, sd, best,
worst, player_owned_avg, player_owned_espn, player_owned_yahoo, rank_delta, bye
```

### `dictionary_espn_qbr` — 23 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, season_type, game_week, team_abb, player_id, name_short, rank, qbr_total, pts_added,
qb_plays, epa_total, pass, run, exp_sack, penalty, qbr_raw, sack, name_first, name_last,
name_display, headshot_href, team, qualified
```

### `dictionary_roster_status` — 19 rows (dictionary columns: `status`, `description`)

```
ACT, EXE, DEV, CUT, E14, INA, NWT, PUP, RES, RET, RFA, RSN, RSR, SUS, TRC, TRD, TRL, TRT, UFA
```

### `dictionary_combine` — 18 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, draft_year, draft_team, draft_round, draft_ovr, pfr_id, cfb_id, player_name, pos,
school, ht, wt, forty, bench, vertical, broad_jump, cone, shuttle
```

### `dictionary_injuries` — 16 rows (dictionary columns: `field`, `data_type`, `description`)

```
season, season_type, team, week, gsis_id, position, full_name, first_name, last_name,
report_primary_injury, report_secondary_injury, report_status, practice_primary_injury,
practice_secondary_injury, practice_status, date_modified
```

### `dictionary_snap_counts` — 16 rows (dictionary columns: `field`, `data_type`, `description`)

```
game_id, pfr_game_id, season, game_type, week, player, pfr_player_id, position, team, opponent,
offense_snaps, offense_pct, defense_snaps, defense_pct, st_snaps, st_pct
```

### `dictionary_contracts` — 15 rows (dictionary columns: `field`, `data_type`, `description`)

```
player, position, team, is_active, year_signed, years, value, apy, guaranteed, apy_cap_pct,
inflated_value, inflated_apy, inflated_guaranteed, player_page, otc_id
```

### `dictionary_depth_charts` — 12 rows (dictionary columns: `field`, `data_type`, `description`)

```
dt, team, player_name, espn_id, gsis_id, pos_grp_id, pos_grp, pos_id, pos_name, pos_abb,
pos_slot, pos_rank
```

### `dictionary_trades` — 11 rows (dictionary columns: `field`, `data_type`, `description`)

```
trade_id, season, trade_date, gave, received, pick_season, pick_round, pick_number,
conditional, pfr_id, pfr_name
```
