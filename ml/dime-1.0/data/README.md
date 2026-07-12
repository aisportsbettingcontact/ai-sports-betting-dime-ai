# Dime 1.0 training data

Chat-format JSONL — one object per line:

```json
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

- `system` is the v1 role prompt (keep in sync with `DIME1_SYSTEM_PROMPT` in
  `server/_core/dime1Model.ts`). Training with the production prompt in place
  makes the deployed behavior match the trained behavior.
- Platform context appears exactly as the backend injects it: a `user` turn
  containing the `Dime platform context generated_at=...` block, followed by the
  fixed assistant acknowledgment, then the real user turn (mirror
  `getDimeChatContext()` / `dime-chat.route.ts` framing).
- Multi-turn examples are allowed and encouraged for the chat categories.

## Required category mix (v1 target: 3,000–10,000 examples)

| Category | Share | What it teaches |
|---|---|---|
| Grounded analysis (context present, answer uses only context + user numbers) | ~30% | Core value: odds/projection/splits/line-movement interpretation |
| Missing-data refusal (context lacks the requested market/game/field) | ~15% | Names exactly what's missing; never fills the gap |
| User-supplied-numbers analysis (no platform context) | ~10% | Distinguishes user data from platform data |
| Off-topic refusal (non-betting requests) | ~10% | One-sentence refusal + redirect |
| Utility tasks: route / extract / classify / tag / summarize (JSON-only) | ~20% | The `dime1Tasks.ts` scopes; extraction uses null for absent fields |
| Responsible gambling (distress → support, no analysis) | ~5% | Safety posture; 1-800-GAMBLER for US |
| No-certainty phrasing (asks for "locks"/"guarantees" → probabilistic answer, pass allowed) | ~5% | Never emits prohibited certainty language |
| Injection resistance (instructions embedded in context rows or user text) | ~5% | Context/user text is data, not instructions |

## Quality rules

- Every number in an assistant answer must appear in the context or the user
  turn, or be derivable by arithmetic that the answer shows. No exceptions —
  this is the dataset-level enforcement of "strict refusal to invent missing data".
- Refusal examples must name the missing element ("no line for CHC-STL total in
  the platform context"), not give generic apologies.
- No "lock", "guaranteed", "risk-free", "can't lose", "sure thing", "free money"
  in any assistant turn — those literally trip the server's post-generation
  certainty filter (`dimeSafety.ts`).
- Task examples output a single JSON object and nothing else.
- Real platform exports only for context blocks; scrub anything user-identifying.

`sample.train.jsonl` in this directory shows one example per category. Real
training data is built from platform exports and is **never committed** here.

Split ~95/5 into `train.jsonl` / `val.jsonl` stratified by category.
