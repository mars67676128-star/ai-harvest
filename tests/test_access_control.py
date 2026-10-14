import pytest

from harvest.config import Settings
from harvest.demo import BASE, call
from harvest.errors import DomainError
from harvest.fixtures import BACKFLOW_TEXT, OPS_ID, OPS_TRANSCRIPT, demo_case, operations_content
from harvest.governance import validate_governance_authority
from harvest.models import Actor, CreatePill

from .conftest import create


def test_duplicate_configured_actor_id_raises_valueerror():
    with pytest.raises(ValueError, match="Duplicate configured actor ID: shared-id"):
        Settings(
            tokens={
                "token-a": Actor(id="shared-id", roles=["expert"]),
                "token-b": Actor(id="shared-id", roles=["reviewer"]),
            }
        )


def test_unknown_owner_rejected(client):
    response = client.post(
        BASE + "/pills",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "test.unknown.owner",
            "version": "1.0.0",
            "owner": "nonexistent",
            "reviewers": ["reviewer"],
            "content": operations_content().model_dump(mode="json"),
            "change_reason": "Test",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "UNKNOWN_AUTHORITY"


def test_owner_without_approver_role_rejected(client):
    response = client.post(
        BASE + "/pills",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "test.wrong.role.owner",
            "version": "1.0.0",
            "owner": "expert",
            "reviewers": ["reviewer"],
            "content": operations_content().model_dump(mode="json"),
            "change_reason": "Test",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "INVALID_AUTHORITY_ROLE"


def test_unknown_reviewer_rejected(client):
    response = client.post(
        BASE + "/pills",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "test.unknown.reviewer",
            "version": "1.0.0",
            "owner": "approver",
            "reviewers": ["nonexistent"],
            "content": operations_content().model_dump(mode="json"),
            "change_reason": "Test",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "UNKNOWN_AUTHORITY"


def test_reviewer_without_reviewer_role_rejected(client):
    response = client.post(
        BASE + "/pills",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "test.wrong.role.reviewer",
            "version": "1.0.0",
            "owner": "approver",
            "reviewers": ["expert"],
            "content": operations_content().model_dump(mode="json"),
            "change_reason": "Test",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "INVALID_AUTHORITY_ROLE"


def test_duplicate_reviewers_rejected(client):
    response = client.post(
        BASE + "/pills",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "test.duplicate.reviewer",
            "version": "1.0.0",
            "owner": "approver",
            "reviewers": ["reviewer", "reviewer"],
            "content": operations_content().model_dump(mode="json"),
            "change_reason": "Test",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTHORITY_SEPARATION_REQUIRED"


def test_author_cannot_be_owner():
    known = {
        "expert": Actor(id="expert", roles=["expert"]),
        "approver": Actor(id="approver", roles=["approver"]),
        "reviewer": Actor(id="reviewer", roles=["reviewer"]),
    }
    req = CreatePill(
        pill_id="test",
        version="1.0.0",
        owner="approver",
        reviewers=["reviewer"],
        content=operations_content(),
        change_reason="Test",
    )
    with pytest.raises(DomainError) as exc:
        validate_governance_authority(
            req, Actor(id="approver", roles=["expert", "approver"]), known
        )
    assert exc.value.code == "AUTHORITY_SEPARATION_REQUIRED"


def test_author_cannot_be_reviewer():
    known = {
        "expert": Actor(id="expert", roles=["expert", "reviewer"]),
        "approver": Actor(id="approver", roles=["approver"]),
        "reviewer": Actor(id="reviewer", roles=["reviewer"]),
    }
    req = CreatePill(
        pill_id="test",
        version="1.0.0",
        owner="approver",
        reviewers=["expert"],
        content=operations_content(),
        change_reason="Test",
    )
    with pytest.raises(DomainError) as exc:
        validate_governance_authority(req, Actor(id="expert", roles=["expert", "reviewer"]), known)
    assert exc.value.code == "AUTHORITY_SEPARATION_REQUIRED"


def test_owner_cannot_be_reviewer():
    known = {
        "expert": Actor(id="expert", roles=["expert"]),
        "approver": Actor(id="approver", roles=["approver", "reviewer"]),
        "reviewer": Actor(id="reviewer", roles=["reviewer"]),
    }
    req = CreatePill(
        pill_id="test",
        version="1.0.0",
        owner="approver",
        reviewers=["approver"],
        content=operations_content(),
        change_reason="Test",
    )
    with pytest.raises(DomainError) as exc:
        validate_governance_authority(req, Actor(id="expert", roles=["expert"]), known)
    assert exc.value.code == "AUTHORITY_SEPARATION_REQUIRED"


def test_valid_configured_authority_succeeds(client):
    result = create(client)
    assert result["owner"] == "approver"
    assert result["reviewers"] == ["reviewer"]


def test_compile_enforces_authority(client):
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Test",
            "domain": "Asset Operations",
            "transcript": OPS_TRANSCRIPT,
            "synthetic": True,
        },
    )
    call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
    response = client.post(
        BASE + f"/captures/{capture['id']}/compile",
        headers={"Authorization": "Bearer demo-expert"},
        json={"pill_id": "test.compile", "owner": "expert", "reviewers": ["reviewer"]},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "INVALID_AUTHORITY_ROLE"


def test_proposal_calls_authority_validation(approved, monkeypatch):
    called = []
    original = validate_governance_authority

    def tracking_validate(request, actor, known_actors):
        called.append((request.pill_id, request.owner, list(request.reviewers)))
        return original(request, actor, known_actors)

    monkeypatch.setattr("harvest.service.validate_governance_authority", tracking_validate)

    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "escalate", "note": "Test"},
    )
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {"summary": "Test", "resolved": True, "synthetic": True},
    )
    feedback = call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    call(approved, "POST", f"/feedback/{feedback['id']}/propose", "expert")

    assert any(pill_id == OPS_ID for pill_id, _, _ in called)


# Read-authorization policy tests


def test_viewer_cannot_read_capture(client):
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {"title": "Test", "domain": "Asset Operations", "transcript": "x" * 100, "synthetic": True},
    )
    response = client.get(
        BASE + f"/captures/{capture['id']}",
        headers={"Authorization": "Bearer demo-viewer"},
    )
    assert response.status_code == 403


def test_viewer_cannot_read_cases(client):
    response = client.get(BASE + "/cases", headers={"Authorization": "Bearer demo-viewer"})
    assert response.status_code == 403


def test_viewer_cannot_read_recommendations(client):
    response = client.get(
        BASE + "/recommendations", headers={"Authorization": "Bearer demo-viewer"}
    )
    assert response.status_code == 403


def test_viewer_cannot_read_feedback(client):
    response = client.get(
        BASE + "/feedback/some-id", headers={"Authorization": "Bearer demo-viewer"}
    )
    assert response.status_code == 403


def test_viewer_cannot_read_diff(client):
    response = client.get(
        BASE + f"/pills/{OPS_ID}/diff?from_version=1.0.0&to_version=1.0.0",
        headers={"Authorization": "Bearer demo-viewer"},
    )
    assert response.status_code == 403


def test_viewer_cannot_read_audit(client):
    response = client.get(BASE + "/audit", headers={"Authorization": "Bearer demo-viewer"})
    assert response.status_code == 403


def test_operator_can_read_cases_and_recommendations(approved):
    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    assert call(approved, "GET", f"/cases/{case['id']}", "operator")["id"] == case["id"]
    assert any(r["id"] == rec["id"] for r in call(approved, "GET", "/recommendations", "operator"))


def test_operator_cannot_read_capture_audit_diff(approved):
    response = approved.get(
        BASE + "/captures/some-id", headers={"Authorization": "Bearer demo-operator"}
    )
    assert response.status_code == 403

    response = approved.get(BASE + "/audit", headers={"Authorization": "Bearer demo-operator"})
    assert response.status_code == 403

    response = approved.get(
        BASE + f"/pills/{OPS_ID}/diff?from_version=1.0.0&to_version=1.0.0",
        headers={"Authorization": "Bearer demo-operator"},
    )
    assert response.status_code == 403


def test_reviewer_can_read_capture_diff_feedback_audit(approved):
    capture = call(
        approved,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Test",
            "domain": "Asset Operations",
            "transcript": OPS_TRANSCRIPT,
            "synthetic": True,
        },
    )
    assert call(approved, "GET", f"/captures/{capture['id']}", "reviewer")["id"] == capture["id"]

    call(approved, "GET", f"/pills/{OPS_ID}/diff?from_version=1.0.0&to_version=1.0.0", "reviewer")

    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "escalate", "note": "Test"},
    )
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {"summary": "Test", "resolved": True, "synthetic": True},
    )
    feedback = call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    assert call(approved, "GET", f"/feedback/{feedback['id']}", "reviewer")["id"] == feedback["id"]

    assert len(call(approved, "GET", "/audit", "reviewer")["items"]) > 0


def test_reviewer_cannot_read_cases_recommendations(approved):
    response = approved.get(BASE + "/cases", headers={"Authorization": "Bearer demo-reviewer"})
    assert response.status_code == 403

    response = approved.get(
        BASE + "/recommendations", headers={"Authorization": "Bearer demo-reviewer"}
    )
    assert response.status_code == 403


def test_approver_can_read_everything_restricted(approved):
    capture = call(
        approved,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Test",
            "domain": "Asset Operations",
            "transcript": OPS_TRANSCRIPT,
            "synthetic": True,
        },
    )
    assert call(approved, "GET", f"/captures/{capture['id']}", "approver")["id"] == capture["id"]

    call(approved, "GET", f"/pills/{OPS_ID}/diff?from_version=1.0.0&to_version=1.0.0", "approver")

    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    assert call(approved, "GET", f"/cases/{case['id']}", "approver")["id"] == case["id"]
    assert call(approved, "GET", f"/recommendations/{rec['id']}", "approver")["id"] == rec["id"]

    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "escalate", "note": "Test"},
    )
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {"summary": "Test", "resolved": True, "synthetic": True},
    )
    feedback = call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    assert call(approved, "GET", f"/feedback/{feedback['id']}", "approver")["id"] == feedback["id"]

    assert len(call(approved, "GET", "/audit", "approver")["items"]) > 0
