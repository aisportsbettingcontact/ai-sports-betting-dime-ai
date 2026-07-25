# Llama 3.1 Release Checklist

This is an operational checklist, not legal advice.

Before uploading an adapter or derivative:

1. Review the exact [Meta Llama 3.1 Community License](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE).
2. Review the exact [Llama 3.1 Acceptable Use Policy](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/USE_POLICY.md).
3. Place an unmodified, reviewed copy of the applicable license in the release
   artifact as `LICENSE.llama3.1`.
4. Complete the release `NOTICE`, including the required Llama attribution.
5. Confirm the derivative model name begins with `Llama`.
6. Include “Built with Llama” and an AI-generated-output disclosure in the model
   card and product.
7. Review the base-model, adapter, code, dataset, teacher-output, feed, and
   evaluation rights together.
8. Bind the human approval to the exact artifact and evaluation hashes using
   `RELEASE_ATTESTATION_TEMPLATE.json`.

The publisher fails closed if these release artifacts and approvals are absent.
