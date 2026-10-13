"""Deterministic authorisation and transactional version lifecycle."""

import json

from .db import Database, audit, digest, dump, now_iso, pill_from_row
from .engine import run_evaluations
from .errors import DomainError
from .models import Actor, CreatePill, EvaluationCase, PillContent


def require_role(actor: Actor, *roles):
    if not set(actor.roles).intersection(roles):
        raise DomainError(403, "FORBIDDEN", f"Requires one of these roles: {', '.join(roles)}")


def version_key(version):
    return tuple(int(i) for i in version.split("."))


def read_pill(con, pill_id, version=None):
    row = (
        con.execute(
            "SELECT * FROM pill_versions WHERE pill_id=? AND version=?", (pill_id, version)
        ).fetchone()
        if version
        else con.execute(
            "SELECT * FROM pill_versions WHERE pill_id=? AND status='APPROVED'", (pill_id,)
        ).fetchone()
    )
    if row is None:
        raise DomainError(404, "PILL_NOT_FOUND", "Pill version or approved release not found")
    return pill_from_row(row)


def check_parent(con, request: CreatePill):
    current = con.execute(
        "SELECT version FROM pill_versions WHERE pill_id=? AND status='APPROVED'",
        (request.pill_id,),
    ).fetchone()
    if (current["version"] if current else None) != request.previous_version:
        raise DomainError(
            409, "STALE_PARENT", "Candidate parent is no longer the current approved version"
        )
    if request.previous_version:
        parent = read_pill(con, request.pill_id, request.previous_version)
        if version_key(request.version) <= version_key(request.previous_version):
            raise DomainError(
                422, "VERSION_ORDER", "Candidate version must be greater than its parent"
            )
        if request.owner != parent["owner"] or request.reviewers != parent["reviewers"]:
            raise DomainError(
                409,
                "OWNERSHIP_CHANGE",
                "Knowledge revisions cannot change ownership or review authority",
            )
    else:
        historical = con.execute(
            "SELECT 1 FROM pill_versions WHERE pill_id=? AND status IN ('SUPERSEDED','DEPRECATED')",
            (request.pill_id,),
        ).fetchone()
        if historical:
            raise DomainError(
                409, "RETIRED_PILL", "A retired identity cannot be reused as a new Pill"
            )


def _check_materially_unchanged(
    parent: EvaluationCase,
    candidate: EvaluationCase,
    new_input_keys: set[str],
) -> str | None:
    """Return case_id if materially changed, else None.

    New input keys are permitted only when they correspond to InputSpecs
    genuinely introduced by the candidate and not present in the parent.
    """
    if parent.id != candidate.id:
        return candidate.id
    if parent.asset_type != candidate.asset_type:
        return candidate.id
    if parent.equipment != candidate.equipment:
        return candidate.id
    if parent.context != candidate.context:
        return candidate.id
    if parent.expected_decision != candidate.expected_decision:
        return candidate.id
    if sorted(parent.expected_actions) != sorted(candidate.expected_actions):
        return candidate.id
    if sorted(parent.expected_blocked) != sorted(candidate.expected_blocked):
        return candidate.id
    # Existing input keys must retain their values.
    for key, value in parent.inputs.items():
        if candidate.inputs.get(key) != value:
            return candidate.id
    # Additional keys are allowed only if they are genuinely new candidate InputSpecs.
    for key in candidate.inputs:
        if key not in parent.inputs and key not in new_input_keys:
            return candidate.id
    return None


def check_inherited_evaluations(con, candidate: PillContent, parent_version: str, pill_id: str):
    """Enforce that a successor Pill does not weaken its parent's regression obligations."""
    parent = read_pill(con, pill_id, parent_version)
    parent_content = PillContent.model_validate(parent["content"])

    parent_cases = {c.id: c for c in parent_content.evaluation}
    candidate_cases = {c.id: c for c in candidate.evaluation}
    parent_input_keys = {i.key for i in parent_content.inputs}
    new_input_keys = {i.key for i in candidate.inputs} - parent_input_keys

    for case_id in parent_cases:
        if case_id not in candidate_cases:
            raise DomainError(
                409,
                "INHERITED_REGRESSION_MISSING",
                f"Inherited evaluation case '{case_id}' is missing from the candidate",
            )
        changed = _check_materially_unchanged(
            parent_cases[case_id], candidate_cases[case_id], new_input_keys
        )
        if changed:
            raise DomainError(
                409,
                "INHERITED_REGRESSION_MODIFIED",
                f"Inherited evaluation case '{changed}' must not be materially changed",
            )

    # Run the parent's evaluation cases against the candidate content.
    # Augment with values for any new required inputs that the candidate's cases provide.
    candidate_inputs = {i.key: i for i in candidate.inputs}
    augmented_cases = []
    for cid, parent_case in parent_cases.items():
        candidate_case = candidate_cases[cid]
        merged_inputs = dict(parent_case.inputs)
        for key in candidate_inputs:
            if key not in merged_inputs and candidate_inputs[key].required:
                if key in candidate_case.inputs:
                    merged_inputs[key] = candidate_case.inputs[key]
        augmented = parent_case.model_dump(mode="json")
        augmented["inputs"] = dict(sorted(merged_inputs.items()))
        augmented_cases.append(augmented)
    inherited_only = PillContent.model_validate(
        {**candidate.model_dump(mode="json"), "evaluation": augmented_cases}
    )
    report = run_evaluations(inherited_only)
    if not report["passed"]:
        raise DomainError(
            409,
            "INHERITED_REGRESSION_FAILED",
            "Candidate content failed one or more inherited parent evaluation cases",
        )


def insert_pill(con, request: CreatePill, actor: Actor, event="PILL_CREATED"):
    check_parent(con, request)
    if con.execute(
        "SELECT 1 FROM pill_versions WHERE pill_id=? AND version=?",
        (request.pill_id, request.version),
    ).fetchone():
        raise DomainError(
            409, "VERSION_EXISTS", "This version already exists; create a new version"
        )
    if any(d.pill_id == request.pill_id for d in request.content.dependencies):
        raise DomainError(422, "DEPENDENCY_CYCLE", "A Pill cannot depend on itself")
    content = request.content.model_dump(mode="json")
    con.execute(
        """INSERT INTO pill_versions
        (pill_id,version,status,owner,reviewers,author,previous_version,change_reason,content,content_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            request.pill_id,
            request.version,
            "DRAFT",
            request.owner,
            dump(request.reviewers),
            actor.id,
            request.previous_version,
            request.change_reason,
            dump(content),
            digest(content),
            now_iso(),
        ),
    )
    audit(
        con,
        event,
        request.pill_id,
        actor.id,
        {
            "version": request.version,
            "previous_version": request.previous_version,
            "content_hash": digest(content),
        },
    )
    return read_pill(con, request.pill_id, request.version)


def resolve_pills(con, pill_ids):
    selected = {}
    visiting = set()

    def visit(pill_id, version=None):
        if pill_id in visiting:
            raise DomainError(409, "DEPENDENCY_CYCLE", "Cyclic Pill dependency")
        pill = read_pill(con, pill_id, version)
        if pill["status"] != "APPROVED":
            raise DomainError(
                409,
                "DEPENDENCY_NOT_APPROVED",
                "Every dependency must be at its exact approved version",
            )
        if pill_id in selected:
            if selected[pill_id]["version"] != pill["version"]:
                raise DomainError(
                    409, "DEPENDENCY_CONFLICT", "Conflicting pinned dependency versions"
                )
            return
        visiting.add(pill_id)
        selected[pill_id] = pill
        if len(selected) > 2:
            raise DomainError(
                422, "CAPABILITY_LIMIT", "MVP orchestration supports at most two capabilities"
            )
        for dep in pill["content"]["dependencies"]:
            visit(dep["pill_id"], dep["version"])
        visiting.remove(pill_id)

    for identifier in pill_ids:
        visit(identifier)
    return list(selected.values())


class Governance:
    def __init__(self, db: Database):
        self.db = db

    def create(self, request: CreatePill, actor: Actor):
        require_role(actor, "expert")
        with self.db.transaction() as con:
            return insert_pill(
                con,
                request,
                actor,
                "CANDIDATE_REVISION_CREATED" if request.previous_version else "PILL_CREATED",
            )

    def get(self, pill_id, version):
        with self.db.connection() as con:
            return read_pill(con, pill_id, version)

    def list(self, pill_id=None):
        with self.db.connection() as con:
            rows = con.execute(
                "SELECT * FROM pill_versions" + (" WHERE pill_id=?" if pill_id else ""),
                (pill_id,) if pill_id else (),
            ).fetchall()
        return sorted(
            [pill_from_row(r) for r in rows],
            key=lambda p: (p["pill_id"], version_key(p["version"])),
        )

    def transition(self, pill_id, version, operation, actor: Actor, note=""):
        role = {
            "submit": "expert",
            "review": "reviewer",
            "validate": "reviewer",
            "approve": "approver",
            "reject": "reviewer",
            "deprecate": "approver",
        }[operation]
        require_role(actor, role)
        with self.db.transaction() as con:
            pill = read_pill(con, pill_id, version)
            expected = (
                "DRAFT"
                if operation == "submit"
                else "APPROVED"
                if operation == "deprecate"
                else "IN_REVIEW"
            )
            if pill["status"] != expected:
                raise DomainError(
                    409, "INVALID_TRANSITION", f"{operation} requires state {expected}"
                )
            if operation == "submit" and actor.id != pill["author"]:
                raise DomainError(403, "NOT_AUTHOR", "Only the author can submit this artifact")
            if operation in ("review", "validate", "reject"):
                if actor.id not in pill["reviewers"] or actor.id == pill["author"]:
                    raise DomainError(
                        403,
                        "INDEPENDENT_REVIEW_REQUIRED",
                        "An assigned reviewer other than the author is required",
                    )
            if operation in ("approve", "deprecate"):
                if actor.id != pill["owner"] or actor.id == pill["author"]:
                    raise DomainError(
                        403,
                        "NOT_RELEASE_OWNER",
                        "An authorised owner other than the author is required",
                    )
            content = PillContent.model_validate(pill["content"])
            if operation == "review":
                if content.unresolved_questions or content.contradictions:
                    raise DomainError(
                        409,
                        "UNRESOLVED_KNOWLEDGE",
                        "Create a corrected candidate resolving questions and contradictions before sign-off",
                    )
                review = {
                    "actor": actor.id,
                    "content_hash": pill["content_hash"],
                    "note": note,
                    "at": now_iso(),
                }
                con.execute(
                    "UPDATE pill_versions SET review=? WHERE pill_id=? AND version=?",
                    (dump(review), pill_id, version),
                )
            elif operation == "validate":
                report = {
                    **run_evaluations(content),
                    "content_hash": pill["content_hash"],
                    "actor": actor.id,
                    "at": now_iso(),
                }
                con.execute(
                    "UPDATE pill_versions SET validation=? WHERE pill_id=? AND version=?",
                    (dump(report), pill_id, version),
                )
            elif operation == "approve":
                if not pill["review"] or pill["review"]["content_hash"] != pill["content_hash"]:
                    raise DomainError(
                        409,
                        "REVIEW_REQUIRED",
                        "Independent review of this exact artifact is required",
                    )
                if (
                    not pill["validation"]
                    or not pill["validation"]["passed"]
                    or pill["validation"]["content_hash"] != pill["content_hash"]
                ):
                    raise DomainError(
                        409,
                        "VALIDATION_REQUIRED",
                        "Passing validation of this exact artifact is required",
                    )
                if not run_evaluations(content)["passed"]:
                    raise DomainError(
                        409, "EVALUATION_FAILED", "Release-time regression evaluation failed"
                    )
                if pill["previous_version"]:
                    check_inherited_evaluations(con, content, pill["previous_version"], pill_id)
                req = CreatePill.model_validate({k: pill[k] for k in CreatePill.model_fields})
                check_parent(con, req)
                # Check exact dependencies and bounded graph before promotion.
                if content.dependencies:
                    resolved = resolve_pills(con, [d.pill_id for d in content.dependencies])
                    if len(resolved) != 1 or any(p["pill_id"] == pill_id for p in resolved):
                        raise DomainError(
                            409,
                            "DEPENDENCY_CYCLE",
                            "Candidate dependency must be a single independent approved capability",
                        )
                    if resolved[0]["version"] != content.dependencies[0].version:
                        raise DomainError(
                            409,
                            "DEPENDENCY_NOT_APPROVED",
                            "Pinned dependency version is not the current release",
                        )
                if pill["previous_version"]:
                    con.execute(
                        "UPDATE pill_versions SET status='SUPERSEDED' WHERE pill_id=? AND version=?",
                        (pill_id, pill["previous_version"]),
                    )
                    audit(
                        con,
                        "PILL_SUPERSEDED",
                        pill_id,
                        actor.id,
                        {"version": pill["previous_version"], "successor": version},
                    )
                approval = {
                    "actor": actor.id,
                    "note": note,
                    "at": now_iso(),
                    "content_hash": pill["content_hash"],
                }
                con.execute(
                    "UPDATE pill_versions SET status='APPROVED',approval=? WHERE pill_id=? AND version=?",
                    (dump(approval), pill_id, version),
                )
            else:
                next_state = {
                    "submit": "IN_REVIEW",
                    "reject": "REJECTED",
                    "deprecate": "DEPRECATED",
                }[operation]
                con.execute(
                    "UPDATE pill_versions SET status=? WHERE pill_id=? AND version=?",
                    (next_state, pill_id, version),
                )
            event = {
                "submit": "REVIEW_REQUESTED",
                "review": "EXPERT_REVIEWED",
                "validate": "PILL_VALIDATED",
                "approve": "PILL_APPROVED",
                "reject": "PILL_REJECTED",
                "deprecate": "PILL_DEPRECATED",
            }[operation]
            audit(
                con,
                event,
                pill_id,
                actor.id,
                {"version": version, "note": note, "content_hash": pill["content_hash"]},
            )
            return read_pill(con, pill_id, version)

    def diff(self, pill_id, from_version, to_version):
        before, after = self.get(pill_id, from_version), self.get(pill_id, to_version)
        changes = []

        def walk(left, right, path):
            if isinstance(left, dict) and isinstance(right, dict):
                for key in sorted(left.keys() | right.keys()):
                    if key not in left or key not in right:
                        changes.append(
                            {
                                "path": f"{path}/{key}",
                                "before": left.get(key),
                                "after": right.get(key),
                            }
                        )
                    else:
                        walk(left[key], right[key], f"{path}/{key}")
            elif (
                isinstance(left, list)
                and isinstance(right, list)
                and all(isinstance(i, dict) and ("id" in i or "key" in i) for i in left + right)
            ):
                walk(
                    {i.get("id", i.get("key")): i for i in left},
                    {i.get("id", i.get("key")): i for i in right},
                    path,
                )
            elif left != right:
                changes.append({"path": path, "before": left, "after": right})

        walk(before["content"], after["content"], "/content")
        return {
            "pill_id": pill_id,
            "from_version": from_version,
            "to_version": to_version,
            "from_hash": before["content_hash"],
            "to_hash": after["content_hash"],
            "change_reason": after["change_reason"],
            "changes": changes,
            "affected_tests": [t["id"] for t in after["content"]["evaluation"]],
            "test_impact_note": "Conservative: rerun every candidate test; changed rule conditions may affect unchanged cases.",
            "supporting_evidence": after["content"]["evidence"],
        }

    def audit_history(self, entity_id=None, after=0, limit=100):
        with self.db.connection() as con:
            rows = con.execute(
                "SELECT * FROM audit WHERE sequence>?"
                + (" AND entity_id=?" if entity_id else "")
                + " ORDER BY sequence LIMIT ?",
                (after, entity_id, limit) if entity_id else (after, limit),
            ).fetchall()
        items = [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]
        return {"items": items, "next_after": items[-1]["sequence"] if items else after}
