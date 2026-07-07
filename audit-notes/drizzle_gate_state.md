# Drizzle Final Gate — Snapshot Reconciliation State (UPDATED)

## Problem Fully Diagnosed
- `drizzle-kit generate` compares Drizzle SCHEMA DEFINITIONS against the LATEST SNAPSHOT
- The snapshot (0108) is stale for EXISTING tables too (not just the 15 we added)
- Example: wc2026_espn_expected_goals has `espn_match_id` in schema.ts but NOT in snapshot
- This means columns were added to schema.ts AFTER migration 0107 was generated
- The 0107 snapshot was the last one produced by a real `generate` run
- Our 0108 was a `--custom` migration (no schema diff) so its snapshot is just a copy of 0107's

## Root Cause
- drizzle-kit generate works by: schema_definitions - snapshot = diff → new migration
- If snapshot is stale (doesn't reflect current schema), it sees phantom "new" columns
- It then prompts "is this column created or renamed?"
- The ONLY way to get a clean generate is: snapshot MUST match current schema definitions EXACTLY

## Correct Solution
- We need to produce a snapshot that EXACTLY matches what the schema files define
- This is NOT about what the DB has — it's about what the Drizzle schema TypeScript files declare
- The way drizzle-kit normally does this: run generate, it produces migration + updated snapshot
- But we can't run generate because it prompts (chicken-and-egg)

## Resolution Path: Generate the snapshot from schema programmatically
- Option 1: Use drizzle-kit's internal serializer to produce the snapshot from schema files
  - drizzle-kit has an internal function that serializes schema to snapshot format
  - We can import it and run it directly
- Option 2: Create a new --custom migration that's a no-op, which forces snapshot refresh
  - Won't work — custom migrations copy the PREVIOUS snapshot unchanged
- Option 3: Temporarily remove all "new" columns from schema, run generate (clean), 
  then add them back and run generate again (it will see them as new, produce migration)
  - This would produce CREATE COLUMN migrations for columns that already exist in DB
  - Then we'd need to register those as applied too
  - Risky: if we ever run migrate, it would try to ALTER TABLE on existing columns

## BEST PATH: Use drizzle-kit's schema serializer directly
- The serializer is in drizzle-kit's internals
- We can call it to produce the correct snapshot from our schema files
- Then replace 0108_snapshot.json with the output
- After that, generate should see: schema = snapshot → no diff → clean exit

## Alternative BEST PATH: Run generate with --custom to get a fresh snapshot
- Actually: `drizzle-kit generate --custom` DOES copy the previous snapshot
- But what if we delete the snapshot and run generate?
- Or: what if we use `drizzle-kit push --dry-run` which compares schema to DB?

## SIMPLEST PATH (chosen):
- The snapshot format is just a JSON representation of the schema definitions
- We can write a script that reads the Drizzle schema TS files and produces the snapshot
- OR: we can use drizzle-kit's OWN internal serializer
- Located in node_modules/drizzle-kit/bin.cjs — search for "generateMySqlSnapshot"

## Files
- Snapshot to fix: drizzle/meta/0108_snapshot.json
- Schema files: drizzle/schema.ts, drizzle/wc2026.schema.ts, drizzle/dime.schema.ts
- Journal: drizzle/meta/_journal.json (109 entries, idx 0-108)
- All 110 migrations registered in __drizzle_migrations DB table

## Current table count in snapshot: 72
## Expected: must match ALL tables defined across the 3 schema files

## Key insight for the script:
- drizzle-kit's bin.cjs exports a function that can serialize schema to snapshot
- We need to find and call it, or replicate its logic
- The snapshot format for each table is straightforward:
  {name, columns:{}, indexes:{}, foreignKeys:{}, compositePrimaryKeys:{}, uniqueConstraints:{}, checkConstraint:{}}
