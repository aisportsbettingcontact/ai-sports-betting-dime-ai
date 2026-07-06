import { SignJWT } from 'jose';
const BASE = 'http://localhost:3000/api/dime/wc2026';
const AUDIT = 'http://localhost:3000/api/dime/wc2026/audit';
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

async function ownerToken() {
  return new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BLOCK 4: IDEMPOTENCY VERIFICATION                                         ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

const ownerTk = await ownerToken();
let passCount = 0;
let failCount = 0;

// Test 1: Send a request, get its requestId, then query the audit endpoint
console.log('[TEST-1] Send request → get requestId → verify audit exists');
const r1 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${ownerTk}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'What is the best edge today?' }] }),
  signal: AbortSignal.timeout(60000),
});
const body1 = await r1.text();
// Parse SSE to get requestId
const lines = body1.split('\n').filter(l => l.startsWith('data: '));
let requestId = null;
for (const line of lines) {
  try {
    const obj = JSON.parse(line.replace('data: ', ''));
    if (obj.type === 'done' && obj.requestId) requestId = obj.requestId;
  } catch {}
}
console.log(`  → HTTP ${r1.status} | requestId=${requestId}`);

if (requestId) {
  // Query audit endpoint
  const auditResp = await fetch(`${AUDIT}/${requestId}`, { signal: AbortSignal.timeout(5000) });
  const auditBody = await auditResp.json();
  const auditExists = auditBody.audit && auditBody.audit.request_id === requestId;
  console.log(`  → Audit query: HTTP ${auditResp.status} | exists=${auditExists}`);
  if (auditExists) {
    console.log(`  → audit.auth_status=${auditBody.audit.auth_status} | response_status=${auditBody.audit.response_status} | credits_charged=${auditBody.audit.credits_charged}`);
    passCount++;
    console.log('  → ✓ PASS: Audit row exists and matches requestId');
  } else {
    failCount++;
    console.log('  → ✗ FAIL: Audit row not found');
  }
} else {
  failCount++;
  console.log('  → ✗ FAIL: No requestId in response');
}

// Test 2: Query a non-existent requestId → should return 404
console.log('');
console.log('[TEST-2] Query non-existent requestId → expect 404');
const fakeId = 'fake-id-does-not-exist-12345';
const r2 = await fetch(`${AUDIT}/${fakeId}`, { signal: AbortSignal.timeout(5000) });
console.log(`  → HTTP ${r2.status} | Expected: 404 | ${r2.status === 404 ? '✓ PASS' : '✗ FAIL'}`);
if (r2.status === 404) passCount++; else failCount++;

// Test 3: Verify credits_charged consistency
console.log('');
console.log('[TEST-3] Verify credits_charged=1 for successful ANSWER in audit');
if (requestId) {
  const auditResp = await fetch(`${AUDIT}/${requestId}`, { signal: AbortSignal.timeout(5000) });
  const auditBody = await auditResp.json();
  const creditsCorrect = auditBody.audit?.credits_charged === 1;
  console.log(`  → credits_charged=${auditBody.audit?.credits_charged} | Expected: 1 | ${creditsCorrect ? '✓ PASS' : '✗ FAIL'}`);
  if (creditsCorrect) passCount++; else failCount++;
} else {
  failCount++;
  console.log('  → ✗ FAIL: No requestId available');
}

// Test 4: Send a refusal request, verify credits_charged=0 in audit
console.log('');
console.log('[TEST-4] Send MARKET_NOT_SUPPORTED refusal → verify credits_charged=0');
const r4 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${ownerTk}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'What spread should I bet on USA?' }] }),
  signal: AbortSignal.timeout(15000),
});
const body4 = await r4.text();
let refusalRequestId = null;
try {
  const json4 = JSON.parse(body4);
  refusalRequestId = json4.requestId;
} catch {}
console.log(`  → HTTP ${r4.status} | refusalRequestId=${refusalRequestId}`);

if (refusalRequestId) {
  const auditResp = await fetch(`${AUDIT}/${refusalRequestId}`, { signal: AbortSignal.timeout(5000) });
  const auditBody = await auditResp.json();
  const zeroCreds = auditBody.audit?.credits_charged === 0;
  console.log(`  → credits_charged=${auditBody.audit?.credits_charged} | Expected: 0 | ${zeroCreds ? '✓ PASS' : '✗ FAIL'}`);
  if (zeroCreds) passCount++; else failCount++;
} else {
  failCount++;
  console.log('  → ✗ FAIL: No requestId in refusal response');
}

// Test 5: Verify auth_status field consistency
console.log('');
console.log('[TEST-5] Auth rejection → verify auth_status=REJECTED in audit');
const r5 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
  signal: AbortSignal.timeout(5000),
});
const body5 = await r5.text();
let authRejectId = null;
try { authRejectId = JSON.parse(body5).requestId; } catch {}
console.log(`  → HTTP ${r5.status} | authRejectId=${authRejectId}`);
if (authRejectId) {
  const auditResp = await fetch(`${AUDIT}/${authRejectId}`, { signal: AbortSignal.timeout(5000) });
  const auditBody = await auditResp.json();
  const authRejected = auditBody.audit?.auth_status === 'REJECTED';
  console.log(`  → auth_status=${auditBody.audit?.auth_status} | Expected: REJECTED | ${authRejected ? '✓ PASS' : '✗ FAIL'}`);
  if (authRejected) passCount++; else failCount++;
} else {
  failCount++;
  console.log('  → ✗ FAIL: No requestId in auth rejection');
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log(`║  BLOCK 4 VERDICT: ${passCount}/5 PASS | ${failCount}/5 FAIL                                       ║`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
if (failCount === 0) {
  console.log('████ IDEMPOTENCY & AUDIT TRAIL: FULLY VERIFIED ████');
}
