import { describe, expect, it } from "vitest";
import { DIME_PRODUCT_ROUTES } from "../server/_core/dimeEngineeringControl";
import { buildDimeProductRouteAudit } from "./audit-dime-product-routes-v1";

describe("Dime product-route observational audit", () => {
  it("produces per-route metrics and a complete nine-by-nine confusion matrix", () => {
    const report = buildDimeProductRouteAudit() as {
      aggregate: {
        sample_count: number;
        route_accuracy: number;
        required_tool_policy_compatibility: number;
      };
      per_route: Record<string, { sample_count: number }>;
      confusion_matrix: Record<string, Record<string, number>>;
      failures: unknown[];
      authorization: { activates_routes: boolean };
    };

    expect(report.aggregate.sample_count).toBeGreaterThanOrEqual(18);
    expect(report.aggregate.route_accuracy).toBe(1);
    expect(report.aggregate.required_tool_policy_compatibility).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.authorization.activates_routes).toBe(false);
    for (const route of DIME_PRODUCT_ROUTES) {
      expect(report.per_route[route]?.sample_count).toBeGreaterThanOrEqual(2);
      expect(Object.keys(report.confusion_matrix[route] ?? {}).sort()).toEqual(
        [...DIME_PRODUCT_ROUTES].sort()
      );
    }
  });
});
