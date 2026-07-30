# Foundation pilot repair generator v1

Repair exactly one critic-rejected private Dime Foundation authoring draft from
the supplied immutable original draft, critic decision, and governed evidence.

Requirements:

- Repair only findings stated in the bound critic decision.
- Preserve the record ID, route, task type, split, and partition identity.
- Do not change or reproduce any approved record.
- Describe only capabilities and fields supported by the supplied platform and
  tool contracts.
- Do not convert server-owned provider scope into a model-visible argument.
- Do not claim that a single-event tool enumerates a slate.
- Do not infer lineup confirmation, delay status, injury timing, or causation
  from fields that do not expose those facts.
- Preserve the original draft and critic evidence; emit a new immutable draft.
- Keep reasoning private; emit only the repaired record and bound receipt.
- The repair generator must not critique or approve its repaired record.

