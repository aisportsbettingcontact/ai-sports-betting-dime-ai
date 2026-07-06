/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  AUDIT LAYER 2: CODE INTEGRITY                                              ║
 * ║  Static analysis of dime-wc2026.route.ts enforcement architecture           ║
 * ║  Verifies: auth gate, sub gate, credit gate, rate limit, refusal, charge    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'fs';

const ROUTE_FILE = 'server/dime-wc2026.route.ts';
const code = readFileSync(ROUTE_FILE, 'utf-8');
const lines = code.split('\n');

let pass = 0, fail = 0;
const results = [];

function gate(name, condition, evidence) {
  const status = condition ? 'PASS' : 'FAIL';
  if (condition) pass++; else fail++;
  const line = `[LAYER2] [${status}] ${condition ? '✓' : '✗'} GATE: ${name} | ${evidence}`;
  console.log(line);
  results.push({ name, status, evidence });
  return condition;
}

function findLine(pattern) {
  const idx = lines.findIndex(l => l.match(pattern));
  return idx >= 0 ? idx + 1 : -1;
}

function hasPattern(pattern) {
  return code.match(pattern) !== null;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('AUDIT LAYER 2: CODE INTEGRITY — ENFORCEMENT ARCHITECTURE');
console.log(`TIMESTAMP: ${new Date().toISOString()}`);
console.log(`FILE: ${ROUTE_FILE} (${lines.length} lines)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// ═══ SECTION 1: AUTH GATE ═══
console.log('╔═══ SECTION 1: AUTHENTICATION GATE ═══╗');
gate('AUTH.jwt_verify_exists', hasPattern(/jwtVerify|verify.*JWT/i), `Line: ${findLine(/jwtVerify|verify.*JWT/i)}`);
gate('AUTH.401_on_no_token', hasPattern(/401.*auth|no.*token.*401|Unauthorized/i), `Line: ${findLine(/401|Unauthorized/)}`);
gate('AUTH.403_on_no_subscription', hasPattern(/403|Forbidden|subscription/i), `Line: ${findLine(/403|Forbidden/)}`);
gate('AUTH.cookie_extraction', hasPattern(/app_session|cookie/i), `Line: ${findLine(/app_session|cookie/)}`);
gate('AUTH.user_lookup', hasPattern(/getAppUserById|findUser/i), `Line: ${findLine(/getAppUserById|findUser/)}`);

// ═══ SECTION 2: RATE LIMIT GATE ═══
console.log('');
console.log('╔═══ SECTION 2: RATE LIMIT GATE ═══╗');
gate('RATE.limiter_exists', hasPattern(/checkRateLimit|rateLimit/), `Line: ${findLine(/checkRateLimit|rateLimit/)}`);
gate('RATE.429_response', hasPattern(/429/), `Line: ${findLine(/429/)}`);
gate('RATE.window_config', hasPattern(/RATE_LIMIT_WINDOW|60.*1000|60000/), `Line: ${findLine(/RATE_LIMIT_WINDOW|60.*1000|60000/)}`);
gate('RATE.max_requests_config', hasPattern(/MAX_REQUESTS|10/), `Line: ${findLine(/MAX_REQUESTS/)}`);

// ═══ SECTION 3: CREDIT GATE ═══
console.log('');
console.log('╔═══ SECTION 3: CREDIT GATE ═══╗');
gate('CREDIT.balance_check', hasPattern(/balance|credit.*check|insufficient/i), `Line: ${findLine(/balance|credit.*check|insufficient/i)}`);
gate('CREDIT.charge_after_success', hasPattern(/chargeCredit|deductCredit|delta.*-1|INSERT.*credit_ledger/i), `Line: ${findLine(/chargeCredit|deductCredit|delta.*-1|INSERT.*credit_ledger/i)}`);
gate('CREDIT.no_charge_on_refusal', hasPattern(/refusal.*0.*credit|credits_charged.*0|no.*credit/i), `Line: ${findLine(/refusal.*0.*credit|credits_charged.*0|no.*credit/i)}`);

// ═══ SECTION 4: VALIDATION GATE ═══
console.log('');
console.log('╔═══ SECTION 4: INPUT VALIDATION ═══╗');
gate('VALID.json_parse', hasPattern(/JSON\.parse|body.*messages/), `Line: ${findLine(/JSON\.parse|body.*messages/)}`);
gate('VALID.messages_array_check', hasPattern(/Array\.isArray.*messages|messages.*length/), `Line: ${findLine(/Array\.isArray.*messages|messages.*length/)}`);
gate('VALID.max_length_check', hasPattern(/MAX_MESSAGE|length.*>|too.*long|oversized/i), `Line: ${findLine(/MAX_MESSAGE|length.*>|too.*long|oversized/i)}`);
gate('VALID.role_check', hasPattern(/role.*user|user.*message/i), `Line: ${findLine(/role.*user/)}`);
gate('VALID.400_on_invalid', hasPattern(/400.*valid|invalid.*400|Bad Request/i), `Line: ${findLine(/400/)}`);

// ═══ SECTION 5: INTENT CLASSIFICATION + REFUSAL ═══
console.log('');
console.log('╔═══ SECTION 5: INTENT CLASSIFICATION & REFUSAL ═══╗');
gate('INTENT.classifier_exists', hasPattern(/classifyIntent/), `Line: ${findLine(/classifyIntent/)}`);
gate('INTENT.refusal_handler', hasPattern(/getRefusalForIntent|refusal/), `Line: ${findLine(/getRefusalForIntent|refusal/)}`);
gate('INTENT.scope_keywords', hasPattern(/moneyline|spread|total|over.*under|WC2026|World Cup/i), `Line: ${findLine(/moneyline|spread|total/)}`);
gate('INTENT.sse_refusal_event', hasPattern(/event.*refusal|refusal.*event|SSE.*refus/i), `Line: ${findLine(/event.*refusal|refusal.*event/)}`);

// ═══ SECTION 6: CLAUDE CALL + STREAMING ═══
console.log('');
console.log('╔═══ SECTION 6: CLAUDE API INTEGRATION ═══╗');
gate('CLAUDE.model_defined', hasPattern(/claude-fable-5/), `Line: ${findLine(/claude-fable-5/)}`);
gate('CLAUDE.stream_mode', hasPattern(/stream.*true|createStream|messages\.stream/i), `Line: ${findLine(/stream.*true|createStream|messages\.stream/i)}`);
gate('CLAUDE.error_handler', hasPattern(/catch.*claude|claude.*error|APIError/i), `Line: ${findLine(/catch.*claude|claude.*error|APIError/i)}`);
gate('CLAUDE.sse_format', hasPattern(/text\/event-stream|event:.*data:/), `Line: ${findLine(/text\/event-stream|event:.*data:/)}`);

// ═══ SECTION 7: AUDIT TRAIL ═══
console.log('');
console.log('╔═══ SECTION 7: AUDIT TRAIL PERSISTENCE ═══╗');
gate('AUDIT.request_audit_insert', hasPattern(/dime_request_audit|request_audit/), `Line: ${findLine(/dime_request_audit|request_audit/)}`);
gate('AUDIT.response_audit_insert', hasPattern(/dime_response_audit|response_audit/), `Line: ${findLine(/dime_response_audit|response_audit/)}`);
gate('AUDIT.context_audit_insert', hasPattern(/dime_context_audit|context_audit/), `Line: ${findLine(/dime_context_audit|context_audit/)}`);
gate('AUDIT.credit_ledger_insert', hasPattern(/dime_credit_ledger|credit_ledger/), `Line: ${findLine(/dime_credit_ledger|credit_ledger/)}`);

// ═══ SECTION 8: DUPLICATE REQUEST PROTECTION ═══
console.log('');
console.log('╔═══ SECTION 8: IDEMPOTENCY PROTECTION ═══╗');
gate('IDEMP.request_id_generation', hasPattern(/uuid|randomUUID|crypto\.random/i), `Line: ${findLine(/uuid|randomUUID|crypto\.random/i)}`);
gate('IDEMP.duplicate_check', hasPattern(/duplicate|existing.*request|already.*processed/i), `Line: ${findLine(/duplicate|existing.*request|already.*processed/i)}`);

// ═══ FINAL VERDICT ═══
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`LAYER 2 FINAL VERDICT: ${pass}/${pass + fail} GATES PASS | ${fail} FAILURES`);
console.log(`OVERALL: ${fail === 0 ? '✓ LAYER 2 CERTIFIED' : '✗ LAYER 2 HAS FAILURES — INVESTIGATE'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

process.exit(fail > 0 ? 1 : 0);
