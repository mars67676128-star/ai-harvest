"""Graceful UNRESOLVED_KNOWLEDGE handling in the live demo orchestration.

Tests that when a feedback-generated AI revision contains unresolved questions:
- The live demo orchestration does NOT crash
- The revision is NOT approved
- The revision's unresolved questions are NOT removed
- The revision is NOT silently corrected
- The approved Pill's content/hash/status remains unchanged
- UNRESOLVED_KNOWLEDGE governance gate is NOT weakened
- The mock demo's v1.1.0 lifecycle remains unchanged
- The graceful handling is in orchestration only, not API/service behavior
"""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import BASE, _attempt_revision_release, call, release, run
from harvest.fixtures import BACKFLOW_TEXT, OPS_ID, operations_content
from harvest.providers import CompatibleProvider


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(database=str(tmp_path / "test.db")))) as client:
        yield client


def create(client, pill_id=OPS_ID, version="1.0.0", previous=None, content=None):
    return call(
        client,
        "POST",
        "/pills",
        "expert",
        {
            "pill_id": pill_id,
            "version": version,
            "owner": "approver",
            "reviewers": ["reviewer"],
            "content": content or operations_content().model_dump(mode="json"),
            "previous_version": previous,
            "change_reason": "Synthetic test artifact",
        },
    )


def _mock_chat_response(payload: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "req",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(payload)}}],
        },
    )


def _revised_content_with_unresolved_questions(current: dict) -> dict:
    """Build revision content that has unresolved_questions populated."""
    from harvest.fixtures import revised_operations

    content = revised_operations(current).model_dump(mode="json")
    content["unresolved_questions"] = [
        "Is the drain backflow intermittent or continuous?",
        "What is the duty cycle of the sump pump under backflow conditions?",
    ]
    return content


def _unresolved_revision_provider(current_content: dict) -> CompatibleProvider:
    """Provider that returns a revision with unresolved questions.

    For the 'revise' operation, the expected output type is PillContent, so the
    mock response content must be a PillContent dict (not wrapped in Extraction).
    """
    payload = _revised_content_with_unresolved_questions(current_content)
    return CompatibleProvider(
        Settings(provider="tencent", model="hunyuan-pro", api_key="test-key"),
        transport=httpx.MockTransport(lambda req: _mock_chat_response(payload)),
    )


def _seed_approved_ops(client) -> str:
    """Seed an approved OPS pill and return its version."""
    create(client)
    release(client, OPS_ID, "1.0.0")
    return "1.0.0"


def _create_feedback_revision(client, approved_version="1.0.0"):
    """Create a case, recommendation, feedback, and proposed revision DRAFT."""
    from harvest.fixtures import demo_case

    case = call(client, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(
        client,
        "POST",
        f"/cases/{case['id']}/invoke",
        "operator",
        {"pill_ids": [OPS_ID]},
    )
    call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "escalate", "note": "SYNTHETIC: referred to duty engineering."},
    )
    call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {
            "summary": "SYNTHETIC: duty team assessment identified intermittent drain backflow.",
            "resolved": True,
            "synthetic": True,
        },
    )
    feedback = call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    candidate = call(client, "POST", f"/feedback/{feedback['id']}/propose", "expert")
    return feedback, candidate, rec


# ---------------------------------------------------------------------------
# 1. Revision with unresolved questions is blocked by governance
# ---------------------------------------------------------------------------


def test_revision_with_unresolved_questions_blocked_at_review(client):
    """An AI revision with unresolved_questions cannot pass review."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _, candidate, _ = _create_feedback_revision(client, approved_version)

    # Submit the candidate
    call(client, "POST", f"/pills/{OPS_ID}/versions/1.1.0/submit", "expert", {"note": "submit"})

    # Attempt review — should fail with UNRESOLVED_KNOWLEDGE
    response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.1.0/review",
        headers={"Authorization": "Bearer demo-reviewer"},
        json={"note": "review"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "UNRESOLVED_KNOWLEDGE"


# ---------------------------------------------------------------------------
# 2. _attempt_revision_release detects UNRESOLVED_KNOWLEDGE gracefully
# ---------------------------------------------------------------------------


def test_attempt_revision_release_detects_unresolved(client):
    """The orchestration helper detects UNRESOLVED_KNOWLEDGE without crashing."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _create_feedback_revision(client, approved_version)

    outcome = _attempt_revision_release(client, OPS_ID, "1.1.0", approved_version)
    assert outcome["blocked_by_unresolved"] is True
    assert outcome["approved_unchanged"]["version"] == approved_version
    assert outcome["approved_unchanged"]["status"] == "APPROVED"


def test_attempt_revision_release_allows_clean_revision(client):
    """When the revision has no unresolved questions, the helper releases normally."""
    # Use mock provider — revised_operations fixture has no unresolved questions
    approved_version = _seed_approved_ops(client)
    _create_feedback_revision(client, approved_version)

    outcome = _attempt_revision_release(client, OPS_ID, "1.1.0", approved_version)
    assert outcome["blocked_by_unresolved"] is False
    assert outcome["approved"]["status"] == "APPROVED"
    assert outcome["historical"]["status"] == "SUPERSEDED"


# ---------------------------------------------------------------------------
# 3. v1.1.0 is NOT approved; unresolved questions NOT removed
# ---------------------------------------------------------------------------


def test_unresolved_revision_not_approved(client):
    """The blocked revision must NOT be approved."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _create_feedback_revision(client, approved_version)

    _attempt_revision_release(client, OPS_ID, "1.1.0", approved_version)

    revision = call(client, "GET", f"/pills/{OPS_ID}/versions/1.1.0")
    assert revision["status"] != "APPROVED"
    # The revision was submitted but review failed — it stays IN_REVIEW
    assert revision["status"] == "IN_REVIEW"
    assert revision["review"] is None


def test_unresolved_questions_not_removed(client):
    """The unresolved questions must remain in the candidate content."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _create_feedback_revision(client, approved_version)

    _attempt_revision_release(client, OPS_ID, "1.1.0", approved_version)

    revision = call(client, "GET", f"/pills/{OPS_ID}/versions/1.1.0")
    assert len(revision["content"]["unresolved_questions"]) == 2
    assert (
        "Is the drain backflow intermittent or continuous?"
        in (revision["content"]["unresolved_questions"])
    )


# ---------------------------------------------------------------------------
# 4. Approved Pill remains unchanged
# ---------------------------------------------------------------------------


def test_approved_pill_unchanged_after_blocked_revision(client):
    """The approved Pill's content, hash, and status must remain unchanged."""
    approved_version = _seed_approved_ops(client)
    original = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    original_hash = original["content_hash"]
    original_content = original["content"]

    client.app.state.service.provider = _unresolved_revision_provider(original["content"])
    _create_feedback_revision(client, approved_version)

    _attempt_revision_release(client, OPS_ID, "1.1.0", approved_version)

    approved_after = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    assert approved_after["status"] == "APPROVED"
    assert approved_after["content_hash"] == original_hash
    assert approved_after["content"] == original_content


# ---------------------------------------------------------------------------
# 5. UNRESOLVED_KNOWLEDGE gate NOT weakened
# ---------------------------------------------------------------------------


def test_unresolved_knowledge_gate_not_weakened(client):
    """The governance API still blocks — the gate is not weakened."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _create_feedback_revision(client, approved_version)

    # Submit + attempt review directly via API
    call(client, "POST", f"/pills/{OPS_ID}/versions/1.1.0/submit", "expert", {"note": "submit"})
    response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.1.0/review",
        headers={"Authorization": "Bearer demo-reviewer"},
        json={"note": "review"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "UNRESOLVED_KNOWLEDGE"

    # Verify the API itself rejects approve attempts (review is required)
    approve_response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.1.0/approve",
        headers={"Authorization": "Bearer demo-approver"},
        json={"note": "try approve"},
    )
    assert approve_response.status_code == 409
    assert approve_response.json()["error"]["code"] == "REVIEW_REQUIRED"


# ---------------------------------------------------------------------------
# 6. Mock demo v1.1.0 lifecycle unchanged
# ---------------------------------------------------------------------------


def test_mock_demo_full_run_with_v1_1_0_lifecycle(tmp_path):
    """The mock demo must still complete the full v1.1.0 lifecycle."""
    with TestClient(create_app(Settings(database=str(tmp_path / "mock-demo.db")))) as client:
        report = run(client, seed_only=False, live=False)

    # v1.1.0 was approved (not blocked)
    assert report.get("revision_blocked") is None or report.get("revision_blocked") is False
    assert report["approved"]["status"] == "APPROVED"
    assert report["approved"]["version"] == "1.1.0"
    assert report["history"]["status"] == "SUPERSEDED"
    # Runtime behaviour changed after revision
    assert report["before_revision"]["result"]["decision"] == "HUMAN_REVIEW"
    assert report["after_revision"]["result"]["decision"] == "ESCALATE"


# ---------------------------------------------------------------------------
# 7. Live demo ends gracefully with blocked revision
# ---------------------------------------------------------------------------


def test_live_demo_ends_gracefully_when_revision_blocked(tmp_path):
    """The live demo must end successfully when a revision is blocked."""

    with TestClient(create_app(Settings(database=str(tmp_path / "live-demo.db")))) as client:
        # Seed with mock provider (deterministic approved pills)
        from harvest.demo import seed

        seed(client, live=False)

        # Get approved content
        approved = call(client, "GET", f"/pills/{OPS_ID}/versions/1.0.0")

        # Set up provider that returns unresolved revision
        client.app.state.service.provider = _unresolved_revision_provider(approved["content"])

        report = run(client, seed_only=False, live=True)

    assert report["live"] is True
    assert report["revision_blocked"] is True
    assert report["revision_block_reason"] == "UNRESOLVED_KNOWLEDGE"

    # Approved pill unchanged
    approved_info = report["approved_version_unchanged"]
    assert approved_info["status"] == "APPROVED"
    assert approved_info["version"] == "1.0.0"

    # v1.1.0 was NOT approved
    assert "approved" not in report or report.get("revision_blocked") is True

    # Audit contains the full lifecycle
    audit = report["audit"]
    events = [e["event"] for e in audit["items"]]
    assert "PILL_VERSION_CREATED" in events or "CANDIDATE_REVISION_CREATED" in events


# ---------------------------------------------------------------------------
# 8. Orchestration-only — API/service behavior unchanged
# ---------------------------------------------------------------------------


def test_api_still_blocks_unresolved_revision_directly(client):
    """The API governance layer is unchanged — it blocks unresolved revisions."""
    approved_version = _seed_approved_ops(client)
    approved = call(client, "GET", f"/pills/{OPS_ID}/versions/{approved_version}")
    client.app.state.service.provider = _unresolved_revision_provider(approved["content"])
    _create_feedback_revision(client, approved_version)

    # The API must block — no orchestration workaround
    call(client, "POST", f"/pills/{OPS_ID}/versions/1.1.0/submit", "expert", {"note": "submit"})
    response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.1.0/review",
        headers={"Authorization": "Bearer demo-reviewer"},
        json={"note": "review"},
    )
    assert response.status_code == 409
    # The error is from the governance layer, not from orchestration
    assert response.json()["error"]["code"] == "UNRESOLVED_KNOWLEDGE"
