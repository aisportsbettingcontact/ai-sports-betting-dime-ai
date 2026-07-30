# Dime shared agent access v1

## Purpose

This is the single access layer shared by Codex and Claude Code for recurring
Dime engineering work. It composes the existing read-only GitHub/Railway
capsule with identity-only provider diagnostics and explicit, role-separated
production login.

It removes repeated repository, PR/check, Railway topology, deployment, health,
and authentication discovery. It does not turn authentication into
authorization and it does not expose a remote write.

## Automatic context

Run:

```bash
pnpm agent:context
```

Codex is instructed through `AGENTS.md` to use this as its task entry point.
Claude Code runs the same command from
`.claude/scripts/bootstrap-dime-context.sh` on `SessionStart`. The Claude hook
never blocks a session when the network is unavailable; it reports a stale or
failed-closed state and exits successfully.

The command reuses:

```text
.cache/dime-control-plane/status-v1.json
.cache/dime-agent-access/identity-v1.json
.cache/dime-agent-access/credentials/<scope>.json
```

Both locations are ignored. Cache files and directories use mode `0600` and
`0700`, respectively. Every persisted cache or credential-evidence payload
must have a valid Ed25519 signature under a root-administered public key outside
the repository. If independent signing trust is unavailable, the live result
is not persisted. The five-minute GitHub/Railway capsule remains bound to the
exact target-manifest checksum, local branch, local HEAD, and dirty-state hash.
Each provider proof is separately bound to a minimal scope-specific contract
checksum, so an unrelated platform, cache, or provider edit cannot invalidate
every proof.

The automatic path reads no platform password, provider token, browser cookie,
Railway variable, database value, prompt, or response.

## Independent local trust

Same-user files and ad-hoc code signatures are never authorization roots.
Execution fails closed unless an independent administrator has provisioned:

- root-owned mode-`0444` SHA-256 pins beneath
  `/Library/Application Support/DimeAI/trust/executables/` for `node`, `env`,
  `git`, `gh`, and `aws`;
- the reviewed 1Password CLI signing identity
  `com.1password.op` / Team ID `2BUA8C4S2C`;
- the root-owned Railway broker pin
  `/Library/Application Support/DimeAI/trust/dime-railway-keychain.sha256`;
  and
- the root-owned cache-signing public key and a separately governed attestation
  writer described by the control-plane runbook.

Candidate generation cannot create this trust. Credential execution remains
`BLOCKED_PENDING_INDEPENDENT_ADMIN_PROVENANCE` until the external trust
artifacts exist and match. Cache writes are skipped when cache-signing trust is
unavailable.

## Pinned identities

The non-secret source of truth is
`config/dime-agent-access.v1.json`.

| Boundary              | Pinned identity                                                |
| --------------------- | -------------------------------------------------------------- |
| GitHub                | `aisportsbettingcontact/ai-sports-betting-dime-ai`             |
| Railway project       | `stunning-creativity` / `8dd7341d-702c-48c7-90df-5c19a4f04913` |
| Railway environment   | `production` / `787f3113-17ab-47d9-9819-1268aeb09b3e`          |
| Production platform   | `https://aisportsbettingmodels.com`                            |
| AWS                   | `us-west-2`, default SSO profile `dime-builder`                |
| Hugging Face owner    | `taileredsports`                                               |
| RunPod access check   | `GET /v1/endpoints` with bearer authorization only             |

Railway service IDs and expected sources remain pinned by
`config/dime-control-plane-targets.v1.json`.

## Credential law

Credential values are never committed, cached in the context capsule, written
to evidence, placed in an agent prompt, or printed by these commands.

1Password is the local broker for Hugging Face and RunPod. `op run` injects one
provider scope into one child process. Each runtime file is bound to an exact
reviewed vault, item, section, and field; it must be ignored, smaller than
8 KiB, and mode `0600`.

The production owner and user credentials remain solely as unreferenced Railway
shared variables. They are not referenced into the production application
service and are never copied to 1Password or a local environment file. On an
explicit login, the device-only Keychain broker captures Railway's JSON shared
variable read in a private pipe and selects the exact role triple inside the
native broker. It then sends only that triple to the fixed authentication child
through a second private pipe. The raw map is never written to standard output
or exposed to the agent or login process. Railway `shell` and `run` are not
used.

Do not create an all-provider environment file. The exact isolation boundaries
are:

| Scope                     | Ignored runtime reference file              |
| ------------------------- | ------------------------------------------- |
| RunPod permission-unverified | `.env.agent.runpod.1password`            |
| HF training read          | `.env.agent.hf-training.1password`          |
| HF serving read           | `.env.agent.hf-serving.1password`           |
| HF release publisher      | `.env.agent.hf-release-publisher.1password` |
| HF locked evaluator       | `.env.agent.hf-locked-evaluator.1password`  |
| HF locked publisher       | `.env.agent.hf-locked-publisher.1password`  |

Tracked provider reference-only templates live under
`config/agent-secret-templates/`. Copy only the needed provider template to the
repository root without changing its exact `op://` reference, and restrict it:

```bash
cp \
  config/agent-secret-templates/runpod.1password.env.example \
  .env.agent.runpod.1password

chmod 600 .env.agent.runpod.1password
```

Repeat only for needed scopes. A 1Password service account, when used, must be
restricted to the dedicated vault containing these items. Desktop integration
or service-account authentication is configured outside the repository.

The six platform names are exact:

```text
DIME_PROD_OWNER_EMAIL
DIME_PROD_OWNER_PASSWORD
DIME_PROD_OWNER_USERNAME
DIME_PROD_USER_EMAIL
DIME_PROD_USER_PASSWORD
DIME_PROD_USER_USERNAME
```

Those names must exist as unreferenced shared variables in the pinned Railway
production environment.
The raw Railway response is captured only inside the native broker. The broker
clears its raw buffer after selecting the exact role fields, clears selected
values after serializing the private child payload, and never emits either
payload to its own standard output. The login child rejects missing keys,
extra keys, empty values, malformed payloads, target drift, and oversized
responses before any browser operation.

## Read-only identity doctor

Run:

```bash
pnpm agent:doctor
```

It performs:

- the fresh checksum-bound GitHub/Railway capsule, refreshing it only when its
  five-minute TTL has expired;
- `op whoami` for service-account/session auth, with an authenticated
  `op vault list` desktop-app fallback, retaining only normalized account-host,
  auth-mode, and vault-count state;
- `aws sts get-caller-identity` through the allowlisted `dime-builder` or
  `dime` profile and retains only account/principal fingerprints;
- presence and permission-mode checks for each provider-only ignored 1Password
  reference file;
- the pinned Railway platform-credential source contract without resolving any
  value; and
- reads of prior scope-isolated Hugging Face and RunPod identity evidence.

It does not read a Railway credential value or automatically inject any
provider credential. If AWS SSO has expired, refresh it outside this tool:

```bash
aws sso login --profile dime-builder
```

Static `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and session credentials do
not belong in a Dime agent broker file.

## Scope-isolated provider proof

Use:

```bash
pnpm credential:verify -- --scope hf-training
pnpm credential:verify -- --scope hf-serving
pnpm credential:verify -- --scope hf-release-publisher
pnpm credential:verify -- --scope hf-locked-evaluator
pnpm credential:verify -- --scope hf-locked-publisher
pnpm credential:verify -- --scope runpod
```

Hugging Face proof requires the exact account, named credential, access-token
identity, and `fineGrained` role already defined in
`ml/dime-1.0/configs/platform_contract.json`. It uses the pinned
`https://huggingface.co/api/whoami-v2` identity endpoint so these fields remain
verifiable across local `hf` CLI output changes. RunPod proof performs one
read-only endpoint-list request to the official REST API with
`Authorization: Bearer`; the credential never appears in a URL. Only credential
presence and endpoint count are retained. That endpoint does not attest key
identity or grants, so the result is always
`CREDENTIAL_PRESENT_PERMISSION_UNVERIFIED`, with `identityVerified: false`,
`permissionsVerified: false`, and authorization `NONE`.

These commands prove identity only. They do not download a model, read a
dataset, enumerate RunPod resources, invoke an endpoint, start a Pod, publish,
or train. A publisher credential passing identity proof remains unauthorized
for a write until its independent release gate exists.

The training Pod continues to receive only `dime-training-read-v1` as
`HF_TOKEN`. It must never receive AWS credentials, the serving credential, a
publisher credential, or locked-evaluation credentials.

## Explicit production login

Headless identity verification:

```bash
pnpm platform:auth:owner
pnpm platform:auth:user
```

Human-visible production browser:

```bash
pnpm platform:auth:open:owner
pnpm platform:auth:open:user
```

The harness:

1. deletes any legacy role-specific storage-state artifacts before login;
2. pins the origin to `https://aisportsbettingmodels.com` and the login route
   to `/login`;
3. pins the Railway project and production environment before the native
   broker privately selects the exact-role credential triple;
4. rejects extra, missing, malformed, or oversized credential responses and
   otherwise makes exactly one credential login attempt;
5. verifies `appUsers.me` against the expected email, username, role, and
   access state;
6. holds cookies only in the current Playwright browser context; and
7. closes that context at command completion without writing storage state.

Legacy role-state removal remains available and is idempotent:

```bash
pnpm platform:auth:invalidate:owner
pnpm platform:auth:invalidate:user
```

No credential, cookie, storage state, email, username, raw Railway output, or
raw `appUsers.me` response is printed or persisted. Output contains only role,
status, side-effect state, source contract, and a short non-reversible identity
fingerprint. Each command makes exactly one credential login attempt and has no
automatic retry, preventing a bad secret from amplifying the production login
rate limiter.

## Failure handling

- Target, origin, role, provider-account, credential-name, or AWS-profile
  mismatch: fail closed.
- Railway project or environment mismatch: fail closed.
- Railway or filter-pipeline failure: report the role-scoped source failure
  without stdout or stderr from the secret-bearing command.
- Missing, extra, or malformed credential values: report names only.
- Any legacy browser state: delete locally before one verified login.
- Login identity mismatch: close the browser context without persisting it.
- Provider or network failure: retain no raw response and report a redacted
  error.
- Expired GitHub/Railway context: use the existing stale-capsule semantics and
  require refresh before any separately authorized write preflight.

## Authorization boundary

This layer never authorizes:

- merge or deployment;
- Railway variables, source, restart, redeploy, job, database, or migration
  changes;
- AWS provisioning or KMS use;
- Hugging Face download, publication, or visibility changes;
- RunPod endpoint invocation, Pod creation/start/stop, or template changes;
- model training or evaluation execution;
- tracing, route activation, shadow traffic, Research Alpha, or user-visible
  answer changes.

Every remote mutation still requires a separate, fresh,
operation-specific preflight and explicit authority.
