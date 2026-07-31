function journalKey(createdAt, hash) {
  return `${Number(createdAt)}:${String(hash)}`;
}

function countByKey(values, keyOf) {
  const counts = new Map();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function assertUnique(values, label) {
  const counts = countByKey(values, value => value);
  const duplicate = [...counts.entries()].find(([, count]) => count > 1);
  if (duplicate) {
    throw new Error(`${label} contains duplicate value ${duplicate[0]}`);
  }
}

function multisetDifference(expected, observed) {
  const expectedCounts = countByKey(expected, value => value);
  const observedCounts = countByKey(observed, value => value);
  const missing = [];
  const extra = [];

  for (const [key, expectedCount] of expectedCounts) {
    const observedCount = observedCounts.get(key) || 0;
    for (let index = observedCount; index < expectedCount; index += 1) {
      missing.push(key);
    }
  }
  for (const [key, observedCount] of observedCounts) {
    const expectedCount = expectedCounts.get(key) || 0;
    for (let index = expectedCount; index < observedCount; index += 1) {
      extra.push(key);
    }
  }

  return { missing, extra };
}

function validateManifest(manifest, migrations, migrationByTag) {
  if (manifest.schemaVersion !== 2) {
    throw new Error("legacy journal manifest schemaVersion must be 2");
  }
  if (!manifest.profileId || typeof manifest.profileId !== "string") {
    throw new Error("legacy journal manifest profileId is required");
  }
  if (
    !manifest.coverageThroughTag ||
    !migrationByTag.has(manifest.coverageThroughTag)
  ) {
    throw new Error(
      "legacy journal manifest coverageThroughTag must name a repository migration"
    );
  }
  if (!Array.isArray(manifest.rows) || manifest.rows.length === 0) {
    throw new Error("legacy journal manifest rows must be a non-empty array");
  }
  if (!Array.isArray(manifest.expectedAbsentRepositoryTags)) {
    throw new Error(
      "legacy journal manifest expectedAbsentRepositoryTags is required"
    );
  }

  const coverageBoundary = migrationByTag.get(
    manifest.coverageThroughTag
  ).index;
  const absentTags = manifest.expectedAbsentRepositoryTags;
  assertUnique(absentTags, "expectedAbsentRepositoryTags");

  for (const tag of absentTags) {
    const migration = migrationByTag.get(tag);
    if (!migration) {
      throw new Error(
        `expected absent repository migration ${tag} does not exist`
      );
    }
    if (migration.index > coverageBoundary) {
      throw new Error(
        `expected absent repository migration ${tag} exceeds coverageThroughTag`
      );
    }
  }

  const manifestKeys = manifest.rows.map(row =>
    journalKey(row.createdAt, row.hash)
  );
  assertUnique(manifestKeys, "legacy journal manifest rows");

  const explicitlyCoveredTags = new Set();
  for (const row of manifest.rows) {
    if (!Number.isSafeInteger(Number(row.createdAt)) || !row.hash) {
      throw new Error(
        "every legacy journal manifest row requires createdAt and hash"
      );
    }
    if (!row.classification) {
      throw new Error(
        `legacy journal manifest row ${row.createdAt} requires classification`
      );
    }

    if (row.mapsToTag) {
      const mappedMigration = migrationByTag.get(row.mapsToTag);
      if (!mappedMigration) {
        throw new Error(
          `legacy journal row ${row.createdAt} maps to unknown migration ${row.mapsToTag}`
        );
      }
      if (Number(row.mapsToWhen) !== mappedMigration.when) {
        throw new Error(
          `legacy journal row ${row.createdAt} has an invalid mapped timestamp for ${row.mapsToTag}`
        );
      }
      if (
        row.classification === "legacy_exact_hash_shifted_timestamp" &&
        String(row.hash) !== mappedMigration.hash
      ) {
        throw new Error(
          `shifted legacy hash ${row.hash} is mapped to the wrong migration ${row.mapsToTag}`
        );
      }
      explicitlyCoveredTags.add(row.mapsToTag);
    }

    for (const tag of row.coversAbsentTags || []) {
      const coveredMigration = migrationByTag.get(tag);
      if (!coveredMigration) {
        throw new Error(
          `legacy journal row ${row.createdAt} covers unknown migration ${tag}`
        );
      }
      explicitlyCoveredTags.add(tag);
    }

    if (row.coversThroughTag) {
      const rowBoundary = migrationByTag.get(row.coversThroughTag);
      if (!rowBoundary) {
        throw new Error(
          `legacy journal row ${row.createdAt} has unknown coverage boundary ${row.coversThroughTag}`
        );
      }
      for (const tag of row.coversAbsentTags || []) {
        if (migrationByTag.get(tag).index > rowBoundary.index) {
          throw new Error(
            `legacy journal row ${row.createdAt} covers ${tag} beyond its explicit boundary`
          );
        }
      }
    }

    if (
      row.classification === "legacy_manual_schema_marker" &&
      !row.coversThroughTag
    ) {
      throw new Error(
        `manual schema marker ${row.createdAt} requires an explicit coverage boundary`
      );
    }
    if (
      !row.mapsToTag &&
      !(row.coversAbsentTags || []).length &&
      !row.coversThroughTag
    ) {
      throw new Error(
        `legacy journal row ${row.createdAt} has no explicit migration coverage`
      );
    }
  }

  for (const tag of absentTags) {
    if (!explicitlyCoveredTags.has(tag)) {
      throw new Error(
        `expected absent repository migration ${tag} lacks explicit legacy coverage`
      );
    }
  }

  return {
    absentTags: new Set(absentTags),
    coverageBoundary,
    manifestKeys,
  };
}

/**
 * Validate an observed Drizzle journal as one of two closed-world histories:
 *
 * - a normal repository history, which must be a contiguous migration prefix;
 * - the pinned Railway production profile, whose legacy-row multiset and
 *   repository-row omissions must exactly match the committed manifest.
 *
 * The returned coverage index is the only value callers may use to select
 * pending migrations. A maximum timestamp is never treated as proof that the
 * historical prefix is complete.
 */
export function validateMigrationJournal({
  rows,
  migrations,
  manifest,
  profileMode = "auto",
}) {
  if (!Array.isArray(rows) || !Array.isArray(migrations)) {
    throw new Error("rows and migrations must be arrays");
  }

  const normalizedMigrations = migrations.map((migration, index) => ({
    index,
    tag: String(migration.tag),
    when: Number(migration.when),
    hash: String(migration.hash),
  }));
  assertUnique(
    normalizedMigrations.map(migration => migration.tag),
    "repository migration tags"
  );
  assertUnique(
    normalizedMigrations.map(migration => migration.when),
    "repository migration timestamps"
  );

  const migrationByTag = new Map(
    normalizedMigrations.map(migration => [migration.tag, migration])
  );
  const migrationByWhen = new Map(
    normalizedMigrations.map(migration => [migration.when, migration])
  );
  const manifestContract = validateManifest(
    manifest,
    normalizedMigrations,
    migrationByTag
  );

  if (!["auto", manifest.profileId].includes(profileMode)) {
    throw new Error(
      `JOURNAL_PROFILE must be auto or ${manifest.profileId}; received ${profileMode}`
    );
  }

  const normalizedRows = rows.map(row => ({
    createdAt: Number(row.created_at ?? row.createdAt),
    hash: String(row.hash),
  }));
  const directCounts = new Map();
  const legacyRows = [];

  for (const row of normalizedRows) {
    const migration = migrationByWhen.get(row.createdAt);
    if (!migration) {
      legacyRows.push(row);
      continue;
    }
    if (row.hash !== migration.hash) {
      throw new Error(
        `journal hash mismatch at created_at=${row.createdAt}; expected ${migration.tag}`
      );
    }
    directCounts.set(
      migration.index,
      (directCounts.get(migration.index) || 0) + 1
    );
  }

  const duplicateDirect = [...directCounts.entries()].find(
    ([, count]) => count > 1
  );
  if (duplicateDirect) {
    const migration = normalizedMigrations[duplicateDirect[0]];
    throw new Error(
      `duplicate repository journal row for ${migration.tag} at created_at=${migration.when}`
    );
  }

  const profileActive =
    profileMode === manifest.profileId || legacyRows.length > 0;
  if (profileActive) {
    const observedLegacyKeys = legacyRows.map(row =>
      journalKey(row.createdAt, row.hash)
    );
    const difference = multisetDifference(
      manifestContract.manifestKeys,
      observedLegacyKeys
    );
    if (difference.missing.length || difference.extra.length) {
      const details = [
        difference.missing.length
          ? `missing=${difference.missing.join(",")}`
          : "",
        difference.extra.length ? `extra=${difference.extra.join(",")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `legacy journal multiset does not exactly match ${manifest.profileId}: ${details}`
      );
    }

    for (
      let index = 0;
      index <= manifestContract.coverageBoundary;
      index += 1
    ) {
      const migration = normalizedMigrations[index];
      const directCount = directCounts.get(index) || 0;
      if (manifestContract.absentTags.has(migration.tag)) {
        if (directCount !== 0) {
          throw new Error(
            `production profile expected repository migration ${migration.tag} to be absent`
          );
        }
      } else if (directCount !== 1) {
        throw new Error(
          `production profile is missing required repository migration ${migration.tag}`
        );
      }
    }

    let coverageIndex = manifestContract.coverageBoundary;
    for (
      let index = manifestContract.coverageBoundary + 1;
      index < normalizedMigrations.length;
      index += 1
    ) {
      const directCount = directCounts.get(index) || 0;
      if (directCount === 1) {
        if (index !== coverageIndex + 1) {
          throw new Error(
            `production journal has ${normalizedMigrations[index].tag} but its historical prefix is incomplete`
          );
        }
        coverageIndex = index;
      }
    }

    return {
      coverageIndex,
      coverageTag:
        coverageIndex >= 0 ? normalizedMigrations[coverageIndex].tag : null,
      coverageWhen:
        coverageIndex >= 0 ? normalizedMigrations[coverageIndex].when : -1,
      legacyRowsVerified: legacyRows.length,
      profileId: manifest.profileId,
    };
  }

  if (legacyRows.length > 0) {
    throw new Error(
      "journal contains legacy rows but no legacy profile was activated"
    );
  }

  let coverageIndex = -1;
  for (let index = 0; index < normalizedMigrations.length; index += 1) {
    const directCount = directCounts.get(index) || 0;
    if (directCount === 1) {
      if (index !== coverageIndex + 1) {
        throw new Error(
          `journal has ${normalizedMigrations[index].tag} but its historical prefix is incomplete`
        );
      }
      coverageIndex = index;
    }
  }

  return {
    coverageIndex,
    coverageTag:
      coverageIndex >= 0 ? normalizedMigrations[coverageIndex].tag : null,
    coverageWhen:
      coverageIndex >= 0 ? normalizedMigrations[coverageIndex].when : -1,
    legacyRowsVerified: 0,
    profileId: null,
  };
}
