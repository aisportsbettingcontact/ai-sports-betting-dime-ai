# transcript inline snippet — Amend 7-inning DH exclusion; ledger the clarification
p = '/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/walkforward.py'
s = open(p).read()
s = s.replace('''    df = pd.read_parquet(os.path.join(RUN, "matrix.parquet"))
    df = df[df["game_type"] == "R"].copy()''','''    df = pd.read_parquet(os.path.join(RUN, "matrix.parquet"))
    df = df[df["game_type"] == "R"].copy()
    # Contract clarification (ledgered pre-scoring): 2020-21 doubleheader games were scheduled
    # 7 innings — excluded from full-game distribution/handicap markets (kept for F5/NRFI,
    # where innings 1-5 are unaffected, and for fg_ml where a win is a win).
    seven = (df["season"].isin([2020, 2021])) & (df["double_header"] != "N")
    if market in ("fg_total", "fg_rl"):
        df = df[~seven]''')
open(p, 'w').write(s)
print('amended')
