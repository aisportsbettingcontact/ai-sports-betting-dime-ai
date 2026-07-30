# Dime repository operating context

For GitHub, Railway, platform, AWS, Hugging Face, 1Password, or RunPod work,
begin with:

```bash
pnpm agent:context
```

This composes the exact GitHub/Railway capsule with the shared, sanitized agent
access state. It validates the repository, Railway workspace/project/production
environment/services, reads only cached provider identity evidence, and reports
which scope-isolated 1Password reference files are configured. Claude Code also
runs this command through a non-blocking `SessionStart` hook. Use the returned
five-minute capsule for the entire task while it is fresh.

Operating rules:

- Consume the fresh capsule instead of repeating repository, authentication,
  topology, deployment, health, PR, and check discovery.
- Use `pnpm agent:context -- --refresh` only when the capsule expired, a merge
  or deployment just occurred, the user requests current state, or an identity
  or parity mismatch is suspected. Use `pnpm agent:doctor` only for a live,
  read-only identity preflight.
- Reuse a successful GitHub check rollup only for the exact recorded commit SHA.
  New local changes still require focused validation and the required GitHub
  checks after push.
- Never use an implicit local Railway link for this repository. The reviewed
  broker passes explicit project, environment, and service IDs. Railway
  credentials are device-only in macOS Keychain and are retrieved only inside
  the signed `dime-railway-keychain` executable; `~/.railway/config.json` must
  contain no access or refresh token.
- Never print, persist, or place Railway variables in an agent environment. On
  an explicit production login, a shell-free child pipeline sends the pinned
  unreferenced shared-variable response directly into an ephemeral filter; only
  the requested role's exact three reviewed values reach the login process.
- Platform login is explicit. For production UI work run
  `pnpm platform:auth:owner` or `pnpm platform:auth:user`; use the headed
  variants only when a human-visible browser is needed. The harness attempts at
  most one credential login, verifies `appUsers.me`, and retains cookies only
  inside the current browser process. Browser storage state is never written to
  disk or reused.
- Verify Hugging Face or RunPod credentials only through
  `pnpm credential:verify -- --scope <reviewed-scope>`. Each scope has its own
  1Password process; never combine training, serving, publisher,
  locked-evaluator, RunPod, or AWS credentials.
- AWS uses the reviewed `dime-builder` SSO profile by default. Do not add static
  AWS access keys to repository or broker files.
- A passing connection is evidence of identity and read access. It is never
  authorization to merge, deploy, redeploy, restart, change variables, run a
  job, access the database, migrate, roll back, or alter a Railway source.
- A passing credential or production-login verification never authorizes
  provider execution, model download, publication, training, tracing, route
  activation, shadow traffic, or Research Alpha.
- Before any separately authorized remote mutation, bypass the cache and
  perform a fresh, operation-specific preflight. Do not add mutation behavior
  to either shared access script.
