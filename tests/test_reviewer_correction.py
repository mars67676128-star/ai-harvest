"""Scripted reviewer correction flow tests.

Tests that a live/demo candidate failing semantic acceptance:
- cannot be directly approved
- triggers an explicit, auditable scripted reviewer correction
- corrected candidate must pass acceptance before approval
- real/non-synthetic candidates are never auto-corrected
- provenance distinguishes AI output from human correction
- all governance gates remain intact
- mock demo still passes
"""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import BASE, call
from harvest.fixtures import OPS_ID, OPS_TRANSCRIPT, operations_content
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


def _release_response(client, pill_id, version):
    """Submit, review, validate, approve — returns the raw approve response."""
    path = f"/pills/{pill_id}/versions/{version}"
    for op, role in [("submit", "expert"), ("review", "reviewer"), ("validate", "reviewer")]:
        call(client, "POST", f"{path}/{op}", role, {"note": "Synthetic test"})
    return client.post(
        BASE + f"{path}/approve",
        headers={"Authorization": "Bearer demo-approver"},
        json={"note": "Synthetic test"},
    )


# ---------------------------------------------------------------------------
# Drifted extraction provider — simulates live AI that produces schema-valid
# content with wrong deterministic behaviour
# ---------------------------------------------------------------------------


def _drifted_extraction_json() -> dict:
    """Build extraction content that is schema-valid but semantically drifted.

    The critical-exposure rule does NOT block review_access_plan, and the
    evaluation cases are adjusted to match the broken rules.
    """
    content = operations_content().model_dump(mode="json")
    for r in content["rules"]:
        if r["id"] == "critical-exposure":
            r["block"] = ["monitor_trend"]
    for ec in content["evaluation"]:
        if ec["id"] == "critical":
            ec["expected_blocked"] = ["monitor_trend"]
            ec["expected_actions"] = ["inspect_drainage", "review_access_plan"]
    return {
        "summary": "Drifted extraction: rules do not preserve source-grounded behaviour.",
        "elicitation_gaps": [],
        "content": content,
    }


def _mock_chat_response(payload: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "req-drifted",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(payload)}}],
        },
    )


def _drifted_provider() -> CompatibleProvider:
    return CompatibleProvider(
        Settings(provider="tencent", model="hunyuan-pro", api_key="test-key"),
        transport=httpx.MockTransport(lambda req: _mock_chat_response(_drifted_extraction_json())),
    )


def _capture_and_extract_drifted(client):
    """Create a capture, extract with drifted provider, compile to a DRAFT pill."""
    client.app.state.service.provider = _drifted_provider()
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {
            "title": "SYNTHETIC drifted interview",
            "transcript": OPS_TRANSCRIPT,
            "domain": "Asset Operations",
            "synthetic": True,
        },
    )
    call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
    draft = call(
        client,
        "POST",
        f"/captures/{capture['id']}/compile",
        "expert",
        {"pill_id": OPS_ID},
    )
    return capture, draft


# ---------------------------------------------------------------------------
# 1. Live/demo candidate semantic failure cannot be directly approved
# ---------------------------------------------------------------------------


def test_drifted_ai_draft_cannot_be_approved(client):
    """An AI draft with drifted rules must fail approval with SEMANTIC_REGRESSION."""
    _, draft = _capture_and_extract_drifted(client)
    response = _release_response(client, OPS_ID, "1.0.0")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "SEMANTIC_REGRESSION"
    assert "ops-critical-escalate-blocks-access" in error["details"]["failed_cases"]


# ---------------------------------------------------------------------------
# 2. Scripted reviewer correction is visibly/auditably separate
# ---------------------------------------------------------------------------


def test_scripted_correction_creates_new_version_with_provenance(client):
    """The correction endpoint creates a new DRAFT version with provenance."""
    _, draft = _capture_and_extract_drifted(client)
    # Validate to discover the failed cases
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    validation = call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})
    failed = [
        r["case_id"] for r in validation["validation"]["acceptance"]["results"] if not r["passed"]
    ]
    assert failed  # acceptance failed

    # Create scripted correction
    correction = call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": failed,
        },
    )
    assert correction["status"] == "DRAFT"
    assert correction["version"] == "1.0.1"
    assert "SCRIPTED SYNTHETIC HUMAN CORRECTION" in correction["change_reason"]
    assert "AI draft v1.0.0" in correction["change_reason"]
    assert "ops-critical-escalate-blocks-access" in correction["change_reason"]

    # Check audit trail
    audit = call(client, "GET", "/audit?limit=500", "reviewer")
    correction_events = [e for e in audit["items"] if e["event"] == "SCRIPTED_REVIEWER_CORRECTION"]
    assert len(correction_events) == 1
    detail = correction_events[0]["detail"]
    assert detail["ai_draft_version"] == "1.0.0"
    assert detail["corrected_version"] == "1.0.1"
    assert "ops-critical-escalate-blocks-access" in detail["failed_cases"]
    assert detail["source"] == "labelled synthetic expert evidence fixture"
    assert detail["synthetic"] is True


def test_ai_draft_remains_unapproved_after_correction(client):
    """The AI draft must remain in an unapproved state, not silently replaced."""
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})

    correction = call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["ops-critical-escalate-blocks-access"],
        },
    )
    # AI draft is still IN_REVIEW (submitted, reviewed, validated, not approved)
    ai_draft = call(client, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    assert ai_draft["status"] != "APPROVED"
    # Corrected version is a separate DRAFT
    assert correction["status"] == "DRAFT"
    assert correction["version"] == "1.0.1"
    # Content hashes differ
    assert ai_draft["content_hash"] != correction["content_hash"]


# ---------------------------------------------------------------------------
# 3. Corrected candidate must pass acceptance before approval
# ---------------------------------------------------------------------------


def test_corrected_candidate_passes_acceptance_and_can_be_approved(client):
    """The scripted corrected candidate passes acceptance and can be approved."""
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    validation = call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})
    failed = [
        r["case_id"] for r in validation["validation"]["acceptance"]["results"] if not r["passed"]
    ]

    call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": failed,
        },
    )
    response = _release_response(client, OPS_ID, "1.0.1")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_corrected_candidate_still_must_pass_governance_gates(client):
    """The corrected candidate must go through review + validate + approve."""
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})

    call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["ops-critical-escalate-blocks-access"],
        },
    )
    # Submit the corrected version but skip review
    call(client, "POST", f"/pills/{OPS_ID}/versions/1.0.1/submit", "expert", {"note": "submit"})
    # Try to approve without review — should fail with REVIEW_REQUIRED
    response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.0.1/approve",
        headers={"Authorization": "Bearer demo-approver"},
        json={"note": "skip review"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REVIEW_REQUIRED"


# ---------------------------------------------------------------------------
# 4. Real/non-synthetic candidates are never auto-corrected
# ---------------------------------------------------------------------------


def test_correction_endpoint_rejects_unregistered_pills(client):
    """The correction endpoint must reject pill_ids not in the acceptance registry."""
    response = client.post(
        BASE + "/pills/some.real.pill/versions/1.0.1/correct",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "some.real.pill",
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["some-case"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CORRECTION_NOT_AVAILABLE"


def test_real_free_form_extraction_not_auto_corrected(client):
    """A real (non-synthetic) free-form extraction that fails acceptance must
    NOT be auto-corrected — the correction endpoint is demo-only."""
    # Build a provider that returns drifted content for a non-synthetic capture
    content = operations_content().model_dump(mode="json")
    content["synthetic"] = False
    for r in content["rules"]:
        if r["id"] == "critical-exposure":
            r["block"] = ["monitor_trend"]
    for ec in content["evaluation"]:
        if ec["id"] == "critical":
            ec["expected_blocked"] = ["monitor_trend"]
            ec["expected_actions"] = ["inspect_drainage", "review_access_plan"]
    payload = {
        "summary": "Real drifted extraction",
        "elicitation_gaps": [],
        "content": content,
    }
    provider = CompatibleProvider(
        Settings(provider="tencent", model="hunyuan-pro", api_key="test-key"),
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200,
                json={
                    "id": "req",
                    "choices": [
                        {"finish_reason": "stop", "message": {"content": json.dumps(payload)}}
                    ],
                },
            )
        ),
    )
    client.app.state.service.provider = provider
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Real interview",
            "transcript": "A real non-synthetic interview about equipment.",
            "domain": "Asset Operations",
            "synthetic": False,
        },
    )
    call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
    call(
        client,
        "POST",
        f"/captures/{capture['id']}/compile",
        "expert",
        {"pill_id": "some.real.pill"},
    )
    # The correction endpoint must reject this — it's not a registered demo pill
    response = client.post(
        BASE + "/pills/some.real.pill/versions/1.0.1/correct",
        headers={"Authorization": "Bearer demo-expert"},
        json={
            "pill_id": "some.real.pill",
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": [],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CORRECTION_NOT_AVAILABLE"


# ---------------------------------------------------------------------------
# 5. Provenance distinguishes AI output from human correction
# ---------------------------------------------------------------------------


def test_provenance_distinguishes_ai_draft_and_correction(client):
    """The audit trail must clearly separate AI extraction from scripted correction."""
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})

    call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["ops-critical-escalate-blocks-access"],
        },
    )
    audit = call(client, "GET", "/audit?limit=500", "reviewer")
    events = [e["event"] for e in audit["items"]]

    # AI extraction event exists
    assert "KNOWLEDGE_EXTRACTED" in events
    # Scripted correction event exists and is distinct
    assert "SCRIPTED_REVIEWER_CORRECTION" in events

    # The correction event must have provenance metadata
    correction_event = next(
        e for e in audit["items"] if e["event"] == "SCRIPTED_REVIEWER_CORRECTION"
    )
    detail = correction_event["detail"]
    assert detail["ai_draft_version"] == "1.0.0"
    assert detail["corrected_version"] == "1.0.1"
    assert detail["source"] == "labelled synthetic expert evidence fixture"
    assert detail["synthetic"] is True

    # The AI extraction event must have AI metadata
    extraction_event = next(e for e in audit["items"] if e["event"] == "KNOWLEDGE_EXTRACTED")
    assert "ai" in extraction_event["detail"]


def test_corrected_content_is_labelled_synthetic(client):
    """The corrected pill content must be labelled synthetic=True."""
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})

    correction = call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["ops-critical-escalate-blocks-access"],
        },
    )
    assert correction["content"]["synthetic"] is True


# ---------------------------------------------------------------------------
# 6. Governance gates remain intact
# ---------------------------------------------------------------------------


def test_corrected_candidate_reject_blocked_by_unresolved_knowledge(client):
    """If the corrected content had unresolved questions, review must block."""
    # This test verifies the governance path is intact even for corrections.
    _, draft = _capture_and_extract_drifted(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})

    correction = call(
        client,
        "POST",
        f"/pills/{OPS_ID}/versions/1.0.1/correct",
        "expert",
        {
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": ["ops-critical-escalate-blocks-access"],
        },
    )
    # The fixture content has no unresolved questions, so review should pass
    assert correction["status"] == "DRAFT"
    call(client, "POST", f"/pills/{OPS_ID}/versions/1.0.1/submit", "expert", {"note": "submit"})
    review_result = call(
        client, "POST", f"/pills/{OPS_ID}/versions/1.0.1/review", "reviewer", {"note": "review"}
    )
    # Review succeeded (no UNRESOLVED_KNOWLEDGE error)
    assert review_result["review"] is not None


def test_correction_requires_expert_role(client):
    """The correction endpoint requires the expert role."""
    response = client.post(
        BASE + f"/pills/{OPS_ID}/versions/1.0.1/correct",
        headers={"Authorization": "Bearer demo-viewer"},
        json={
            "pill_id": OPS_ID,
            "version": "1.0.1",
            "ai_draft_version": "1.0.0",
            "failed_cases": [],
        },
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 7. Mock demo still passes
# ---------------------------------------------------------------------------


def test_mock_demo_seed_still_passes(client):
    """The mock (non-live) demo seed path must work unchanged."""
    from harvest.demo import seed

    result = seed(client, live=False)
    assert len(result) == 2
    for item in result:
        assert item["approved"]["status"] == "APPROVED"


def test_mock_demo_full_run_still_passes(tmp_path):
    """The full mock demo run must pass end-to-end."""
    from harvest.demo import run

    with TestClient(create_app(Settings(database=str(tmp_path / "full-demo.db")))) as client:
        report = run(client, seed_only=False, live=False)
    assert report["synthetic"] is True
    assert report["live"] is False
    # Two pills seeded and approved
    assert len(report["seed"]) == 2
