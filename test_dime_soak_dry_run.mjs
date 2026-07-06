/**
 * DRY RUN: Execute 3 test cases (1 auth fail, 1 malformed, 1 answer) to verify harness
 */
import { SignJWT } from 'jose';
const BASE = 'http://localhost:3000/api/dime/wc2026';
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

async function ownerToken() {
  return new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}

console.log('═══ DRY RUN: 3 TEST CASES ═══');
console.log(`[TIMESTAMP] ${new Date().toISOString()}`);
console.log('');

// Test 1: Auth fail (no cookie)
console.log('[DRY-1] AUTH_FAIL: No cookie...');
const r1 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
  signal: AbortSignal.timeout(10000),
});
console.log(`  → HTTP ${r1.status} | Expected: 401 | ${r1.status === 401 ? '✓ PASS' : '✗ FAIL'}`);
const b1 = await r1.text();
try { const j1 = JSON.parse(b1); console.log(`  → mode=${j1.mode} reason=${j1.reason}`); } catch {}

// Test 2: Malformed (invalid JSON)
console.log('[DRY-2] MALFORMED: Invalid JSON body...');
const ownerTk = await ownerToken();
const r2 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${ownerTk}` },
  body: 'NOT_JSON',
  signal: AbortSignal.timeout(10000),
});
console.log(`  → HTTP ${r2.status} | Expected: 400 | ${r2.status === 400 ? '✓ PASS' : '✗ FAIL'}`);

// Test 3: Answer (short question, owner auth)
console.log('[DRY-3] ANSWER: Best edge question (Claude call ~10-30s)...');
const r3 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${ownerTk}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'What is the best edge today?' }] }),
  signal: AbortSignal.timeout(60000),
});
const b3 = await r3.text();
const sseLines = b3.split('\n').filter(l => l.startsWith('data: '));
let textLen = 0;
let doneObj = null;
for (const line of sseLines) {
  try {
    const obj = JSON.parse(line.replace('data: ', ''));
    if (obj.type === 'delta') textLen += obj.text.length;
    if (obj.type === 'done') doneObj = obj;
  } catch {}
}
console.log(`  → HTTP ${r3.status} | SSE lines: ${sseLines.length} | Text: ${textLen} chars | Done: ${!!doneObj}`);
if (doneObj) console.log(`  → creditsCharged=${doneObj.creditsCharged} | requestId=${doneObj.requestId}`);
console.log(`  → ${r3.status === 200 && textLen > 30 ? '✓ PASS' : '✗ FAIL'}`);

console.log('');
console.log('═══ DRY RUN COMPLETE ═══');
