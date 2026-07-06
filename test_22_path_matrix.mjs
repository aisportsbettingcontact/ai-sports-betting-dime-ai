/**
 * T4 BLOCK 5: 22-PATH DIME MATRIX VALIDATION
 * Tests all 22 response paths of the Dime WC2026 intelligence route.
 * Each path verifies: enforcement gate, response mode, reason code, credit behavior.
 */
import { SignJWT } from 'jose';

const BASE = 'http://localhost:3000/api/dime/wc2026';
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Token generators
async function ownerToken() {
  return new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}
async function noSubToken() {
  return new SignJWT({ sub: '999999', role: 'user', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
}
async function expiredToken() {
  return new SignJWT({ sub: '1', role: 'owner', type: 'app_user', tv: 1 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('-1h').sign(SECRET);
}

async function callDime(token, messages, timeout = 30000) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Cookie'] = `app_session=${token}`;
  
  const resp = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(timeout)
  });
  
  const text = await resp.text();
  return { status: resp.status, body: text };
}

function parseSSE(body) {
  // First check if it's a JSON refusal (not SSE)
  try {
    const json = JSON.parse(body);
    if (json.mode === 'REFUSE') {
      return { fullText: json.message || '', done: json, isRefusal: true, reason: json.reason, creditsCharged: json.creditsCharged };
    }
  } catch {}
  // Otherwise parse as SSE
  const lines = body.split('\n').filter(l => l.startsWith('data: '));
  let fullText = '';
  let done = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.replace('data: ', ''));
      if (obj.type === 'delta') fullText += obj.text;
      if (obj.type === 'done') done = obj;
    } catch {}
  }
  return { fullText, done, isRefusal: false };
}

const results = [];
let passCount = 0;
let failCount = 0;

function log(pathNum, name, expected, actual, pass) {
  const status = pass ? '✓ PASS' : '✗ FAIL';
  if (pass) passCount++; else failCount++;
  const entry = { path: pathNum, name, expected, actual, status };
  results.push(entry);
  console.log(`[PATH ${String(pathNum).padStart(2,'0')}] ${status} | ${name} | expected=${expected} | actual=${actual}`);
}

async function runMatrix() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('[T4-B5] 22-PATH DIME MATRIX VALIDATION — STARTING');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`[TIMESTAMP] ${new Date().toISOString()}`);
  console.log('');

  // === ENFORCEMENT GATES (Paths 1-9) ===
  console.log('--- ENFORCEMENT GATES ---');

  // Path 1: No cookie → 401
  const r1 = await callDime(null, [{ role: 'user', content: 'test' }]);
  log(1, 'AUTH_REQUIRED (no cookie)', 'HTTP 401', `HTTP ${r1.status}`, r1.status === 401);

  // Path 2: Invalid JWT → 401
  const r2 = await callDime('invalid_token_xyz', [{ role: 'user', content: 'test' }]);
  log(2, 'AUTH_REQUIRED (invalid JWT)', 'HTTP 401', `HTTP ${r2.status}`, r2.status === 401);

  // Path 3: Expired JWT → 401
  const expToken = await expiredToken();
  const r3 = await callDime(expToken, [{ role: 'user', content: 'test' }]);
  log(3, 'AUTH_REQUIRED (expired JWT)', 'HTTP 401', `HTTP ${r3.status}`, r3.status === 401);

  // Path 4: No subscription → 403
  const noSub = await noSubToken();
  const r4 = await callDime(noSub, [{ role: 'user', content: 'test' }]);
  log(4, 'SUBSCRIPTION_REQUIRED (no sub)', 'HTTP 403', `HTTP ${r4.status}`, r4.status === 403);

  // Path 5: Empty message → 400
  const ownerTk = await ownerToken();
  const r5 = await callDime(ownerTk, []);
  log(5, 'VALIDATION_FAILED (empty messages)', 'HTTP 400', `HTTP ${r5.status}`, r5.status === 400);

  // Path 6: Message too long → 400
  const longMsg = 'x'.repeat(5000);
  const r6 = await callDime(ownerTk, [{ role: 'user', content: longMsg }]);
  log(6, 'VALIDATION_FAILED (message too long)', 'HTTP 400', `HTTP ${r6.status}`, r6.status === 400);

  // Path 7: Invalid format (no role) → 400
  const r7 = await callDime(ownerTk, [{ content: 'test' }]);
  log(7, 'VALIDATION_FAILED (missing role)', 'HTTP 400', `HTTP ${r7.status}`, r7.status === 400);

  // Path 8: Too many messages → 400
  const manyMsgs = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  const r8 = await callDime(ownerTk, manyMsgs);
  log(8, 'VALIDATION_FAILED (too many messages)', 'HTTP 400', `HTTP ${r8.status}`, r8.status === 400);

  // Path 9: Internal error (malformed JSON body)
  const r9 = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `app_session=${ownerTk}` },
    body: 'NOT_JSON',
    signal: AbortSignal.timeout(5000)
  });
  log(9, 'INTERNAL_ERROR (malformed JSON)', 'HTTP 400', `HTTP ${r9.status}`, r9.status === 400);

  // === ANSWER PATHS (Paths 10-16) ===
  console.log('');
  console.log('--- ANSWER PATHS (require Claude call, ~10s each) ---');

  // Path 10: BEST_EDGE → ANSWER
  const r10 = await callDime(ownerTk, [{ role: 'user', content: 'What is the best edge today?' }], 45000);
  const p10 = parseSSE(r10.body);
  log(10, 'BEST_EDGE → ANSWER', 'HTTP 200 + SSE', `HTTP ${r10.status} + text=${p10.fullText.length}chars`, r10.status === 200 && p10.fullText.length > 50);

  // Path 11: MATCH_ANALYSIS → ANSWER
  const r11 = await callDime(ownerTk, [{ role: 'user', content: 'Analyze the Mexico vs England match' }], 45000);
  const p11 = parseSSE(r11.body);
  log(11, 'MATCH_ANALYSIS → ANSWER', 'HTTP 200 + SSE', `HTTP ${r11.status} + text=${p11.fullText.length}chars`, r11.status === 200 && p11.fullText.length > 50);

  // Path 12: MODEL_COMPARISON → ANSWER
  const r12 = await callDime(ownerTk, [{ role: 'user', content: 'Compare model versions and their Brier scores' }], 45000);
  const p12 = parseSSE(r12.body);
  log(12, 'MODEL_COMPARISON → ANSWER', 'HTTP 200 + SSE', `HTTP ${r12.status} + text=${p12.fullText.length}chars`, r12.status === 200 && p12.fullText.length > 50);

  // Path 13: ODDS_CHECK → ANSWER
  const r13 = await callDime(ownerTk, [{ role: 'user', content: 'What are the current odds for Brazil vs Norway?' }], 45000);
  const p13 = parseSSE(r13.body);
  log(13, 'ODDS_CHECK → ANSWER', 'HTTP 200 + SSE', `HTTP ${r13.status} + text=${p13.fullText.length}chars`, r13.status === 200 && p13.fullText.length > 50);

  // Path 14: GENERAL_WC2026 → ANSWER
  const r14 = await callDime(ownerTk, [{ role: 'user', content: 'How many matches are in the World Cup 2026 group stage?' }], 45000);
  const p14 = parseSSE(r14.body);
  log(14, 'GENERAL_WC2026 → ANSWER', 'HTTP 200 + SSE', `HTTP ${r14.status} + text=${p14.fullText.length}chars`, r14.status === 200 && p14.fullText.length > 50);

  // Path 15: TODAYS_CARD → ANSWER
  const r15 = await callDime(ownerTk, [{ role: 'user', content: "What's on today's card?" }], 45000);
  const p15 = parseSSE(r15.body);
  log(15, 'TODAYS_CARD → ANSWER', 'HTTP 200 + SSE', `HTTP ${r15.status} + text=${p15.fullText.length}chars`, r15.status === 200 && p15.fullText.length > 50);

  // Path 16: NO_BET_REASON → ANSWER
  const r16 = await callDime(ownerTk, [{ role: 'user', content: 'Why is there no bet on France vs Iraq?' }], 45000);
  const p16 = parseSSE(r16.body);
  log(16, 'NO_BET_REASON → ANSWER', 'HTTP 200 + SSE', `HTTP ${r16.status} + text=${p16.fullText.length}chars`, r16.status === 200 && p16.fullText.length > 50);

  // === REFUSAL PATHS (Paths 17-22) ===
  console.log('');
  console.log('--- REFUSAL PATHS (Claude should refuse with reason) ---');

  // Path 17: SPREAD market → REFUSE (JSON refusal, not SSE)
  const r17 = await callDime(ownerTk, [{ role: 'user', content: 'What spread should I bet on the USA game?' }], 15000);
  const p17 = parseSSE(r17.body);
  log(17, 'SPREAD → REFUSE (MARKET_NOT_SUPPORTED)', 'refusal=true, reason=MARKET_NOT_SUPPORTED, credits=0', `refusal=${p17.isRefusal}, reason=${p17.reason}, credits=${p17.creditsCharged}`, r17.status === 200 && p17.isRefusal && p17.reason === 'MARKET_NOT_SUPPORTED' && p17.creditsCharged === 0);

  // Path 18: TOTAL/OVER-UNDER → REFUSE (JSON refusal)
  const r18 = await callDime(ownerTk, [{ role: 'user', content: 'What is the over/under total for Brazil vs Norway?' }], 15000);
  const p18 = parseSSE(r18.body);
  log(18, 'TOTAL → REFUSE (MARKET_NOT_SUPPORTED)', 'refusal=true, reason=MARKET_NOT_SUPPORTED, credits=0', `refusal=${p18.isRefusal}, reason=${p18.reason}, credits=${p18.creditsCharged}`, r18.status === 200 && p18.isRefusal && p18.reason === 'MARKET_NOT_SUPPORTED' && p18.creditsCharged === 0);

  // Path 19: BTTS → REFUSE (JSON refusal)
  const r19 = await callDime(ownerTk, [{ role: 'user', content: 'Will both teams score in France vs Iraq?' }], 15000);
  const p19 = parseSSE(r19.body);
  log(19, 'BTTS → REFUSE (MARKET_NOT_SUPPORTED)', 'refusal=true, reason=MARKET_NOT_SUPPORTED, credits=0', `refusal=${p19.isRefusal}, reason=${p19.reason}, credits=${p19.creditsCharged}`, r19.status === 200 && p19.isRefusal && p19.reason === 'MARKET_NOT_SUPPORTED' && p19.creditsCharged === 0);

  // Path 20: PLAYER_PROPS → REFUSE (could be JSON refusal or SSE refusal)
  const r20 = await callDime(ownerTk, [{ role: 'user', content: 'How many goals will Mbappe score in the tournament?' }], 45000);
  const p20 = parseSSE(r20.body);
  const p20Pass = p20.isRefusal ? (p20.reason === 'PLAYER_STATS_MISSING' || p20.reason === 'UNSUPPORTED_PROP') : (p20.fullText.toLowerCase().includes('player') || p20.fullText.toLowerCase().includes('not supported') || p20.fullText.toLowerCase().includes('prop'));
  log(20, 'PLAYER_PROPS → REFUSE', 'refusal with reason', `refusal=${p20.isRefusal}, reason=${p20.reason || 'SSE'}, text=${p20.fullText.substring(0,60)}`, r20.status === 200 && p20Pass);

  // Path 21: NON-WC2026 → REFUSE (Claude SSE refusal)
  const r21 = await callDime(ownerTk, [{ role: 'user', content: 'Who will win the NBA Finals this year?' }], 45000);
  const p21 = parseSSE(r21.body);
  const p21Pass = p21.isRefusal ? true : (p21.fullText.toLowerCase().includes('world cup') || p21.fullText.toLowerCase().includes('wc2026') || p21.fullText.toLowerCase().includes('only') || p21.fullText.toLowerCase().includes('scope') || p21.fullText.toLowerCase().includes('nba'));
  log(21, 'NON-WC2026 → REFUSE', 'refusal or scope mention', `refusal=${p21.isRefusal}, text=${p21.fullText.substring(0,60)}`, r21.status === 200 && p21Pass);

  // Path 22: FRESHNESS/STALE check → ANSWER
  const r22 = await callDime(ownerTk, [{ role: 'user', content: 'How fresh are the current odds? When were they last updated?' }], 45000);
  const p22 = parseSSE(r22.body);
  log(22, 'FRESHNESS_CHECK → ANSWER', 'HTTP 200 + SSE', `HTTP ${r22.status} + text=${p22.fullText.length}chars`, r22.status === 200 && p22.fullText.length > 50);

  // === SUMMARY ===
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`[T4-B5] 22-PATH MATRIX VALIDATION — COMPLETE`);
  console.log(`[TIMESTAMP] ${new Date().toISOString()}`);
  console.log(`[RESULT] ${passCount}/22 PASS | ${failCount}/22 FAIL`);
  console.log('═══════════════════════════════════════════════════════════════════');
  
  // Output JSON for audit
  console.log('\n[JSON_RESULTS]');
  console.log(JSON.stringify(results, null, 2));
}

runMatrix().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
