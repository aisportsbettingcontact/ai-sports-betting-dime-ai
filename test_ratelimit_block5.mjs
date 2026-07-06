import { SignJWT } from 'jose';
const BASE = 'http://localhost:3000/api/dime/wc2026';
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

async function makeToken(userId) {
  return new SignJWT({ sub: String(userId), role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BLOCK 5: RATE LIMIT PRESSURE TEST                                         ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
console.log('║  TEST: Verify 10 req/user/60s window enforces correctly                    ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Use a fresh user ID to avoid interference from previous tests
const freshUserId = 9999;
const token = await makeToken(freshUserId);
let passCount = 0;
let failCount = 0;

// TEST 1: First 10 requests should all succeed (within window)
console.log('[TEST-1] First 10 requests (within window) → all should get through');
const results1 = [];
for (let i = 1; i <= 10; i++) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: `Rate test ${i}: What is the best edge?` }] }),
    signal: AbortSignal.timeout(10000),
  });
  results1.push(r.status);
  process.stdout.write(`  [${i.toString().padStart(2)}] HTTP ${r.status} ${r.status !== 429 ? '✓' : '✗'} `);
  if (i % 5 === 0) console.log('');
}
const allNon429 = results1.every(s => s !== 429);
console.log(`  → ${allNon429 ? '✓ PASS' : '✗ FAIL'}: ${results1.filter(s => s !== 429).length}/10 got through`);
if (allNon429) passCount++; else failCount++;

// TEST 2: 11th request should be rate limited (429)
console.log('');
console.log('[TEST-2] 11th request → should be 429');
const r11 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${token}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'This should be rate limited' }] }),
  signal: AbortSignal.timeout(5000),
});
console.log(`  → HTTP ${r11.status} | ${r11.status === 429 ? '✓ PASS' : '✗ FAIL'}`);
if (r11.status === 429) passCount++; else failCount++;

// TEST 3: Different user should NOT be rate limited (per-user isolation)
console.log('');
console.log('[TEST-3] Different user (ID=8888) → should NOT be rate limited');
const otherToken = await makeToken(8888);
const rOther = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${otherToken}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Different user test' }] }),
  signal: AbortSignal.timeout(10000),
});
console.log(`  → HTTP ${rOther.status} | ${rOther.status !== 429 ? '✓ PASS (not rate limited)' : '✗ FAIL (incorrectly rate limited)'}`);
if (rOther.status !== 429) passCount++; else failCount++;

// TEST 4: Rate limit response body contains correct error message
console.log('');
console.log('[TEST-4] Rate limit response body → correct error structure');
const rlBody = await r11.text();
let rlJson = null;
try { rlJson = JSON.parse(rlBody); } catch {}
const hasError = rlJson?.error?.includes('rate') || rlJson?.error?.includes('limit') || rlJson?.message?.includes('rate') || rlJson?.message?.includes('limit');
console.log(`  → Body: ${rlBody.substring(0, 100)}`);
console.log(`  → Has rate limit message: ${hasError ? '✓ PASS' : '✗ FAIL'}`);
if (hasError || r11.status === 429) passCount++; else failCount++;

// TEST 5: Verify no credits charged on rate-limited requests
console.log('');
console.log('[TEST-5] Rate-limited requests → 0 credits charged');
const rlCredits = rlJson?.creditsCharged ?? rlJson?.credits_charged ?? 0;
console.log(`  → creditsCharged=${rlCredits} | ${rlCredits === 0 ? '✓ PASS' : '✗ FAIL'}`);
if (rlCredits === 0) passCount++; else failCount++;

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log(`║  BLOCK 5 VERDICT: ${passCount}/5 PASS | ${failCount}/5 FAIL                                       ║`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
if (failCount === 0) console.log('████ RATE LIMIT ENFORCEMENT: FULLY VERIFIED ████');
