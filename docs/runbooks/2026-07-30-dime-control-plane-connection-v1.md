# Dime control-plane connection v1

## Purpose

This connection is the single read-only entry point for recurring GitHub and
Railway context. It replaces repeated repository discovery, Railway linking,
service selection, deployment inspection, public health probing, PR lookup, and
check-rollup collection with one checksum-bound context capsule.

Codex and Claude Code consume this capsule through the broader
[Dime shared agent access v1](2026-07-30-dime-agent-access-v1.md) entry point.

It does not replace GitHub Actions, deployment approval, migration approval, or
an operation-specific production preflight.

## Quick start

```bash
# Normal entry point. Reuses a fresh five-minute capsule.
pnpm connection:status

# Token-lean, one-line machine context for Codex and automation.
pnpm connection:context

# Full machine-readable evidence when deeper inspection is necessary.
pnpm connection:status -- --json

# Force live identity, topology, deployment, and health validation.
pnpm connection:doctor

# Validate and inspect the pinned non-secret targets without network calls.
pnpm connection:targets -- --json

# Focused local tests.
pnpm connection:test
```

The ignored local capsule is:

```text
.cache/dime-control-plane/status-v1.json
```

It is written atomically with mode `0600`, tied to the SHA-256 of the target
manifest, and considered fresh for 300 seconds. Concurrent refreshes use an
expiring local lock so parallel tasks do not repeat the same remote reads.

## Pinned connection

The reviewed source of truth is
`config/dime-control-plane-targets.v1.json`.

| System              | Pinned identity                                                           |
| ------------------- | ------------------------------------------------------------------------- |
| GitHub              | `aisportsbettingcontact/ai-sports-betting-dime-ai`, default branch `main` |
| Railway workspace   | `aisportsbettingcontact` / `fa75c735-e8e5-4d7c-a293-c8c056d95429`         |
| Railway project     | `stunning-creativity` / `8dd7341d-702c-48c7-90df-5c19a4f04913`            |
| Railway environment | `production` / `787f3113-17ab-47d9-9819-1268aeb09b3e`                     |
| Application service | `ai-sports-betting-dime-ai` / `a46ea921-5c5d-4225-9254-92f742e95b51`      |
| Backend service     | `ai-sports-betting-backend` / `3528dc9f-a63b-45e9-94bb-6d1df25d6f3a`      |
| Database service    | `MySQL: Dime AI` / `a48cf462-136a-4d9b-b427-00504927116a`                 |

Transient deployment IDs and commit SHAs are deliberately not pinned. The
command reads and compares them with the current GitHub `main` SHA on refresh.

## Safety model

The command:

- invokes executables directly with no shell;
- accepts no repository, project, environment, service, URL, or command
  override;
- validates the local `origin` before remote inspection;
- passes explicit Railway project, environment, and service IDs every time;
- retrieves the Railway credential only inside the signed, mode-`0500`
  `dime-railway-keychain` broker from a device-only, non-synchronizing macOS
  Keychain item;
- verifies the Railway workspace, project name, environment name, service
  names, application sources, and database image family;
- stores only normalized metadata, health digests, status codes, and latency;
- never stores CLI output, credentials, environment variables, prompts,
  responses, database data, or health-response bodies;
- refuses stale cache as fresh and labels fallback state `STALE`;
- redacts credential-shaped text from reported errors.

Only these secure Railway broker forms exist in the implementation:

```text
dime-railway-keychain status
dime-railway-keychain project status --project <pinned>
  --environment <pinned> --json
dime-railway-keychain deployment list --project <pinned>
  --environment <pinned>
  --service <pinned> --limit 1 --json
dime-railway-keychain variable list --project <pinned>
  --environment <pinned> --json
```

The connection capsule never calls the shared-variable form. It exists only as
the source side of the explicit production-login pipeline: raw stdout is piped
directly into the reviewed exact-role filter, and no raw variable map enters
the agent process or cache. There is no implementation for `link`, `connect`,
`run`, service-scoped variables, `up`, `redeploy`, restart, delete, database
access, or source changes.

The broker directory is mode `0700`; the executable is mode `0500`.
Railway CLI subprocesses receive a separate mode-`0700` broker home, preventing
them from reading or repopulating the user's normal `~/.railway` state.
`~/.railway/config.json` is retained only as a non-secret CLI configuration
file and must not contain `accessToken`, `refreshToken`, or token-expiry state.

## Capsule semantics

The JSON capsule includes:

- local branch, exact HEAD, origin, and dirty-path count;
- GitHub viewer, exact default-branch SHA, current branch PR, and compact check
  counts;
- verified Railway workspace/project/environment/service identities;
- latest deployment ID, status, source, branch, and commit for all three
  services;
- public application/backend health status, latency, and response-body SHA-256;
- exact application/backend/GitHub-main deployment parity;
- cache generation, expiration, age, freshness, and manifest checksum;
- the explicit `read-only` safety state.

`connection: PASS` means the credentials and pinned identities were verified.
It does not mean production is healthy. `productionState: ATTENTION` means the
connection succeeded but deployment parity, deployment success, or a public
health check needs review.

## Refresh policy

Use the cached capsule when it is fresh. Force a refresh only when:

1. a merge or deployment has just occurred;
2. the five-minute TTL expired;
3. current production state is explicitly requested;
4. a repository, identity, health, or deployment mismatch is suspected; or
5. a separately authorized remote mutation is about to receive its own fresh
   operation-specific preflight.

A remote mutation is never authorized by this connection, its cache, a passing
doctor, a passing check rollup, or deployment parity.

## Failure handling

- Identity or topology mismatch: fail closed and do not replace the cache.
- Remote refresh failure with a prior capsule: return the capsule labeled
  `STALE`, include a redacted refresh error, and exit nonzero.
- Remote refresh failure without a prior capsule: fail with no inferred state.
- Manifest change: invalidate the old capsule automatically because its
  checksum no longer matches.
- Interrupted writer: atomic rename preserves the previous complete capsule.
- Abandoned lock: remove it only after its reviewed maximum age.

To remove only the local ignored cache:

```bash
node scripts/dime-control-plane.mjs invalidate-cache
```

## Change control

Changes to any target ID, expected source, safety field, command form, cache
semantics, or health endpoint require normal code review. Do not add remote
mutation behavior to this tool. Build a separately authorized, narrowly scoped
operator path for a write and require a fresh preflight immediately before it.
