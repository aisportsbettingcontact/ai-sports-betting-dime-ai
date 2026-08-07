/**
 * buildIdentity — lets the running server say which commit it is.
 *
 * Incident 64: the repository moved between GitHub accounts, Railway silently
 * stopped receiving push events, and PR #432 merged without deploying. The
 * `deploy-smoke` workflow ran against the live origin and reported SUCCESS —
 * production was healthy, serving the PREVIOUS commit. Every assertion it made
 * was true and the conclusion it drew was false.
 *
 * It could not have done better: `/health` returned {db, integrations, schema,
 * status, ts} and nothing in that response identified the build. "The origin is
 * healthy" and "the thing I just built is what is answering" are different
 * claims, and only the first was checkable.
 *
 * This module makes the second one checkable. See
 * os/memory/lessons/a-healthy-origin-is-not-a-new-deploy.md.
 */

/**
 * Environment variables that may carry the deployed commit, most authoritative
 * first. `RAILWAY_GIT_COMMIT_SHA` is Railway-provided
 * (docs.railway.com/variables/reference#git-variables); the rest are fallbacks
 * for other runners and for local `docker run`.
 */
export const COMMIT_ENV_VARS = [
  "RAILWAY_GIT_COMMIT_SHA",
  "GIT_COMMIT_SHA",
  "SOURCE_COMMIT",
  "GITHUB_SHA",
] as const;

/** A git object name: 7–40 hex characters. Anything else is not a commit. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * The commit this process was built from, or `null` when it cannot be known.
 *
 * `null` is a real answer and must stay one. Returning a placeholder — "unknown",
 * the empty string, a package version — would let a smoke test assert equality
 * against a value that means "I have no idea", which is precisely the false
 * green this exists to prevent. A caller that gets `null` should say so loudly
 * rather than proceed.
 */
export function readBuildCommit(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const name of COMMIT_ENV_VARS) {
    const raw = env[name]?.trim();
    if (raw && SHA_PATTERN.test(raw)) return raw.toLowerCase();
  }
  return null;
}

/**
 * Do two commit references describe the same commit?
 *
 * Git abbreviates: CI may hold a full 40-character SHA while the runtime was
 * given a 7-character one, or vice versa. Comparing with `===` would report a
 * mismatch for two names of the same commit — a false alarm on the deploy path,
 * which is worse than useless because it trains people to ignore the check.
 * Prefix comparison on the shorter of the two is the correct relation.
 */
export function commitsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!SHA_PATTERN.test(x) || !SHA_PATTERN.test(y)) return false;
  const n = Math.min(x.length, y.length);
  return x.slice(0, n) === y.slice(0, n);
}
