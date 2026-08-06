# transcript inline snippet — Patch close(), collect report into worktree, verify grade counts
p = "$WT/docs/audits/mlb-model-audit-2026/tools/replay/calibrate_and_grade.py"
s = open(p).read()
s = s.replace("""    def cursor(self, *a, **k):""", """    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass

    def cursor(self, *a, **k):""")
open(p, "w").write(s)
print("patched close()")
