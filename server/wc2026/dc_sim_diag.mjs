// DC Sim Diagnostic — verify spread coverage probabilities
// Zero external dependencies

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dcAdjust(x, y, mu, nu, rho) {
  if (x === 0 && y === 0) return 1 - mu * nu * rho;
  if (x === 0 && y === 1) return 1 + mu * rho;
  if (x === 1 && y === 0) return 1 + nu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function runDCSim(lambdaH, lambdaA, rho, spreadLine) {
  const MAX_G = 10;
  let pH = 0, pD = 0, pA = 0;
  let pOver = 0, pUnder = 0, pBTTS = 0;
  let pHomeSpread = 0, pAwaySpread = 0;
  let total = 0;

  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      const p = poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA) * dcAdjust(h, a, lambdaH, lambdaA, rho);
      if (p <= 0) continue;
      total += p;
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
      if (h + a > 2.5) pOver += p;
      else pUnder += p;
      if (h > 0 && a > 0) pBTTS += p;
      if (h - a > spreadLine) pHomeSpread += p;
      else pAwaySpread += p;
    }
  }

  console.log(`[DIAG] total before renorm: ${total.toFixed(6)}`);
  console.log(`[DIAG] pH=${pH.toFixed(4)} pD=${pD.toFixed(4)} pA=${pA.toFixed(4)} sum=${(pH+pD+pA).toFixed(4)}`);
  console.log(`[DIAG] pOver=${pOver.toFixed(4)} pUnder=${pUnder.toFixed(4)} sum=${(pOver+pUnder).toFixed(4)}`);
  console.log(`[DIAG] pHomeSpread=${pHomeSpread.toFixed(4)} pAwaySpread=${pAwaySpread.toFixed(4)} sum=${(pHomeSpread+pAwaySpread).toFixed(4)}`);
  console.log(`[DIAG] pBTTS=${pBTTS.toFixed(4)}`);

  // After renorm
  pH /= total; pD /= total; pA /= total;
  pOver /= total; pUnder /= total; pBTTS /= total;
  pHomeSpread /= total; pAwaySpread /= total;

  console.log(`\n[RENORM] pH=${pH.toFixed(4)} pD=${pD.toFixed(4)} pA=${pA.toFixed(4)}`);
  console.log(`[RENORM] pOver=${pOver.toFixed(4)} pUnder=${pUnder.toFixed(4)}`);
  console.log(`[RENORM] pHomeSpread=${pHomeSpread.toFixed(4)} pAwaySpread=${pAwaySpread.toFixed(4)}`);
  console.log(`[RENORM] pBTTS=${pBTTS.toFixed(4)}`);

  // Manual spot check: P(2-0)
  const p20 = poissonPMF(2, lambdaH) * poissonPMF(0, lambdaA) * dcAdjust(2, 0, lambdaH, lambdaA, rho);
  const p30 = poissonPMF(3, lambdaH) * poissonPMF(0, lambdaA) * dcAdjust(3, 0, lambdaH, lambdaA, rho);
  const p31 = poissonPMF(3, lambdaH) * poissonPMF(1, lambdaA) * dcAdjust(3, 1, lambdaH, lambdaA, rho);
  const p21 = poissonPMF(2, lambdaH) * poissonPMF(1, lambdaA) * dcAdjust(2, 1, lambdaH, lambdaA, rho);
  const p40 = poissonPMF(4, lambdaH) * poissonPMF(0, lambdaA) * dcAdjust(4, 0, lambdaH, lambdaA, rho);
  const p41 = poissonPMF(4, lambdaH) * poissonPMF(1, lambdaA) * dcAdjust(4, 1, lambdaH, lambdaA, rho);
  const p32 = poissonPMF(3, lambdaH) * poissonPMF(2, lambdaA) * dcAdjust(3, 2, lambdaH, lambdaA, rho);
  console.log(`\n[SPOT] P(2-0)=${p20.toFixed(4)} P(3-0)=${p30.toFixed(4)} P(3-1)=${p31.toFixed(4)} P(2-1)=${p21.toFixed(4)}`);
  console.log(`[SPOT] P(4-0)=${p40.toFixed(4)} P(4-1)=${p41.toFixed(4)} P(3-2)=${p32.toFixed(4)}`);
  const manualSpread = p20 + p30 + p31 + p40 + p41 + p32;
  console.log(`[SPOT] Manual spread coverage (top 7 scores): ${manualSpread.toFixed(4)}`);
}

// Test cases from v14 report
console.log('\n══════════════════════════════════════');
console.log('TEST 1: ENG vs COD | λH=1.8324 λA=1.0545 rho=0.065 spread=1.5');
console.log('══════════════════════════════════════');
runDCSim(1.8324, 1.0545, 0.065, 1.5);

console.log('\n══════════════════════════════════════');
console.log('TEST 2: BEL vs SEN | λH=1.9856 λA=1.7255 rho=0.065 spread=1.5');
console.log('══════════════════════════════════════');
runDCSim(1.9856, 1.7255, 0.065, 1.5);

console.log('\n══════════════════════════════════════');
console.log('TEST 3: USA vs BIH | λH=1.5687 λA=0.7101 rho=0.065 spread=1.5');
console.log('══════════════════════════════════════');
runDCSim(1.5687, 0.7101, 0.065, 1.5);
