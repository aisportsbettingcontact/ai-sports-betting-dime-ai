"""replay_db.py — shared pymysql connection helper for the Phase 5 replay tools.

Reads DATABASE_URL from the environment (mysql://user:pass@host:port/db).
The URL is never logged or printed by anything in this package.
"""

from __future__ import annotations

import os
import re

import pymysql
import pymysql.cursors

_URL_RE = re.compile(r"mysql2?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)")


def connect() -> pymysql.connections.Connection:
    """Open a pymysql connection from DATABASE_URL (DictCursor, autocommit off)."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in the environment")
    m = _URL_RE.match(url)
    if not m:
        raise RuntimeError("DATABASE_URL did not match the expected mysql:// shape")
    return pymysql.connect(
        host=m.group(3),
        port=int(m.group(4) or 3306),
        user=m.group(1),
        password=m.group(2),
        database=m.group(5),
        ssl={"ssl": {}},
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
