"""Pure finite rule evaluation; models never participate in authority decisions."""

import operator
from datetime import datetime, timezone

from .models import CaseInput, Observation, PillContent, scalar_fits

OPS = {
    "eq": operator.eq,
    "ne": operator.ne,
    "gt": operator.gt,
    "gte": operator.ge,
    "lt": operator.lt,
    "lte": operator.le,
}


def evaluate(content: PillContent, case: CaseInput, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    issues = []
    scope = content.scope
    for value, allowed, label in [
        (case.asset_type, scope.asset_types, "asset_type"),
        (case.equipment, scope.equipment, "equipment"),
        (case.context, scope.contexts, "context"),
    ]:
        if value not in allowed:
            issues.append(f"OUT_OF_SCOPE: {label}={value}")
    for spec in content.inputs:
        obs = case.observations.get(spec.key)
        if obs is None:
            if spec.required:
                issues.append(f"MISSING_INPUT: {spec.key}")
            continue
        age = (now - obs.observed_at).total_seconds()
        if not scalar_fits(spec.kind, obs.value):
            issues.append(f"INVALID_TYPE: {spec.key}")
        elif spec.kind == "number" and (
            (spec.minimum is not None and obs.value < spec.minimum)
            or (spec.maximum is not None and obs.value > spec.maximum)
        ):
            issues.append(f"OUT_OF_RANGE: {spec.key}")
        if spec.choices and obs.value not in spec.choices:
            issues.append(f"INVALID_CHOICE: {spec.key}")
        if obs.unit != spec.unit:
            issues.append(f"INVALID_UNIT: {spec.key}; expected {spec.unit!r}")
        if obs.quality != "verified":
            issues.append(f"UNVERIFIED_EVIDENCE: {spec.key} ({obs.quality})")
        if age > spec.max_age_seconds or age < -30:
            issues.append(f"STALE_OR_FUTURE_EVIDENCE: {spec.key}")
    base = {
        "decision": "ABSTAIN",
        "actions": [],
        "blocked_actions": [],
        "trace": [],
        "escalations": issues,
        "assumptions": content.assumptions,
        "boundaries": content.guardrails + content.prohibited_actions + scope.exclusions,
        "evidence": [e.model_dump(mode="json") for e in content.evidence],
        "execution_allowed": False,
    }
    if issues:
        base["escalations"].append(
            "Refer to the duty manager; verify scope and evidence before reuse."
        )
        return base
    recommended, blocked, escalations, trace = set(), set(), [], []
    for rule in content.rules:
        if all(OPS[c.op](case.observations[c.input].value, c.value) for c in rule.when):
            recommended.update(rule.recommend)
            blocked.update(rule.block)
            if rule.escalate_to:
                escalations.append(f"{rule.id}: {rule.escalate_to}")
            trace.append(
                {
                    "rule_id": rule.id,
                    "category": rule.category,
                    "rationale": rule.rationale,
                    "evidence_ids": rule.evidence_ids,
                    "observations": {
                        c.input: case.observations[c.input].model_dump(mode="json")
                        for c in rule.when
                    },
                }
            )
    actions = [a.model_dump() for a in content.actions if a.id in recommended - blocked]
    decision = "ESCALATE" if escalations else "HUMAN_REVIEW" if actions else "ABSTAIN"
    if decision == "ABSTAIN":
        escalations.append("NO_COVERING_RULE: qualified human assessment required.")
    return {
        **base,
        "decision": decision,
        "actions": actions,
        "blocked_actions": sorted(blocked),
        "trace": trace,
        "escalations": escalations,
    }


def run_evaluations(content: PillContent) -> dict:
    now = datetime.now(timezone.utc)
    specs = {i.key: i for i in content.inputs}
    results = []
    for test in content.evaluation:
        case = CaseInput(
            title=test.description,
            asset_id="evaluation",
            asset_type=test.asset_type,
            equipment=test.equipment,
            context=test.context,
            observations={
                k: Observation(
                    value=v, unit=specs[k].unit, source="synthetic evaluation", observed_at=now
                )
                for k, v in test.inputs.items()
            },
        )
        actual = evaluate(content, case, now)
        passed = (
            actual["decision"] == test.expected_decision
            and {a["id"] for a in actual["actions"]} == set(test.expected_actions)
            and set(actual["blocked_actions"]) == set(test.expected_blocked)
        )
        results.append(
            {
                "id": test.id,
                "passed": passed,
                "expected": {
                    "decision": test.expected_decision,
                    "actions": test.expected_actions,
                    "blocked": test.expected_blocked,
                },
                "actual": {
                    "decision": actual["decision"],
                    "actions": [a["id"] for a in actual["actions"]],
                    "blocked": actual["blocked_actions"],
                },
            }
        )
    return {"passed": all(r["passed"] for r in results), "results": results}


def combine(results: list[dict]) -> dict:
    blocked = {a for result in results for a in result["blocked_actions"]}
    actions, conflicts = {}, []
    for result in results:
        for action in result["actions"]:
            if action["id"] in actions and actions[action["id"]] != action:
                conflicts.append(f"CONFLICTING_ACTION: {action['id']}")
            actions[action["id"]] = action
    decisions = [r["decision"] for r in results]
    decision = (
        "ABSTAIN"
        if "ABSTAIN" in decisions or conflicts
        else "ESCALATE"
        if "ESCALATE" in decisions
        else "HUMAN_REVIEW"
    )
    allowed = [a for key, a in sorted(actions.items()) if key not in blocked]
    if not allowed and decision == "HUMAN_REVIEW":
        decision = "ABSTAIN"
        conflicts.append("NO_COMBINED_ACTION: all recommendations are blocked.")
    return {
        "decision": decision,
        "actions": [] if decision == "ABSTAIN" else allowed,
        "blocked_actions": sorted(blocked),
        "escalations": [s for r in results for s in r["escalations"]] + conflicts,
        "execution_allowed": False,
        "human_responsibility": "A qualified human owns the decision. No action is executed.",
    }
