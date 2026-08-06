# transcript inline snippet — Patch fitter for calib+score roles; run parameter fitting
p='/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/fit_engine.py'
s=open(p).read()
s=s.replace('''        tr = df[(df["season"] >= TRAIN_START) & (df["season"] <= tr_end)]
        te = df[df["season"] == sc]
        if not len(te): continue''','''        tr = df[(df["season"] >= TRAIN_START) & (df["season"] <= tr_end)]
        targets = [(cal, "calib"), (sc, "score")]''')
s=s.replace('''        med = tr[cols].median()
        Xtr = tr[cols].astype(float).fillna(med); Xte = te[cols].astype(float).fillna(med)
        lam = {}
        for tgt, side, exposure in BLOCKS:
            m = PoissonRegressor(alpha=2.0, max_iter=400).fit(Xtr, tr[tgt].values / exposure)
            lam[tgt] = np.clip(m.predict(Xte), 0.01, 3.0)''','''        med = tr[cols].median()
        Xtr = tr[cols].astype(float).fillna(med)
        models = {}
        for tgt, side, exposure in BLOCKS:
            models[tgt] = PoissonRegressor(alpha=2.0, max_iter=400).fit(Xtr, tr[tgt].values / exposure)''')
s=s.replace('''        for i, (gpk, si) in enumerate(zip(te["game_pk"].values, te["sched_innings"].values)):
            out_rows.append({"game_pk": int(gpk), "fold": sc, "state": state,
                             "lam_h1": float(lam["h1"][i]), "lam_a1": float(lam["a1"][i]),
                             "lam_h25": float(lam["h25"][i]), "lam_a25": float(lam["a25"][i]),
                             "lam_h69": float(lam["h69"][i]), "lam_a69": float(lam["a69"][i]),
                             "k_disp": k, "extra_rate": extra_rate, "sched_innings": int(si)})''','''        for season_t, role in targets:
            te = df[df["season"] == season_t]
            if not len(te): continue
            Xte = te[cols].astype(float).fillna(med)
            lam = {tgt: np.clip(models[tgt].predict(Xte), 0.01, 3.0) for tgt, _, _ in BLOCKS}
            for i, (gpk, si) in enumerate(zip(te["game_pk"].values, te["sched_innings"].values)):
                out_rows.append({"game_pk": int(gpk), "fold": sc, "role": role, "state": state,
                                 "lam_h1": float(lam["h1"][i]), "lam_a1": float(lam["a1"][i]),
                                 "lam_h25": float(lam["h25"][i]), "lam_a25": float(lam["a25"][i]),
                                 "lam_h69": float(lam["h69"][i]), "lam_a69": float(lam["a69"][i]),
                                 "k_disp": k, "extra_rate": extra_rate, "sched_innings": int(si)})''')
open(p,'w').write(s)
print('fit_engine emits calib+score roles')
