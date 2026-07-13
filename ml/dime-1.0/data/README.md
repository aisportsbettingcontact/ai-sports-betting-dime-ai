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

## Generating the dataset

`build_dataset.py` does all of the above from real `games` rows: context blocks
formatted byte-for-byte like `dimeChatContext.ts`, the system prompt extracted
from `dime1Model.ts` at build time, grounded answers computed deterministically
from row numbers, the category mix enforced, exact-duplicate examples dropped,
and a hard abort if any generated answer trips the certainty filter.

```bash
# from a JSON export of the games table:
python build_dataset.py --games games.json --target 4000 --seed 42

# or straight from the platform DB (pip install pymysql first):
DATABASE_URL='mysql://...' python build_dataset.py --from-db \
    --start 2026-04-01 --end 2026-07-12 --target 4000
```

Outputs `train.jsonl`, `val.jsonl` (stratified split), and
`dataset_manifest.json` (seed, counts, system-prompt hash — upload it next to
the eval report so every checkpoint's data is reproducible). All three are
git-ignored. If a category prints a "capped" warning, widen `--start/--end` to
feed it more game rows. Hand-written examples can be appended to `train.jsonl`
afterward — the format is identical.

## Auditing — the ship gate (required before every training run)

`audit_dataset.py` is the deterministic post-generation gate. It reads FULL
records (never previews — a `[:400]` terminal slice hides context rows and
produces false fabrication findings) and enforces the hard gates: grounding
(any team a verdict cites must be in that row's own context), math recompute
(implied% from the stated price, stated gap vs model−implied), verdict-sign
coherence (PLAY needs ≥2.0pp positive gap; "edge" claims need a positive gap),
extraction fidelity (non-null fields must be evidenced in the INPUT text),
certainty language, RG safety (helpline once, no picks), and a template-
duplication census (>20% verbatim reuse per category; the off-topic product
constant and the context acknowledgment are exempt by design).

```bash
python audit_dataset.py train.jsonl val.jsonl
# optional: write an untruncated dump for human/LLM row audits
python audit_dataset.py train.jsonl --dump-full full_dump.txt
```

Exit 1 = a SEV-1 gate failure = **DO-NOT-TRAIN**. Never start a training run
on a dataset that hasn't printed `VERDICT: TRAIN`.
