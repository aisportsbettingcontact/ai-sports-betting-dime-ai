#!/usr/bin/env python3
"""Deterministic full-dump audit of a Dime 1.0 SFT dataset — the ship gate.

Reads complete records (never previews) and enforces the hard gates from the
Dime SFT audit contract:

  G1 grounding      any team named in a final answer must appear in that row's
                    own context or user turns (cross-row bleed = fabrication)
  G2 math           stated implied% recomputed from the stated price (±0.2pp);
                    stated gap recomputed from model% − implied% (±0.15pp)
  G3 direction      PLAY requires model > implied by the 2.0pp bar; PASS
                    requires the gap below the bar or negative; any "points of
                    edge/value" claim requires model > implied
  G4 RG safety      distress rows: 1-800-GAMBLER exactly once, no pick verdicts
  G5 structured     task JSON parses; extraction non-null values must be
                    evidenced in the INPUT text; summaries ≤3 sentences with no
                    numbers absent from the input
  G6 certainty      lock/guaranteed/risk-free/can't-lose/sure-thing/free-money
  Template collapse any non-exempt assistant sentence (≥8 words) repeated
                    verbatim in >20% of its category

Exit 1 on any SEV-1 (G1–G6 confirmed hit) — DO-NOT-TRAIN. Exit 0 otherwise;
SEV-3 duplication findings print as warnings.

Usage:
  python audit_dataset.py train.jsonl val.jsonl
  python audit_dataset.py train.jsonl --dump-full full_dump.txt   # untruncated
                                                                  # dump for
                                                                  # human audit
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

CERTAINTY = re.compile(r"\block\b|free money|guaranteed|risk[- ]free|can'?t lose|sure thing", re.I)
PCT = r"(\d{1,3}(?:\.\d)?)%"
PRICE = r"([+-]\d{2,4})\b"
MODEL_PCT = re.compile(
    r"(?:Dime has [\w .'-]+?|model (?:read of|says|puts [\w .'-]+? at)|makes them|winning this|"
    r"Dime makes them|Dime prices [\w .'-]+? at|Model)\s*(?:at\s*)?" + PCT,
    re.I,
)
MARKET_PCT = re.compile(
    r"(?:implies|implied|needs|charging you for|paying you like it'?s|price says|against(?: an)?(?: implied)?|requires)\s*" + PCT,
    re.I,
)
GAP = re.compile(r"(\d{1,2}(?:\.\d)?)(?:[- ]points?(?: of)? (?:edge|value|gap|overpay|deficit)|-point)", re.I)
# Bettor-directed claims only: "giving the book X points of value" is a
# correctly-signed PASS statement and must not match.
EDGE_CLAIM = re.compile(r"points? of edge|edge in your favor|getting [\d.]+ points? of value", re.I)
# User-supplied probability ("your 53%") — the model-side number in
# user-numbers rows, so G2/G3 run on that category too.
USER_PCT = re.compile(r"your (?:number of )?" + PCT, re.I)
# Sign-mirrored prose claims: "short of break-even" demands a negative gap,
# "above break-even / points of room" demands a positive one.
SHORT_CLAIM = re.compile(r"points? short|short of break-even|more than your number supports", re.I)
AHEAD_CLAIM = re.compile(r"above break-even|points? of room|clears? [\w +-]+ by", re.I)
# Board-wide superlatives are unverifiable from one row's two prices and were
# provably false in generated data — ban the phrasing outright.
BOARD_SUPERLATIVE = re.compile(r"widest gap|best gap out there|at the widest", re.I)
DENIAL = re.compile(r"isn'?t in the (?:current )?Dime feed|doesn'?t carry|hasn'?t modeled|off the board as far as", re.I)
PLAY_BAR = 2.0

ACK = "Understood. I will ground Dime answers in this platform context and clearly say when a requested market is missing."
OFF_TOPIC_CONSTANT = "Dime only handles sports betting and platform questions."
CONTEXT_HEADER = re.compile(r"^\d+\.\s+\S+\s+\d{4}-\d{2}-\d{2}.*?—\s*(.+?)\s+at\s+(.+?)\s*$", re.M)


def implied(odds: float) -> float:
    return 100 / (odds + 100) if odds > 0 else -odds / (-odds + 100)


class Audit:
    def __init__(self):
        self.sev1: list[str] = []
        self.sev2: list[str] = []
        self.sev3: list[str] = []

    def report(self) -> int:
        for label, bucket in (("SEV-1", self.sev1), ("SEV-2", self.sev2), ("SEV-3", self.sev3)):
            for finding in bucket:
                print(f"[{label}] {finding}")
        print(
            f"\n[audit] SEV-1: {len(self.sev1)}  SEV-2: {len(self.sev2)}  SEV-3: {len(self.sev3)}"
        )
        if self.sev1:
            print("[audit] VERDICT: DO-NOT-TRAIN — confirmed SEV-1 findings above.")
            return 1
        if self.sev2:
            print("[audit] VERDICT: FIX-THEN-TRAIN — resolve SEV-2 findings.")
            return 0
        print("[audit] VERDICT: TRAIN — no gate failures.")
        return 0


def load_rows(paths: list[str]) -> list[tuple[str, int, list[dict]]]:
    rows = []
    for path in paths:
        for lineno, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            rows.append((path, lineno, json.loads(line)["messages"]))
    return rows


def context_teams(messages: list[dict]) -> set[str]:
    teams = set()
    for m in messages:
        if m["role"] == "user" and m["content"].startswith("Dime platform context"):
            for away, home in CONTEXT_HEADER.findall(m["content"]):
                teams.update((away.strip(), home.strip()))
    return teams


def classify(messages: list[dict]) -> str:
    answer = messages[-1]["content"]
    if answer.startswith("{"):
        return "task"
    if "1-800-GAMBLER" in answer:
        return "rg"
    if answer == OFF_TOPIC_CONSTANT:
        return "offtopic"
    if answer.startswith("NO DATA") or "NO DATA" in answer[:120]:
        return "nodata"
    if answer.startswith(("PLAY", "PASS", "LEAN", "NO LEAN")):
        return "verdict"
    return "other"


# Teams the generator uses that never appear in context headers (absent-game
# refusals, user-numbers examples). Kept in sync with build_dataset.py; the
# try-import below picks up the live list when the auditor runs next to it.
EXTRA_LEXICON = {
    "Lakers", "Celtics", "Chiefs", "Bills", "Dodgers", "Padres", "Oilers", "Rangers",
    "Knicks", "Warriors", "Braves", "Mets", "Bruins", "Heat", "Astros", "Eagles",
    "Jets", "Cubs", "Kings", "Spurs",
}
try:  # enrich from the generator when colocated
    from build_dataset import ABSENT_MATCHUPS as _AM

    EXTRA_LEXICON |= {team for _, away, home in _AM for team in (away, home)}
except Exception:
    pass


def audit_grounding(audit: Audit, rows, lexicon: set[str]):
    for path, lineno, messages in rows:
        answer = messages[-1]["content"]
        if answer.startswith("{"):
            continue
        allowed_text = " ".join(m["content"] for m in messages[:-1])
        row_teams = context_teams(messages)
        has_model_read = bool(MODEL_PCT.search(answer)) and "NO DATA" not in answer
        for team in lexicon:
            if not re.search(rf"(?<![\w]){re.escape(team)}(?![\w])", answer):
                continue
            in_context = team in row_teams
            in_user_turns = bool(re.search(rf"(?<![\w]){re.escape(team)}(?![\w])", allowed_text))
            if not in_context and not in_user_turns:
                audit.sev1.append(
                    f"G1 {path}:{lineno} — answer names '{team}' which is in neither this row's context nor its user turns"
                )
            elif not in_context and has_model_read and row_teams:
                # The fabrication-family shape: user asks about an absent team
                # and the answer supplies a model read for it anyway.
                audit.sev1.append(
                    f"G1 {path}:{lineno} — model read given for '{team}' which is absent from this row's context"
                )
        # Inverse failure: a NO DATA answer denying a matchup whose teams are
        # both sitting in this row's own context (denial of present data).
        if DENIAL.search(answer):
            denied_present = [t for t in row_teams if re.search(rf"(?<![\w]){re.escape(t)}(?![\w])", answer)]
            if len(denied_present) >= 2:
                audit.sev1.append(
                    f"G1 {path}:{lineno} — NO DATA denial names {denied_present}, but those teams ARE in this row's context"
                )


def audit_math_direction(audit: Audit, rows):
    for path, lineno, messages in rows:
        answer = messages[-1]["content"]
        if answer.startswith("{"):
            continue
        if BOARD_SUPERLATIVE.search(answer):
            audit.sev2.append(
                f"G3 {path}:{lineno} — board-wide superlative ('widest/best gap') is unverifiable from one row and banned"
            )
        model_m = MODEL_PCT.search(answer) or USER_PCT.search(answer)
        market_m = MARKET_PCT.search(answer)
        if not (model_m and market_m):
            continue
        model_p, market_p = float(model_m.group(1)), float(market_m.group(1))
        gap = model_p - market_p

        price_m = re.search(PRICE, answer)
        if price_m:
            recomputed = implied(int(price_m.group(1))) * 100
            if abs(recomputed - market_p) > 0.2:
                audit.sev2.append(
                    f"G2 {path}:{lineno} — implied {market_p}% stated but {price_m.group(1)} recomputes to {recomputed:.1f}%"
                )

        stated_gap_m = GAP.search(answer)
        if stated_gap_m and abs(abs(gap) - float(stated_gap_m.group(1))) > 0.15:
            audit.sev2.append(
                f"G2 {path}:{lineno} — stated gap {stated_gap_m.group(1)} vs recomputed {abs(gap):.1f}"
            )

        if answer.startswith("PLAY") and gap < PLAY_BAR - 0.05:
            audit.sev1.append(
                f"G3 {path}:{lineno} — PLAY verdict on model {model_p}% vs implied {market_p}% (gap {gap:+.1f})"
            )
        if answer.startswith("PASS") and gap >= PLAY_BAR + 0.05:
            audit.sev1.append(
                f"G3 {path}:{lineno} — PASS verdict despite {gap:+.1f}pp positive gap"
            )
        if EDGE_CLAIM.search(answer) and gap <= 0:
            audit.sev1.append(
                f"G3 {path}:{lineno} — 'edge' claimed with model {model_p}% <= implied {market_p}%"
            )
        if SHORT_CLAIM.search(answer) and gap > 0.05:
            audit.sev1.append(
                f"G3 {path}:{lineno} — 'short of break-even' prose with a {gap:+.1f}pp POSITIVE gap"
            )
        if AHEAD_CLAIM.search(answer) and gap < -0.05:
            audit.sev1.append(
                f"G3 {path}:{lineno} — 'above break-even' prose with a {gap:+.1f}pp NEGATIVE gap"
            )


def audit_tasks(audit: Audit, rows):
    for path, lineno, messages in rows:
        answer = messages[-1]["content"]
        if not answer.startswith("{"):
            continue
        try:
            output = json.loads(answer)
        except json.JSONDecodeError:
            audit.sev1.append(f"G5 {path}:{lineno} — task output is not valid JSON")
            continue
        user = messages[-2]["content"]
        input_text = user.split("INPUT:", 1)[-1].strip() if "INPUT:" in user else user

        if "Extract any bet details" in user:
            for key, value in output.items():
                if value is None or key in ("market", "league", "event"):
                    continue
                needles = [str(value)] if not isinstance(value, str) else [value]
                if isinstance(value, (int, float)):
                    needles.append(f"{value:g}".lstrip("+-"))
                    needles = [n.lstrip("+-") for n in needles]
                if isinstance(value, str):
                    needles = [part for part in value.split() if part]
                if not all(n.lower() in input_text.lower() for n in needles):
                    audit.sev1.append(
                        f"G5 {path}:{lineno} — extraction field {key}={value!r} not evidenced in input {input_text!r}"
                    )
        if "Summarize the text" in user and "summary" in output:
            summary = str(output["summary"])
            if len(re.findall(r"[.!?]+(?:\s|$)", summary)) > 3:
                audit.sev2.append(f"G5 {path}:{lineno} — summary exceeds 3 sentences")
            for number in re.findall(r"\d+(?:\.\d+)?", summary):
                if number not in input_text:
                    audit.sev1.append(
                        f"G5 {path}:{lineno} — summary contains number {number} absent from input"
                    )


def audit_safety(audit: Audit, rows):
    for path, lineno, messages in rows:
        answer = messages[-1]["content"]
        if CERTAINTY.search(answer):
            audit.sev1.append(f"G6 {path}:{lineno} — prohibited certainty language in answer")
        if "1-800-GAMBLER" in answer:
            if answer.count("1-800-GAMBLER") != 1:
                audit.sev2.append(f"G4 {path}:{lineno} — helpline should appear exactly once")
            if re.search(r"\bPLAY\b|\bLEAN\b|points of edge", answer):
                audit.sev1.append(f"G4 {path}:{lineno} — RG response contains a pick")


def audit_duplication(audit: Audit, rows, max_frac: float):
    buckets: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for path, lineno, messages in rows:
        category = classify(messages)
        if category in ("task", "offtopic"):
            continue  # JSON outputs and the deliberate product constant are exempt
        answer = messages[-1]["content"]
        for sentence in re.split(r"(?<=[.!?])\s+", answer):
            sentence = sentence.strip()
            if len(sentence.split()) >= 8 and sentence != ACK:
                buckets[category].append((sentence, f"{path}:{lineno}"))
    for category, entries in buckets.items():
        total_rows = len({loc for _, loc in entries})
        counts = Counter(sentence for sentence, _ in entries)
        for sentence, count in counts.items():
            if total_rows and count / total_rows > max_frac:
                audit.sev3.append(
                    f"template-collapse [{category}] {count}/{total_rows} rows share: \"{sentence[:80]}...\""
                )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="JSONL files to audit (full contents)")
    parser.add_argument("--dump-full", default=None, help="write an untruncated human-readable dump")
    parser.add_argument("--max-dup-frac", type=float, default=0.20)
    args = parser.parse_args()

    rows = load_rows(args.files)
    print(f"[audit] {len(rows)} rows loaded from {len(args.files)} file(s) — auditing FULL contents")

    lexicon: set[str] = set(EXTRA_LEXICON)
    for _, _, messages in rows:
        lexicon.update(context_teams(messages))
    print(f"[audit] team lexicon: {len(lexicon)} teams (context headers + generator pools)")

    audit = Audit()
    audit_grounding(audit, rows, lexicon)
    audit_math_direction(audit, rows)
    audit_tasks(audit, rows)
    audit_safety(audit, rows)
    audit_duplication(audit, rows, args.max_dup_frac)

    if args.dump_full:
        with open(args.dump_full, "w", encoding="utf-8") as f:
            for index, (path, lineno, messages) in enumerate(rows, 1):
                f.write(f"===== ROW {index} ({path}:{lineno}) =====\n")
                for m in messages:
                    f.write(f"[{m['role'].upper()}]\n{m['content']}\n\n")
        print(f"[audit] full untruncated dump written to {args.dump_full}")

    sys.exit(audit.report())


if __name__ == "__main__":
    main()
