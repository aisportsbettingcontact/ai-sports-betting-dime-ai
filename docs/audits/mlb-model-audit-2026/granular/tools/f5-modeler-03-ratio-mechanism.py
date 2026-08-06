#!/usr/bin/env python
"""f5-modeler-03-ratio-mechanism.py — F5 MODELER, step 3: root-cause the ratio deficit.

Finding to explain: over all 1,555 games, projF5Total/projTotal (p1) has mean 0.53556
(sd 0.00549), a -4.67% relative deficit vs the engine's own F5_RUN_SHARE = 0.5618, even
though the TEAM_F5_RS adjustment nets to ~0 (table mean 2.4837 vs league const 2.484).

Mechanism hypothesis (from reading server/MLBAIModel.py at the replay-fixed revision):
  (1) HFA skip — FG sampling mus get HFA (home x1.0525, away x0.972 at hfa=0.35;
      MLBAIModel.py:945-947) but the F5 mus are built from the UN-adjusted state mus
      (home_state["mu"] * F5_RUN_SHARE; MLBAIModel.py:1259-1261). Net FG inflation
      (1.0525+0.972)/2 = 1.01225 -> ratio deflator 0.98790.
  (2) Extra innings — exp_total averages home_9+home_xi (MLBAIModel.py:990-991) where
      tied 9-inning sims get ghost-runner extras with mu_xi = mu/9 + 0.50 PER SIDE
      (simulate_extra_innings, MLBAIModel.py:853-905); exp_f5_total has no analogue.

This script replicates the engine's exact sampling machinery (NBGammaMixture.sample with
gamma_shape=4, clip [0.3,3.0], per-draw var max(1.5mu, mu+0.5); simulate_extra_innings
with GHOST_RUNNER_BONUS=0.50, var x0.7 floor +0.3, MAX_EXTRA=6, coin-flip resolve;
seed 42, 400k sims) at population-typical parameters and decomposes the ratio.

Note: the engine's state `variance` argument is dead in sample() — fit_nb(mu, variance)
computes _r_base/_p_base which are never used (MLBAIModel.py:831); each draw's NB uses
adj_var = max(1.5*adj_mu, adj_mu+0.5). So the sampled distribution depends on mu only,
which makes this replication exact rather than approximate.

Output: stdout aggregates (captured into f5-modeler.md) + f5-modeler-ratio-mechanism.csv
"""
from __future__ import annotations

import csv
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.join(HERE, "..", "f5")

N_SIMS = 400_000
SEED = 42
F5_RUN_SHARE = 0.5618
HFA = 0.35


def fit_nb(mu, variance):
    variance = max(variance, mu + 0.01)
    p = float(np.clip(mu / variance, 0.01, 0.99))
    r = max(0.01, (mu * p) / (1.0 - p))
    return r, p


def sample(mu, n, rng, gamma_shape=4.0):
    """Engine NBGammaMixtureDistribution.sample, vectorized (mean-exact replication).

    The engine loops per-sim; the NB(r_i, p_i) draw for adj_mu_i is identical to this
    vectorized form because r_i, p_i depend only on adj_mu_i.
    """
    mult = np.clip(rng.gamma(shape=gamma_shape, scale=1.0 / gamma_shape, size=n), 0.3, 3.0)
    adj_mu = mu * mult
    adj_var = np.maximum(adj_mu * 1.5, adj_mu + 0.5)
    p = np.clip(adj_mu / np.maximum(adj_var, adj_mu + 0.01), 0.01, 0.99)
    r = np.maximum(0.01, adj_mu * p / (1.0 - p))
    return rng.negative_binomial(r, p).astype(float), mult


def simulate_extras(home_mu_per, away_mu_per, home_var, away_var, rng, n):
    GHOST = 0.50
    hmu, amu = home_mu_per + GHOST, away_mu_per + GHOST
    eh = np.zeros(n)
    ea = np.zeros(n)
    still = np.ones(n, dtype=bool)
    for _ in range(6):
        if not still.any():
            break
        k = int(still.sum())
        hv = max(home_var * 0.7, hmu + 0.3)
        av = max(away_var * 0.7, amu + 0.3)
        hr_, hp_ = fit_nb(hmu, hv)
        ar_, ap_ = fit_nb(amu, av)
        ih = rng.negative_binomial(hr_, hp_, size=k).astype(float)
        ia = rng.negative_binomial(ar_, ap_, size=k).astype(float)
        eh[still] += ih
        ea[still] += ia
        resolved = still.copy()
        resolved[still] = (ih - ia) != 0
        still[resolved] = False
    if still.any():
        coin = rng.random(int(still.sum())) < 0.5
        eh[still] += coin
        ea[still] += (~coin)
    return eh, ea


def run_case(mu_state_home, mu_state_away, label):
    rng = np.random.default_rng(SEED)
    mu_h = mu_state_home * (1.0 + HFA * 0.15)
    mu_a = mu_state_away * (1.0 - HFA * 0.08)
    h9, mult_h = sample(mu_h, N_SIMS, rng)
    a9, _ = sample(mu_a, N_SIMS, rng)
    ties = h9 == a9
    n_ties = int(ties.sum())
    eh = np.zeros(N_SIMS)
    ea = np.zeros(N_SIMS)
    if n_ties:
        teh, tea = simulate_extras(mu_h / 9, mu_a / 9, mu_h / 9 * 1.5, mu_a / 9 * 1.5,
                                   rng, n_ties)
        eh[ties] = teh
        ea[ties] = tea
    exp_total = float((h9 + a9 + eh + ea).mean())
    exp_9 = float((h9 + a9).mean())
    extras_runs = exp_total - exp_9

    # F5: no HFA, TEAM adj ~0 (table mean 2.4837 vs const 2.484)
    mu_f5_h = mu_state_home * F5_RUN_SHARE
    mu_f5_a = mu_state_away * F5_RUN_SHARE
    f5h, _ = sample(mu_f5_h, N_SIMS, rng)
    f5a, _ = sample(mu_f5_a, N_SIMS, rng)
    exp_f5 = float((f5h + f5a).mean())
    f5_tie_rate = float((f5h == f5a).mean())

    clip_bias = float(mult_h.mean())
    r = {
        "case": label,
        "mu_state_home": mu_state_home, "mu_state_away": mu_state_away,
        "clip_mult_mean": round(clip_bias, 5),
        "exp_9inn_total": round(exp_9, 4),
        "extras_runs_added": round(extras_runs, 4),
        "extras_pct_of_total": round(extras_runs / exp_total, 5),
        "tie9_rate": round(n_ties / N_SIMS, 5),
        "exp_total": round(exp_total, 4),
        "exp_f5_total": round(exp_f5, 4),
        "f5_tie_rate": round(f5_tie_rate, 5),
        "ratio": round(exp_f5 / exp_total, 5),
        "ratio_no_hfa_no_extras": round(exp_f5 / (exp_9 / ((mu_h + mu_a) / (mu_state_home + mu_state_away))), 5),
    }
    return r


def main():
    print("== RATIO MECHANISM DECOMPOSITION (engine sampling replicated, seed 42, 400k sims) ==")
    print(f"  observed population mean ratio (script 02): 0.53556 over 1,555 games")
    print(f"  F5_RUN_SHARE={F5_RUN_SHARE}; HFA deflator = 1/1.01225 = 0.98790")
    cases = [
        run_case(4.40, 4.40, "typical (state mu 4.40/4.40)"),
        run_case(3.80, 3.80, "low-scoring (3.80/3.80)"),
        run_case(5.00, 5.00, "high-scoring (5.00/5.00)"),
        run_case(4.70, 4.10, "asymmetric (4.70/4.10)"),
    ]
    out = os.path.join(F5_DIR, "f5-modeler-ratio-mechanism.csv")
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(cases[0].keys()))
        w.writeheader()
        w.writerows(cases)
    for c in cases:
        print(f"  {c['case']:32s} exp_total={c['exp_total']:.3f} "
              f"(9inn={c['exp_9inn_total']:.3f} + extras={c['extras_runs_added']:.3f} "
              f"= {c['extras_pct_of_total']*100:.2f}% of total, tie9={c['tie9_rate']*100:.1f}%) "
              f"exp_f5={c['exp_f5_total']:.3f} ratio={c['ratio']:.5f} "
              f"f5_tie={c['f5_tie_rate']:.4f} clip_mult_mean={c['clip_mult_mean']:.5f}")
    print("  decomposition at typical case:")
    c = cases[0]
    hfa_part = 1 - 1 / 1.01225
    extras_part = c["extras_pct_of_total"]
    total_deficit = 1 - c["ratio"] / F5_RUN_SHARE
    print(f"    total relative deficit vs 0.5618: {total_deficit*100:.2f}%")
    print(f"    = HFA skip {hfa_part*100:.2f}% + extra-innings inflation {extras_part*100:.2f}% "
          f"+ residual {(total_deficit - hfa_part - extras_part)*100:.2f}%")
    print(f"  [write] {out}")


if __name__ == "__main__":
    main()
