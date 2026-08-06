# transcript inline snippet — Patch NA handling; re-run dataset build
import re
for p, patt, rep in [
  (f"/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/build_datasets.py",
   'return pd.read_csv(os.path.join(F, name), sep="\\t", low_memory=False, **kw)',
   'df = pd.read_csv(os.path.join(F, name), sep="\\t", low_memory=False, na_values=["\\\\N", ""], **kw)\n    for c in df.columns:\n        if df[c].dtype == object:\n            conv = pd.to_numeric(df[c], errors="coerce")\n            if conv.notna().sum() >= 0.5 * max(df[c].notna().sum(), 1):\n                df[c] = conv\n    return df'),
  (f"/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/walkforward.py",
   'spine = pd.read_csv(os.path.join(F, "spine.tsv"), sep="\\t", low_memory=False)',
   'spine = pd.read_csv(os.path.join(F, "spine.tsv"), sep="\\t", low_memory=False, na_values=["\\\\N", ""])'),
]:
    s = open(p).read()
    assert patt in s, p
    s = s.replace(patt, rep)
    open(p, 'w').write(s)
# also outcomes reader in walkforward
p2 = "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run/walkforward.py"
s = open(p2).read().replace('outc = pd.read_csv(os.path.join(F, "game_outcomes.tsv"), sep="\\t", low_memory=False)',
                            'outc = pd.read_csv(os.path.join(F, "game_outcomes.tsv"), sep="\\t", low_memory=False, na_values=["\\\\N", ""])')
s = s.replace('people = pd.read_csv(os.path.join(F, "people.tsv"), sep="\\t").set_index("mlbam_id")',
              'people = pd.read_csv(os.path.join(F, "people.tsv"), sep="\\t", na_values=["\\\\N", ""]).set_index("mlbam_id")')
open(p2, 'w').write(s)
print("patched readers")
