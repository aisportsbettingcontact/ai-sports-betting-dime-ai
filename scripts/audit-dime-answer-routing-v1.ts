#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format } from "prettier";

import {
  DIME_ANSWER_ROUTING_VERSION,
  DIME_PLATFORM_TIME_ZONE,
  collectDimeNumericValues,
  planDimeAnswerRoute,
  renderPlatformCapabilitiesFallback,
  resolveDimeEvent,
  validateDimeResponseCompleteness,
  type DimeAnswerEvidence,
  type DimeCompletenessStatus,
  type DimeDateSource,
  type DimeEventResolutionKind,
  type DimeGroundingStatus,
  type DimeLeague,
  type DimeResolvableGame,
} from "../server/_core/dimeAnswerRouting.ts";

type DimeMode = "platform" | "matchup" | "slate" | "educational";
type PlatformScope = "capabilities" | "feature" | "not_applicable";

interface BenchmarkExpected {
  mode: DimeMode;
  platform_scope: PlatformScope;
  league: DimeLeague | null;
  requested_date: string | null;
  date_source: DimeDateSource;
  retrieval_cap: number;
  retrieval_bypassed: boolean;
  resolution_kind: DimeEventResolutionKind;
  selected_event_ids: number[];
  completeness_status: DimeCompletenessStatus;
}

interface BenchmarkCase {
  case_id: string;
  objective: string;
  prompt: string;
  routing_enabled: boolean;
  input_event_ids: number[];
  freshness: DimeAnswerEvidence["freshness"];
  grounding: DimeGroundingStatus;
  response_fixture:
    | { kind: "platform_capabilities_fallback" }
    | { kind: "literal"; text: string };
  expected: BenchmarkExpected;
}

interface BenchmarkFixture {
  schema_version: "dime-runtime-answer-routing-benchmark-v1";
  benchmark_version: string;
  runtime_contract_version: string;
  synthetic_data_only: true;
  frozen_clock: {
    now_utc: string;
    platform_time_zone: string;
  };
  events: DimeResolvableGame[];
  cases: BenchmarkCase[];
}

interface Metric {
  numerator: number;
  denominator: number;
  rate: number;
}

interface CaseResult {
  case_id: string;
  pass: boolean;
  checks: {
    route_exact_match: boolean;
    resolution_exact_match: boolean;
    completeness_contract_match: boolean;
    retrieval_cap_compliant: boolean;
    retrieval_bypass_compliant: boolean;
  };
  actual: BenchmarkExpected & {
    resolution_confidence: number;
    input_event_count: number;
    selected_event_count: number;
  };
  completeness_error_codes: string[];
}

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "ml/dime-1.0/data/eval/runtime_answer_routing_v1.benchmark.json"
);
const DEFAULT_REPORT = resolve(
  REPOSITORY_ROOT,
  "ml/dime-1.0/evidence/benchmarks/runtime-answer-routing-v1/local-baseline.json"
);
const RUNTIME_MODULE = resolve(
  REPOSITORY_ROOT,
  "server/_core/dimeAnswerRouting.ts"
);
const EDUCATIONAL_MATH_MODULE = resolve(
  REPOSITORY_ROOT,
  "server/_core/dimeEducationalMath.ts"
);

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFixture(value: unknown): asserts value is BenchmarkFixture {
  if (!value || typeof value !== "object") {
    throw new Error("Benchmark fixture must be an object.");
  }
  const fixture = value as Partial<BenchmarkFixture>;
  if (
    fixture.schema_version !== "dime-runtime-answer-routing-benchmark-v1" ||
    fixture.runtime_contract_version !== DIME_ANSWER_ROUTING_VERSION ||
    fixture.synthetic_data_only !== true ||
    fixture.frozen_clock?.platform_time_zone !== DIME_PLATFORM_TIME_ZONE ||
    !fixture.frozen_clock.now_utc ||
    !Number.isFinite(Date.parse(fixture.frozen_clock.now_utc)) ||
    !Array.isArray(fixture.events) ||
    !Array.isArray(fixture.cases) ||
    fixture.cases.length === 0
  ) {
    throw new Error("Benchmark fixture failed its runtime contract.");
  }

  const eventIds = new Set<number>();
  for (const event of fixture.events) {
    if (!Number.isInteger(event.id) || eventIds.has(event.id)) {
      throw new Error(
        `Benchmark contains an invalid or duplicate event ID: ${event.id}`
      );
    }
    eventIds.add(event.id);
  }

  const caseIds = new Set<string>();
  for (const benchmarkCase of fixture.cases) {
    if (
      !/^route_[a-z0-9_]+_[0-9]{3}$/.test(benchmarkCase.case_id) ||
      caseIds.has(benchmarkCase.case_id)
    ) {
      throw new Error(
        `Benchmark contains an invalid or duplicate case ID: ${benchmarkCase.case_id}`
      );
    }
    caseIds.add(benchmarkCase.case_id);
    for (const eventId of benchmarkCase.input_event_ids) {
      if (!eventIds.has(eventId)) {
        throw new Error(
          `${benchmarkCase.case_id} references unknown event ID ${eventId}`
        );
      }
    }
  }
}

function exactEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function metric(values: boolean[]): Metric {
  const numerator = values.filter(Boolean).length;
  return {
    numerator,
    denominator: values.length,
    rate:
      values.length === 0 ? 0 : Number((numerator / values.length).toFixed(6)),
  };
}

function responseText(benchmarkCase: BenchmarkCase): string {
  return benchmarkCase.response_fixture.kind ===
    "platform_capabilities_fallback"
    ? renderPlatformCapabilitiesFallback()
    : benchmarkCase.response_fixture.text;
}

function relativePath(path: string): string {
  return relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
}

export function buildRuntimeAnswerRoutingAudit(
  fixturePath = DEFAULT_FIXTURE
): Record<string, unknown> {
  const fixtureBytes = readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8")) as unknown;
  assertFixture(fixture);

  const frozenNow = new Date(fixture.frozen_clock.now_utc);
  const eventById = new Map(fixture.events.map(event => [event.id, event]));

  const caseResults: CaseResult[] = fixture.cases.map(benchmarkCase => {
    const route = planDimeAnswerRoute(benchmarkCase.prompt, frozenNow, {
      DIME_ANSWER_ROUTING_V1_ENABLED: String(benchmarkCase.routing_enabled),
    });
    const inputRows = benchmarkCase.input_event_ids.map(eventId => {
      const event = eventById.get(eventId);
      if (!event) {
        throw new Error(
          `${benchmarkCase.case_id} references unavailable event ${eventId}`
        );
      }
      return event;
    });
    const { resolution, selectedRows } = resolveDimeEvent(inputRows, route);
    const completeness = validateDimeResponseCompleteness(
      {
        route,
        resolution,
        freshness: benchmarkCase.freshness,
        grounding: benchmarkCase.grounding,
        rowCount: selectedRows.length,
        retrievalCandidateCount: inputRows.length,
        retrievalLatencyMs: 0,
        supportedNumericValues: collectDimeNumericValues([
          benchmarkCase.prompt,
          ...selectedRows.flatMap(row => Object.values(row)),
        ]),
      },
      responseText(benchmarkCase)
    );

    const actual: CaseResult["actual"] = {
      mode: route.mode,
      platform_scope: route.platformScope,
      league: route.league ?? null,
      requested_date: route.requestedDate ?? null,
      date_source: route.dateSource,
      retrieval_cap: route.retrievalCap,
      retrieval_bypassed: route.retrievalBypassed,
      resolution_kind: resolution.kind,
      selected_event_ids: selectedRows.map(row => row.id),
      completeness_status: completeness.status,
      resolution_confidence: resolution.confidence,
      input_event_count: inputRows.length,
      selected_event_count: selectedRows.length,
    };

    const routeExactMatch = exactEqual(
      {
        mode: actual.mode,
        platform_scope: actual.platform_scope,
        league: actual.league,
        requested_date: actual.requested_date,
        date_source: actual.date_source,
        retrieval_cap: actual.retrieval_cap,
        retrieval_bypassed: actual.retrieval_bypassed,
      },
      {
        mode: benchmarkCase.expected.mode,
        platform_scope: benchmarkCase.expected.platform_scope,
        league: benchmarkCase.expected.league,
        requested_date: benchmarkCase.expected.requested_date,
        date_source: benchmarkCase.expected.date_source,
        retrieval_cap: benchmarkCase.expected.retrieval_cap,
        retrieval_bypassed: benchmarkCase.expected.retrieval_bypassed,
      }
    );
    const resolutionExactMatch =
      actual.resolution_kind === benchmarkCase.expected.resolution_kind &&
      exactEqual(
        actual.selected_event_ids,
        benchmarkCase.expected.selected_event_ids
      );
    const completenessContractMatch =
      actual.completeness_status === benchmarkCase.expected.completeness_status;
    const retrievalCapCompliant =
      actual.selected_event_count <= actual.retrieval_cap;
    const retrievalBypassCompliant =
      !actual.retrieval_bypassed || actual.selected_event_count === 0;
    const checks = {
      route_exact_match: routeExactMatch,
      resolution_exact_match: resolutionExactMatch,
      completeness_contract_match: completenessContractMatch,
      retrieval_cap_compliant: retrievalCapCompliant,
      retrieval_bypass_compliant: retrievalBypassCompliant,
    };

    return {
      case_id: benchmarkCase.case_id,
      pass: Object.values(checks).every(Boolean),
      checks,
      actual,
      completeness_error_codes: completeness.errorCodes,
    };
  });

  const routeChecks = caseResults.map(
    result => result.checks.route_exact_match
  );
  const resolutionChecks = caseResults.map(
    result => result.checks.resolution_exact_match
  );
  const completenessChecks = caseResults.map(
    result => result.checks.completeness_contract_match
  );
  const capChecks = caseResults.map(
    result => result.checks.retrieval_cap_compliant
  );
  const bypassChecks = caseResults.map(
    result => result.checks.retrieval_bypass_compliant
  );
  const caseChecks = caseResults.map(result => result.pass);

  return {
    schema_version: "dime-runtime-answer-routing-audit-v1",
    benchmark_version: fixture.benchmark_version,
    runtime_contract_version: DIME_ANSWER_ROUTING_VERSION,
    evidence_class: "deterministic_local_contract",
    synthetic_data_only: true,
    frozen_clock: fixture.frozen_clock,
    sources: {
      fixture_path: relativePath(fixturePath),
      fixture_sha256: sha256(fixtureBytes),
      runtime_module_path: relativePath(RUNTIME_MODULE),
      runtime_module_sha256: sha256(readFileSync(RUNTIME_MODULE)),
      educational_math_module_path: relativePath(EDUCATIONAL_MATH_MODULE),
      educational_math_module_sha256: sha256(
        readFileSync(EDUCATIONAL_MATH_MODULE)
      ),
    },
    summary: {
      case_count: caseResults.length,
      passing_cases: caseChecks.filter(Boolean).length,
      failing_cases: caseChecks.filter(value => !value).length,
      deterministic_local_baseline_pass: caseChecks.every(Boolean),
      production_promotion_authorized: false,
    },
    local_metrics: {
      route_exact_match: metric(routeChecks),
      grounding_resolution_exact_match: metric(resolutionChecks),
      completeness_guard_expectation_match: metric(completenessChecks),
      retrieval_cap_compliance: metric(capChecks),
      retrieval_bypass_compliance: metric(bypassChecks),
      full_case_contract_accuracy: metric(caseChecks),
    },
    post_deploy_live_metrics: {
      measurement_status: "pending",
      sample_count: null,
      answer_grounding_claim_support_rate: null,
      answer_completeness_rate: null,
      retrieval_rows: {
        p50: null,
        p95: null,
        maximum: null,
      },
      latency_ms: {
        routing_p50: null,
        routing_p95: null,
        retrieval_p50: null,
        retrieval_p95: null,
        provider_p50: null,
        provider_p95: null,
        total_p50: null,
        total_p95: null,
      },
      tokens: {
        prompt_total: null,
        completion_total: null,
        total: null,
        per_request_p50: null,
        per_request_p95: null,
      },
      provider_failure_rate: null,
      monetary_cost: {
        currency: "USD",
        total: null,
        per_request: null,
        status: "not_computable_without_verified_provider_price_snapshot",
      },
    },
    rollback_criteria: {
      immediate: [
        "platform_or_educational_route_retrieves_event_rows",
        "nearby_event_is_presented_as_exact",
        "ambiguous_event_is_selected_without_confirmation",
        "missing_event_is_replaced_with_another_event",
        "retrieval_cap_is_exceeded",
        "runtime_kill_switch_does_not_restore_the_bounded_legacy_path",
        "private_or_production_data_appears_in_benchmark_or_evidence",
      ],
      before_live_promotion: [
        "any_frozen_case_fails",
        "live_metric_capture_is_incomplete",
        "owner_approved_live_thresholds_are_absent",
        "verified_provider_price_snapshot_is_absent_when_reporting_dollar_cost",
      ],
    },
    limitations: [
      "This baseline measures deterministic routing, event resolution, retrieval bounds, and completeness-guard behavior only.",
      "Synthetic response fixtures are contract probes, not model-generated answers.",
      "The baseline does not prove live answer quality, factual claim support, latency, token usage, provider reliability, or monetary cost.",
      "Post-deploy metrics remain pending until sanitized runtime traces are collected under an approved measurement plan.",
    ],
    cases: caseResults.map(result => ({
      case_id: result.case_id,
      pass: result.pass,
      mode: result.actual.mode,
      date_source: result.actual.date_source,
      resolution_kind: result.actual.resolution_kind,
      selected_event_ids: result.actual.selected_event_ids,
      selected_event_count: result.actual.selected_event_count,
      retrieval_cap: result.actual.retrieval_cap,
      completeness_status: result.actual.completeness_status,
    })),
    failures: caseResults.filter(result => !result.pass),
  };
}

function parseArguments(argv: string[]): {
  fixturePath: string;
  reportPath: string;
  check: boolean;
} {
  let fixturePath = DEFAULT_FIXTURE;
  let reportPath = DEFAULT_REPORT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") {
      const value = argv[index + 1];
      if (!value) throw new Error("--fixture requires a path.");
      fixturePath = resolve(value);
      index += 1;
    } else if (argument === "--report") {
      const value = argv[index + 1];
      if (!value) throw new Error("--report requires a path.");
      reportPath = resolve(value);
      index += 1;
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
  const report = buildRuntimeAnswerRoutingAudit(fixturePath);
  const serialized = await format(JSON.stringify(report, null, 2), {
    parser: "json",
  });
  if (check) {
    const tracked = readFileSync(reportPath, "utf8");
    if (tracked !== serialized) {
      throw new Error(
        `Tracked routing evidence differs from deterministic output: ${relativePath(reportPath)}`
      );
    }
    console.log(
      `Runtime Answer Routing v1 evidence matches ${relativePath(reportPath)}`
    );
    return;
  }
  writeFileSync(reportPath, serialized, "utf8");
  console.log(`Report written to ${relativePath(reportPath)}`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
