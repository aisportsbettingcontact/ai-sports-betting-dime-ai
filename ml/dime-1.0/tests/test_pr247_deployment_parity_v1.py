from __future__ import annotations

import hashlib
import json
from pathlib import Path

EVIDENCE = (
    Path(__file__).resolve().parents[1]
    / "evidence"
    / "infrastructure"
    / "2026-07-30"
    / "pr247-deployment-parity-v1"
)


def test_pr247_parity_evidence_is_checksum_pinned_and_non_authorizing() -> None:
    expected = {}
    for line in (EVIDENCE / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, filename = line.split("  ", 1)
        expected[filename] = digest

    assert set(expected) == {"README.md", "observation.json"}
    for filename, digest in expected.items():
        assert hashlib.sha256((EVIDENCE / filename).read_bytes()).hexdigest() == digest

    observation = json.loads((EVIDENCE / "observation.json").read_text(encoding="utf-8"))
    assert observation["verdict"] == "PASS"
    assert observation["github"]["mergeSha"] == ("c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae")
    assert observation["deployment"]["application"]["commitSha"] == (
        "c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae"
    )
    assert observation["deployment"]["backend"]["commitSha"] == (
        "c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae"
    )
    assert observation["userVisibleParity"]["observedGameCards"] == 16
    assert observation["userVisibleParity"]["freshBrowserErrors"] == 0
    assert observation["serverObservation"]["stableObservationWindow"]["freshErrors"] == 0
    assert observation["serverObservation"]["disclosedStartupExceptions"][0]["count"] == 1
    assert observation["github"]["independentReviewDecision"] is None
    assert observation["featureState"] == {
        "traceV1Enabled": False,
        "researchAlphaEnabled": False,
        "researchAlphaKillSwitch": True,
        "shadowTrafficEnabled": False,
        "generativeRouteActivation": False,
        "modelTrainingAuthorized": False,
    }
    assert not any(observation["dataAndExternalOperations"].values())
    assert observation["productionMutationsPerformed"] == []
