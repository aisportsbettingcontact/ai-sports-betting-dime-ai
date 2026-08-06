# Dime Conversation Trace v1

## Outcome

Trace v1 makes Railway the authoritative record for an authenticated Dime Chat
turn. It captures the accepted user prompt before inference, every model
attempt, the exact bounded platform context supplied to that attempt, provider
and model identity, raw provider output, validation decisions, the exact text
served to the user, token/latency metrics, and terminal outcome.

This removes the data-loss window created by browser-only, post-stream history
writes. It also creates trustworthy evidence for quality evaluation without
silently turning private conversations into training data.

## Ownership boundaries

| System              | Owns                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Browser             | Opaque UUIDs for session, turn, message, and request replay correlation                                                      |
| Railway application | Authentication, authorization, canonical prompt capture, provider call, output gates, user-visible response, trace lifecycle |
| Railway database    | Chat history, sessions, turns, generations, append-only events                                                               |
| RunPod              | Private inference only; it is not the system of record                                                                       |
| GitHub              | Code, schemas, migrations, tests, contracts, and aggregate evidence                                                          |
| Hugging Face        | Approved immutable datasets and promoted adapters only                                                                       |

The browser never supplies `userId`. Railway binds every opaque browser ID to
the authenticated `app_user`.

## Canonical flow

1. Authenticate, authorize, rate-limit, sanitize, and validate the request.
2. When `DIME_CHAT_TRACE_V1_ENABLED=true` and the request has a valid v1
   envelope, start one database transaction.
3. Upsert the browser session under the authenticated user.
4. Lock the owned thread, or create a new one.
5. Persist the exact sanitized conversation transcript accepted by the server,
   its hash, the user prompt, logical turn, first generation attempt, request
   fingerprint, worker lease, and `prompt_persisted` event.
6. Commit. Only now may a provider be called.
7. Capture the exact bounded platform-context snapshot before inference.
8. Call the selected provider.
9. Validate the raw response and apply responsible-gambling/certainty gates.
10. In one transaction, persist the restricted raw output, exact served output,
    gate outcome, usage, latency, assistant history message, and terminal event.
11. Commit. Only now may response text be sent to the browser.

If canonical persistence fails before inference, the server returns `503` and
makes no provider call. If final persistence fails after inference, the server
withholds the unrecorded output.

## Data model

### `dime_chat_sessions`

Maps one opaque browser session UUID to the authenticated user and records the
policy version. No cookie, token, email, username, or IP address is copied into
the trace.

### `dime_chat_turns`

Represents one user prompt. Retries do not duplicate the prompt; they create a
new generation attempt under the same turn.

### `dime_chat_generations`

Represents one provider attempt. It records:

- request and idempotency IDs;
- the requested-thread value and a fingerprint of the full accepted request;
- attempt number;
- provider, deployment tier, endpoint source, requested and actual model;
- base, adapter, source-commit, profile, prompt, and blueprint identity;
- the exact sanitized browser transcript plus hash;
- exact bounded platform context plus hash and row count;
- restricted raw output and exact served output;
- validation errors and prohibited-certainty result;
- finish reason, token counts, latency, error class, and terminal status;
- the 90-day restricted-payload purge deadline.
- the worker lease deadline used to recover abandoned attempts.

### `dime_chat_trace_events`

Append-only, content-free lifecycle facts: prompt persisted, context captured,
retry started, safety intervention, completed, blocked, failed, or aborted.

### `dime_chat_messages`

Remains the user-visible history source. Trace v1 adds nullable session, turn,
client-message, generation, and content-hash links. Existing rows remain valid.
The router never exposes restricted raw output or context.

## Idempotency and concurrency

- `(userId, idempotencyKey)` is unique per generation request.
- The same key and same input replays the persisted served response without a
  second provider call.
- The fingerprint covers the full accepted transcript, prompt, requested
  thread, request class, response budget, and provider identity. The same key
  with a different fingerprint is a `409` conflict.
- A running duplicate is a `409`; it cannot start a second provider call.
- Manual Retry creates the next attempt under the same turn.
- Retry is permitted only from a failed or aborted attempt. Completed and
  blocked attempts cannot be mutated into retries.
- A generating attempt whose 30-minute worker lease expires is failed under
  the thread lock before a new attempt may begin.
- Thread rows are locked while allocating message sequence numbers.
- `(threadId, seq)` is a database-enforced unique invariant.
- The legacy compatibility writer uses the same row lock until it is removed.

## Privacy and training boundary

User-visible chat history supports the product. Restricted accepted-history
snapshots, bounded context snapshots, raw provider outputs, and validation
details have a 90-day purge deadline. The designated Railway writer runs a
daily sanitizer that clears those restricted payloads after the deadline while
retaining content hashes and non-content operational metrics.

Trace rows are **evaluation evidence, not training authorization**. They may be
used to measure failures and nominate correction candidates. A
conversation-derived example can enter training only after a separate process
proves:

1. explicit training consent;
2. deidentification and secret/PII scanning;
3. rights and purpose review;
4. human review of the exact example;
5. conversation/user/event partition isolation;
6. approval into an immutable dataset revision.

The Foundation rule remains: do not bulk-train raw chats.

## Response and delivery semantics

`servedOutput` is the exact response selected by the server and written to the
SSE stream after canonical finalization. It does not prove that the browser or
end user received the final byte. A content-free `response_dispatched` event
records that the server attempted the SSE write with delivery marked
`unknown`. Browser receipt must not be inferred from that event.

After Trace begins, JSON failures include the `X-Dime-Trace-Version: 1`
capability header and canonical trace metadata. This lets the browser bind the
failure to the correct turn and retry safely without falling back to a stale
request.

## Safe production rollout

The order is mandatory because application code may deploy automatically while
database migration is manual.

### Phase 1 — Merge with Trace disabled

1. Merge the code and migration.
2. Keep `DIME_CHAT_TRACE_V1_ENABLED` absent or `false` in Railway.
3. The new client sends additive trace metadata, but the server stays on the
   legacy history path. No new table is accessed.

### Phase 2 — Read-only production preflight

Run **DB Query (read-only)** from GitHub Actions with mode
`dime-trace-v1`.

Required pre-migration result:

- `duplicate_thread_seq_pairs = 0`;
- `trace_v1_tables_present = 0` (or `4` only if the migration already ran);
- the old non-unique sequence index may still be present.

If duplicate pairs are nonzero, stop. Do not delete or rewrite rows inside this
rollout. Investigate and approve a separate repair.

### Phase 3 — Apply migration

Run **DB Push (apply schema migrations)** manually from GitHub Actions.
Migration `0121_dime_conversation_trace_v1.sql` adds the unique sequence
constraint before dropping the old index, so duplicate data fails closed.

Do not run `drizzle-kit push` directly against production.

### Phase 4 — Post-migration verification

Run **DB Query (read-only)** again with mode `dime-trace-v1`.

Required result:

- `duplicate_thread_seq_pairs = 0`;
- `trace_v1_tables_present = 4`;
- `uq_dime_chat_messages_thread_seq` exists with `non_unique = 0`;
- the old `idx_dime_chat_messages_thread_seq` is absent.

### Phase 5 — Activate one writer

Set `DIME_CHAT_TRACE_V1_ENABLED=true` only on the Railway service that handles
Dime Chat and owns the retention scheduler. Keep background jobs disabled on
the separate web-only/backend service. Redeploy the same reviewed commit.

### Phase 6 — One controlled live turn

From an authenticated Dime Chat account:

1. send one harmless platform question;
2. confirm the SSE `meta` frame contains Trace v1 IDs;
3. refresh the page and confirm the prompt and response reload;
4. run the read-only verification query/report;
5. confirm exactly one session, turn, generation attempt, user message, and
   assistant message were created;
6. retransmit the same idempotency key only in a controlled test and confirm no
   second generation was created.

Do not print prompt text, raw output, cookies, credentials, or database URLs in
CI logs.

## Rollback

Set `DIME_CHAT_TRACE_V1_ENABLED=false` and redeploy. The client returns to the
legacy compatibility writer. Do not roll back or drop the additive tables.
Recorded traces remain available for authorized retention/deletion handling.

## Compatibility removal criterion

Delete `dimeChats.create` / `appendMessages` browser fallback only after:

1. the migration and flag are stable in production;
2. Trace v1 capture succeeds for the agreed observation window;
3. no new legacy-only messages appear;
4. refresh/resume, retry, abort, blocked-response, and outage cases pass.

That removal is a separate focused PR.

## Capability-improvement handoff

Trace v1 enables a measurable improvement loop:

1. aggregate failure types without exporting raw conversations;
2. build a deidentified, reviewed candidate queue;
3. add reproducible failures to development evaluation first;
4. write or approve corrected target responses;
5. train a versioned adapter on the approved dataset only;
6. compare base, prior adapter, and candidate on locked gates;
7. promote only if the candidate improves Dime-specific quality without safety,
   grounding, math, privacy, or regression failures.

“GPT-5.6-Sol quality” is a benchmark target, not a model identity claim. Dime
must be measured on platform grounding, correct tool use, quantitative
reasoning, calibrated uncertainty, betting-coach usefulness, safety, and
communication. An 8B model is not declared equivalent to a frontier model
unless an approved benchmark proves the specified behaviors.
