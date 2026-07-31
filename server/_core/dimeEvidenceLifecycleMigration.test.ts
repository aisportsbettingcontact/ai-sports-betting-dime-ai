import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const migrationPath = path.join(
  repositoryRoot,
  "drizzle",
  "0122_dime_evidence_lifecycle_v1.sql"
);
const rollbackPath = path.join(
  repositoryRoot,
  "drizzle",
  "rollbacks",
  "0122_dime_evidence_lifecycle_v1.rollback.sql"
);
const snapshotPath = path.join(
  repositoryRoot,
  "drizzle",
  "meta",
  "0122_snapshot.json"
);
const journalPath = path.join(
  repositoryRoot,
  "drizzle",
  "meta",
  "_journal.json"
);

const migrationSource = fs.readFileSync(migrationPath, "utf8");
const rollbackSource = fs.readFileSync(rollbackPath, "utf8");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
  tables: Record<string, { columns: Record<string, Record<string, unknown>> }>;
};
const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

const TIMESTAMP_COLUMNS = [
  "provider_observed_at",
  "source_updated_at",
  "ingestion_received_at",
  "ingestion_normalized_at",
  "ingestion_persisted_at",
] as const;
const IDENTITY_COLUMNS = [
  "ingestion_pipeline_revision",
  "ingestion_run_id",
] as const;
const ALL_COLUMNS = [...TIMESTAMP_COLUMNS, ...IDENTITY_COLUMNS] as const;

function gamesColumns(): Record<string, Record<string, unknown>> {
  const gamesTable = Object.entries(snapshot.tables).find(
    ([tableName]) => tableName === "games" || tableName.endsWith(".games")
  )?.[1];
  if (!gamesTable) throw new Error("games table missing from Drizzle snapshot");
  return gamesTable.columns;
}

describe("Dime evidence lifecycle migration", () => {
  it("is the ordered Drizzle migration and has a generated schema snapshot", () => {
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 122,
      tag: "0122_dime_evidence_lifecycle_v1",
    });
  });

  it("adds only nullable no-default lifecycle storage", () => {
    const columns = gamesColumns();
    for (const columnName of TIMESTAMP_COLUMNS) {
      expect(columns[columnName]).toMatchObject({
        name: columnName,
        type: "timestamp(3)",
        notNull: false,
      });
      expect(columns[columnName]).not.toHaveProperty("default");
      expect(migrationSource).toContain(
        `ADD COLUMN \`${columnName}\` timestamp(3) NULL DEFAULT NULL`
      );
    }
    for (const columnName of IDENTITY_COLUMNS) {
      expect(columns[columnName]).toMatchObject({
        name: columnName,
        type: "varchar(160)",
        notNull: false,
      });
      expect(columns[columnName]).not.toHaveProperty("default");
      expect(migrationSource).toContain(
        `ADD COLUMN \`${columnName}\` varchar(160) NULL DEFAULT NULL`
      );
    }
    expect(migrationSource).not.toMatch(/\bUPDATE\s+`?games`?/i);
    expect(migrationSource).not.toMatch(/\bCURRENT_TIMESTAMP\b|\bNOW\s*\(/i);
  });

  it("guards every additive operation for resumable idempotency", () => {
    expect(migrationSource).toContain("information_schema.COLUMNS");
    for (const columnName of ALL_COLUMNS) {
      expect(migrationSource).toContain(`COLUMN_NAME = '${columnName}'`);
      expect(migrationSource).toContain(`${columnName} already present`);
    }
  });

  it("keeps rollback manual, guarded, and dependent on tracing being disabled", () => {
    expect(rollbackSource).toContain("REVIEWED MANUAL ROLLBACK ONLY");
    expect(rollbackSource).toContain("DIME_CHAT_TRACE_V1_ENABLED=false");
    expect(rollbackSource).toContain("information_schema.COLUMNS");
    for (const columnName of ALL_COLUMNS) {
      expect(rollbackSource).toContain(`DROP COLUMN \`${columnName}\``);
      expect(rollbackSource).toContain(`${columnName} already absent`);
    }
  });
});
