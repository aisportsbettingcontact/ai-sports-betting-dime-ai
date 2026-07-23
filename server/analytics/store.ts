/**
 * store.ts — durable analytics storage in the DEDICATED MySQL: Dime AI.
 *
 * Runs ONLY on the back office (role "store"). Every entry point hard-guards on
 * isAnalyticsStore() and throws otherwise, so this code can never write to the
 * product TiDB database. It uses the instance's own getDb() — on the back office
 * that resolves to MySQL: Dime AI (its DATABASE_URL). The web instance is a
 * "forwarder" and never calls into here.
 *
 * No PII: source_user_id is the pseudonymous Dime account id (server-derived);
 * props_json holds only allowlisted scalars (enforced upstream at the endpoint).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { isAnalyticsStore } from "./config";

const TAG = "[analytics][store]";

/** Idempotent schema — CREATE TABLE IF NOT EXISTS, safe to run on every boot. */
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS analytics_events (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     event_id VARCHAR(64) NOT NULL,
     event_name VARCHAR(64) NOT NULL,
     schema_version INT NOT NULL,
     definition_version INT NOT NULL DEFAULT 1,
     source_user_id BIGINT NOT NULL,
     session_id VARCHAR(64) NULL,
     tab_id VARCHAR(64) NULL,
     feature_id VARCHAR(64) NULL,
     action_name VARCHAR(64) NULL,
     route VARCHAR(96) NULL,
     device_type VARCHAR(12) NULL,
     os_family VARCHAR(16) NULL,
     browser_family VARCHAR(16) NULL,
     app_surface VARCHAR(24) NULL,
     viewport_class VARCHAR(8) NULL,
     orientation VARCHAR(10) NULL,
     is_touch TINYINT(1) NULL,
     is_standalone TINYINT(1) NULL,
     connection_class VARCHAR(12) NULL,
     surface VARCHAR(32) NOT NULL,
     outcome VARCHAR(32) NULL,
     occurred_at_utc BIGINT NOT NULL,
     received_at_utc BIGINT NOT NULL,
     environment VARCHAR(32) NOT NULL,
     app_version VARCHAR(64) NULL,
     is_test TINYINT(1) NOT NULL DEFAULT 0,
     props_json JSON NULL,
     UNIQUE KEY uq_event_id (event_id),
     KEY idx_subject_time (source_user_id, occurred_at_utc),
     KEY idx_event_time (event_name, occurred_at_utc),
     KEY idx_env_test (environment, is_test),
     KEY idx_device_time (device_type, occurred_at_utc),
     KEY idx_route_time (route, occurred_at_utc)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function guard(op: string): void {
  if (!isAnalyticsStore()) {
    throw new Error(
      `${TAG} ${op} refused — this instance is not the analytics store (guard against writing analytics to a non-dedicated DB such as TiDB)`,
    );
  }
}

/** Create the analytics tables if absent. Store-role only; idempotent. */
export async function ensureAnalyticsSchema(): Promise<void> {
  guard("ensureAnalyticsSchema");
  const db = await getDb();
  if (!db) throw new Error(`${TAG} database unavailable`);
  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
  }
  console.log(`${TAG} schema ensured (${DDL.length} statement(s))`);
}

export interface StoredEvent {
  eventId: string;
  eventName: string;
  schemaVersion: number;
  definitionVersion?: number;
  /** Server-derived pseudonymous Dime account id — never client-supplied. */
  sourceUserId: number;
  sessionId?: string | null;
  tabId?: string | null;
  featureId?: string | null;
  route?: string | null;
  actionName?: string | null;
  deviceType?: string | null;
  osFamily?: string | null;
  browserFamily?: string | null;
  appSurface?: string | null;
  viewportClass?: string | null;
  orientation?: string | null;
  isTouch?: boolean | null;
  isStandalone?: boolean | null;
  connectionClass?: string | null;
  surface: string;
  outcome?: string | null;
  occurredAtUtc: number;
  environment: string;
  appVersion?: string | null;
  isTest?: boolean;
  props?: Record<string, unknown> | null;
}

/**
 * Insert one event idempotently (unique event_id ⇒ re-delivery is a no-op).
 * `received_at` is stamped server-side. Store-role only.
 */
export async function insertAnalyticsEvent(e: StoredEvent): Promise<{ ok: true; deduped: boolean }> {
  guard("insertAnalyticsEvent");
  const db = await getDb();
  if (!db) throw new Error(`${TAG} database unavailable`);
  const receivedAt = Date.now();
  const propsJson = e.props ? JSON.stringify(e.props) : null;
  const result = await db.execute(sql`
    INSERT IGNORE INTO analytics_events
      (event_id, event_name, schema_version, definition_version, source_user_id,
       session_id, tab_id, feature_id, action_name, route, surface, outcome,
       device_type, os_family, browser_family, app_surface, viewport_class,
       orientation, is_touch, is_standalone, connection_class,
       occurred_at_utc, received_at_utc, environment, app_version, is_test, props_json)
    VALUES
      (${e.eventId}, ${e.eventName}, ${e.schemaVersion}, ${e.definitionVersion ?? 1}, ${e.sourceUserId},
       ${e.sessionId ?? null}, ${e.tabId ?? null}, ${e.featureId ?? null}, ${e.actionName ?? null}, ${e.route ?? null}, ${e.surface}, ${e.outcome ?? null},
       ${e.deviceType ?? null}, ${e.osFamily ?? null}, ${e.browserFamily ?? null}, ${e.appSurface ?? null}, ${e.viewportClass ?? null},
       ${e.orientation ?? null}, ${e.isTouch == null ? null : e.isTouch ? 1 : 0}, ${e.isStandalone == null ? null : e.isStandalone ? 1 : 0}, ${e.connectionClass ?? null},
       ${e.occurredAtUtc}, ${receivedAt}, ${e.environment}, ${e.appVersion ?? null}, ${e.isTest ? 1 : 0}, ${propsJson})
  `);
  // mysql2 ResultSetHeader: affectedRows 0 = duplicate ignored, 1 = inserted.
  // Defensive extraction across driver/drizzle result shapes.
  const header = Array.isArray(result) ? (result[0] as { affectedRows?: number }) : (result as { affectedRows?: number });
  const affected = typeof header?.affectedRows === "number" ? header.affectedRows : 1;
  return { ok: true, deduped: affected === 0 };
}
