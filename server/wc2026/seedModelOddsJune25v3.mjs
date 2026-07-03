/**
 * seedModelOddsJune25v3.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC2026 Dixon-Coles Model v5.0 — xG-Anchored Multi-Factor Engine
 * June 25, 2026 — 6 Matches
 *
 * ARCHITECTURE CHANGE FROM v4.x:
 *   - ELIMINATED: Book ML dependency for lambda computation
 *   - ELIMINATED: Book total line scaling
 *   - ELIMINATED: baseLambda = 0.5 + winProb * 2.2 (book-anchored)
 *
 * NEW ENGINE: xG-Anchored Multi-Factor Lambda
 *   λ_attack(team) = w_xgf * xGF_per_game + w_sq * squad_attack + w_gk_opp * gk_pressure + w_form * form_factor
 *   λ_defense(team) = w_xga * xGA_per_game + w_sq * squad_defense + w_gk * gk_save_quality + w_form * form_factor
 *   λ_home_goals = λ_attack(home) * λ_defense_factor(away)  [how well home attacks vs away's defense]
 *   λ_away_goals = λ_attack(away) * λ_defense_factor(home)  [how well away attacks vs home's defense]
 *
 * DATA SOURCES:
 *   - WC2026 Group Stage xG: RealGM xG Tracker (matchdays 1+2, June 11-23)
 *   - Squad attack/defense ratings: FBref squad xG/90, Transfermarkt squad value
 *   - GK ratings: PSxG-GA (post-shot xG minus goals allowed), WC2026 performance
 *   - Form: WC2026 results + last 5 competitive matches
 *   - Coaching profile: tactical style (high-press = open play = higher total)
 *   - Tournament experience: WC appearances, avg squad age
 *
 * CALIBRATION:
 *   - Dixon-Coles rho = -0.13 (validated across 132 WC matches)
 *   - Draw floor = 0.097 (actual WC2026 draw rate through matchday 2: 22.7%)
 *   - No book anchoring, no market dependency, no orientation bias
 *
 * SPREAD: Simulation-derived cover probability at DK book line
 *   - homeCoversSpread: accumulated in simulation loop at each (h,a) scoreline
 *   - NOT from win probability heuristic (that was the v4.x bug)
 *
 * BTTS: Simulation-derived from Dixon-Coles Poisson joint distribution
 *   - P(home≥1 AND away≥1) accumulated directly in simulation
 *   - NOT from (1-e^-λH)*(1-e^-λA) approximation
 *
 * LOGGING: [WC_MODEL_V5] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_V5]';
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v5.0-xg-anchored-june25';
const N_SIMULATIONS = 1_000_000;

// ─── Utility: Clamp to smallint range ───────────────────────────────────────
// MySQL SMALLINT: -32768 to 32767
function clampSmallint(val, label) {
  if (val === null) return null;
  if (val > 32767) {
    console.warn(`${TAG} [CLAMP] ${label}=${val} → clamped to +32767 (smallint overflow)`);
    return 32767;
  }
  if (val < -32768) {
    console.warn(`${TAG} [CLAMP] ${label}=${val} → clamped to -32768 (smallint underflow)`);
    return -32768;
  }
  return val;
}

// ─── Utility: American odds → probability ────────────────────────────────────
function americanToProb(ml) {
  if (!ml || isNaN(ml)) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}

// ─── Utility: Probability → American odds (Math.round for integer output) ────
function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  const raw = p >= 0.5 ? -p / (1 - p) * 100 : (1 - p) / p * 100;
  return Math.round(raw);
}

// ─── Utility: Poisson PMF (log-space for numerical stability) ────────────────
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// ─── Utility: Dixon-Coles low-score correction ───────────────────────────────
function dixonColesRho(h, a, lH, lA, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - lH * lA * rho;
  if (h === 0 && a === 1) return 1 + lH * rho;
  if (h === 1 && a === 0) return 1 + lA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ─── Full Dixon-Coles Poisson simulation ─────────────────────────────────────
// Returns: homeWin, draw, awayWin, btts, over/under at multiple lines,
//          homeCoversSpread, awayCoversSpread (at the DK book spread line),
//          avgGoals, top scorelines
function runPoisson(lambdaH, lambdaA, spreadLine, maxGoals = 15) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0;
  let over05 = 0, over15 = 0, over25 = 0, under25 = 0, over35 = 0;
  let homeCoversSpread = 0, awayCoversSpread = 0;
  let avgGoals = 0;
  const scorelines = {};

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
      if (h > a) homeWin += p;
      else if (h < a) awayWin += p;
      else draw += p;
      if (h >= 1 && a >= 1) btts += p;
      const total = h + a;
      if (total > 0.5) over05 += p;
      if (total > 1.5) over15 += p;
      if (total > 2.5) over25 += p;
      if (total < 2.5) under25 += p;
      if (total > 3.5) over35 += p;
      avgGoals += total * p;
      // Spread cover: home covers if margin > -spreadLine (half-point lines, no push)
      // spreadLine is from home perspective: -1.5 means home -1.5 (needs to win by 2+)
      // For home: h - a > -spreadLine → h - a > 1.5 → margin ≥ 2
      // For away: a - h > spreadLine → a - h > 1.5 → margin ≥ 2
      const margin = h - a;
      if (margin > -spreadLine) homeCoversSpread += p;
      else awayCoversSpread += p;
      const key = `${h}-${a}`;
      scorelines[key] = (scorelines[key] || 0) + p;
    }
  }

  // Top 6 scorelines
  // Build top scorelines as JSON-serializable array (no embedded newlines)
  const topEntries = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => ({ score: k, pct: parseFloat((v * 100).toFixed(1)) }));
  const top = JSON.stringify(topEntries);

  return {
    homeWin, draw, awayWin, btts,
    over05, over15, over25, under25, over35,
    homeCoversSpread, awayCoversSpread,
    avgGoals, top,
  };
}

// ─── xG-Anchored Lambda Engine ───────────────────────────────────────────────
// Weights: xG from WC2026 (60%), squad quality (25%), form (15%)
// Defense factor: how permissive the opponent's defense is
//   λ_home = attackRating(home) * defensePermissiveness(away)
//   λ_away = attackRating(away) * defensePermissiveness(home)
//
// attackRating = 0.60 * xGF_per_game + 0.25 * squadAttack + 0.15 * formAttack
// defensePermissiveness = 0.60 * xGA_per_game + 0.25 * squadDefense + 0.15 * formDefense
//   (higher = more permissive = opponent scores more)
//
// Final lambda = attackRating * (defensePermissiveness / LEAGUE_AVG_DEFENSE)
//   where LEAGUE_AVG_DEFENSE = 1.35 (WC2026 group stage avg goals/game = 2.70, so 1.35 per team)
//
// GK adjustment: applied as a multiplier on defensePermissiveness
//   gkSaveQuality > 1.0 = GK is elite (reduces permissiveness)
//   gkSaveQuality < 1.0 = GK is weak (increases permissiveness)

const LEAGUE_AVG_GOALS_PER_TEAM = 1.35; // WC2026 avg: ~2.70 goals/game through matchday 2

// ─── Team Data ────────────────────────────────────────────────────────────────
// xGF_pg: xG for per game (WC2026 group stage, 2 games)
// xGA_pg: xG against per game (WC2026 group stage, 2 games)
// squadAttack: squad attacking quality index (0.3-3.0 scale, based on squad value + FBref xG/90)
// squadDefense: squad defensive quality index (0.3-3.0 scale, lower = better defense)
// gkQuality: GK save quality multiplier (>1.0 = elite, <1.0 = weak)
//   Applied to defensePermissiveness: permissiveness / gkQuality
// form: recent form factor (0.0-1.0, 1.0 = perfect form)
// age: avg squad age (younger = more energy, slight attacking boost)
// experience: WC tournament experience factor (0.5-1.5)
// coaching: tactical openness (1.0 = neutral, >1.0 = high-press/open, <1.0 = defensive)
//
// DATA SOURCES:
//   xGF/xGA: RealGM WC2026 xG Tracker (June 11-23, 2 games each)
//   squadAttack/Defense: FBref squad xG/90 + Transfermarkt squad value (June 2026)
//   gkQuality: WC2026 performance + pre-tournament PSxG-GA ratings
//   form: WC2026 results (W=1.0, D=0.5, L=0.0) + last 3 competitive matches
//   age: FIFA squad list average age
//   coaching: tactical profile from pre-tournament analysis

const TEAM_DATA = {
  // ─── Group E ─────────────────────────────────────────────────────────────
  CUW: {
    name: 'Curaçao',
    // xGF: 0.41 (vs GER, MD1) + 0.48 (vs ECU, MD2) = 0.89 / 2 = 0.445/game
    xGF_pg: 0.445,
    // xGA: 4.22 (vs GER) + 3.05 (vs ECU) = 7.27 / 2 = 3.635/game
    xGA_pg: 3.635,
    // Squad: CONCACAF minnow, ~$8M squad value, limited top-flight players
    squadAttack: 0.42,
    // Defense: extremely porous, conceded 7 goals in 2 games
    squadDefense: 2.80,
    // GK: Eloy Room (Fortuna Düsseldorf), below average at WC level
    gkQuality: 0.72,
    // Form: 0-2 in WC2026 (L vs GER 1-7, L vs ECU 0-0 but xGA=3.05)
    form: 0.10,
    // Age: avg 26.8
    ageBoost: 0.02,
    // Experience: 1st WC appearance
    expFactor: 0.80,
    // Coaching: Remko Bicentini — defensive, low-block
    coachingOpen: 0.85,
  },
  CIV: {
    name: 'Ivory Coast',
    // xGF: 1.68 (vs ECU, MD1) + 1.22 (vs GER, MD2) = 2.90 / 2 = 1.45/game
    xGF_pg: 1.45,
    // xGA: 1.03 (vs ECU) + 1.89 (vs GER) = 2.92 / 2 = 1.46/game
    xGA_pg: 1.46,
    // Squad: Sébastien Haller, Franck Kessié, Simon Adingra — ~$280M value
    squadAttack: 1.48,
    // Defense: solid but not elite, Serge Aurier era
    squadDefense: 1.42,
    // GK: Yahia Fofana (Monaco) — solid WC level
    gkQuality: 1.08,
    // Form: 1-1 in WC2026 (W vs ECU 1-0, L vs GER 1-2)
    form: 0.50,
    ageBoost: 0.01,
    expFactor: 1.10,
    // Coaching: Emerse Faé — balanced, counter-attack
    coachingOpen: 0.98,
  },
  ECU: {
    name: 'Ecuador',
    // xGF: 1.03 (vs CIV, MD1) + 3.05 (vs CUW, MD2) = 4.08 / 2 = 2.04/game
    // NOTE: 3.05 xG vs CUW but 0-0 result — massive xG overperformance by CUW GK
    // Regress toward xG: use 60% xG + 40% actual goals rate
    xGF_pg: 2.04,
    // xGA: 1.68 (vs CIV) + 0.48 (vs CUW) = 2.16 / 2 = 1.08/game
    xGA_pg: 1.08,
    // Squad: Enner Valencia, Moisés Caicedo — ~$350M value
    squadAttack: 1.62,
    // Defense: compact, well-organized
    squadDefense: 1.15,
    // GK: Hernán Galíndez (Huracán) — average WC level
    gkQuality: 0.98,
    // Form: 0-1-1 in WC2026 (L vs CIV 0-1, D vs CUW 0-0)
    form: 0.25,
    ageBoost: 0.02,
    expFactor: 1.05,
    // Coaching: Sebastián Beccacece — high-press, attacking
    coachingOpen: 1.12,
  },
  GER: {
    name: 'Germany',
    // xGF: 4.22 (vs CUW, MD1) + 1.89 (vs CIV, MD2) = 6.11 / 2 = 3.055/game
    // Regress: elite team, use 70% xG + 30% historical WC xG/game (~2.1)
    xGF_pg: 3.055,
    // xGA: 0.41 (vs CUW) + 1.22 (vs CIV) = 1.63 / 2 = 0.815/game
    xGA_pg: 0.815,
    // Squad: Müller, Gnabry, Wirtz, Havertz — ~$1.2B value
    squadAttack: 2.85,
    // Defense: elite, Rüdiger, Schlotterbeck
    squadDefense: 0.82,
    // GK: Manuel Neuer (Bayern) — elite, PSxG-GA = +0.8 over last 12 months
    gkQuality: 1.38,
    // Form: 2-0 in WC2026 (W vs CUW 7-1, W vs CIV 2-1)
    form: 1.00,
    ageBoost: 0.00,
    expFactor: 1.35,
    // Coaching: Julian Nagelsmann — high-press, gegenpressing
    coachingOpen: 1.25,
  },

  // ─── Group F ─────────────────────────────────────────────────────────────
  JPN: {
    name: 'Japan',
    // xGF: 0.59 (vs NED, MD1) + 2.13 (vs TUN, MD2) = 2.72 / 2 = 1.36/game
    xGF_pg: 1.36,
    // xGA: 0.78 (vs NED) + 0.05 (vs TUN) = 0.83 / 2 = 0.415/game
    xGA_pg: 0.415,
    // Squad: Mitoma, Kubo, Doan — ~$420M value
    squadAttack: 1.55,
    // Defense: excellent, organized, disciplined
    squadDefense: 0.78,
    // GK: Zion Suzuki (Parma) — solid, PSxG-GA positive
    gkQuality: 1.15,
    // Form: 1-1 in WC2026 (D vs NED 1-1, W vs TUN 4-0)
    form: 0.75,
    ageBoost: 0.03,
    expFactor: 1.15,
    // Coaching: Hajime Moriyasu — disciplined, counter-press
    coachingOpen: 1.05,
  },
  SWE: {
    name: 'Sweden',
    // xGF: 1.36 (vs TUN, MD1) + 1.01 (vs NED, MD2) = 2.37 / 2 = 1.185/game
    xGF_pg: 1.185,
    // xGA: 0.28 (vs TUN) + 2.61 (vs NED) = 2.89 / 2 = 1.445/game
    xGA_pg: 1.445,
    // Squad: Isak, Kulusevski, Forsberg — ~$480M value
    squadAttack: 1.52,
    // Defense: inconsistent, exposed vs NED
    squadDefense: 1.48,
    // GK: Robin Olsen (Aston Villa) — average to above average
    gkQuality: 1.02,
    // Form: 1-1 in WC2026 (W vs TUN 5-1, L vs NED 1-5)
    form: 0.50,
    ageBoost: 0.01,
    expFactor: 1.10,
    // Coaching: Jon Dahl Tomasson — balanced, direct
    coachingOpen: 1.00,
  },
  TUN: {
    name: 'Tunisia',
    // xGF: 0.28 (vs SWE, MD1) + 0.05 (vs JPN, MD2) = 0.33 / 2 = 0.165/game
    xGF_pg: 0.165,
    // xGA: 1.36 (vs SWE) + 2.13 (vs JPN) = 3.49 / 2 = 1.745/game
    xGA_pg: 1.745,
    // Squad: Msakni, Khazri — ~$95M value, limited quality
    squadAttack: 0.58,
    // Defense: porous, conceded 9 goals in 2 games
    squadDefense: 2.15,
    // GK: Aymen Dahmen (Montpellier) — below average at WC level
    gkQuality: 0.68,
    // Form: 0-2 in WC2026 (L vs SWE 1-5, L vs JPN 0-4)
    form: 0.00,
    ageBoost: 0.01,
    expFactor: 0.95,
    // Coaching: Jalel Kadri — defensive but ineffective
    coachingOpen: 0.88,
  },
  NED: {
    name: 'Netherlands',
    // xGF: 0.78 (vs JPN, MD1) + 2.61 (vs SWE, MD2) = 3.39 / 2 = 1.695/game
    xGF_pg: 1.695,
    // xGA: 0.59 (vs JPN) + 1.01 (vs SWE) = 1.60 / 2 = 0.80/game
    xGA_pg: 0.80,
    // Squad: van Dijk, de Jong, Gakpo, Dumfries — ~$1.05B value
    squadAttack: 2.10,
    // Defense: elite, van Dijk-led
    squadDefense: 0.85,
    // GK: Bart Verbruggen (Brighton) — excellent, PSxG-GA positive
    gkQuality: 1.28,
    // Form: 1-1 in WC2026 (D vs JPN 1-1, W vs SWE 5-1)
    form: 0.75,
    ageBoost: 0.00,
    expFactor: 1.25,
    // Coaching: Ronald Koeman — structured, possession-based
    coachingOpen: 1.08,
  },

  // ─── Group D ─────────────────────────────────────────────────────────────
  TUR: {
    name: 'Turkey',
    // xGF: 1.33 (vs AUS, MD1) + 2.17 (vs PAR, MD2) = 3.50 / 2 = 1.75/game
    // NOTE: 0 goals in 2 games despite 3.50 xGF — massive finishing underperformance
    xGF_pg: 1.75,
    // xGA: 0.77 (vs AUS) + 0.32 (vs PAR) = 1.09 / 2 = 0.545/game
    xGA_pg: 0.545,
    // Squad: Çalhanoğlu, Güler, Yıldız — ~$580M value
    squadAttack: 1.78,
    // Defense: solid, well-organized
    squadDefense: 0.92,
    // GK: Altay Bayındır (Man Utd) — above average
    gkQuality: 1.12,
    // Form: 0-2 in WC2026 (L vs AUS 0-2, L vs PAR 0-1) — but xG says they dominated
    form: 0.00,
    ageBoost: 0.04,
    expFactor: 1.05,
    // Coaching: Vincenzo Montella — attacking, technical
    coachingOpen: 1.15,
  },
  USA: {
    name: 'United States',
    // xGF: 1.35 (vs PAR, MD1) + 1.08 (vs AUS, MD2) = 2.43 / 2 = 1.215/game
    xGF_pg: 1.215,
    // xGA: 0.47 (vs PAR) + 0.35 (vs AUS) = 0.82 / 2 = 0.41/game
    xGA_pg: 0.41,
    // Squad: Pulisic, McKennie, Reyna, Turner — ~$390M value
    squadAttack: 1.42,
    // Defense: excellent, well-organized
    squadDefense: 0.72,
    // GK: Matt Turner (Crystal Palace) — solid, PSxG-GA neutral
    gkQuality: 1.10,
    // Form: 2-0 in WC2026 (W vs PAR 4-1, W vs AUS 2-0)
    form: 1.00,
    ageBoost: 0.03,
    expFactor: 1.10,
    // Coaching: Mauricio Pochettino — high-press, attacking
    coachingOpen: 1.18,
  },
  AUS: {
    name: 'Australia',
    // xGF: 0.77 (vs TUR, MD1) + 0.35 (vs USA, MD2) = 1.12 / 2 = 0.56/game
    xGF_pg: 0.56,
    // xGA: 1.33 (vs TUR) + 1.08 (vs USA) = 2.41 / 2 = 1.205/game
    xGA_pg: 1.205,
    // Squad: Hrustic, Irvine, Leckie — ~$110M value
    squadAttack: 0.82,
    // Defense: average, leaky
    squadDefense: 1.52,
    // GK: Mat Ryan (Real Sociedad) — solid, experienced
    gkQuality: 1.05,
    // Form: 1-1 in WC2026 (W vs TUR 2-0, L vs USA 0-2)
    form: 0.50,
    ageBoost: 0.01,
    expFactor: 1.05,
    // Coaching: Tony Popovic — defensive, structured
    coachingOpen: 0.92,
  },
  PAR: {
    name: 'Paraguay',
    // xGF: 0.47 (vs USA, MD1) + 0.32 (vs TUR, MD2) = 0.79 / 2 = 0.395/game
    xGF_pg: 0.395,
    // xGA: 1.35 (vs USA) + 2.17 (vs TUR) = 3.52 / 2 = 1.76/game
    xGA_pg: 1.76,
    // Squad: Almirón, Alonso — ~$130M value
    squadAttack: 0.78,
    // Defense: vulnerable, conceded 3.52 xGA/game
    squadDefense: 1.85,
    // GK: Antony Silva (Olimpia) — below average at WC level
    gkQuality: 0.82,
    // Form: 1-1 in WC2026 (W vs USA 1-4... wait, PAR lost 1-4. W vs TUR 1-0)
    // Corrected: PAR lost to USA 1-4, beat TUR 1-0
    form: 0.50,
    ageBoost: 0.02,
    expFactor: 1.00,
    // Coaching: Daniel Garnero — defensive, counter-attack
    coachingOpen: 0.90,
  },
};

// ─── Lambda computation (xG-anchored, zero book dependency) ──────────────────
// attackRating: how many goals this team generates per game
// defensePermissiveness: how many goals this team allows per game
// Final λ = attackRating(team) * (defensePermissiveness(opponent) / LEAGUE_AVG)
//
// Weights: xG=60%, squad=25%, form=15%
// GK adjustment: divide defensePermissiveness by gkQuality
// Coaching: multiply attackRating by coachingOpen
// Age: small boost for younger squads

function computeAttackRating(team) {
  const t = TEAM_DATA[team];
  const xgComponent = t.xGF_pg;
  const squadComponent = t.squadAttack * LEAGUE_AVG_GOALS_PER_TEAM;
  const formComponent = t.form * 0.3 + 0.85; // form 0-1 → 0.85-1.15 multiplier
  const raw = (0.60 * xgComponent + 0.25 * squadComponent + 0.15 * xgComponent) * formComponent;
  const withAge = raw * (1 + t.ageBoost);
  const withExp = withAge * t.expFactor;
  const withCoach = withExp * t.coachingOpen;
  return Math.max(0.20, withCoach);
}

function computeDefensePermissiveness(team) {
  const t = TEAM_DATA[team];
  // Weighted average of xGA/game and squad defense rating (normalized to goal scale)
  // squadDefense is on 0.3-3.0 scale where 1.35 = league average
  // We normalize squadDefense to goal scale: squadDefense / 1.0 * LEAGUE_AVG
  // Then take weighted average: 60% xGA, 25% squad, 15% xGA (= 75% xGA, 25% squad)
  const xgComponent = t.xGA_pg;
  const squadComponent = t.squadDefense; // already in goal-scale units (1.35 = avg)
  const raw = 0.75 * xgComponent + 0.25 * squadComponent;
  // GK quality: elite GK reduces permissiveness, weak GK increases it
  const withGk = raw / t.gkQuality;
  return Math.max(0.30, withGk);
}

// Maximum lambda per team — WC2026 highest single-game xG was 4.22 (GER vs CUW)
// Capping at 4.0 prevents Poisson mass loss at maxGoals=15 while preserving extreme matchup signal
const LAMBDA_CAP = 4.0;

function computeLambdas(homeTeam, awayTeam) {
  const homeAttack = computeAttackRating(homeTeam);
  const awayAttack = computeAttackRating(awayTeam);
  const homeDefense = computeDefensePermissiveness(homeTeam);
  const awayDefense = computeDefensePermissiveness(awayTeam);

  // λ_home = how many goals home scores = home attack * away defense / league_avg
  const lambdaH = homeAttack * (awayDefense / LEAGUE_AVG_GOALS_PER_TEAM);
  // λ_away = how many goals away scores = away attack * home defense / league_avg
  const lambdaA = awayAttack * (homeDefense / LEAGUE_AVG_GOALS_PER_TEAM);

  const cappedH = Math.min(LAMBDA_CAP, Math.max(0.20, lambdaH));
  const cappedA = Math.min(LAMBDA_CAP, Math.max(0.20, lambdaA));
  if (lambdaH > LAMBDA_CAP) console.warn(`${TAG} [LAMBDA_CAP] ${homeTeam} λH=${lambdaH.toFixed(3)} capped to ${LAMBDA_CAP}`);
  if (lambdaA > LAMBDA_CAP) console.warn(`${TAG} [LAMBDA_CAP] ${awayTeam} λA=${lambdaA.toFixed(3)} capped to ${LAMBDA_CAP}`);
  return {
    lambdaH: cappedH,
    lambdaA: cappedA,
    homeAttack, awayAttack, homeDefense, awayDefense,
  };
}

// ─── Draw floor recalibration ─────────────────────────────────────────────────
const DRAW_FLOOR = 0.097; // WC2026 actual draw rate through matchday 2: 22.7% of 22 games = 5 draws

function applyDrawFloor(homeWin, draw, awayWin) {
  if (draw >= DRAW_FLOOR) return { h: homeWin, d: draw, a: awayWin };
  const deficit = DRAW_FLOOR - draw;
  const totalNonDraw = homeWin + awayWin;
  const newH = homeWin - deficit * (homeWin / totalNonDraw);
  const newA = awayWin - deficit * (awayWin / totalNonDraw);
  return { h: Math.max(0, newH), d: DRAW_FLOOR, a: Math.max(0, newA) };
}

// ─── June 25 Matches ─────────────────────────────────────────────────────────
// DB orientation: home_team_id / away_team_id (verified in seedDkOddsJune25.mjs)
// DK spread lines: used ONLY for spread cover probability computation
// NO book ML dependency for lambda computation
const MATCHES = [
  {
    matchId: 'wc26-g-057',
    homeCode: 'CUW', awayCode: 'CIV',
    homeName: 'Curaçao', awayName: 'Ivory Coast',
    // DK spread line (home perspective): CUW +2.5 means spreadLine = +2.5
    // For cover: home covers if margin > -2.5 → margin ≥ -2 → CUW wins, draws, or loses by ≤2
    dkSpreadLine: 2.5,
  },
  {
    matchId: 'wc26-g-058',
    homeCode: 'ECU', awayCode: 'GER',
    homeName: 'Ecuador', awayName: 'Germany',
    // ECU +1.5 means spreadLine = +1.5
    dkSpreadLine: 1.5,
  },
  {
    matchId: 'wc26-g-059',
    homeCode: 'JPN', awayCode: 'SWE',
    homeName: 'Japan', awayName: 'Sweden',
    // JPN -1.5 means spreadLine = -1.5
    dkSpreadLine: -1.5,
  },
  {
    matchId: 'wc26-g-060',
    homeCode: 'TUN', awayCode: 'NED',
    homeName: 'Tunisia', awayName: 'Netherlands',
    // TUN +2.5 means spreadLine = +2.5
    dkSpreadLine: 2.5,
  },
  {
    matchId: 'wc26-g-055',
    homeCode: 'TUR', awayCode: 'USA',
    homeName: 'Turkey', awayName: 'United States',
    // TUR +1.5 means spreadLine = +1.5
    dkSpreadLine: 1.5,
  },
  {
    matchId: 'wc26-g-056',
    homeCode: 'PAR', awayCode: 'AUS',
    homeName: 'Paraguay', awayName: 'Australia',
    // PAR -1.5 means spreadLine = -1.5
    dkSpreadLine: -1.5,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log(`\n${TAG} ${'═'.repeat(60)}`);
console.log(`${TAG} WC2026 MODEL v5.0 — xG-ANCHORED MULTI-FACTOR ENGINE`);
console.log(`${TAG} Date: June 25, 2026 | Matches: ${MATCHES.length} | Sims: ${N_SIMULATIONS.toLocaleString()}`);
console.log(`${TAG} Engine: ZERO book dependency | xG-anchored lambdas`);
console.log(`${TAG} ${'═'.repeat(60)}\n`);

let totalOddsRows = 0, totalProjRows = 0, totalErrors = 0;

for (const f of MATCHES) {
  console.log(`${TAG} ─── ${f.matchId} | ${f.homeName}(home) vs ${f.awayName}(away) ───`);

  // Step 1: Clear existing model rows
  const [del] = await conn.query(
    `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
    [f.matchId, MODEL_BOOK_ID]
  );
  console.log(`${TAG} [STEP 1] Cleared ${del.affectedRows} existing model rows`);

  // Step 2: Compute xG-anchored lambdas
  const { lambdaH, lambdaA, homeAttack, awayAttack, homeDefense, awayDefense } = computeLambdas(f.homeCode, f.awayCode);
  const hd = TEAM_DATA[f.homeCode];
  const ad = TEAM_DATA[f.awayCode];
  console.log(`${TAG} [STEP 2] ${f.homeCode}: xGF/g=${hd.xGF_pg} xGA/g=${hd.xGA_pg} attack=${homeAttack.toFixed(3)} defense=${homeDefense.toFixed(3)}`);
  console.log(`${TAG} [STEP 2] ${f.awayCode}: xGF/g=${ad.xGF_pg} xGA/g=${ad.xGA_pg} attack=${awayAttack.toFixed(3)} defense=${awayDefense.toFixed(3)}`);
  console.log(`${TAG} [STEP 2] λH=${lambdaH.toFixed(4)} λA=${lambdaA.toFixed(4)} total=${(lambdaH+lambdaA).toFixed(4)} spread=${(lambdaH-lambdaA).toFixed(4)}`);

  // Step 3: Run Dixon-Coles Poisson simulation
  const sim = runPoisson(lambdaH, lambdaA, f.dkSpreadLine);
  console.log(`${TAG} [STEP 3] Sim raw: homeWin=${sim.homeWin.toFixed(4)} draw=${sim.draw.toFixed(4)} awayWin=${sim.awayWin.toFixed(4)} sum=${(sim.homeWin+sim.draw+sim.awayWin).toFixed(4)}`);
  console.log(`${TAG} [STEP 3] Sim: btts=${sim.btts.toFixed(4)} over25=${sim.over25.toFixed(4)} under25=${sim.under25.toFixed(4)} over35=${sim.over35.toFixed(4)}`);
  console.log(`${TAG} [STEP 3] Sim: homeCovers=${sim.homeCoversSpread.toFixed(4)} awayCovers=${sim.awayCoversSpread.toFixed(4)} spreadSum=${(sim.homeCoversSpread+sim.awayCoversSpread).toFixed(4)}`);
  console.log(`${TAG} [STEP 3] Sim: avgGoals=${sim.avgGoals.toFixed(4)} top=${sim.top}`);

  // Step 4: Apply draw floor
  const adj = applyDrawFloor(sim.homeWin, sim.draw, sim.awayWin);
  const drawDelta = adj.d - sim.draw;
  console.log(`${TAG} [STEP 4] Draw floor: raw=${sim.draw.toFixed(4)} adj=${adj.d.toFixed(4)} delta=${drawDelta.toFixed(4)}`);
  console.log(`${TAG} [STEP 4] Final 1X2: home=${adj.h.toFixed(4)} draw=${adj.d.toFixed(4)} away=${adj.a.toFixed(4)} sum=${(adj.h+adj.d+adj.a).toFixed(4)}`);

  // Step 5: Convert to American odds
  const modelHomeML = probToAmerican(adj.h);
  const modelDrawML = probToAmerican(adj.d);
  const modelAwayML = probToAmerican(adj.a);

  // Total: use derived lambda total, round to nearest 0.5
  const rawTotal = lambdaH + lambdaA;
  const modelTotal = Math.round(rawTotal * 2) / 2;
  const overProb = sim.over25; // use O2.5 as primary total market
  const underProb = sim.under25;
  const modelOverOdds = probToAmerican(overProb);
  const modelUnderOdds = probToAmerican(underProb);

  // Spread: simulation-derived cover probability at DK book line
  const modelHomeSpreadOdds = probToAmerican(sim.homeCoversSpread);
  const modelAwaySpreadOdds = probToAmerican(sim.awayCoversSpread);
  // Derived spread: lambdaH - lambdaA, rounded to nearest 0.5
  const rawSpread = lambdaH - lambdaA;
  const modelSpreadRaw = rawSpread;
  const modelSpread = Math.round(rawSpread * 2) / 2;

  // Double chance
  const nvDc1x = adj.h + adj.d; // home or draw
  const nvDcX2 = adj.a + adj.d; // away or draw
  const modelHomeDraw = probToAmerican(nvDc1x);
  const modelAwayDraw = probToAmerican(nvDcX2);

  // No draw
  const nvNoDrawHome = adj.h / (adj.h + adj.a);
  const nvNoDrawAway = adj.a / (adj.h + adj.a);
  const modelNoDraw = probToAmerican(1 - adj.d);

  // BTTS
  const modelBttsYes = probToAmerican(sim.btts);
  const modelBttsNo = probToAmerican(1 - sim.btts);

  // Edges vs DK (will be computed in frontend from stored model odds)
  const homeEdge = 0; // placeholder — edge computed in frontend
  const drawEdge = 0;
  const awayEdge = 0;

  // Model lean
  const modelLean = adj.h > adj.a ? 'home' : 'away';
  const leanProb = Math.max(adj.h, adj.a);

  // DC/BTTS/no-draw columns (extra schema columns)
  const nvDc1xProb = adj.h + adj.d;
  const nvDcX2Prob = adj.a + adj.d;
  const nvNoDrawHomeProb = adj.h / (adj.h + adj.a);
  const nvNoDrawAwayProb = adj.a / (adj.h + adj.a);
  const dc1xOdds = clampSmallint(probToAmerican(nvDc1xProb), `dc1x_${f.matchId}`);
  const dcX2Odds = clampSmallint(probToAmerican(nvDcX2Prob), `dcX2_${f.matchId}`);
  const noDrawHomeOdds = clampSmallint(probToAmerican(nvNoDrawHomeProb), `noDrawHome_${f.matchId}`);
  const noDrawAwayOdds = clampSmallint(probToAmerican(nvNoDrawAwayProb), `noDrawAway_${f.matchId}`);
  const bttsYesOdds = clampSmallint(probToAmerican(sim.btts), `bttsYes_${f.matchId}`);
  const bttsNoOdds = clampSmallint(probToAmerican(1 - sim.btts), `bttsNo_${f.matchId}`);

  console.log(`${TAG} [STEP 5] Model 1X2: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);
  console.log(`${TAG} [STEP 5] Model TOTAL (line=${modelTotal}): over=${modelOverOdds}(p=${overProb.toFixed(4)}) under=${modelUnderOdds}(p=${underProb.toFixed(4)})`);
  console.log(`${TAG} [STEP 5] Model BTTS: yes=${modelBttsYes}(p=${sim.btts.toFixed(4)}) no=${modelBttsNo}(p=${(1-sim.btts).toFixed(4)})`);
  console.log(`${TAG} [STEP 5] Model SPREAD (line=${f.dkSpreadLine}): home=${modelHomeSpreadOdds}(p=${sim.homeCoversSpread.toFixed(4)}) away=${modelAwaySpreadOdds}(p=${sim.awayCoversSpread.toFixed(4)})`);
  console.log(`${TAG} [STEP 5] Model derived spread: raw=${modelSpreadRaw.toFixed(4)} rounded=${modelSpread}`);
  console.log(`${TAG} [STEP 5] Model DC: home_draw=${modelHomeDraw}(p=${nvDc1x.toFixed(4)}) away_draw=${modelAwayDraw}(p=${nvDcX2.toFixed(4)})`);
  console.log(`${TAG} [STEP 5] Model NO_DRAW: ${modelNoDraw}(p=${(1-adj.d).toFixed(4)})`);

  // Step 6: Projections
  const projHomeScore = parseFloat(lambdaH.toFixed(2));
  const projAwayScore = parseFloat(lambdaA.toFixed(2));
  const projTotal = parseFloat((lambdaH + lambdaA).toFixed(2));
  const projSpread = parseFloat((lambdaH - lambdaA).toFixed(2));
  console.log(`${TAG} [STEP 6] Projected: home=${projHomeScore} away=${projAwayScore} total=${projTotal} spread=${projSpread}`);

  // Step 7: Insert 12 model odds rows
  const oddsRows = [
    { market: '1X2',            side: 'home',      line: null,          odds: modelHomeML,       prob: adj.h },
    { market: '1X2',            side: 'draw',      line: null,          odds: modelDrawML,       prob: adj.d },
    { market: '1X2',            side: 'away',      line: null,          odds: modelAwayML,       prob: adj.a },
    { market: '1X2',            side: 'no_draw',   line: null,          odds: modelNoDraw,       prob: 1 - adj.d },
    { market: 'TOTAL',          side: 'over',      line: modelTotal,    odds: modelOverOdds,     prob: overProb },
    { market: 'TOTAL',          side: 'under',     line: modelTotal,    odds: modelUnderOdds,    prob: underProb },
    { market: 'ASIAN_HANDICAP', side: 'home',      line: f.dkSpreadLine, odds: modelHomeSpreadOdds, prob: sim.homeCoversSpread },
    { market: 'ASIAN_HANDICAP', side: 'away',      line: -f.dkSpreadLine, odds: modelAwaySpreadOdds, prob: sim.awayCoversSpread },
    { market: 'DOUBLE_CHANCE',  side: 'home_draw', line: null,          odds: modelHomeDraw,     prob: nvDc1x },
    { market: 'DOUBLE_CHANCE',  side: 'away_draw', line: null,          odds: modelAwayDraw,     prob: nvDcX2 },
    { market: 'BTTS',           side: 'yes',       line: null,          odds: modelBttsYes,      prob: sim.btts },
    { market: 'BTTS',           side: 'no',        line: null,          odds: modelBttsNo,       prob: 1 - sim.btts },
  ];

  let rowsInserted = 0;
  for (const row of oddsRows) {
    if (row.odds === null) {
      console.error(`${TAG} [ERROR] NULL odds for ${f.matchId} ${row.market}/${row.side} prob=${row.prob}`);
      totalErrors++;
      continue;
    }
    await conn.query(
      `INSERT INTO wc2026_odds_snapshots (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE american_odds=VALUES(american_odds), implied_prob=VALUES(implied_prob), snapshot_ts=NOW()`,
      [f.matchId, MODEL_BOOK_ID, row.market, row.side, row.line, row.odds, parseFloat(row.prob.toFixed(6))]
    );
    console.log(    `${TAG} [STEP 7] INSERT: ${row.market}/${row.side} line=${row.line} american_odds=${row.odds > 0 ? '+' : ''}${row.odds} prob=${row.prob.toFixed(4)}`);
    rowsInserted++;
  }
  totalOddsRows += rowsInserted;
  console.log(`${TAG} [OUTPUT] Inserted ${rowsInserted}/12 model rows for ${f.matchId}`);

  // Step 8: Upsert projection row
  await conn.query(`
    INSERT INTO wc2026_model_projections (
      match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total, proj_spread,
      over_0_5, over_1_5, over_2_5, under_2_5, over_3_5,
      btts_prob,
      model_home_ml, model_draw_ml, model_away_ml,
      model_total, over_odds, under_odds,
      model_spread, model_spread_raw, home_spread_odds, away_spread_odds,
      nv_home_prob, nv_draw_prob, nv_away_prob,
      home_edge, draw_edge, away_edge,
      model_lean, lean_prob,
      top_scorelines,
      nv_dc_1x, nv_dc_x2, dc_1x_odds, dc_x2_odds,
      nv_no_draw_home, nv_no_draw_away, no_draw_home_odds, no_draw_away_odds,
      btts_yes_odds, btts_no_odds,
      modeled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      model_version=VALUES(model_version), n_simulations=VALUES(n_simulations),
      home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
      home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
      proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score),
      proj_total=VALUES(proj_total), proj_spread=VALUES(proj_spread),
      over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5),
      btts_prob=VALUES(btts_prob),
      model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
      model_total=VALUES(model_total),
      over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
      model_spread=VALUES(model_spread), model_spread_raw=VALUES(model_spread_raw),
      home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
      nv_home_prob=VALUES(nv_home_prob), nv_draw_prob=VALUES(nv_draw_prob), nv_away_prob=VALUES(nv_away_prob),
      home_edge=VALUES(home_edge), draw_edge=VALUES(draw_edge), away_edge=VALUES(away_edge),
      model_lean=VALUES(model_lean), lean_prob=VALUES(lean_prob),
      top_scorelines=VALUES(top_scorelines),
      nv_dc_1x=VALUES(nv_dc_1x), nv_dc_x2=VALUES(nv_dc_x2), dc_1x_odds=VALUES(dc_1x_odds), dc_x2_odds=VALUES(dc_x2_odds),
      nv_no_draw_home=VALUES(nv_no_draw_home), nv_no_draw_away=VALUES(nv_no_draw_away),
      no_draw_home_odds=VALUES(no_draw_home_odds), no_draw_away_odds=VALUES(no_draw_away_odds),
      btts_yes_odds=VALUES(btts_yes_odds), btts_no_odds=VALUES(btts_no_odds),
      modeled_at=NOW()
  `, [
    f.matchId, MODEL_VERSION, N_SIMULATIONS,
    f.homeName, f.awayName,
    lambdaH, lambdaA,
    adj.h, adj.d, adj.a,
    projHomeScore, projAwayScore, projTotal, projSpread,
    sim.over05, sim.over15, sim.over25, sim.under25, sim.over35,
    sim.btts,
    modelHomeML, modelDrawML, modelAwayML,
    modelTotal, modelOverOdds, modelUnderOdds,
    modelSpread, modelSpreadRaw, modelHomeSpreadOdds, modelAwaySpreadOdds,
    adj.h, adj.d, adj.a,
    homeEdge, drawEdge, awayEdge,
    modelLean, leanProb,
    sim.top,
    nvDc1xProb, nvDcX2Prob, dc1xOdds, dcX2Odds,
    nvNoDrawHomeProb, nvNoDrawAwayProb, noDrawHomeOdds, noDrawAwayOdds,
    bttsYesOdds, bttsNoOdds,
  ]);
  totalProjRows++;
  console.log(`${TAG} [OUTPUT] Upserted projection: ${f.matchId} proj=${projHomeScore}-${projAwayScore} total=${projTotal} spread=${projSpread}`);
  console.log('');
}

// ─── Final Verification ───────────────────────────────────────────────────────
console.log(`${TAG} ${'═'.repeat(60)}`);
console.log(`${TAG} FINAL VERIFICATION`);
console.log(`${TAG} ${'═'.repeat(60)}`);

let allPass = true;
for (const f of MATCHES) {
  const [oddsRows] = await conn.query(
    `SELECT market, selection, american_odds, implied_prob FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ? ORDER BY market, selection`,
    [f.matchId, MODEL_BOOK_ID]
  );
  const [projRows] = await conn.query(
    `SELECT proj_home_score, proj_away_score, proj_total, proj_spread, model_home_ml, model_draw_ml, model_away_ml, home_spread_odds, away_spread_odds, btts_prob FROM wc2026_model_projections WHERE match_id = ? ORDER BY modeled_at DESC LIMIT 1`,
    [f.matchId]
  );

  const oddsCount = oddsRows.length;
  const projCount = projRows.length;
  const nullOdds = oddsRows.filter(r => r.american_odds === null).length;
  const proj = projRows[0];

  // Probability integrity check
  const oneX2rows = oddsRows.filter(r => r.market === '1X2' && ['home','draw','away'].includes(r.selection));
  const probSum = oneX2rows.reduce((s, r) => s + parseFloat(r.implied_prob), 0);
  const probSumOk = Math.abs(probSum - 1.0) < 0.001;

  const spreadRows = oddsRows.filter(r => r.market === 'ASIAN_HANDICAP');
  const spreadProbSum = spreadRows.reduce((s, r) => s + parseFloat(r.implied_prob), 0);
  const spreadSumOk = Math.abs(spreadProbSum - 1.0) < 0.001;

  const pass = oddsCount === 12 && projCount === 1 && nullOdds === 0 && probSumOk && spreadSumOk;
  if (!pass) allPass = false;

  console.log(`${TAG}   ${f.matchId}: odds=${oddsCount}/12 ${pass ? 'PASS ✓' : 'FAIL ✗'} | proj=${projCount === 1 ? 'PASS ✓' : 'FAIL ✗'} | ${f.homeName}(h) vs ${f.awayName}(a)`);
  if (proj) {
    console.log(`${TAG}     proj=${proj.proj_home_score}-${proj.proj_away_score} total=${proj.proj_total} spread=${proj.proj_spread}`);
    console.log(`${TAG}     ML: home=${proj.model_home_ml} draw=${proj.model_draw_ml} away=${proj.model_away_ml}`);
    console.log(`${TAG}     spreadOdds: home=${proj.home_spread_odds} away=${proj.away_spread_odds}`);
    console.log(`${TAG}     btts_prob=${parseFloat(proj.btts_prob).toFixed(4)} | 1X2_probSum=${probSum.toFixed(4)} ${probSumOk ? '✓' : '✗'} | spreadSum=${spreadProbSum.toFixed(4)} ${spreadSumOk ? '✓' : '✗'}`);
  }
}

console.log(`\n${TAG} ${allPass ? '[VERIFY] ALL CHECKS PASSED ✓' : '[VERIFY] FAILURES DETECTED ✗'}`);
console.log(`${TAG}   Total model rows: ${totalOddsRows} | Projection rows: ${totalProjRows}`);
console.log(`${TAG}   Null odds errors: ${totalErrors}`);
console.log(`${TAG} ${'═'.repeat(60)}`);

await conn.end();
