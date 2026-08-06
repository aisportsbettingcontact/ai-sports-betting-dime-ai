#!/usr/bin/env python3
"""Compact the forensic audit ledgers for archival and review.

The raw ledgers hold one JSON line per row-level comparison and run to several GB,
dominated by NOT_COMPARABLE records for fields no public authority publishes (snap
counts, historical depth charts). They compress ~37:1, so this writes three things
per agent and leaves the raw file untouched on disk:

  <A>.jsonl.gz          the complete ledger, committable
  findings/<A>.jsonl    every non-clean verdict, uncompressed and directly greppable
  findings/<A>.json     verdict counts by table, for the coverage proof

"Clean" means MATCH or NOT_COMPARABLE. Everything else -- MISMATCH, DB_ONLY,
REF_ONLY, UNRESOLVED -- is a finding somebody has to adjudicate, so it stays in
plain text where it can be read without decompressing a gigabyte.

Usage:  python3 scripts/data/nfl-db/audit/compact_ledgers.py [--keep-raw]
"""
import collections
import glob
import gzip
import json
import os
import shutil
import sys

LEDGER_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..",
    "docs", "audits", "2026-07-27-nfl-db-forensic", "ledger",
)
LEDGER_DIR = os.path.normpath(LEDGER_DIR)
FINDINGS_DIR = os.path.join(LEDGER_DIR, "findings")

CLEAN = {"MATCH", "NOT_COMPARABLE"}


def compact(path, keep_raw):
    agent = os.path.basename(path)[: -len(".jsonl")]
    gz_path = path + ".gz"
    find_path = os.path.join(FINDINGS_DIR, f"{agent}.jsonl")
    summ_path = os.path.join(FINDINGS_DIR, f"{agent}.json")

    by_table = collections.defaultdict(collections.Counter)
    findings = kept = unparseable = 0

    with open(path, "rb") as src, gzip.open(gz_path, "wb", compresslevel=6) as gz, \
            open(find_path, "w") as fnd:
        for raw in src:
            gz.write(raw)
            kept += 1
            try:
                rec = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                unparseable += 1
                continue
            verdict = rec.get("verdict", "MISSING_VERDICT")
            by_table[rec.get("table", "?")][verdict] += 1
            # A record with no evidence path is a contract violation, so it is a
            # finding regardless of what verdict it claims.
            if verdict not in CLEAN or not rec.get("evidence"):
                fnd.write(raw.decode("utf-8", "replace"))
                findings += 1

    summary = {
        "agent": agent,
        "ledgerLines": kept,
        "unparseable": unparseable,
        "findings": findings,
        "rawBytes": os.path.getsize(path),
        "gzipBytes": os.path.getsize(gz_path),
        "byTable": {t: dict(c) for t, c in sorted(by_table.items())},
    }
    with open(summ_path, "w") as fh:
        json.dump(summary, fh, indent=2, sort_keys=True)

    ratio = summary["rawBytes"] / max(summary["gzipBytes"], 1)
    print(f"{agent}: {kept:,} lines -> {summary['gzipBytes']/1048576:.1f} MB gz "
          f"({ratio:.0f}:1), {findings:,} findings, {unparseable:,} unparseable")

    if not keep_raw:
        os.remove(path)
    return summary


def main():
    keep_raw = "--keep-raw" in sys.argv
    os.makedirs(FINDINGS_DIR, exist_ok=True)
    paths = sorted(glob.glob(os.path.join(LEDGER_DIR, "*.jsonl")))
    if not paths:
        print(f"no ledgers in {LEDGER_DIR}")
        return 1

    summaries = [compact(p, keep_raw) for p in paths]

    total_find = sum(s["findings"] for s in summaries)
    total_bad = sum(s["unparseable"] for s in summaries)
    print(f"\n{len(summaries)} ledgers, {sum(s['ledgerLines'] for s in summaries):,} lines, "
          f"{total_find:,} findings, {total_bad:,} unparseable")
    if total_bad:
        print("WARNING: unparseable ledger lines exist -- the ledger is the evidence, "
              "so these must be explained before the audit is considered complete.")
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
