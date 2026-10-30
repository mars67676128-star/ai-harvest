"""Source-grounded semantic regression / acceptance validation tests."""

import pytest
from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import BASE, call
from harvest.fixtures import OPS_ID, TENANT_ID, operations_content, tenant_content
from harvest.models import PillContent


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


def _release(client, pill_id, version):
    """Submit, review, validate, approve a candidate already created."""
    path = f"/pills/{pill_id}/versions/{version}"
    for op, role in [("submit", "expert"), ("review", "reviewer"), ("validate", "reviewer")]:
        call(client, "POST", f"{path}/{op}", role, {"note": "Synthetic test"})
    return client.post(
        BASE + f"{path}/approve",
        headers={"Authorization": "Bearer demo-approver"},
        json={"note": "Synthetic test"},
    )


@pytest.fixture
def approved(client):
    create(client)
    _release(client, OPS_ID, "1.0.0")
    return client


# ---------------------------------------------------------------------------
# Correct Pills pass acceptance
# ---------------------------------------------------------------------------


def test_correct_ops_pill_passes_acceptance():
    """A fixture-correct ops Pill must pass all source-grounded acceptance cases."""
    from harvest.acceptance import run_acceptance

    result = run_acceptance(operations_content(), OPS_ID)
    assert result.passed, f"Failed cases: {[r for r in result.results if not r['passed']]}"


def test_correct_tenant_pill_passes_acceptance():
    """A fixture-correct tenant Pill must pass all source-grounded acceptance cases."""
    from harvest.acceptance import run_acceptance

    result = run_acceptance(tenant_content(), TENANT_ID)
    assert result.passed, f"Failed cases: {[r for r in result.results if not r['passed']]}"


def test_correct_pill_can_be_approved(client):
    """A correct Pill must pass through the approve gate without SEMANTIC_REGRESSION."""
    create(client)
    response = _release(client, OPS_ID, "1.0.0")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_correct_tenant_pill_can_be_approved(client):
    create(client, pill_id=TENANT_ID, content=tenant_content().model_dump(mode="json"))
    response = _release(client, TENANT_ID, "1.0.0")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Pills with wrong rules fail acceptance
# ---------------------------------------------------------------------------


def test_pill_omitting_review_access_plan_block_fails_acceptance():
    """A Pill where the critical-exposure rule does NOT block review_access_plan
    must fail the acceptance case that expects it to be blocked."""
    from harvest.acceptance import run_acceptance

    content = operations_content()
    data = content.model_dump(mode="json")
    # Remove review_access_plan from the critical-exposure rule's block list
    for r in data["rules"]:
        if r["id"] == "critical-exposure":
            r["block"] = ["monitor_trend"]  # missing review_access_plan
    modified = PillContent.model_validate(data)
    result = run_acceptance(modified, OPS_ID)
    assert not result.passed
    failed = [r["case_id"] for r in result.results if not r["passed"]]
    assert "ops-critical-escalate-blocks-access" in failed


def test_pill_with_wrong_decision_fails_acceptance():
    """A Pill where the rising-water rule does not escalate must fail."""
    from harvest.acceptance import run_acceptance

    content = operations_content()
    data = content.model_dump(mode="json")
    # Remove escalation from the running-is-not-draining rule
    for r in data["rules"]:
        if r["id"] == "running-is-not-draining":
            r["escalate_to"] = None
    modified = PillContent.model_validate(data)
    result = run_acceptance(modified, OPS_ID)
    assert not result.passed
    failed = [r["case_id"] for r in result.results if not r["passed"]]
    assert "ops-rising-escalate" in failed


def test_pill_with_wrong_action_fails_acceptance():
    """A Pill where the rising-water rule recommends the wrong action must fail."""
    from harvest.acceptance import run_acceptance

    content = operations_content()
    data = content.model_dump(mode="json")
    for r in data["rules"]:
        if r["id"] == "running-is-not-draining":
            r["recommend"] = ["monitor_trend"]  # wrong action
    modified = PillContent.model_validate(data)
    result = run_acceptance(modified, OPS_ID)
    assert not result.passed


def test_tenant_pill_omitting_access_block_fails_acceptance():
    """A tenant Pill where the unverified-route rule does not block
    review_access_plan must fail."""
    from harvest.acceptance import run_acceptance

    content = tenant_content()
    data = content.model_dump(mode="json")
    for r in data["rules"]:
        if r["id"] == "unverified-route":
            r["block"] = []  # removed block
    modified = PillContent.model_validate(data)
    result = run_acceptance(modified, TENANT_ID)
    assert not result.passed
    failed = [r["case_id"] for r in result.results if not r["passed"]]
    assert "tenant-unverified-escalate" in failed


# ---------------------------------------------------------------------------
# Changing only AI-generated evaluation cannot bypass acceptance
# ---------------------------------------------------------------------------


def test_changing_evaluation_only_cannot_make_wrong_rules_pass():
    """If the rules are wrong but the evaluation cases are 'corrected' to match,
    the acceptance suite must still fail because it uses its own cases."""
    from harvest.acceptance import run_acceptance

    content = operations_content()
    data = content.model_dump(mode="json")
    # Break the rule: remove escalation from running-is-not-draining
    for r in data["rules"]:
        if r["id"] == "running-is-not-draining":
            r["escalate_to"] = None
    # Change the Pill's OWN evaluation case to match the broken rules
    for ec in data["evaluation"]:
        if ec["id"] == "rising":
            ec["expected_decision"] = "HUMAN_REVIEW"
            ec["expected_actions"] = ["inspect_drainage", "review_access_plan"]
            ec["expected_blocked"] = []
    modified = PillContent.model_validate(data)
    # The Pill's own evaluations would now pass (rules and eval agree)
    from harvest.engine import run_evaluations

    eval_report = run_evaluations(modified)
    assert eval_report["passed"]  # model eval agrees with itself
    # But acceptance must still fail — source-grounded cases are independent
    result = run_acceptance(modified, OPS_ID)
    assert not result.passed


# ---------------------------------------------------------------------------
# SEMANTIC_REGRESSION governance gate
# ---------------------------------------------------------------------------


def test_semantic_regression_blocks_approval(client):
    """A candidate Pill with broken rules must fail approval with
    SEMANTIC_REGRESSION — not EVALUATION_FAILED — when the Pill's own
    evaluation cases are adjusted to match the broken rules."""
    content = operations_content().model_dump(mode="json")
    # Break the rule: remove the block on review_access_plan
    for r in content["rules"]:
        if r["id"] == "critical-exposure":
            r["block"] = ["monitor_trend"]
    # Adjust the Pill's own evaluation to match the broken rules so that
    # run_evaluations passes (rules and eval agree with each other).
    for ec in content["evaluation"]:
        if ec["id"] == "critical":
            ec["expected_blocked"] = ["monitor_trend"]
            # review_access_plan is no longer blocked, so it appears in actions
            ec["expected_actions"] = ["inspect_drainage", "review_access_plan"]
    # Use OPS_ID (registered in acceptance registry) with a fresh DB.
    create(client, pill_id=OPS_ID, content=content)
    response = _release(client, OPS_ID, "1.0.0")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "SEMANTIC_REGRESSION"
    assert "failed_cases" in error["details"]
    assert "ops-critical-escalate-blocks-access" in error["details"]["failed_cases"]


def test_semantic_regression_details_are_sanitized(client):
    """The error details must contain only safe case IDs and decision/action
    identifiers — never transcript text or model content."""
    content = operations_content().model_dump(mode="json")
    for r in content["rules"]:
        if r["id"] == "running-is-not-draining":
            r["escalate_to"] = None
    # Adjust evaluation to match broken rules so run_evaluations passes
    for ec in content["evaluation"]:
        if ec["id"] == "rising":
            ec["expected_decision"] = "HUMAN_REVIEW"
    content["name"] = "Sanitization test pill"
    # Use a new DB so OPS_ID is not already approved; acceptance registry
    # has OPS_ID registered so the gate will fire.
    create(client, pill_id=OPS_ID, content=content)
    response = _release(client, OPS_ID, "1.0.0")
    assert response.status_code == 409
    body = response.text
    # Must not contain transcript content or rule rationales
    assert "Rising water contradicts" not in body
    assert "transcript" not in body.lower()
    assert "interview" not in body.lower()


# ---------------------------------------------------------------------------
# Acceptance validation appears in validate report
# ---------------------------------------------------------------------------


def test_acceptance_included_in_validation_report(client):
    """The validate operation must include acceptance results in its report."""
    create(client)
    path = f"/pills/{OPS_ID}/versions/1.0.0"
    call(client, "POST", f"{path}/submit", "expert", {"note": "submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "review"})
    result = call(client, "POST", f"{path}/validate", "reviewer", {"note": "validate"})
    assert "acceptance" in result["validation"]
    assert result["validation"]["acceptance"]["passed"] is True


# ---------------------------------------------------------------------------
# Unregistered pills skip acceptance
# ---------------------------------------------------------------------------


def test_unregistered_pill_skips_acceptance():
    """A pill_id not in the registry must pass acceptance (no cases)."""
    from harvest.acceptance import run_acceptance

    result = run_acceptance(operations_content(), "some.other.pill")
    assert result.passed
    assert result.results == []


def test_unregistered_pill_can_be_approved(client):
    """A pill not in the acceptance registry must be approvable without
    SEMANTIC_REGRESSION."""
    content = operations_content().model_dump(mode="json")
    create(client, pill_id="some.other.pill", content=content)
    response = _release(client, "some.other.pill", "1.0.0")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Registry extensibility
# ---------------------------------------------------------------------------


def test_registry_can_register_new_pill_cases():
    """Later domains can register acceptance cases via ACCEPTANCE_REGISTRY."""
    from harvest.acceptance import ACCEPTANCE_REGISTRY, AcceptanceCase, run_acceptance
    from harvest.fixtures import demo_case

    custom_id = "test.custom.pill"
    custom_case = AcceptanceCase(
        id="custom-test",
        description="Custom domain case",
        case=demo_case(),
        expected_decision="ESCALATE",
    )
    ACCEPTANCE_REGISTRY[custom_id] = [custom_case]
    try:
        result = run_acceptance(operations_content(), custom_id)
        assert len(result.results) == 1
        assert result.results[0]["case_id"] == "custom-test"
    finally:
        del ACCEPTANCE_REGISTRY[custom_id]
