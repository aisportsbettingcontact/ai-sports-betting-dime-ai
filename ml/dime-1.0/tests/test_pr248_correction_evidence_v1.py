from __future__ import annotations

import hashlib
from pathlib import Path

from dime_ai.governed_json import load_governed_json

EVIDENCE = Path(__file__).resolve().parents[1] / "evidence" / "execution" / "pr248-correction-v1"


def test_pr248_correction_evidence_is_checksum_pinned_and_non_authorizing() -> None:
    checksums = {}
    for line in (EVIDENCE / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, filename = line.split("  ", maxsplit=1)
        checksums[filename] = digest

    assert checksums == {
        "README.md": "5f1e493d1101e7bfafa92117e97be345277caa5b1c8ab1935ade8ae6543142cc",
        "observation.json": "bb9e89e1f07514814cb2d69b320939381de4d97dde20bc1882b526c57dee62ab",
    }
    for filename, expected in checksums.items():
        assert hashlib.sha256((EVIDENCE / filename).read_bytes()).hexdigest() == expected

    observation = load_governed_json(EVIDENCE / "observation.json")
    assert observation["repository"]["startingHead"] == ("b2adebe253ef5398d9eaa6ac16239fb6240f002c")
    assert observation["productionNonDeployment"]["application"]["commitSha"] == (
        "c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae"
    )
    assert observation["productionNonDeployment"]["backend"]["commitSha"] == (
        "c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae"
    )
    assert observation["productionNonDeployment"]["mutationsPerformed"] == []
    assert not any(observation["authorizationBoundary"].values())
    assert not any(observation["externalOperations"].values())
    assert observation["currentGate"] == ("HOLD_FOR_CORRECTED_HEAD_CHECKS_AND_INDEPENDENT_REVIEW")
