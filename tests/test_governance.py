import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from harvest.demo import BASE, call, release
from harvest.errors import DomainError
from harvest.fixtures import OPS_ID, TENANT_ID, demo_case, operations_content, tenant_content
from harvest.models import Actor

from .conftest import create


def post(client, operation, role, version="1.0.0"):
    return client.post(
        BASE + f"/pills/{OPS_ID}/versions/{version}/{operation}",
        headers={"Authorization": f"Bearer demo-{role}"},
        json={"note": "Synthetic test"},
    )


def test_draft_cannot_be_invoked(client):
    create(client)
    case = call(client, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    response = client.post(
        BASE + f"/cases/{case['id']}/invoke",
        headers={"Authorization": "Bearer demo-operator"},
        json={"pill_ids": [OPS_ID]},
    )
    assert response.status_code == 404


def test_exact_review_and_validation_required(client):
    create(client)
    assert post(client, "approve", "approver").status_code == 409
    assert post(client, "submit", "expert").status_code == 200
    assert post(client, "approve", "approver").json()["error"]["code"] == "REVIEW_REQUIRED"
    assert post(client, "review", "reviewer").status_code == 200
    assert post(client, "approve", "approver").json()["error"]["code"] == "VALIDATION_REQUIRED"
    assert post(client, "validate", "reviewer").json()["validation"]["passed"]
    assert post(client, "approve", "approver").status_code == 200


def test_author_cannot_review_or_approve_even_with_roles(client):
    create(client)
    gov = client.app.state.service.governance
    gov.transition(OPS_ID, "1.0.0", "submit", Actor(id="expert", roles=["expert"]))
    for op in ("review", "approve"):
        with pytest.raises(DomainError) as exc:
            gov.transition(OPS_ID, "1.0.0", op, Actor(id="expert", roles=["reviewer", "approver"]))
        assert exc.value.status == 403


def test_rejection_keeps_production_and_history(approved):
    original = call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    create(approved, version="1.1.0", previous="1.0.0")
    post(approved, "submit", "expert", "1.1.0")
    assert post(approved, "reject", "reviewer", "1.1.0").status_code == 200
    assert call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0") == original
    events = call(approved, "GET", "/audit")["items"]
    assert any(e["event"] == "PILL_REJECTED" for e in events)


def test_stale_candidate_cannot_replace_new_release(approved):
    create(approved, version="1.1.0", previous="1.0.0")
    create(approved, version="1.2.0", previous="1.0.0")
    release(approved, OPS_ID, "1.1.0")
    for op, role in [("submit", "expert"), ("review", "reviewer"), ("validate", "reviewer")]:
        assert post(approved, op, role, "1.2.0").status_code == 200
    assert post(approved, "approve", "approver", "1.2.0").json()["error"]["code"] == "STALE_PARENT"
    assert call(approved, "GET", f"/pills/{OPS_ID}/versions/1.1.0")["status"] == "APPROVED"


def test_concurrent_approvals_have_one_winner(approved):
    for version in ("1.1.0", "1.2.0"):
        create(approved, version=version, previous="1.0.0")
        for op, role in [("submit", "expert"), ("review", "reviewer"), ("validate", "reviewer")]:
            assert post(approved, op, role, version).status_code == 200
    gov = approved.app.state.service.governance

    def approve(version):
        try:
            gov.transition(OPS_ID, version, "approve", Actor(id="approver", roles=["approver"]))
            return "approved"
        except DomainError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, ("1.1.0", "1.2.0")))
    assert sorted(results) == ["STALE_PARENT", "approved"]
    assert sum(p["status"] == "APPROVED" for p in gov.list()) == 1


def test_database_protects_artifacts_and_audit(approved):
    db = approved.app.state.service.db
    for sql in (
        "UPDATE pill_versions SET content='{}'",
        "DELETE FROM pill_versions",
        "UPDATE audit SET event='fake'",
        "DELETE FROM audit",
    ):
        with db.transaction() as con, pytest.raises(sqlite3.IntegrityError):
            con.execute(sql)


def test_failed_tests_prevent_release(client):
    content = operations_content().model_dump(mode="json")
    content["evaluation"][0]["expected_actions"] = []
    create(client, content=content)
    post(client, "submit", "expert")
    post(client, "review", "reviewer")
    assert not post(client, "validate", "reviewer").json()["validation"]["passed"]
    assert post(client, "approve", "approver").status_code == 409


def test_unresolved_questions_block_signoff(client):
    content = operations_content().model_dump(mode="json")
    content["unresolved_questions"] = ["Who verified this rule?"]
    create(client, content=content)
    post(client, "submit", "expert")
    assert post(client, "review", "reviewer").json()["error"]["code"] == "UNRESOLVED_KNOWLEDGE"


def test_pinned_dependency_is_resolved_and_deprecation_abstains(client):
    create(client, pill_id=TENANT_ID, content=tenant_content().model_dump(mode="json"))
    release(client, TENANT_ID, "1.0.0")
    content = operations_content().model_dump(mode="json")
    content["dependencies"] = [{"pill_id": TENANT_ID, "version": "1.0.0"}]
    create(client, content=content)
    release(client, OPS_ID, "1.0.0")
    case = call(client, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(client, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    assert len(rec["capabilities"]) == 2
    call(
        client,
        "POST",
        f"/pills/{TENANT_ID}/versions/1.0.0/deprecate",
        "approver",
        {"note": "Synthetic deprecation"},
    )
    response = client.post(
        BASE + f"/cases/{case['id']}/invoke",
        headers={"Authorization": "Bearer demo-operator"},
        json={"pill_ids": [OPS_ID]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DEPENDENCY_NOT_APPROVED"


def _release(client, pill_id, version):
    """Submit, review, validate, approve a candidate already created."""
    for op, role in [
        ("submit", "expert"),
        ("review", "reviewer"),
        ("validate", "reviewer"),
    ]:
        post(client, op, role, version)
    return post(client, "approve", "approver", version)


def test_deleting_inherited_evaluation_case_blocks_approval(approved):
    content = operations_content().model_dump(mode="json")
    content["evaluation"] = [t for t in content["evaluation"] if t["id"] != "rising"]
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INHERITED_REGRESSION_MISSING"


def test_modifying_inherited_evaluation_case_blocks_approval(approved):
    content = operations_content().model_dump(mode="json")
    for t in content["evaluation"]:
        if t["id"] == "rising":
            # Change an existing input value. The candidate still produces ESCALATE
            # (water_rise_mm_min=5 still matches "gt 0"), so the candidate's own
            # validation passes, but the inherited test definition is materially changed.
            t["inputs"]["water_rise_mm_min"] = 5
            break
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INHERITED_REGRESSION_MODIFIED"


def test_candidate_that_adds_new_evaluation_case_can_be_approved(approved):
    content = operations_content().model_dump(mode="json")
    content["inputs"].append(
        {
            "key": "drain_backflow",
            "description": "Backflow present",
            "kind": "boolean",
            "required": True,
            "unit": "",
            "max_age_seconds": 900,
        }
    )
    # All existing evaluation cases must include the new required input.
    for t in content["evaluation"]:
        if t["inputs"] is not None:
            t["inputs"]["drain_backflow"] = False
    # Add the backflow-exception rule so the new evaluation case passes.
    content["rules"].append(
        {
            "id": "backflow-exception",
            "category": "exception",
            "when": [{"input": "drain_backflow", "op": "eq", "value": True}],
            "recommend": ["inspect_drainage"],
            "block": ["monitor_trend"],
            "escalate_to": "Duty facilities engineer",
            "rationale": "Backflow invalidates monitoring as the sole response.",
            "evidence_ids": ["demo-interview"],
        }
    )
    content["evaluation"].append(
        {
            "id": "backflow",
            "description": "Synthetic regression: backflow",
            "asset_type": "office",
            "equipment": "basement_sump",
            "context": "wet_weather",
            "inputs": {
                "water_rise_mm_min": 0,
                "pump_running": True,
                "critical_equipment_exposed": False,
                "drain_backflow": True,
            },
            "expected_decision": "ESCALATE",
            "expected_actions": ["inspect_drainage"],
            "expected_blocked": ["monitor_trend"],
        }
    )
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_inherited_evaluation_failing_against_candidate_blocks_approval(approved):
    """Direct unit test: parent test preserved but fails against candidate content."""
    from harvest.governance import check_inherited_evaluations
    from harvest.models import PillContent

    gov = approved.app.state.service.governance
    parent = gov.get(OPS_ID, "1.0.0")
    parent_content = PillContent.model_validate(parent["content"])

    # Build a candidate that preserves parent tests but whose content would fail them.
    candidate_content = parent_content.model_copy(deep=True)
    # Remove the rule that makes the "rising" parent test pass.
    candidate_content.rules = [
        r for r in candidate_content.rules if r.id != "running-is-not-draining"
    ]

    with approved.app.state.service.db.transaction() as con:
        with pytest.raises(DomainError) as exc:
            check_inherited_evaluations(con, candidate_content, "1.0.0", OPS_ID)
        assert exc.value.code == "INHERITED_REGRESSION_FAILED"


def test_approved_parent_content_unchanged_after_inheritance_rejection(approved):
    original = call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    content = operations_content().model_dump(mode="json")
    content["evaluation"] = [t for t in content["evaluation"] if t["id"] != "rising"]
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    _release(approved, OPS_ID, "1.1.0")
    after = call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    assert after["content_hash"] == original["content_hash"]
    assert after["status"] == "APPROVED"


def test_new_input_spec_in_inherited_case_is_allowed(approved):
    """Adding a genuinely new InputSpec value to an inherited case is permitted."""
    content = operations_content().model_dump(mode="json")
    content["inputs"].append(
        {
            "key": "drain_backflow",
            "description": "Backflow present",
            "kind": "boolean",
            "required": True,
            "unit": "",
            "max_age_seconds": 900,
        }
    )
    for t in content["evaluation"]:
        if t["inputs"] is not None:
            t["inputs"]["drain_backflow"] = False
    content["rules"].append(
        {
            "id": "backflow-exception",
            "category": "exception",
            "when": [{"input": "drain_backflow", "op": "eq", "value": True}],
            "recommend": ["inspect_drainage"],
            "block": ["monitor_trend"],
            "escalate_to": "Duty facilities engineer",
            "rationale": "Backflow invalidates monitoring as the sole response.",
            "evidence_ids": ["demo-interview"],
        }
    )
    content["evaluation"].append(
        {
            "id": "backflow",
            "description": "Synthetic regression: backflow",
            "asset_type": "office",
            "equipment": "basement_sump",
            "context": "wet_weather",
            "inputs": {
                "water_rise_mm_min": 0,
                "pump_running": True,
                "critical_equipment_exposed": False,
                "drain_backflow": True,
            },
            "expected_decision": "ESCALATE",
            "expected_actions": ["inspect_drainage"],
            "expected_blocked": ["monitor_trend"],
        }
    )
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_adding_existing_parent_input_to_inherited_case_is_rejected(approved):
    """Adding a value for an InputSpec that already existed in the parent schema
    to an inherited evaluation case that previously omitted it is rejected."""
    content = operations_content().model_dump(mode="json")
    # The parent 'missing' case has empty inputs. Add an existing parent input
    # (water_rise_mm_min) to it. This silently narrows the inherited regression.
    for t in content["evaluation"]:
        if t["id"] == "missing":
            t["inputs"]["water_rise_mm_min"] = 0
            break
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INHERITED_REGRESSION_MODIFIED"


def test_existing_v1_0_0_to_v1_1_0_workflow_still_passes(approved):
    """The synthetic backflow revision from fixtures must still be approvable."""
    from harvest.fixtures import revised_operations

    content = revised_operations(operations_content().model_dump()).model_dump(mode="json")
    create(approved, version="1.1.0", previous="1.0.0", content=content)
    response = _release(approved, OPS_ID, "1.1.0")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"
