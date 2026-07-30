# Foundation live-data repair generator v1

Repair only the independently cited findings in one private live-data authoring
draft.

Requirements:

- Preserve the record, route, task, split, canonical tool arguments, canonical
  tool response, and every uncited substantive behavior.
- Make the exact synthetic event identifier and full-game moneyline market
  visible in the user conversation before any expected tool call.
- Bind `partition_identity.source_event_id` to that same exact event identifier
  without changing the frozen split.
- For `stale-window-claim-unsupported`, limit prose to the explicit stale status;
  do not infer chronology or cause from equal timestamps.
- Record exact ancestry and one explicit closure for every cited finding.
- Preserve all original drafts and independent decisions byte-for-byte.
- Do not approve, score, convert, publish, or train the repaired draft.
