# Llama 3.1 Release Checklist

This is an operational checklist, not legal advice.

Before uploading an adapter or derivative:

1. Review the exact [Meta Llama 3.1 Community License](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE).
2. Review the exact [Llama 3.1 Acceptable Use Policy](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/USE_POLICY.md).
3. Place an unmodified, reviewed copy of the applicable license at the release
   root as `LICENSE`.
4. Complete the release `NOTICE`, including the required Llama attribution.
5. Confirm the derivative model name begins with `Llama`.
6. Include “Built with Llama” and an AI-generated-output disclosure in the model
   card and product.
7. Review the base-model, adapter, code, dataset, teacher-output, feed, and
   evaluation rights together.
8. Bind the human approval to the exact source, data, locked-evaluation, base,
   experiment, evaluator, prompt, tool, schema, configuration, model, bundle,
   and evaluation identities using `RELEASE_ATTESTATION_TEMPLATE.json`.
9. Verify the published release by the full returned Hugging Face commit SHA
   and preserve a publication receipt with its exact remote inventory and
   post-upload hashes.

The publisher fails closed if these release artifacts and approvals are absent.
