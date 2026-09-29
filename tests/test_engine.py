from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from harvest.engine import combine, evaluate, run_evaluations
from harvest.fixtures import demo_case, operations_content, revised_operations, tenant_content
from harvest.models import PillContent


def test_fixture_regressions_pass():
    assert run_evaluations(operations_content())["passed"]
    assert run_evaluations(tenant_content())["passed"]
    assert run_evaluations(revised_operations(operations_content().model_dump()))["passed"]


@pytest.mark.parametrize(
    "fault,expected",
    [
        ("missing", "MISSING_INPUT"),
        ("stale", "STALE_OR_FUTURE"),
        ("future", "STALE_OR_FUTURE"),
        ("unverified", "UNVERIFIED_EVIDENCE"),
        ("conflicting", "UNVERIFIED_EVIDENCE"),
        ("unit", "INVALID_UNIT"),
        ("boolean", "INVALID_TYPE"),
        ("string", "INVALID_TYPE"),
        ("range", "OUT_OF_RANGE"),
        ("scope", "OUT_OF_SCOPE"),
    ],
)
def test_invalid_context_or_evidence_abstains(fault, expected):
    case = demo_case()
    obs = case.observations["water_rise_mm_min"]
    if fault == "missing":
        del case.observations["water_rise_mm_min"]
    elif fault == "stale":
        obs.observed_at = datetime.now(timezone.utc) - timedelta(hours=1)
    elif fault == "future":
        obs.observed_at = datetime.now(timezone.utc) + timedelta(hours=1)
    elif fault in ("unverified", "conflicting"):
        obs.quality = fault
    elif fault == "unit":
        obs.unit = "feet/hour"
    elif fault == "boolean":
        obs.value = True
    elif fault == "string":
        obs.value = "3"
    elif fault == "range":
        obs.value = 500
    elif fault == "scope":
        case.asset_type = "hospital"
    result = evaluate(operations_content(), case)
    assert result["decision"] == "ABSTAIN" and result["actions"] == []
    assert any(expected in issue for issue in result["escalations"])
    assert result["execution_allowed"] is False


def test_cross_domain_block_wins_and_missing_domain_abstains():
    case = demo_case()
    ops, tenant = evaluate(operations_content(), case), evaluate(tenant_content(), case)
    assert "review_access_plan" in {a["id"] for a in ops["actions"]}
    merged = combine([ops, tenant])
    assert "review_access_plan" not in {a["id"] for a in merged["actions"]}
    assert merged["decision"] == "ESCALATE"
    del case.observations["alternative_route_verified"]
    merged = combine([ops, evaluate(tenant_content(), case)])
    assert merged["decision"] == "ABSTAIN" and merged["actions"] == []


def test_revision_detects_discriminating_exception():
    before = operations_content()
    after = revised_operations(before.model_dump())
    case = demo_case(water_rise_mm_min=0, drain_backflow=True)
    assert evaluate(before, case)["decision"] == "HUMAN_REVIEW"
    result = evaluate(after, case)
    assert result["decision"] == "ESCALATE" and "monitor_trend" in result["blocked_actions"]
    assert any(t["rule_id"] == "backflow-exception" for t in result["trace"])


@pytest.mark.parametrize(
    "fault",
    [
        "unknown_input",
        "unknown_action",
        "unknown_evidence",
        "duplicate",
        "optional_guardrail",
        "code_operator",
        "no_escalation_test",
    ],
)
def test_schema_rejects_invalid_rule_graph(fault):
    content = operations_content().model_dump(mode="json")
    if fault == "unknown_input":
        content["rules"][0]["when"][0]["input"] = "not_defined"
    elif fault == "unknown_action":
        content["rules"][0]["recommend"] = ["actuate_pump"]
    elif fault == "unknown_evidence":
        content["rules"][0]["evidence_ids"] = ["made-up"]
    elif fault == "duplicate":
        content["rules"].append(content["rules"][0])
    elif fault == "optional_guardrail":
        content["inputs"][0]["required"] = False
    elif fault == "code_operator":
        content["rules"][0]["when"][0]["op"] = "exec"
    else:
        content["evaluation"] = [
            t for t in content["evaluation"] if t["expected_decision"] != "ESCALATE"
        ]
    with pytest.raises(ValidationError):
        PillContent.model_validate(content)
