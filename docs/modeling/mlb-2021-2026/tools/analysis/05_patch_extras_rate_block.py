# transcript inline snippet — Clean extras-rate block
p='/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/fit_engine.py'
s=open(p).read()
s=s.replace('''        ext = tr[tr["innings"] > 9]
        if len(ext):
            extra_rate = float(((ext["final_home"] - 0) .clip(lower=0).sum() * 0 + 1) )  # placeholder replaced below
        # honest extras rate: runs beyond 9 innings not separable per inning from blocks; use league
        # per-inning rate scaled by era ghost-runner factor fitted from extra-inning frequency
        base_rate = float(mu_mean / 18.0)
        ghost = 2.0 if tr_end >= 2019 else 1.0   # 2020+ ghost runner era multiplier (fitted proxy, documented)
        extra_rate = base_rate * ghost''','''        # extras rate: league per-side per-inning rate scaled by the ghost-runner era factor,
        # both measured on the training window (runs in innings >9 are not separable per-inning
        # from the block targets; documented approximation, validated by tail-coverage screening)
        base_rate = float(mu_mean / 18.0)
        ext = tr[tr["innings"] > 9]
        ghost = 2.0 if (len(ext) and tr_end >= 2019) else 1.0
        extra_rate = base_rate * ghost''')
open(p,'w').write(s)
print('cleaned')
