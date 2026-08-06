# transcript inline snippet — Smoke-check v2 parameters for discriminative signal before full sweep
import numpy as np, pandas as pd, os
RUN="/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run"
rng=np.random.default_rng(7)
mat=pd.read_parquet(os.path.join(RUN,"matrix_v2.parquet"))
mat=mat[mat["game_type"]=="R"].set_index("game_pk")
for st in ["A","B"]:
    ep=pd.read_parquet(os.path.join(RUN,f"engine_params_v2_{st}.parquet"))
    sc=ep[ep.role=="score"].sample(2500, random_state=7)
    ps=[]; ys=[]
    for r in sc.itertuples():
        N=20000
        G=rng.gamma(r.k_disp,1/r.k_disp,N)
        H=rng.poisson(r.lam_h1*G)+rng.poisson(r.lam_h25*G*4)+rng.poisson(r.lam_h69*G*(r.sched_innings-5))
        A=rng.poisson(r.lam_a1*G)+rng.poisson(r.lam_a25*G*4)+rng.poisson(r.lam_a69*G*(r.sched_innings-5))
        tie=H==A
        # cheap tie-break: split ties by extra-innings symmetric coin biased to home lambda edge
        ph=((H>A).sum()+0.52*tie.sum())/N
        ps.append(ph)
        m=mat.loc[r.game_pk]
        ys.append(1 if m["margin"]>0 else (0 if m["margin"]<0 else np.nan))
    d=pd.DataFrame({"p":ps,"y":ys}).dropna()
    p=np.clip(d.p,1e-6,1-1e-6); y=d.y
    ll=float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))
    br=float(np.mean(y)); clim=float(-(br*np.log(br)+(1-br)*np.log(1-br)))
    print(f"{st}: n={len(d)} p_home std {d.p.std():.4f} range [{d.p.min():.3f},{d.p.max():.3f}] | LL {ll:.4f} vs climatology {clim:.4f} | delta {clim-ll:+.4f}")
