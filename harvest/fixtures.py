"""SYNTHETIC DEMO DATA. No Keppel assets, interviews or validated procedures."""

from datetime import datetime, timezone

from .models import CaseInput, PillContent

OPS_ID = "asset.monsoon.triage"
TENANT_ID = "tenant.incident.continuity"
OPS_TRANSCRIPT = (
    "SYNTHETIC EXPERT INTERVIEW: At Harbour Exchange the sump pump showed running, "
    "but basement water was still rising. A junior operator trusted the green status. "
    "I compare actual water trend with that indication and request qualified drainage inspection. "
    "A running signal is not proof of effective drainage. If water is rising while the pump runs, "
    "escalate to the duty facilities engineer. If water approaches critical equipment, escalate "
    "to the incident lead and never recommend entering the affected area. If water is stable "
    "or falling and no critical equipment is exposed, recommend continued observation for human review. "
    "Before considering an access plan, ask the tenant team to verify a safe alternative route. "
    "This applies only to our synthetic office basement sump during wet weather. "
    "No pump switching, barrier deployment, electrical work or automated messages are authorised."
)
TENANT_TRANSCRIPT = (
    "SYNTHETIC EXPERT INTERVIEW: During the same Harbour Exchange basement incident, "
    "tenant arrivals were expected. The tempting shortcut was to propose a new access plan "
    "without checking the route. If an alternative route is not verified, block that recommendation "
    "and escalate to the tenant duty manager. If the route is verified and tenants are arriving, "
    "recommend human review of the access plan and a draft tenant update. If no arrivals are "
    "expected, recommend continued liaison. Never send the message or change access automatically. "
    "Only our synthetic wet-weather office basement context is covered."
)
BACKFLOW_TEXT = (
    "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified "
    "drain_backflow observation. If backflow is present, escalate to the duty facilities engineer "
    "and block routine monitoring as the sole response, even when water is not rising."
)
ACCESS_DESCRIPTION = "Ask the incident lead to review an access plan after safe-route verification."


def action(identifier, description):
    return {"id": identifier, "description": description, "human_approval_required": True}


def condition(key, op, value):
    return {"input": key, "op": op, "value": value}


def rule(identifier, when, rationale, recommend=(), block=(), escalate=None, category="heuristic"):
    return {
        "id": identifier,
        "category": category,
        "when": when,
        "recommend": list(recommend),
        "block": list(block),
        "escalate_to": escalate,
        "rationale": rationale,
        "evidence_ids": ["demo-interview"],
    }


def evaluation(identifier, inputs, decision, actions=(), blocked=(), asset_type="office"):
    return {
        "id": identifier,
        "description": f"Synthetic regression: {identifier}",
        "asset_type": asset_type,
        "equipment": "basement_sump",
        "context": "wet_weather",
        "inputs": inputs,
        "expected_decision": decision,
        "expected_actions": list(actions),
        "expected_blocked": list(blocked),
    }


def base_content(domain):
    return {
        "schema_version": "1.0",
        "domain": domain,
        "scope": {
            "asset_types": ["office"],
            "equipment": ["basement_sump"],
            "contexts": ["wet_weather"],
            "prerequisites": ["Qualified duty team available; verified observations supplied."],
            "exclusions": [
                "Not a live emergency procedure; no personnel entry or equipment actuation guidance."
            ],
        },
        "facts": ["All operational values and people in this artifact are synthetic."],
        "assumptions": ["A site-specific emergency plan takes precedence over this demonstration."],
        "exceptions": ["Unknown conditions require qualified human assessment."],
        "prohibited_actions": [
            "Automatic equipment control",
            "Automatic access changes",
            "Automatic tenant messaging",
            "Automatic knowledge release",
        ],
        "guardrails": [
            "Advisory output only; a qualified human owns consequential decisions.",
            "Do not enter water-affected areas on the basis of this demo.",
        ],
        "evidence": [
            {
                "id": "demo-interview",
                "kind": "expert_interview",
                "citation": "Synthetic interview fixture; not a real professional interview.",
                "summary": "Case-based reconstruction, novice pitfall, exceptions and escalation.",
                "synthetic": True,
            },
            {
                "id": "pub-context",
                "kind": "public_context",
                "citation": "https://www.pub.gov.sg/Resources/News-Room/PressReleases/2026/06/Flood-Resilient-Developments-Guidebook",
                "summary": "Context only: property-level flood resilience and response planning; does not validate our rules.",
                "synthetic": False,
            },
        ],
        "dependencies": [],
        "unresolved_questions": [],
        "contradictions": [],
        "synthetic": True,
    }


def input_spec(key, kind, unit="", minimum=None, maximum=None):
    return {
        "key": key,
        "description": f"Synthetic verified observation: {key}",
        "kind": kind,
        "required": True,
        "unit": unit,
        "max_age_seconds": 900,
        "minimum": minimum,
        "maximum": maximum,
    }


def operations_content() -> PillContent:
    base = base_content("Asset Operations")
    rising = {"water_rise_mm_min": 3, "pump_running": True, "critical_equipment_exposed": False}
    stable = {**rising, "water_rise_mm_min": 0}
    base.update(
        {
            "name": "Monsoon near-miss triage",
            "description": "Distinguish equipment status from demonstrated drainage effectiveness.",
            "inputs": [
                input_spec("water_rise_mm_min", "number", "mm/min", -100, 100),
                input_spec("pump_running", "boolean"),
                input_spec("critical_equipment_exposed", "boolean"),
            ],
            "expert_observations": ["A running pump indication does not prove effective drainage."],
            "actions": [
                action(
                    "inspect_drainage",
                    "Request qualified drainage assessment from the duty facilities engineer.",
                ),
                action(
                    "monitor_trend",
                    "Ask the duty team to continue verified observation and reassess.",
                ),
                action("review_access_plan", ACCESS_DESCRIPTION),
            ],
            "rules": [
                rule(
                    "running-is-not-draining",
                    [
                        condition("water_rise_mm_min", "gt", 0),
                        condition("pump_running", "eq", True),
                    ],
                    "Rising water contradicts the assumption that a running pump is managing inflow.",
                    ["inspect_drainage", "review_access_plan"],
                    escalate="Duty facilities engineer",
                ),
                rule(
                    "pump-not-running",
                    [
                        condition("water_rise_mm_min", "gt", 0),
                        condition("pump_running", "eq", False),
                    ],
                    "Rising water and absent running indication need qualified assessment, not remote switching.",
                    ["inspect_drainage"],
                    escalate="Duty facilities engineer",
                ),
                rule(
                    "stable-trend",
                    [
                        condition("water_rise_mm_min", "lte", 0),
                        condition("critical_equipment_exposed", "eq", False),
                    ],
                    "Verified stable trend without observed critical exposure permits a monitoring recommendation.",
                    ["monitor_trend"],
                ),
                rule(
                    "critical-exposure",
                    [condition("critical_equipment_exposed", "eq", True)],
                    "Critical equipment exposure exceeds this advisory workflow's authority.",
                    block=["monitor_trend", "review_access_plan"],
                    escalate="Incident lead and qualified electrical specialist",
                    category="guardrail",
                ),
            ],
            "evaluation": [
                evaluation(
                    "rising", rising, "ESCALATE", ["inspect_drainage", "review_access_plan"]
                ),
                evaluation("stable", stable, "HUMAN_REVIEW", ["monitor_trend"]),
                evaluation(
                    "critical",
                    {**rising, "critical_equipment_exposed": True},
                    "ESCALATE",
                    ["inspect_drainage"],
                    ["monitor_trend", "review_access_plan"],
                ),
                evaluation("missing", {}, "ABSTAIN"),
                evaluation("scope", stable, "ABSTAIN", asset_type="residential"),
            ],
        }
    )
    return PillContent.model_validate(base)


def tenant_content() -> PillContent:
    base = base_content("Tenant Experience")
    base.update(
        {
            "name": "Tenant incident continuity",
            "description": "Prevent a proposed access plan from outrunning verified tenant-route evidence.",
            "expert_observations": [
                "An operationally convenient access plan can conflict with tenant safety constraints."
            ],
            "inputs": [
                input_spec("alternative_route_verified", "boolean"),
                input_spec("tenant_arrivals_expected", "boolean"),
            ],
            "actions": [
                action("review_access_plan", ACCESS_DESCRIPTION),
                action(
                    "draft_tenant_update",
                    "Prepare a factual tenant update for the duty manager's review; do not send.",
                ),
                action(
                    "tenant_liaison", "Ask the tenant duty manager to maintain incident liaison."
                ),
            ],
            "rules": [
                rule(
                    "unverified-route",
                    [condition("alternative_route_verified", "eq", False)],
                    "No verified alternative route means the access plan is not ready for approval.",
                    ["tenant_liaison"],
                    ["review_access_plan"],
                    "Tenant duty manager",
                    "guardrail",
                ),
                rule(
                    "verified-arrivals",
                    [
                        condition("alternative_route_verified", "eq", True),
                        condition("tenant_arrivals_expected", "eq", True),
                    ],
                    "Verified route and expected arrivals justify preparing options for human review.",
                    ["review_access_plan", "draft_tenant_update"],
                ),
                rule(
                    "no-arrivals",
                    [
                        condition("alternative_route_verified", "eq", True),
                        condition("tenant_arrivals_expected", "eq", False),
                    ],
                    "Maintain coordination even if tenant arrivals are not currently expected.",
                    ["tenant_liaison"],
                ),
            ],
            "evaluation": [
                evaluation(
                    "unverified",
                    {"alternative_route_verified": False, "tenant_arrivals_expected": True},
                    "ESCALATE",
                    ["tenant_liaison"],
                    ["review_access_plan"],
                ),
                evaluation(
                    "verified",
                    {"alternative_route_verified": True, "tenant_arrivals_expected": True},
                    "HUMAN_REVIEW",
                    ["review_access_plan", "draft_tenant_update"],
                ),
                evaluation("missing", {}, "ABSTAIN"),
            ],
        }
    )
    return PillContent.model_validate(base)


def revised_operations(current: dict) -> PillContent:
    data = PillContent.model_validate(current).model_dump(mode="json")
    data["inputs"].append(input_spec("drain_backflow", "boolean"))
    data["expert_observations"].append(
        "A flat water trend can hide drain backflow; trend alone is insufficient."
    )
    data["rules"].append(
        rule(
            "backflow-exception",
            [condition("drain_backflow", "eq", True)],
            "The newly observed exception invalidates monitoring as the sole response.",
            ["inspect_drainage"],
            ["monitor_trend"],
            "Duty facilities engineer",
            "exception",
        )
    )
    for test in data["evaluation"]:
        if test["inputs"] is not None:
            test["inputs"]["drain_backflow"] = False
    data["evaluation"].append(
        evaluation(
            "flat-but-backflow",
            {
                "water_rise_mm_min": 0,
                "pump_running": True,
                "critical_equipment_exposed": False,
                "drain_backflow": True,
            },
            "ESCALATE",
            ["inspect_drainage"],
            ["monitor_trend"],
        )
    )
    return PillContent.model_validate(data)


def demo_case(**values) -> CaseInput:
    raw = {
        "water_rise_mm_min": 3,
        "pump_running": True,
        "critical_equipment_exposed": False,
        "alternative_route_verified": False,
        "tenant_arrivals_expected": True,
    }
    raw.update(values)
    observed_at = datetime.now(timezone.utc)
    return CaseInput.model_validate(
        {
            "title": "SYNTHETIC: Green pump indicator, rising basement water",
            "asset_id": "harbour-exchange-demo",
            "asset_type": "office",
            "equipment": "basement_sump",
            "context": "wet_weather",
            "synthetic": True,
            "observations": {
                k: {
                    "value": v,
                    "unit": "mm/min" if k == "water_rise_mm_min" else "",
                    "source": "Synthetic verified demo observation",
                    "observed_at": observed_at,
                    "quality": "verified",
                }
                for k, v in raw.items()
            },
        }
    )


ELICITATION = [
    {
        "technique": "incident reconstruction",
        "question": "Think of the last case: what happened, in what order, and what did you actually do?",
    },
    {
        "technique": "decision walkthrough",
        "question": "What did you notice first, and which evidence changed your recommendation?",
    },
    {
        "technique": "novice comparison",
        "question": "What would a junior operator commonly miss or misinterpret?",
    },
    {
        "technique": "counterfactual",
        "question": "If the apparent signal were wrong, what evidence would expose that?",
    },
    {
        "technique": "exception discovery",
        "question": "When does this rule not apply, and what looks harmless but is not?",
    },
    {
        "technique": "uncertainty",
        "question": "Which missing or contradictory information should make us abstain?",
    },
    {
        "technique": "escalation",
        "question": "Who must take over, and what decision remains outside your authority?",
    },
]
