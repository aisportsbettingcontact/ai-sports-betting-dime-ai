# WC2026 migration-chain reconciliation

Status: proposed for independent migration review. This document authorizes no
production migration, deployment, feature activation, or journal mutation.

## Decision

Preserve all historical migration files and all production journal rows. Repair
fresh-database replay with a guarded runner that temporarily parks the canonical
`wc2026_matches` table immediately before migration `0104`, then restores it
immediately after migration `0107`.

## Verified root cause

- `0097_happy_yellow_claw` creates the canonical domain table
  `wc2026_matches` with primary key `match_id`.
- `0104_outgoing_night_thrasher` creates an unrelated ESPN scraper table under
  the same name, with primary key `id` and unique external key `matchId`.
- `0106_espn_table_renames` is a no-op journal marker whose comments record an
  out-of-band rename.
- `0107_majestic_kinsey_walden` creates the final `wc2026_espn_*` tables and
  drops the temporary unprefixed ESPN tables.
- `0108_adopt_8_orphan_tables` is also a no-op marker for tables that were
  created out-of-band. Migration `0109` immediately alters one of those
  adopted tables, so a fresh replay must materialize the immutable `0108`
  snapshot before continuing.
- A direct fresh replay therefore stops at `0104` before reaching `0122`.

## Sanitized production evidence

Observed read-only on 2026-07-30:

- Production journal includes the repository hashes for `0104` through `0108`.
- Production journal contains 14 legacy rows whose timestamps are not present
  in the current repository journal. Five retain exact repository migration
  hashes under shifted timestamps; one is the explicit
  `uq_me_natural_key_0110_blushing_silver_sable` marker; the remaining rows are
  synthetic or manual baseline markers.
- Thirteen current repository timestamps through `0121` are absent from the
  production journal. This is journal drift caused by historical baselining,
  renumbering, and out-of-band schema adoption—not evidence that `0122` ran.
- Production contains both the canonical `wc2026_matches` shape and the ESPN
  `wc2026_espn_matches` shape.
- The canonical table uses `match_id`; the ESPN table uses `espn_match_id`.
- `provider_observed_at` column count is zero.
- Latest migration hash is
  `7c17edb8ddfce62b95f4a5615279d62af574ef5b998ebdd95b6cd8769eb80537`
  at `created_at=1785292771387` (`0121`).
- Migration `0122` remains unapplied.

No row contents, credentials, prompts, responses, or user data were captured.

## Compatibility behavior

The bridge runs only when the corresponding historical migration is pending:

1. Before `0104`, verify `wc2026_matches` has the canonical `match_id` shape.
2. Rename it to `wc2026_matches_canonical_bridge`.
3. Apply unchanged migrations `0104` through `0107`.
4. Verify `0107` removed the temporary ESPN `wc2026_matches`.
5. Rename the parked canonical table back to `wc2026_matches`.
6. Before `0109`, materialize only the nine tables present in the immutable
   `0108` snapshot but absent from the historical SQL chain.
7. Continue the unchanged migration history.

An existing production journal at `0121` skips both bridge points and leaves the
production schema and journal untouched.

The runner validates the complete journal before planning or applying work.
Normal repository histories must form an unbroken prefix of the immutable
migration sequence. A valid maximum timestamp cannot conceal a missing earlier
migration, and pending work is selected from the verified prefix boundary—not
from the largest observed timestamp.

The Railway production history is a closed, named profile. Its 14 legacy rows
are pinned as an exact `(createdAt, hash)` multiset in
`drizzle/meta/production_legacy_journal.json`. Missing, additional, or
duplicated legacy rows fail closed. The manifest also declares every repository
timestamp that production legitimately lacks and maps it to a pinned baseline,
shifted-hash row, or manual marker with an explicit coverage boundary. All
other repository migrations through `0121` must be present exactly once.

The manifest is recognition-only: the runner never writes, deletes, renumbers,
or repairs its rows. Railway entry points force
`JOURNAL_PROFILE=railway-production-v1`; fresh development and CI databases use
automatic repository-prefix detection.

## Failure behavior

The runner fails closed when:

- the database journal is ahead of the requested target;
- a row is absent from both the repository journal and the exact pinned legacy
  manifest;
- the observed legacy-row multiset differs from the complete pinned multiset;
- a legacy mapping names the wrong migration or timestamp;
- a manual schema marker has no explicit coverage boundary;
- a repository migration through the verified profile boundary is missing
  without an explicit manifest explanation;
- any direct repository row is duplicated;
- the observed repository rows do not form a complete historical prefix;
- any recorded migration hash differs from the immutable repository file;
- either table has an unexpected identity shape;
- canonical and parked tables coexist ambiguously;
- the expected table is missing at a bridge boundary;
- a migration statement fails;
- the final journal timestamp differs from the requested target; or
- the canonical table is not restored at completion.

`MODE=plan` is the default and performs no writes. Applying requires both
`MODE=apply` and `CONFIRM=RECONCILE`.

## Required independent gates

- Fresh MySQL 8 replay through `0121`
- `0122` application
- `0122` rollback and repeated rollback
- Production-schema clone replay
- Known production journal no-op through `0121`
- Application database tests
- TypeScript, Vitest, build, security, and secret-scan checks

Production remains blocked until these gates pass and an independent migration
reviewer explicitly approves the resulting PR.
