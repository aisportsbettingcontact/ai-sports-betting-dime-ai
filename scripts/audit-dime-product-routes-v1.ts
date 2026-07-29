import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import {
  DIME_PRODUCT_ROUTES,
  DIME_ROUTE_POLICIES,
  classifyDimeProductRoute,
  type DimeProductRoute,
} from "../server/_core/dimeEngineeringControl";

type LegacyMode = "platform" | "matchup" | "slate" | "educational";

interface BenchmarkCase {
  case_id: string;
  prompt: string;
  legacy_mode: LegacyMode;
  expected_route: DimeProductRoute;
  accepted_alternate_routes: DimeProductRoute[];
  entities: string[];
  temporal_state: string;
  tools_required: string[];
  authoritative_sources: string[];
  expected_output_schema: string;
  critical_failure_conditions: string[];
}

interface BenchmarkFixture {
  schema_version: string;
  benchmark_version: string;
  control_plane_revision: string;
  data_classification: "synthetic";
  provenance: {
    created_at: string;
    source: string;
    contains_production_data: false;
  };
  cases: BenchmarkCase[];
}

const DEFAULT_FIXTURE = resolve(
  "ml/dime-1.0/data/eval/product_route_observability_v1.benchmark.json"
);
const DEFAULT_REPORT = resolve(
  "ml/dime-1.0/evidence/benchmarks/product-route-observability-v1/local-baseline.json"
);
const CONTROL_SOURCE = resolve("server/_core/dimeEngineeringControl.ts");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function metric(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function buildDimeProductRouteAudit(
  fixturePath = DEFAULT_FIXTURE
): Record<string, unknown> {
  const fixtureSource = readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureSource) as BenchmarkFixture;
  const controlSource = readFileSync(CONTROL_SOURCE, "utf8");
  const caseIds = new Set<string>();
  const expectedRouteCounts = Object.fromEntries(
    DIME_PRODUCT_ROUTES.map(route => [route, 0])
  ) as Record<DimeProductRoute, number>;
  const confusionMatrix = Object.fromEntries(
    DIME_PRODUCT_ROUTES.map(expected => [
      expected,
      Object.fromEntries(DIME_PRODUCT_ROUTES.map(actual => [actual, 0])),
    ])
  ) as Record<DimeProductRoute, Record<DimeProductRoute, number>>;

  const cases = fixture.cases.map(benchmarkCase => {
    if (caseIds.has(benchmarkCase.case_id)) {
      throw new Error(`Duplicate benchmark case ID: ${benchmarkCase.case_id}`);
    }
    caseIds.add(benchmarkCase.case_id);
    const actualRoute = classifyDimeProductRoute(
      benchmarkCase.prompt,
      benchmarkCase.legacy_mode
    );
    expectedRouteCounts[benchmarkCase.expected_route] += 1;
    confusionMatrix[benchmarkCase.expected_route][actualRoute] += 1;
    const routeAccepted =
      actualRoute === benchmarkCase.expected_route ||
      benchmarkCase.accepted_alternate_routes.includes(actualRoute);
    const permittedTools = DIME_ROUTE_POLICIES[actualRoute].toolPermissions;
    const requiredToolsPermitted = benchmarkCase.tools_required.every(tool =>
      permittedTools.includes(tool)
    );
    return {
      case_id: benchmarkCase.case_id,
      expected_route: benchmarkCase.expected_route,
      accepted_alternate_routes: benchmarkCase.accepted_alternate_routes,
      actual_route: actualRoute,
      route_accepted: routeAccepted,
      required_tools_permitted: requiredToolsPermitted,
      temporal_state: benchmarkCase.temporal_state,
      entity_count: benchmarkCase.entities.length,
      pass: routeAccepted && requiredToolsPermitted,
    };
  });

  const perRoute = Object.fromEntries(
    DIME_PRODUCT_ROUTES.map(route => {
      const truePositive = confusionMatrix[route][route];
      const falseNegative = Object.entries(confusionMatrix[route])
        .filter(([actual]) => actual !== route)
        .reduce((sum, [, count]) => sum + count, 0);
      const falsePositive = DIME_PRODUCT_ROUTES.filter(
        expected => expected !== route
      ).reduce((sum, expected) => sum + confusionMatrix[expected][route], 0);
      return [
        route,
        {
          sample_count: expectedRouteCounts[route],
          precision: metric(truePositive, truePositive + falsePositive),
          recall: metric(truePositive, truePositive + falseNegative),
        },
      ];
    })
  );
  const routeAcceptedCount = cases.filter(item => item.route_accepted).length;
  const policyCompatibleCount = cases.filter(
    item => item.required_tools_permitted
  ).length;

  return {
    schema_version: "dime-product-route-observability-audit-v1",
    benchmark_version: fixture.benchmark_version,
    control_plane_revision: fixture.control_plane_revision,
    generated_from: {
      fixture_path:
        "ml/dime-1.0/data/eval/product_route_observability_v1.benchmark.json",
      fixture_sha256: sha256(fixtureSource),
      control_source_path: "server/_core/dimeEngineeringControl.ts",
      control_source_sha256: sha256(controlSource),
      deterministic_generated_at: fixture.provenance.created_at,
    },
    data_governance: {
      classification: fixture.data_classification,
      source: fixture.provenance.source,
      contains_production_data: fixture.provenance.contains_production_data,
    },
    aggregate: {
      sample_count: cases.length,
      route_accuracy: metric(routeAcceptedCount, cases.length),
      route_accepted_count: routeAcceptedCount,
      required_tool_policy_compatibility: metric(
        policyCompatibleCount,
        cases.length
      ),
    },
    per_route: perRoute,
    confusion_matrix: confusionMatrix,
    unmeasured_until_observational_traces_exist: {
      entity_resolution_accuracy: null,
      tool_selection_accuracy: null,
      false_tool_call_rate: null,
      missed_tool_call_rate: null,
      context_relevance: null,
      latency_distributions: null,
      cost_distributions: null,
    },
    cases,
    failures: cases.filter(item => !item.pass),
    authorization: {
      activates_routes: false,
      authorizes_shadow: false,
      authorizes_release: false,
    },
  };
}

function parseArguments(argv: string[]) {
  let fixturePath = DEFAULT_FIXTURE;
  let reportPath = DEFAULT_REPORT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") {
      const value = argv[++index];
      if (!value) throw new Error("--fixture requires a path.");
      fixturePath = resolve(value);
    } else if (argument === "--report") {
      const value = argv[++index];
      if (!value) throw new Error("--report requires a path.");
      reportPath = resolve(value);
    } else if (argument === "--check") {
      check = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { fixturePath, reportPath, check };
}

async function main(): Promise<void> {
  const { fixturePath, reportPath, check } = parseArguments(
    process.argv.slice(2)
  );
  const serialized = await format(
    JSON.stringify(buildDimeProductRouteAudit(fixturePath), null, 2),
    { parser: "json" }
  );
  if (check) {
    if (readFileSync(reportPath, "utf8") !== serialized) {
      throw new Error("Tracked product-route evidence is stale.");
    }
    console.log("Product-route observational evidence matches.");
    return;
  }
  writeFileSync(reportPath, serialized, "utf8");
  console.log(`Wrote ${reportPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
