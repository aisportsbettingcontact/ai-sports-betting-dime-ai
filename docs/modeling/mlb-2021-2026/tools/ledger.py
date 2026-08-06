#!/usr/bin/env python3
"""Append-only, hash-chained execution ledger for the MLB 2021-2026 modeling run.

Contract (mandate §5): every material event appended, never rewritten; corrections are new
events referencing the original. Each event carries a monotonic id, parent id, UTC timestamps,
phase/operation/purpose, repo commit + DB cutoff, sanitized command/query, inputs, expected vs
actual result, exit status, row counts, artifact paths+hashes, evidence class, warnings/next
action, and prev/current SHA-256 chain hashes. File locking makes concurrent appends safe.

Usage:
  python3 ledger.py append '<json-object>'          # fills ids/timestamps/hashes
  python3 ledger.py verify                          # validates order + hash chain
"""
import fcntl, hashlib, json, os, sys, datetime

RUN_DIR = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(RUN_DIR, "mlb-modeling-ledger.jsonl")

def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

def _hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=True).encode()).hexdigest()

def append(event: dict) -> dict:
    with open(LEDGER, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        lines = [l for l in f.read().splitlines() if l.strip()]
        last = json.loads(lines[-1]) if lines else None
        event.setdefault("event_id", (last["event_id"] + 1) if last else 1)
        event.setdefault("parent_event_id", last["event_id"] if last else None)
        event.setdefault("ts_start_utc", _now())
        event.setdefault("ts_end_utc", event["ts_start_utc"])
        event["prev_event_hash"] = last["event_hash"] if last else "GENESIS"
        body = {k: v for k, v in event.items() if k != "event_hash"}
        event["event_hash"] = _hash(body)
        f.write(json.dumps(event, ensure_ascii=True) + "\n")
        fcntl.flock(f, fcntl.LOCK_UN)
    return event

def verify() -> int:
    prev_hash, prev_id = "GENESIS", 0
    n = 0
    with open(LEDGER) as f:
        for line in f:
            if not line.strip():
                continue
            e = json.loads(line)
            assert e["event_id"] == prev_id + 1, f"order break at {e['event_id']}"
            assert e["prev_event_hash"] == prev_hash, f"chain break at {e['event_id']}"
            body = {k: v for k, v in e.items() if k != "event_hash"}
            assert _hash(body) == e["event_hash"], f"hash mismatch at {e['event_id']}"
            prev_hash, prev_id = e["event_hash"], e["event_id"]
            n += 1
    print(f"ledger OK: {n} events, chain intact, head={prev_hash[:16]}")
    return n

if __name__ == "__main__":
    if sys.argv[1] == "append":
        e = append(json.loads(sys.argv[2]))
        print(json.dumps({"event_id": e["event_id"], "event_hash": e["event_hash"][:16]}))
    elif sys.argv[1] == "verify":
        verify()
