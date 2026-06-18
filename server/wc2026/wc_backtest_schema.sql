-- ============================================================================
-- WC Backtesting Engine — Complete Schema
-- World Cup AI Model Master Backtesting Engine
-- Covers: 2018 Group Stage (48) + 2022 Group Stage (48) + 2026 through June 17 (24) = 120 matches
-- Sources: StatsBomb Open Data (2018/2022), ESPN API (2026)
-- ============================================================================

-- ─── RAW SOURCE TABLES ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_matches (
  id              VARCHAR(32)  NOT NULL PRIMARY KEY,  -- e.g. wc2018-gs-001, wc26-g-021
  tournament_year SMALLINT     NOT NULL,               -- 2018, 2022, 2026
  stage           VARCHAR(32)  NOT NULL DEFAULT 'Group Stage',
  group_letter    CHAR(1),
  matchday        TINYINT,
  match_date      DATE         NOT NULL,
  kickoff_utc     DATETIME,
  home_team       VARCHAR(64)  NOT NULL,
  away_team       VARCHAR(64)  NOT NULL,
  home_score      TINYINT,
  away_score      TINYINT,
  ht_home_score   TINYINT,
  ht_away_score   TINYINT,
  venue           VARCHAR(128),
  city            VARCHAR(64),
  country         VARCHAR(64),
  attendance      INT,
  referee         VARCHAR(128),
  source          VARCHAR(32)  NOT NULL,               -- 'statsbomb', 'espn', 'manual'
  source_match_id VARCHAR(32),                         -- statsbomb match_id or espn event_id
  espn_event_id   VARCHAR(32),
  sb_match_id     INT,
  sb_season_id    SMALLINT,
  result          CHAR(1) GENERATED ALWAYS AS (
    CASE
      WHEN home_score > away_score THEN 'H'
      WHEN home_score < away_score THEN 'A'
      WHEN home_score = away_score THEN 'D'
      ELSE NULL
    END
  ) STORED,
  total_goals     TINYINT GENERATED ALWAYS AS (home_score + away_score) STORED,
  ingested_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tournament_year (tournament_year),
  INDEX idx_match_date (match_date),
  INDEX idx_group (group_letter),
  INDEX idx_source_match_id (source_match_id)
);

-- Raw StatsBomb event data (one row per event per match)
CREATE TABLE IF NOT EXISTS wc_bt_raw_events (
  id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id        VARCHAR(32)  NOT NULL,
  sb_event_id     VARCHAR(64)  NOT NULL,
  event_index     INT          NOT NULL,
  period          TINYINT      NOT NULL,
  minute          SMALLINT     NOT NULL,
  second_         TINYINT      NOT NULL,
  event_type      VARCHAR(64)  NOT NULL,
  event_subtype   VARCHAR(64),
  team            VARCHAR(64)  NOT NULL,
  player_name     VARCHAR(128),
  player_id       INT,
  position        VARCHAR(64),
  location_x      FLOAT,
  location_y      FLOAT,
  end_location_x  FLOAT,
  end_location_y  FLOAT,
  duration_sec    FLOAT,
  play_pattern    VARCHAR(64),
  possession_team VARCHAR(64),
  possession_num  INT,
  -- Shot-specific
  shot_xg         FLOAT,
  shot_outcome    VARCHAR(32),
  shot_technique  VARCHAR(32),
  shot_body_part  VARCHAR(32),
  shot_first_time BOOLEAN,
  -- Pass-specific
  pass_length     FLOAT,
  pass_angle      FLOAT,
  pass_height     VARCHAR(32),
  pass_end_x      FLOAT,
  pass_end_y      FLOAT,
  pass_outcome    VARCHAR(32),
  pass_type       VARCHAR(32),
  pass_shot_assist BOOLEAN,
  pass_goal_assist BOOLEAN,
  pass_switch     BOOLEAN,
  pass_cross      BOOLEAN,
  pass_through_ball BOOLEAN,
  pass_progressive BOOLEAN,   -- computed: end closer to goal by >10 yards
  -- Carry-specific
  carry_end_x     FLOAT,
  carry_end_y     FLOAT,
  carry_progressive BOOLEAN,  -- computed: end closer to goal by >5 yards
  -- Duel-specific
  duel_type       VARCHAR(32),
  duel_outcome    VARCHAR(32),
  -- Foul-specific
  foul_committed_card VARCHAR(16),
  -- Goalkeeper-specific
  gk_outcome      VARCHAR(32),
  gk_technique    VARCHAR(32),
  gk_body_part    VARCHAR(32),
  -- Pressure
  pressure_success BOOLEAN,   -- computed: possession regained within 5 events
  -- Interception
  interception_outcome VARCHAR(32),
  -- Block
  block_deflection BOOLEAN,
  block_save_block BOOLEAN,
  -- Clearance
  clearance_body_part VARCHAR(32),
  clearance_head  BOOLEAN,
  -- Related events
  related_events  JSON,
  raw_json        JSON,       -- full raw event for traceability
  INDEX idx_match_event (match_id, event_index),
  INDEX idx_match_type (match_id, event_type),
  INDEX idx_player (player_id),
  INDEX idx_team_match (team, match_id)
);

-- Raw odds data (opening + closing from multiple books)
CREATE TABLE IF NOT EXISTS wc_bt_raw_odds (
  id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id        VARCHAR(32)  NOT NULL,
  book            VARCHAR(32)  NOT NULL,  -- 'dk', 'fanduel', 'betmgm', 'pinnacle', 'market_avg'
  snapshot_type   VARCHAR(16)  NOT NULL,  -- 'opening', 'closing', 'model'
  market          VARCHAR(32)  NOT NULL,  -- '1X2', 'TOTAL', 'ASIAN_HANDICAP', 'BTTS'
  selection       VARCHAR(32)  NOT NULL,  -- 'home', 'draw', 'away', 'over', 'under'
  line            FLOAT,
  american_odds   SMALLINT,
  decimal_odds    FLOAT,
  implied_prob    FLOAT,
  no_vig_prob     FLOAT,
  source          VARCHAR(32),
  ingested_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_odds (match_id, book, market)
);

-- Raw box score data (team-level match stats)
CREATE TABLE IF NOT EXISTS wc_bt_raw_box_scores (
  id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id        VARCHAR(32)  NOT NULL UNIQUE,
  -- Possession
  home_possession_pct   FLOAT,
  away_possession_pct   FLOAT,
  -- Shots
  home_shots            TINYINT,
  away_shots            TINYINT,
  home_shots_on_target  TINYINT,
  away_shots_on_target  TINYINT,
  home_shots_off_target TINYINT,
  away_shots_off_target TINYINT,
  home_blocked_shots    TINYINT,
  away_blocked_shots    TINYINT,
  -- xG (from StatsBomb)
  home_xg               FLOAT,
  away_xg               FLOAT,
  home_xg_ot            FLOAT,  -- post-shot xG (shots on target only)
  away_xg_ot            FLOAT,
  -- Passes
  home_passes           SMALLINT,
  away_passes           SMALLINT,
  home_accurate_passes  SMALLINT,
  away_accurate_passes  SMALLINT,
  home_pass_pct         FLOAT,
  away_pass_pct         FLOAT,
  home_progressive_passes SMALLINT,
  away_progressive_passes SMALLINT,
  home_passes_into_box  SMALLINT,
  away_passes_into_box  SMALLINT,
  -- Carries
  home_progressive_carries SMALLINT,
  away_progressive_carries SMALLINT,
  -- Corners
  home_corners          TINYINT,
  away_corners          TINYINT,
  -- Fouls & Cards
  home_fouls            TINYINT,
  away_fouls            TINYINT,
  home_yellow_cards     TINYINT,
  away_yellow_cards     TINYINT,
  home_red_cards        TINYINT,
  away_red_cards        TINYINT,
  -- Duels
  home_aerial_won       TINYINT,
  away_aerial_won       TINYINT,
  home_aerial_total     TINYINT,
  away_aerial_total     TINYINT,
  -- Defensive actions
  home_tackles          TINYINT,
  away_tackles          TINYINT,
  home_interceptions    TINYINT,
  away_interceptions    TINYINT,
  home_clearances       TINYINT,
  away_clearances       TINYINT,
  home_blocks           TINYINT,
  away_blocks           TINYINT,
  -- Saves
  home_saves            TINYINT,
  away_saves            TINYINT,
  -- Offsides
  home_offsides         TINYINT,
  away_offsides         TINYINT,
  -- Pressures (from StatsBomb)
  home_pressures        SMALLINT,
  away_pressures        SMALLINT,
  home_pressure_regains SMALLINT,
  away_pressure_regains SMALLINT,
  -- Set pieces
  home_free_kicks       TINYINT,
  away_free_kicks       TINYINT,
  home_throw_ins        TINYINT,
  away_throw_ins        TINYINT,
  -- Final third
  home_final_third_entries SMALLINT,
  away_final_third_entries SMALLINT,
  home_box_touches      SMALLINT,
  away_box_touches      SMALLINT,
  -- High turnovers
  home_high_turnovers   TINYINT,
  away_high_turnovers   TINYINT,
  -- Source
  source                VARCHAR(32),
  ingested_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match (match_id)
);

-- ─── NORMALIZED PLAYER STATS TABLE ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_player_stats (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id              VARCHAR(32)  NOT NULL,
  tournament_year       SMALLINT     NOT NULL,
  team                  VARCHAR(64)  NOT NULL,
  opponent              VARCHAR(64)  NOT NULL,
  player_name           VARCHAR(128) NOT NULL,
  player_id             INT,
  sb_player_id          INT,
  position              VARCHAR(32),
  position_group        VARCHAR(16),  -- 'GK','DEF','MID','FWD'
  is_starter            BOOLEAN,
  minute_on             TINYINT      NOT NULL DEFAULT 0,
  minute_off            TINYINT,
  minutes_played        TINYINT,
  -- Goals & Assists
  goals                 TINYINT      NOT NULL DEFAULT 0,
  assists               TINYINT      NOT NULL DEFAULT 0,
  -- Shots
  shots                 TINYINT      NOT NULL DEFAULT 0,
  shots_on_target       TINYINT      NOT NULL DEFAULT 0,
  shots_off_target      TINYINT      NOT NULL DEFAULT 0,
  blocked_shots         TINYINT      NOT NULL DEFAULT 0,
  -- xG metrics
  np_xg                 FLOAT        NOT NULL DEFAULT 0,  -- non-penalty xG
  xg_per_shot           FLOAT,
  xg_ot                 FLOAT        NOT NULL DEFAULT 0,  -- post-shot xG (on target)
  xg_ot_minus_xg        FLOAT,       -- shot execution edge
  np_goals_minus_np_xg  FLOAT,       -- finishing overperformance
  -- xA metrics
  xa                    FLOAT        NOT NULL DEFAULT 0,
  key_passes_into_box   TINYINT      NOT NULL DEFAULT 0,
  shot_creating_actions TINYINT      NOT NULL DEFAULT 0,
  -- Progressive actions
  progressive_carries   TINYINT      NOT NULL DEFAULT 0,
  progressive_passes    TINYINT      NOT NULL DEFAULT 0,
  -- Defensive metrics
  pressures             TINYINT      NOT NULL DEFAULT 0,
  successful_pressures  TINYINT      NOT NULL DEFAULT 0,
  pressure_regains      TINYINT      NOT NULL DEFAULT 0,
  tackles               TINYINT      NOT NULL DEFAULT 0,
  interceptions         TINYINT      NOT NULL DEFAULT 0,
  tackles_plus_int      TINYINT GENERATED ALWAYS AS (tackles + interceptions) STORED,
  poss_adj_tack_int     FLOAT,       -- possession-adjusted
  ball_recoveries       TINYINT      NOT NULL DEFAULT 0,
  aerial_won            TINYINT      NOT NULL DEFAULT 0,
  aerial_total          TINYINT      NOT NULL DEFAULT 0,
  aerial_win_rate       FLOAT,
  dribbled_past         TINYINT      NOT NULL DEFAULT 0,
  blocks                TINYINT      NOT NULL DEFAULT 0,
  blocks_shot           TINYINT      NOT NULL DEFAULT 0,
  blocks_pass           TINYINT      NOT NULL DEFAULT 0,
  clearances            TINYINT      NOT NULL DEFAULT 0,
  clearances_under_pressure TINYINT  NOT NULL DEFAULT 0,
  -- Passes
  passes_total          SMALLINT     NOT NULL DEFAULT 0,
  passes_accurate       SMALLINT     NOT NULL DEFAULT 0,
  passes_into_final_third TINYINT    NOT NULL DEFAULT 0,
  crosses               TINYINT      NOT NULL DEFAULT 0,
  -- Cards
  yellow_cards          TINYINT      NOT NULL DEFAULT 0,
  red_cards             TINYINT      NOT NULL DEFAULT 0,
  -- Contribution scores (computed in feature engineering)
  set_piece_contribution    FLOAT,
  transition_contribution   FLOAT,
  territorial_contribution  FLOAT,
  chance_suppression_contribution FLOAT,
  model_contribution_delta  FLOAT,
  -- Defensive action height (avg y-coordinate of defensive actions)
  defensive_action_height   FLOAT,
  -- Source
  source                VARCHAR(32),
  ingested_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_player (match_id, player_id),
  INDEX idx_team_match (team, match_id),
  INDEX idx_tournament (tournament_year),
  INDEX idx_player_name (player_name)
);

-- ─── GOALKEEPER STATS TABLE ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_goalkeeper_stats (
  id                        INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id                  VARCHAR(32)  NOT NULL,
  tournament_year           SMALLINT     NOT NULL,
  team                      VARCHAR(64)  NOT NULL,
  opponent                  VARCHAR(64)  NOT NULL,
  player_name               VARCHAR(128) NOT NULL,
  player_id                 INT,
  sb_player_id              INT,
  minutes_played            TINYINT,
  goals_conceded            TINYINT      NOT NULL DEFAULT 0,
  saves                     TINYINT      NOT NULL DEFAULT 0,
  shots_on_target_faced     TINYINT      NOT NULL DEFAULT 0,
  post_shot_xg_faced        FLOAT        NOT NULL DEFAULT 0,
  goals_prevented           FLOAT,       -- post_shot_xg_faced - goals_conceded
  goals_prevented_per_sot   FLOAT,
  save_pct                  FLOAT,
  save_pct_above_expected   FLOAT,
  crosses_stopped           TINYINT      NOT NULL DEFAULT 0,
  crosses_faced             TINYINT      NOT NULL DEFAULT 0,
  crosses_stopped_pct       FLOAT,
  sweeper_actions           TINYINT      NOT NULL DEFAULT 0,
  avg_defensive_action_dist FLOAT,
  launch_attempts           TINYINT      NOT NULL DEFAULT 0,
  launch_completions        TINYINT      NOT NULL DEFAULT 0,
  launch_completion_rate    FLOAT,
  passes_into_final_third   TINYINT      NOT NULL DEFAULT 0,
  corner_claims             TINYINT      NOT NULL DEFAULT 0,
  corner_attempts           TINYINT      NOT NULL DEFAULT 0,
  claim_rate                FLOAT,
  errors_leading_to_shots   TINYINT      NOT NULL DEFAULT 0,
  errors_leading_to_goals   TINYINT      NOT NULL DEFAULT 0,
  penalty_saves             TINYINT      NOT NULL DEFAULT 0,
  penalty_goals_allowed     TINYINT      NOT NULL DEFAULT 0,
  -- Composite scores (computed in feature engineering)
  keeper_volatility_score   FLOAT,
  keeper_driven_result_flag BOOLEAN,
  keeper_model_weight_adj   FLOAT,
  source                    VARCHAR(32),
  ingested_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_gk (match_id, player_id),
  INDEX idx_team_match (team, match_id),
  INDEX idx_tournament (tournament_year)
);

-- ─── ADVANCED MATCH FEATURES TABLE ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_match_features (
  match_id                  VARCHAR(32)  NOT NULL PRIMARY KEY,
  tournament_year           SMALLINT     NOT NULL,
  -- xG metrics
  home_xg                   FLOAT,
  away_xg                   FLOAT,
  xg_diff                   FLOAT,       -- home - away
  home_xg_ot                FLOAT,
  away_xg_ot                FLOAT,
  xg_ot_diff                FLOAT,
  -- Big chances
  home_big_chances          TINYINT,
  away_big_chances          TINYINT,
  big_chances_diff          TINYINT,
  -- Field tilt (% of shots in opponent's half)
  home_field_tilt           FLOAT,
  away_field_tilt           FLOAT,
  -- Final third entries
  home_final_third_entries  SMALLINT,
  away_final_third_entries  SMALLINT,
  final_third_entries_diff  SMALLINT,
  -- Box touches
  home_box_touches          SMALLINT,
  away_box_touches          SMALLINT,
  box_touches_diff          SMALLINT,
  -- High turnovers
  home_high_turnovers       TINYINT,
  away_high_turnovers       TINYINT,
  -- Set-piece xG
  home_sp_xg                FLOAT,
  away_sp_xg                FLOAT,
  sp_xg_diff                FLOAT,
  -- Transition xG
  home_trans_xg             FLOAT,
  away_trans_xg             FLOAT,
  trans_xg_diff             FLOAT,
  -- Game-state adjusted xG
  home_gs_adj_xg            FLOAT,
  away_gs_adj_xg            FLOAT,
  -- PPDA (passes allowed per defensive action — lower = more pressing)
  home_ppda                 FLOAT,
  away_ppda                 FLOAT,
  -- Deep completions
  home_deep_completions     SMALLINT,
  away_deep_completions     SMALLINT,
  -- Possession length (avg possession sequence length in passes)
  home_avg_possession_length FLOAT,
  away_avg_possession_length FLOAT,
  -- Goalkeeper goals prevented
  home_gk_goals_prevented   FLOAT,
  away_gk_goals_prevented   FLOAT,
  gk_goals_prevented_diff   FLOAT,
  -- ── COMPOSITE METRICS ──
  -- 19.1 True Attacking Threat Index
  home_tati                 FLOAT,
  away_tati                 FLOAT,
  -- 19.2 Chance Suppression Index
  home_csi                  FLOAT,
  away_csi                  FLOAT,
  -- 19.3 Shot Execution Edge
  home_see                  FLOAT,
  away_see                  FLOAT,
  -- 19.4 Territorial Control Index
  home_tci                  FLOAT,
  away_tci                  FLOAT,
  -- 19.5 Transition Volatility Index
  home_tvi                  FLOAT,
  away_tvi                  FLOAT,
  -- 19.6 Set-Piece Edge
  home_spe                  FLOAT,
  away_spe                  FLOAT,
  -- 19.7 Game-State Resilience
  home_gsr                  FLOAT,
  away_gsr                  FLOAT,
  -- 19.8 Opponent-Adjusted xG Differential
  home_oa_xg_diff           FLOAT,
  away_oa_xg_diff           FLOAT,
  -- 19.9 Squad Availability Delta
  home_sad                  FLOAT,
  away_sad                  FLOAT,
  -- 19.10 Keeper Volatility Score
  home_kvs                  FLOAT,
  away_kvs                  FLOAT,
  -- Match classification
  is_upset                  BOOLEAN,
  is_draw                   BOOLEAN,
  upset_draw_classification VARCHAR(128),  -- comma-separated labels
  -- Advanced stat truth profile
  stat_truth_profile        VARCHAR(256),
  -- Model error attribution
  model_error_labels        JSON,
  ingested_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tournament (tournament_year)
);

-- ─── MONTE CARLO SIMULATION OUTPUTS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_simulations (
  id                        BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id                  VARCHAR(32)  NOT NULL,
  tournament_year           SMALLINT     NOT NULL,
  model_version             VARCHAR(16)  NOT NULL DEFAULT 'v1.0',
  feature_version           VARCHAR(16)  NOT NULL DEFAULT 'v1.0',
  sim_count                 INT          NOT NULL DEFAULT 250000,
  sim_seed                  INT,
  -- Lambda inputs
  home_lambda               FLOAT        NOT NULL,
  away_lambda               FLOAT        NOT NULL,
  draw_adjustment           FLOAT        NOT NULL DEFAULT 1.0,
  correlation_adjustment    FLOAT        NOT NULL DEFAULT 1.0,
  sp_adjustment             FLOAT        NOT NULL DEFAULT 1.0,
  transition_adjustment     FLOAT        NOT NULL DEFAULT 1.0,
  gk_volatility_adjustment  FLOAT        NOT NULL DEFAULT 1.0,
  game_state_adjustment     FLOAT        NOT NULL DEFAULT 1.0,
  total_goals_adjustment    FLOAT        NOT NULL DEFAULT 1.0,
  -- Outcome probabilities
  home_win_prob             FLOAT        NOT NULL,
  draw_prob                 FLOAT        NOT NULL,
  away_win_prob             FLOAT        NOT NULL,
  -- Scoreline distribution (top 10 most likely)
  top_scorelines            JSON,
  -- Total goals distribution
  over_0_5                  FLOAT,
  over_1_5                  FLOAT,
  over_2_5                  FLOAT,
  over_3_5                  FLOAT,
  under_0_5                 FLOAT,
  under_1_5                 FLOAT,
  under_2_5                 FLOAT,
  under_3_5                 FLOAT,
  btts_prob                 FLOAT,
  home_clean_sheet_prob     FLOAT,
  away_clean_sheet_prob     FLOAT,
  -- Half-time distributions
  ht_over_0_5               FLOAT,
  ht_over_1_5               FLOAT,
  ht_under_0_5              FLOAT,
  ht_under_1_5              FLOAT,
  -- Special probabilities
  home_team_total_dist      JSON,
  away_team_total_dist      JSON,
  sp_goal_prob              FLOAT,
  transition_goal_prob      FLOAT,
  keeper_volatility_prob    FLOAT,
  favorite_fragility_score  FLOAT,
  underdog_viability_score  FLOAT,
  draw_quality_score        FLOAT,
  -- Accuracy vs actual
  actual_home_score         TINYINT,
  actual_away_score         TINYINT,
  actual_total_goals        TINYINT,
  correct_outcome_prob      FLOAT,
  correct_total_goals_prob  FLOAT,
  correct_outcome_and_total FLOAT,
  correct_over_under        FLOAT,
  correct_total_band_prob   FLOAT,
  correct_team_superiority  BOOLEAN,
  met_75pct_target          BOOLEAN,
  miss_reason               TEXT,
  -- Calibration
  recalibration_version     VARCHAR(16),
  recalibrated_home_win     FLOAT,
  recalibrated_draw         FLOAT,
  recalibrated_away_win     FLOAT,
  recalibrated_correct_outcome FLOAT,
  recalibrated_correct_total   FLOAT,
  ran_at                    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_sim (match_id),
  INDEX idx_tournament_sim (tournament_year),
  INDEX idx_model_version (model_version)
);

-- ─── RECALIBRATION LOG ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_recalibration_log (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recal_version         VARCHAR(16)  NOT NULL,
  batch_name            VARCHAR(64)  NOT NULL,  -- e.g. '2018_only', '2018+2022', 'through_june17'
  match_id_trigger      VARCHAR(32),            -- match that triggered this recalibration
  stat_name             VARCHAR(64)  NOT NULL,
  current_weight        FLOAT        NOT NULL,
  proposed_weight       FLOAT        NOT NULL,
  direction             VARCHAR(16)  NOT NULL,  -- 'increase', 'decrease', 'retain', 'smooth', 'cap', 'remove'
  magnitude             FLOAT        NOT NULL,
  confidence            VARCHAR(16)  NOT NULL,  -- 'high', 'medium', 'low'
  volatility            VARCHAR(16)  NOT NULL,
  sample_size_reliability VARCHAR(16) NOT NULL,
  opponent_dependence   VARCHAR(16)  NOT NULL,
  game_state_sensitivity VARCHAR(16) NOT NULL,
  overfitting_risk      VARCHAR(16)  NOT NULL,
  data_completeness     FLOAT        NOT NULL,  -- 0.0 to 1.0
  leakage_risk          VARCHAR(16)  NOT NULL,
  forward_test_impact   VARCHAR(16)  NOT NULL,
  backtest_impact       VARCHAR(16)  NOT NULL,
  final_recommendation  VARCHAR(64)  NOT NULL,
  reason                TEXT,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recal_version (recal_version),
  INDEX idx_stat (stat_name),
  INDEX idx_batch (batch_name)
);

-- ─── MODEL PROJECTION SNAPSHOTS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_projections (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id              VARCHAR(32)  NOT NULL,
  tournament_year       SMALLINT     NOT NULL,
  model_version         VARCHAR(16)  NOT NULL,
  -- Pre-match model projection
  model_home_win_prob   FLOAT,
  model_draw_prob       FLOAT,
  model_away_win_prob   FLOAT,
  model_home_lambda     FLOAT,
  model_away_lambda     FLOAT,
  model_total_goals     FLOAT,
  model_lean            VARCHAR(8),   -- 'home', 'draw', 'away'
  model_lean_prob       FLOAT,
  -- Market closing
  market_home_win_prob  FLOAT,
  market_draw_prob      FLOAT,
  market_away_win_prob  FLOAT,
  market_total_line     FLOAT,
  market_lean           VARCHAR(8),
  -- Actual result
  actual_result         CHAR(1),      -- 'H', 'D', 'A'
  actual_total_goals    TINYINT,
  -- Accuracy
  model_correct_result  BOOLEAN,
  model_correct_total   BOOLEAN,
  model_error_type      VARCHAR(128),
  -- Recalibrated projection
  recal_home_win_prob   FLOAT,
  recal_draw_prob       FLOAT,
  recal_away_win_prob   FLOAT,
  recal_correct_result  BOOLEAN,
  recal_correct_total   BOOLEAN,
  recal_improvement     BOOLEAN,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_proj (match_id),
  INDEX idx_tournament_proj (tournament_year)
);

-- ─── DATA QUALITY FLAGS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_data_quality (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id              VARCHAR(32)  NOT NULL,
  tournament_year       SMALLINT     NOT NULL,
  stat_name             VARCHAR(64)  NOT NULL,
  flag_type             VARCHAR(32)  NOT NULL,  -- 'missing', 'imputed', 'conflicted', 'outlier', 'excluded', 'diagnostic_only'
  flag_severity         VARCHAR(16)  NOT NULL,  -- 'blocking', 'warning', 'info'
  source_value          TEXT,
  imputed_value         TEXT,
  imputation_method     VARCHAR(128),
  confidence            FLOAT,
  notes                 TEXT,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_match_quality (match_id),
  INDEX idx_flag_type (flag_type),
  INDEX idx_stat_quality (stat_name)
);

-- ─── UPSET/DRAW ANALYSIS TABLE ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_upset_draw_analysis (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id              VARCHAR(32)  NOT NULL UNIQUE,
  tournament_year       SMALLINT     NOT NULL,
  is_upset              BOOLEAN      NOT NULL DEFAULT FALSE,
  is_draw               BOOLEAN      NOT NULL DEFAULT FALSE,
  pre_match_favorite    VARCHAR(64),
  pre_match_fav_prob    FLOAT,
  model_favorite        VARCHAR(64),
  model_fav_prob        FLOAT,
  actual_result         CHAR(1),
  xg_diff               FLOAT,
  xg_ot_diff            FLOAT,
  big_chances_diff      TINYINT,
  possession_diff       FLOAT,
  field_tilt_diff       FLOAT,
  final_third_diff      SMALLINT,
  box_touches_diff      SMALLINT,
  shot_quality_diff     FLOAT,
  gk_saves_diff         TINYINT,
  post_shot_xg_diff     FLOAT,
  goals_prevented_diff  FLOAT,
  corners_diff          TINYINT,
  sp_xg_diff            FLOAT,
  transition_xg_diff    FLOAT,
  penalties_awarded     TINYINT,
  red_cards             TINYINT,
  yellow_cards          TINYINT,
  fouls_diff            TINYINT,
  -- Classification (comma-separated labels from Section 21)
  classifications       VARCHAR(512),
  -- Narrative
  why_it_happened       TEXT,
  possession_length_impact TEXT,
  goalkeeping_impact    TEXT,
  corner_impact         TEXT,
  penalty_impact        TEXT,
  card_impact           TEXT,
  sp_impact             TEXT,
  transition_impact     TEXT,
  elite_vs_weak_offense TEXT,
  weak_vs_elite_defense TEXT,
  equalizing_tendencies TEXT,
  recalibration_action  TEXT,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tournament_upset (tournament_year),
  INDEX idx_upset_type (is_upset, is_draw)
);

-- ─── BATCH RECALIBRATION RESULTS ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wc_bt_batch_results (
  id                    INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_name            VARCHAR(64)  NOT NULL,
  batch_size            SMALLINT     NOT NULL,
  -- Best predictors
  best_xg_diff_predictors       JSON,
  best_xg_ot_diff_predictors    JSON,
  best_result_prob_predictors   JSON,
  best_totals_vol_predictors    JSON,
  best_draw_risk_predictors     JSON,
  best_fav_fragility_predictors JSON,
  best_underdog_predictors      JSON,
  best_sp_vol_predictors        JSON,
  best_trans_vol_predictors     JSON,
  best_gk_vol_predictors        JSON,
  -- Stats that gained/lost predictive value
  stats_gained           JSON,
  stats_lost             JSON,
  stable_metrics         JSON,
  opponent_dependent     JSON,
  game_state_distorted   JSON,
  sample_size_traps      JSON,
  -- Overall accuracy
  correct_result_pct     FLOAT,
  correct_total_pct      FLOAT,
  avg_xg_diff_error      FLOAT,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch_name (batch_name)
);
