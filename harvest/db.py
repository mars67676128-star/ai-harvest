"""Small transactional repository; JSON content remains portable."""

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def dump(value) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def digest(value) -> str:
    return hashlib.sha256(dump(value).encode("utf-8")).hexdigest()


class Database:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY)")
            for file in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
                if not con.execute(
                    "SELECT 1 FROM schema_migrations WHERE version=?", (file.name,)
                ).fetchone():
                    # Migration names are bundled code, never external input.
                    con.executescript(
                        "BEGIN IMMEDIATE;\n"
                        + file.read_text(encoding="utf-8")
                        + "\nINSERT INTO schema_migrations VALUES ('"
                        + file.name
                        + "');\nCOMMIT;"
                    )

    @contextmanager
    def connection(self):
        con = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        try:
            yield con
        finally:
            con.close()

    @contextmanager
    def transaction(self):
        with self.connection() as con:
            con.execute("BEGIN IMMEDIATE")
            try:
                yield con
                con.commit()
            except BaseException:
                con.rollback()
                raise


def pill_from_row(row) -> dict:
    result = dict(row)
    for field in ("content", "reviewers", "review", "validation", "approval"):
        result[field] = json.loads(result[field]) if result[field] is not None else None
    return result


def object_from_row(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "parent_id": row["parent_id"],
        "created_at": row["created_at"],
        **json.loads(row["data"]),
    }


def add_object(con, kind: str, data: dict, parent_id: str | None = None) -> dict:
    identifier, created = str(uuid4()), now_iso()
    con.execute(
        "INSERT INTO objects VALUES (?,?,?,?,?)", (identifier, kind, parent_id, dump(data), created)
    )
    return {"id": identifier, "kind": kind, "parent_id": parent_id, "created_at": created, **data}


def audit(con, event: str, entity_id: str, actor: str, detail: dict | None = None):
    con.execute(
        "INSERT INTO audit(event,entity_id,actor,created_at,detail) VALUES (?,?,?,?,?)",
        (event, entity_id, actor, now_iso(), dump(detail or {})),
    )
