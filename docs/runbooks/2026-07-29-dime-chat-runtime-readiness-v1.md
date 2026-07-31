# Dime Chat Runtime Readiness v1

## Purpose

Runtime Readiness v1 gives owners one secret-safe view of the Dime Chat
application control plane. It reports configuration state; it does not activate
a provider, migrate a database, contact a model endpoint, or authorize Dime 1.0
training or serving.

The canonical query is the owner-only tRPC procedure:

```text
dimeRuntime.readiness
```

The companion non-authorizing engineering-control contract is:

```text
dimeRuntime.engineeringControl
```

It reports the failure taxonomy, product-route policies, controlled-agent
registry, release verdict vocabulary, and a stable route-policy hash. It
cannot start training, change a provider, promote a model, or authorize
serving.

The server also emits one bounded startup line:

```text
[DIME_RUNTIME] version=dime-chat-runtime-readiness-v1 state=limited mode=frozen routing=on trace=off issues=provider_frozen,trace_disabled
```

Neither surface includes endpoint URLs, credentials, prompts, user content, or
raw environment values.

## States

| State        | Meaning                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configured` | A generative lane passes its local configuration gate, Runtime Answer Routing is valid, and Trace v1 is enabled. Endpoint health and migration state still require separate probes. |
| `incomplete` | A generative lane passes its local gate, but routing, routing configuration, or Trace v1 is not fully configured.                                                                   |
| `limited`    | No generative lane is active, but deterministic routing/math responses remain available.                                                                                            |
| `offline`    | Neither generative responses nor deterministic routing/math responses are available.                                                                                                |

`limited` is the expected repository default while
`DIME_CHAT_LLM_PROVIDER="frozen"`.

## Configuration contract

### Runtime Answer Routing v1

- Variable: `DIME_ANSWER_ROUTING_V1_ENABLED`
- Unset default: enabled, preserving the shipped Runtime Answer Routing v1 behavior.
- Explicit rollback: `false` (case-insensitive, surrounding whitespace ignored).
- Any other configured value preserves the existing enabled behavior but is
  reported as `answer_routing_config_invalid`.

### Conversation Trace v1

- Variable: `DIME_CHAT_TRACE_V1_ENABLED`
- Enabled only when the exact trimmed value is `true`.
- Do not enable until migrations `0121_dime_conversation_trace_v1.sql` and
  `0122_dime_evidence_lifecycle_v1.sql` pass their preflight, migration, and
  post-migration checks. Migration 0122 must precede the Phase 1 application
  deployment; trace activation remains a later, independently gated change.

### Research Alpha

Runtime Readiness delegates to the existing fail-closed Research Alpha gate. It
reports only whether activation was requested, whether the kill switch is
engaged, whether the gate is active, and a bounded inactive reason.

It never returns:

- `DIME_MODEL_BASE_URL`
- `RUNPOD_ENDPOINT_ID`
- `DIME_MODEL_API_SECRET`
- `RUNPOD_API_KEY`
- any Anthropic credential

## Issue codes

| Code                               | Operator action                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `provider_frozen`                  | Expected until a separately authorized provider transition. Do not bypass the hardcoded freeze through environment configuration. |
| `answer_routing_disabled`          | Confirm an intentional rollback; restore the variable to `true` or remove it after the incident.                                  |
| `answer_routing_config_invalid`    | Correct the variable to `true` or `false`.                                                                                        |
| `trace_disabled`                   | Required through migration 0122 and disabled-state parity; otherwise verify the single-writer Railway environment.                |
| `research_alpha_config_incomplete` | Compare the environment with the Research Alpha gate contract; do not log secret values.                                          |
| `dime_endpoint_missing`            | Configure the approved private endpoint only after the applicable authorization.                                                  |
| `dime_endpoint_credential_missing` | Configure the approved secret through the deployment platform; never commit it.                                                   |
| `anthropic_credentials_missing`    | Required only if a code-authorized provider transition selects Anthropic.                                                         |

## Verification

From the repository root:

```bash
pnpm exec vitest run server/_core/dimeRuntimeReadiness.test.ts
pnpm run check
pnpm run build
pnpm run check:bundle
```

For an environment rollout:

1. Deploy without changing provider, Trace, or Research Alpha flags.
2. Confirm the startup line contains no raw configuration.
3. Query `dimeRuntime.readiness` as an owner.
4. Confirm unauthenticated and non-owner callers are rejected by
   `ownerProcedure`.
5. Compare the reported mode and issues with the intended environment.
6. Roll back the deployment if diagnostics expose restricted values or disagree
   with the intended control-plane state.

## Authorization boundary

This diagnostic contract does not change the governed
`ml/dime-1.0/configs/platform_contract.json`. Training, locked evaluation,
adapter publication, serving, and provider activation remain separate,
owner-authorized transitions.
