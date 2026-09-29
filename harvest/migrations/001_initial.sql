CREATE TABLE IF NOT EXISTS pill_versions (
    pill_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','SUPERSEDED','DEPRECATED')),
    owner TEXT NOT NULL,
    reviewers TEXT NOT NULL CHECK(json_valid(reviewers)),
    author TEXT NOT NULL,
    previous_version TEXT,
    change_reason TEXT NOT NULL,
    content TEXT NOT NULL CHECK(json_valid(content)),
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review TEXT,
    validation TEXT,
    approval TEXT,
    PRIMARY KEY(pill_id, version),
    FOREIGN KEY(pill_id, previous_version) REFERENCES pill_versions(pill_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_version ON pill_versions(pill_id) WHERE status='APPROVED';
CREATE TRIGGER IF NOT EXISTS immutable_pill_content
BEFORE UPDATE OF pill_id, version, owner, reviewers, author, previous_version, change_reason, content, content_hash, created_at ON pill_versions
BEGIN SELECT RAISE(ABORT, 'Pill artifacts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_pill_delete BEFORE DELETE ON pill_versions
BEGIN SELECT RAISE(ABORT, 'Pill history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS legal_lifecycle BEFORE UPDATE OF status ON pill_versions
WHEN NOT (
  (OLD.status='DRAFT' AND NEW.status='IN_REVIEW') OR
  (OLD.status='IN_REVIEW' AND NEW.status IN ('APPROVED','REJECTED')) OR
  (OLD.status='APPROVED' AND NEW.status IN ('SUPERSEDED','DEPRECATED'))
)
BEGIN SELECT RAISE(ABORT, 'Invalid Pill state transition'); END;

CREATE TABLE IF NOT EXISTS objects (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    parent_id TEXT REFERENCES objects(id),
    data TEXT NOT NULL CHECK(json_valid(data)),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_parent ON objects(parent_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS one_capture_extraction ON objects(parent_id) WHERE kind='extraction';
CREATE UNIQUE INDEX IF NOT EXISTS one_human_decision ON objects(parent_id) WHERE kind='decision';
CREATE UNIQUE INDEX IF NOT EXISTS one_outcome ON objects(parent_id) WHERE kind='outcome';
CREATE TRIGGER IF NOT EXISTS no_object_update BEFORE UPDATE ON objects
BEGIN SELECT RAISE(ABORT, 'Operational history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_object_delete BEFORE DELETE ON objects
BEGIN SELECT RAISE(ABORT, 'Operational history cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS audit (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    detail TEXT NOT NULL CHECK(json_valid(detail))
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit(entity_id, sequence);
CREATE TRIGGER IF NOT EXISTS no_audit_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS no_audit_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
