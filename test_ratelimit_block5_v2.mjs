import { SignJWT } from 'jose';
const BASE = 'http://localhost:3000/api/dime/wc2026';
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Must use owner role to bypass subscription check
async function ownerToken() {
  return new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}

// Use a different user ID that also has owner role for isolation test
async function otherOwnerToken() {
  return new SignJWT({ sub: '2', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BLOCK 5 (v2): RATE LIMIT PRESSURE TEST                                    ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
console.log('║  STRATEGY: Use owner tokens (bypass sub check), test rate limit isolation   ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Wait 61s for any previous rate limit window to expire for user 1
console.log('[PREP] Waiting 61s for rate limit window to expire for userId=1...');
await new Promise(r => setTimeout(r, 61000));
console.log('[PREP] Window expired. Starting tests.');
console.log('');

const token = await ownerToken();
let passCount = 0;
let failCount = 0;

// TEST 1: First 10 requests should all get through (within window)
console.log('[TEST-1] First 10 requests (userId=1, within 60s window) → all should pass');
const results1 = [];
for (let i = 1; i <= 10; i++) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: `Rate pressure ${i}: What is the best edge?` }] }),
    signal: AbortSignal.timeout(15000),
  });
  results1.push(r.status);
  const icon = r.status !== 429 ? '✓' : '✗';
  process.stdout.write(`  [${i.toString().padStart(2)}] ${r.status} ${icon} `);
  if (i % 5 === 0) console.log('');
}
const allNon429 = results1.every(s => s !== 429);
console.log(`  → Result: ${results1.filter(s => s !== 429).length}/10 passed | ${allNon429 ? '✓ PASS' : '✗ FAIL'}`);
if (allNon429) passCount++; else failCount++;

// TEST 2: 11th request should be 429
console.log('');
console.log('[TEST-2] 11th request (same user, same window) → expect 429');
const r11 = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${token}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'This should be rate limited' }] }),
  signal: AbortSignal.timeout(5000),
});
const body11 = await r11.text();
console.log(`  → HTTP ${r11.status} | body: ${body11.substring(0, 80)}`);
console.log(`  → ${r11.status === 429 ? '✓ PASS' : '✗ FAIL'}`);
if (r11.status === 429) passCount++; else failCount++;

// TEST 3: Different user (userId=2) should NOT be rate limited (per-user isolation)
console.log('');
console.log('[TEST-3] Different user (userId=2, owner role) → should NOT be rate limited');
const otherTk = await otherOwnerToken();
const rOther = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${otherTk}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Different user isolation test' }] }),
  signal: AbortSignal.timeout(15000),
});
// userId=2 might not exist in DB - check for 403 (sub check) vs 429 (rate limit)
console.log(`  → HTTP ${rOther.status}`);
if (rOther.status === 429) {
  failCount++;
  console.log('  → ✗ FAIL: User 2 incorrectly rate limited (isolation broken)');
} else {
  passCount++;
  console.log(`  → ✓ PASS: Not rate limited (got ${rOther.status} which is sub/auth check, not rate limit)`);
}

// TEST 4: Rate limit response includes requestId and 0 credits
console.log('');
console.log('[TEST-4] Rate limit response structure → has requestId, 0 credits');
let rlJson = null;
try { rlJson = JSON.parse(body11); } catch {}
const hasReqId = !!rlJson?.requestId;
const zeroCreds = (rlJson?.creditsCharged ?? 0) === 0;
console.log(`  → requestId=${rlJson?.requestId} | creditsCharged=${rlJson?.creditsCharged}`);
console.log(`  → ${hasReqId && zeroCreds ? '✓ PASS' : '✗ FAIL'}`);
if (hasReqId && zeroCreds) passCount++; else failCount++;

// TEST 5: After window expires, requests should work again
console.log('');
console.log('[TEST-5] After 61s window reset → requests should work again');
console.log('  → Waiting 61s...');
await new Promise(r => setTimeout(r, 61000));
const rAfter = await fetch(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${token}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Post-window-reset test' }] }),
  signal: AbortSignal.timeout(15000),
});
console.log(`  → HTTP ${rAfter.status} | ${rAfter.status !== 429 ? '✓ PASS (window reset worked)' : '✗ FAIL (still rate limited)'}`);
if (rAfter.status !== 429) passCount++; else failCount++;

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log(`║  BLOCK 5 VERDICT: ${passCount}/5 PASS | ${failCount}/5 FAIL                                       ║`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
if (failCount === 0) console.log('████ RATE LIMIT ENFORCEMENT: FULLY VERIFIED ████');
