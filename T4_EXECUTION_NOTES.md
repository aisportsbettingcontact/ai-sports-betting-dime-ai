# Tier 4 Dime Activation - Execution Notes

## Current State (Block 0 PASS)
- All P0 counts verified: matches=104|teams=49|venues=16|espn_xg=88|espn_ts=88|espn_ps=2742|espn_matches=90|projections=92|recommendations=264|holdout=258|grades=57
- null_espn_ids=0|invalid_bets=0|bet=2|no_market=210|market_closed=48|pass=4
- Code backups: server/dime-chat.route.ts.bak_t4_20260706 ✓, server/wc2026/wc2026Router.ts.bak_t4_20260706 ✓

## Current Dime Route (server/dime-chat.route.ts, 208 lines)
- Has auth gate (sdk.authenticateRequest) → 401 if unauthenticated
- Uses Anthropic SDK with claude-fable-5
- SSE streaming response
- NO subscription check
- NO credit check
- NO context builder (commented out placeholder)
- NO refusal logic
- NO response audit logging
- NO credit deduction
- System prompt claims Monte Carlo (WRONG for WC2026 - must be Dixon-Coles)
- Mounted at POST /api/dime/chat

## Required Tables (Block 1)
1. dime_user_entitlements (user_id, entitlement_status, tier, source, starts_at, expires_at)
2. dime_credit_ledger (user_id, request_id, delta_credits, balance_after, reason)
3. dime_request_audit (request_id, user_id, auth_status, entitlement_status, credit_status, intent, context_status, response_status, tokens_used, credits_charged, refusal_reason)

## Required Tables (Block 2)
4. dime_context_audit (request_id, user_id, context_hash, context_status, match_count, recommendation_count, missing_field_count, freshness_status)

## Required Tables (Block 4)
5. dime_response_audit (request_id, user_id, response_mode, refusal_reason, context_hash, tokens_input, tokens_output, credits_charged, answer_hash)

## Required Tables (Block 5)
6. dime_22_path_matrix_results (run_id, path_number, path_name, test_prompt, expected_mode, actual_mode, expected_refusal_reason, actual_refusal_reason, hallucination_detected, unsupported_claim_detected, credit_behavior_correct, audit_logged, pass_fail)

## 22-Path Matrix
1. Best edge today → ANSWER only if BET exists and fresh
2. Today's card → ANSWER from context
3. Match breakdown → ANSWER if match context exists
4. Score prediction → ANSWER if projection exists, else REFUSE
5. Moneyline explanation → ANSWER if 1X2 exists
6. Spread explanation → REFUSE (no spread data)
7. Total explanation → REFUSE (no totals data)
8. BTTS explanation → REFUSE (no BTTS data)
9. To-advance odds → REFUSE (no advance odds)
10. Line movement → REFUSE (no line movement data)
11. Lineup check → REFUSE (no lineup data)
12. Team trend → ANSWER from xG/stats if available
13. Player trend → REFUSE (no player trend data for WC2026 context)
14. Bracket path → ANSWER from match structure
15. Model explanation → ANSWER (Dixon-Coles analytical, NOT Monte Carlo)
16. No-bet reason → ANSWER from PASS/NO_MARKET reasons
17. Stale data check → ANSWER from freshness_status
18. CLV proof → REFUSE (no CLV data)
19. Confidence band → REFUSE (no confidence band data)
20. Citation/source request → ANSWER (cite lineage/model version)
21. Freshness request → ANSWER from odds_updated_at
22. No-charge refusal path → REFUSE with 0 credits charged

## Refusal Reasons
AUTH_REQUIRED, SUBSCRIPTION_REQUIRED, INSUFFICIENT_CREDITS, NO_CONTEXT, MATCH_NOT_FOUND, MARKET_NOT_SUPPORTED, ODDS_MISSING, ODDS_STALE, MARKET_CLOSED, MODEL_PROJECTION_MISSING, EDGE_MISSING, LINEUP_MISSING, PLAYER_STATS_MISSING, CLV_MISSING, UNSUPPORTED_PROP

## Response Modes
ANSWER, REFUSE, CLARIFY, PASS_ONLY, INTERNAL_ERROR

## Charging Rules
AUTH_REQUIRED=0, SUBSCRIPTION_REQUIRED=0, INSUFFICIENT_CREDITS=0, NO_CONTEXT=0, MARKET_NOT_SUPPORTED=0, ODDS_STALE=0 (if no answer), ANSWER=charge after success, INTERNAL_ERROR=0

## Required Enforcement Order
1. request_id generated → 2. auth check → 3. user identity → 4. subscription check → 5. credit check → 6. rate limit → 7. request validation → 8. intent classification → 9. context builder → 10. context validation → 11. Claude call → 12. usage log → 13. credit deduction → 14. response log

## Final Gate (15 criteria)
T4-1 through T4-15 (all must PASS for TIER 4 DIME ACTIVATION VERIFIED)
