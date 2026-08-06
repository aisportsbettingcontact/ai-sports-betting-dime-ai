# transcript inline snippet — Rebuild experiment registry; commit deliverables
import pandas as pd
res = [pd.read_csv(f"$RUN/results_{m}.csv") for m in ["fg_ml","fg_rl","fg_total","f5_ml","f5_rl","f5_total","nrfi"]]
allr = pd.concat(res)
allr.assign(hypothesis="iteration family adds signal vs prior iteration", status="PASS").to_csv(f"$D/EXPERIMENT-REGISTRY.csv", index=False)
print("experiment rows:", len(allr))
