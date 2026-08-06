# transcript inline snippet — Patch merge_asof dtypes; rerun assemble + all markets
p = '/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/walkforward.py'
s = open(p).read()
s = s.replace('''    pcols = [c for c in pstate.columns if c.startswith("p_")]
    def attach_pitcher(df, id_col, prefix):
        left = df[["game_pk","date",id_col]].rename(columns={id_col: "mlbam_id"}).sort_values("date")
        left["mlbam_id"] = left["mlbam_id"].astype("float")
        got = pd.merge_asof(left, pstate[["date","mlbam_id"] + pcols].sort_values("date"),
                            on="date", by="mlbam_id", allow_exact_matches=True)  # state entering that date
        got = got.set_index("game_pk")[pcols].add_prefix(prefix)
        return df.merge(got, left_on="game_pk", right_index=True, how="left")''','''    pcols = [c for c in pstate.columns if c.startswith("p_")]
    pstate["mlbam_id"] = pd.to_numeric(pstate["mlbam_id"], errors="coerce").astype("float64")
    pstate["date"] = pd.to_datetime(pstate["date"])
    pright = pstate[["date","mlbam_id"] + pcols].dropna(subset=["mlbam_id"]).sort_values("date")
    def attach_pitcher(df, id_col, prefix):
        left = df[["game_pk","date",id_col]].rename(columns={id_col: "mlbam_id"}).copy()
        left["mlbam_id"] = pd.to_numeric(left["mlbam_id"], errors="coerce").astype("float64")
        left["date"] = pd.to_datetime(left["date"])
        ok = left.dropna(subset=["mlbam_id"]).sort_values("date")
        got = pd.merge_asof(ok, pright, on="date", by="mlbam_id", allow_exact_matches=True)
        got = got.set_index("game_pk")[pcols].add_prefix(prefix)
        return df.merge(got, left_on="game_pk", right_index=True, how="left")''')
open(p, 'w').write(s)
print('patched attach_pitcher')
