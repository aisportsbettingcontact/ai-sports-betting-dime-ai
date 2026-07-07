# Schema Alignment Execution State (Authorization A)

## COMPLETED SLICES

### Slice 1 (DB-008): Remove duplicate wc2026MatchOdds ✓
- Removed table definition from drizzle/schema.ts (kept types-only re-export)
- Removed table re-export (drizzle-kit sees re-exports as duplicates)
- Fixed router import: wc2026Router.ts now imports table from wc2026.schema.ts
- TypeScript: 0 errors ✓
- Feed smoke: 2 rows returned for 2026-07-07 ✓
- DIME smoke: 8 R16 odds rows with correct odds_source ✓

### Slice 5 (Enum fix): Add 'r16' to world_cup_round ✓
- Applied in same edit as Slice 1 (wc2026.schema.ts)
- Enum now includes: 'group', 'r32', 'r16', 'qf', 'sf', 'final'

### Slice 2 (DB-007): Add 27 missing columns to wc2026ModelProjections ✓
- Added all 27 columns that exist in live DB but were missing from Drizzle
- TypeScript: 0 errors ✓

### Slice 4 (DB-014): Fix odds_source mislabel ✓
- 84/84 rows now have correct odds_source
- 0 remaining ESPN_INGEST or NULL
- Mapping: gs_metadata_backfill→betexplorer, r32_backfill→betexplorer, v19→betexplorer, v20→betexplorer, v22→betexplorer+draftkings_manual_advance

### Slice 3A (DB-013): ADOPT 8 orphan tables ✓
- Added Drizzle definitions for: wc2026_data_lineage, wc2026_holdout_validation, wc2026_market_edges, wc2026_market_no_vig, wc2026_model_grades, wc2026_model_runs, wc2026_provider_match_map, wc2026_recommendations
- TypeScript: 0 errors ✓

## FINAL GATE: drizzle-kit generate — PARTIALLY RESOLVED

### DB-008 (wc2026MatchOdds duplicate) — FIXED ✓
- No longer prompts about wc2026MatchOdds
- The prompt is now about the 8 newly adopted orphan tables

### New prompt issue
- drizzle-kit prompts "Is wc2026_data_lineage table created or renamed from another table?"
- This is because the 8 adopted tables exist in live DB but not in the migration journal
- drizzle-kit also shows a "rename from wc2026_espn_match_odds" option (the dropped table)
- The prompt uses an interactive TUI (inquirer-style) that doesn't respond to piped stdin
- pexpect sends Enter but the TUI doesn't advance (likely needs specific escape sequences)

### Root cause of remaining prompt
- The 8 adopted tables + the dropped wc2026_espn_match_odds (still in journal but not in schema)
- drizzle-kit sees: 8 new tables in schema, 1 table in journal but not in schema
- It asks if each new table is a rename of the missing one

### Resolution options
1. Use `drizzle-kit generate --custom` to create empty migration, then manually write it
2. Manually add journal entries for the 8 tables (mark them as already existing)
3. Accept this as expected behavior for first-time adoption (one-time interactive run needed)
4. Use `drizzle-kit push` instead (applies schema directly without migrations)

## r16-096 STATUS
- Match started ~20:00 UTC, was at 11' (0-0) when last checked
- ESPN match ID: 760508
- Expected FINAL: ~22:00 UTC

## CHECKPOINT
- Last checkpoint: a066499b (pre-schema-alignment)
- Current state: all slices applied, NOT checkpointed yet
- Need to save checkpoint after drizzle-kit gate resolves
