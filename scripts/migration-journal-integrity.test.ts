import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { validateMigrationJournal } from "./lib/migration-journal-integrity.mjs";

type JournalRow = {
  hash: string;
  created_at: number;
};

type ManifestRow = {
  createdAt: number;
  hash: string;
  classification: string;
  mapsToTag?: string;
  mapsToWhen?: number;
  coversThroughTag?: string;
  coversAbsentTags?: string[];
};

type LegacyManifest = {
  schemaVersion: number;
  profileId: string;
  coverageThroughTag: string;
  expectedAbsentRepositoryTags: string[];
  rows: ManifestRow[];
};

const repositoryJournal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8")
);
const manifest = JSON.parse(
  readFileSync("drizzle/meta/production_legacy_journal.json", "utf8")
) as LegacyManifest;
const migrationFiles = readMigrationFiles({ migrationsFolder: "./drizzle" });
const tagByWhen = new Map(
  repositoryJournal.entries.map((entry: { tag: string; when: number }) => [
    Number(entry.when),
    entry.tag,
  ])
);
const migrations = migrationFiles.map(migration => ({
  tag: tagByWhen.get(Number(migration.folderMillis)),
  when: Number(migration.folderMillis),
  hash: String(migration.hash),
}));
const indexByTag = new Map(
  migrations.map((migration, index) => [migration.tag, index])
);

function repositoryRow(tag: string): JournalRow {
  const migration = migrations[indexByTag.get(tag)!];
  return { hash: migration.hash, created_at: migration.when };
}

function productionFixture(): JournalRow[] {
  const absent = new Set(manifest.expectedAbsentRepositoryTags);
  const boundary = indexByTag.get(manifest.coverageThroughTag)!;
  const directRows = migrations
    .slice(0, boundary + 1)
    .filter(migration => !absent.has(migration.tag))
    .map(migration => ({
      hash: migration.hash,
      created_at: migration.when,
    }));
  const legacyRows = manifest.rows.map(row => ({
    hash: row.hash,
    created_at: row.createdAt,
  }));
  return [...directRows, ...legacyRows];
}

function validate(
  rows: JournalRow[],
  candidateManifest: LegacyManifest = manifest,
  profileMode = "railway-production-v1"
) {
  return validateMigrationJournal({
    rows,
    migrations,
    manifest: candidateManifest,
    profileMode,
  });
}

describe("migration journal integrity", () => {
  it("accepts the exact pinned Railway profile through 0121", () => {
    const result = validate(productionFixture());

    expect(result).toMatchObject({
      coverageTag: "0121_dime_conversation_trace_v1",
      legacyRowsVerified: 14,
      profileId: "railway-production-v1",
    });
  });

  it("accepts a complete clean repository prefix", () => {
    const rows = migrations.slice(0, 5).map(migration => ({
      hash: migration.hash,
      created_at: migration.when,
    }));

    expect(validate(rows, manifest, "auto")).toMatchObject({
      coverageIndex: 4,
      coverageTag: migrations[4].tag,
      legacyRowsVerified: 0,
      profileId: null,
    });
  });

  it("rejects a missing pinned legacy row", () => {
    const missing = productionFixture().filter(
      row =>
        !(
          row.created_at === manifest.rows[0].createdAt &&
          row.hash === manifest.rows[0].hash
        )
    );

    expect(() => validate(missing)).toThrow(
      /legacy journal multiset does not exactly match.*missing=/
    );
  });

  it("rejects a duplicated pinned legacy row", () => {
    const rows = productionFixture();
    rows.push({
      hash: manifest.rows[0].hash,
      created_at: manifest.rows[0].createdAt,
    });

    expect(() => validate(rows)).toThrow(
      /legacy journal multiset does not exactly match.*extra=/
    );
  });

  it("rejects a valid repository migration missing below the verified boundary", () => {
    const required = repositoryRow("0111_panoramic_lyja");
    const rows = productionFixture().filter(
      row => row.created_at !== required.created_at
    );

    expect(() => validate(rows)).toThrow(
      /production profile is missing required repository migration 0111_panoramic_lyja/
    );
  });

  it("rejects a shifted hash mapped to the wrong migration", () => {
    const candidate = structuredClone(manifest);
    const shifted = candidate.rows.find(
      row =>
        row.classification === "legacy_exact_hash_shifted_timestamp" &&
        row.mapsToTag === "0106_espn_table_renames"
    )!;
    const wrongMigration =
      migrations[indexByTag.get("0105_puzzling_quicksilver")!];
    shifted.mapsToTag = wrongMigration.tag;
    shifted.mapsToWhen = wrongMigration.when;

    expect(() => validate(productionFixture(), candidate)).toThrow(
      /shifted legacy hash .* is mapped to the wrong migration/
    );
  });

  it("rejects a manual marker without an explicit coverage boundary", () => {
    const candidate = structuredClone(manifest);
    const manualSchemaMarker = candidate.rows.find(
      row => row.classification === "legacy_manual_schema_marker"
    )!;
    delete manualSchemaMarker.coversThroughTag;

    expect(() => validate(productionFixture(), candidate)).toThrow(
      /manual schema marker .* requires an explicit coverage boundary/
    );
  });

  it("rejects a valid migration hash paired with the wrong timestamp", () => {
    const rows = [repositoryRow(migrations[0].tag)];
    rows[0].created_at = migrations[1].when;

    expect(() => validate(rows, manifest, "auto")).toThrow(
      /journal hash mismatch at created_at=.*expected/
    );
  });

  it("rejects a valid maximum when its historical prefix is incomplete", () => {
    const rows = [
      repositoryRow(migrations[0].tag),
      repositoryRow(migrations[2].tag),
    ];

    expect(() => validate(rows, manifest, "auto")).toThrow(
      /historical prefix is incomplete/
    );
  });
});
