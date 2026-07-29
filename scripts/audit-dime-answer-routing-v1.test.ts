import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRuntimeAnswerRoutingAudit } from "./audit-dime-answer-routing-v1";

describe("Runtime Answer Routing v1 evidence", () => {
  it("reproduces the tracked deterministic local baseline", () => {
    const reportPath = resolve(
      "ml/dime-1.0/evidence/benchmarks/runtime-answer-routing-v1/local-baseline.json"
    );
    const tracked = JSON.parse(readFileSync(reportPath, "utf8"));

    expect(buildRuntimeAnswerRoutingAudit()).toEqual(tracked);
    expect(tracked.summary.deterministic_local_baseline_pass).toBe(true);
    expect(tracked.summary.production_promotion_authorized).toBe(false);
    expect(tracked.post_deploy_live_metrics.measurement_status).toBe("pending");
  });
});
