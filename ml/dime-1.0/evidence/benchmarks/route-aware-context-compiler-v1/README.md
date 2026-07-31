# Route-Aware Context Compiler v1 evidence

This directory records the sanitized local acceptance result for the additive,
inactive Route-Aware Context Compiler v1.

The evidence covers deterministic context packing, route isolation, temporal
provenance, contradiction preservation, deduplication safety, schema validity,
TypeScript compilation, the production build, and the complete Dime LLM Python
regression suite.

It does not contain prompts, responses, credentials, provider output, answer
keys, private Foundation records, or production data. It does not authorize
runtime integration, deployment, provider execution, tracing, route activation,
model download, evaluation execution, or training.

Reproduce from the repository root:

```bash
pnpm vitest run server/_core/dimeContextCompiler.test.ts
pnpm check
pnpm build
cd ml/dime-1.0
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest -q
```

The unscoped root `pnpm test` command also exercises integration tests that
intentionally require local databases, service credentials, Playwright browser
support, or network binding. Those environment-dependent failures are recorded
in `contract.json`; no credential-bearing retry was performed.
