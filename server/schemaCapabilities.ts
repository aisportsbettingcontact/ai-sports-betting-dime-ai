/**
 * schemaCapabilities.ts — runtime probe for deploy-gated columns.
 *
 * Deploy law: schema changes ship via the manual db-push.yml workflow BEFORE
 * any code deploy. Code that references brand-new columns must therefore
 * tolerate a database that does not have them yet — otherwise the first boot
 * after a code deploy throws ER_BAD_FIELD_ERROR in a 24/7 loop.
 *
 * This module answers "does the live database have column X on table Y?" once
 * per process (information_schema probe, cached), logs the verdict, and fails
 * SAFE: any probe error reports the column as absent, so new-column writes are
 * skipped rather than crashing settlement paths.
 *
 * The decision helper (pickSupported) is pure and unit-tested; only the probe
 * touches the DB.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const TAG = "[SchemaCaps]";

const columnCache = new Map<string, Set<string>>();

function extractRows(result: unknown): Array<Record<string, unknown>> {
  // drizzle/mysql2 execute() shapes vary: [rows, fields] | { rows } | rows.
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? (result[0] as Array<Record<string, unknown>>) : (result as Array<Record<string, unknown>>);
  }
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

/** All column names of `table` in the connected schema (cached per process). */
export async function tableColumns(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  try {
    const db = await getDb();
    const result = await db.execute(
      sql`SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`,
    );
    const names = new Set(
      extractRows(result)
        .map((r) => String(r.columnName ?? r.COLUMN_NAME ?? ""))
        .filter(Boolean),
    );
    columnCache.set(table, names);
    console.log(`${TAG} [STATE] ${table}: ${names.size} columns discovered`);
    return names;
  } catch (err) {
    console.warn(
      `${TAG} [WARN] probe failed for ${table}: ${err instanceof Error ? err.message : err} — treating ALL probed columns as absent (fail-safe)`,
    );
    const empty = new Set<string>();
    columnCache.set(table, empty);
    return empty;
  }
}

export async function hasColumns(
  table: string,
  columns: string[],
): Promise<Record<string, boolean>> {
  const present = await tableColumns(table);
  const verdict: Record<string, boolean> = {};
  for (const column of columns) verdict[column] = present.has(column);
  const missing = columns.filter((c) => !verdict[c]);
  if (missing.length > 0) {
    console.warn(
      `${TAG} [STATE] ${table} missing deploy-gated column(s): ${missing.join(", ")} — writes will omit them until db-push.yml runs`,
    );
  }
  return verdict;
}

/**
 * Pure: given a candidate field map and the column-presence verdict, return
 * only the fields the live schema can accept.
 */
export function pickSupported<T extends Record<string, unknown>>(
  candidate: T,
  verdict: Record<string, boolean>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(candidate) as Array<keyof T>) {
    if (verdict[key as string]) out[key] = candidate[key];
  }
  return out;
}

/** Test hook / post-db-push refresh. */
export function clearSchemaCapabilityCache(): void {
  columnCache.clear();
}
