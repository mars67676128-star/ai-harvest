"""SYNTHETIC DEMO DATA. No Keppel assets, interviews or validated procedures."""

from datetime import datetime, timezone

from .models import CaseInput, PillContent

OPS_ID = "asset.monsoon.triage"
TENANT_ID = "tenant.incident.continuity"
OPS_TRANSCRIPT = (
    "SYNTHETIC EXPERT INTERVIEW: This is a synthetic reconstruction of a near-miss at Harbour "
    "Exchange. No real personnel, assets, or actions are involved. Everything I describe is "
    "demo material for knowledge capture.\n"
    "\n"
    "Scenario: During wet weather, our office basement sump pump showed a green running "
    "indication, but basement water was still rising. A junior operator trusted the green "
    "status and nearly missed the problem. A running signal is not proof of effective drainage.\n"
    "\n"
    "The scope is narrow: this applies only to our synthetic office basement sump during "
    "wet_weather. Asset type is office, equipment is basement_sump. It is not a live emergency "
    "procedure; no personnel entry or equipment actuation guidance. A site-specific emergency "
    "plan takes precedence over this demonstration. Unknown conditions require qualified human "
    "assessment.\n"
    "\n"
    "Required observations: I need three verified inputs, all required, each no older than 900 "
    "seconds. First, water_rise_mm_min — a number in millimetres per minute, range minus 100 to "
    "100. A value greater than 0 means water is rising. Zero or below means stable or falling. "
    "Second, pump_running — a boolean: true if the sump pump shows a running indication. Third, "
    "critical_equipment_exposed — a boolean: true if critical equipment in the basement is "
    "exposed to water.\n"
    "\n"
    "Allowed human actions, all requiring human approval: inspect_drainage — request a qualified "
    "drainage assessment from the duty facilities engineer. monitor_trend — ask the duty team to "
    "continue verified observation and reassess. review_access_plan — ask the incident lead to "
    "review an access plan after safe-route verification.\n"
    "\n"
    "Prohibited actions: never recommend automatic equipment control, automatic access changes, "
    "automatic tenant messaging, or automatic knowledge release. No pump switching, barrier "
    "deployment, electrical work, or automated messages are authorised.\n"
    "\n"
    "Guardrails: this is advisory output only; a qualified human owns consequential decisions. "
    "Do not enter water-affected areas on the basis of this demo.\n"
    "\n"
    "Decision rules: If water_rise_mm_min is greater than 0 and pump_running is true, that "
    "contradicts the assumption that a running pump is managing inflow. Recommend "
    "inspect_drainage and review_access_plan, and escalate to the Duty facilities engineer. "
    "If water_rise_mm_min is greater than 0 and pump_running is false, rising water with no "
    "running indication needs qualified assessment, not remote switching. Recommend "
    "inspect_drainage and escalate to the Duty facilities engineer. If water_rise_mm_min is "
    "less than or equal to 0 and critical_equipment_exposed is false, a verified stable trend "
    "without observed critical exposure permits a monitoring recommendation: recommend "
    "monitor_trend. If critical_equipment_exposed is true, that exceeds this advisory "
    "workflow's authority — block monitor_trend and review_access_plan, and escalate to the "
    "Incident lead and qualified electrical specialist.\n"
    "\n"
    "Evidence basis: the primary evidence is this synthetic expert interview, a case-based "
    "reconstruction covering the novice pitfall, exceptions, and escalation. Secondary context "
    "is a public flood-resilience guidebook from PUB Singapore; that provides context only and "
    "does not validate our rules.\n"
    "\n"
    "Test scenarios I would use to validate this: First, rising — water_rise_mm_min is 3, "
    "pump_running is true, critical_equipment_exposed is false. Expected decision is ESCALATE; "
    "expected recommended actions are inspect_drainage and review_access_plan. Second, stable — "
    "water_rise_mm_min is 0, pump_running is true, critical_equipment_exposed is false. Expected "
    "decision is HUMAN_REVIEW; expected action is monitor_trend. Third, critical — water_rise_mm_min "
    "is 3, pump_running is true, critical_equipment_exposed is true. Expected decision is ESCALATE; "
    "expected recommended action is inspect_drainage; expected blocked actions are monitor_trend "
    "and review_access_plan. Fourth, missing inputs — no observations supplied. Expected decision "
    "is ABSTAIN. Fifth, out of scope — same as stable but asset_type is residential, not office. "
    "Expected decision is ABSTAIN.\n"
    "\n"
    "I consider the scope, inputs, assumptions, exceptions, actions, prohibited actions, "
    "guardrails, rules, escalation recipients, evidence, and evaluation cases described above "
    "complete for this synthetic workflow. There are no known contradictions in what I have "
    "described. Any condition outside the stated scope is already handled by the stated exception "
    "that unknown conditions require qualified human assessment."
)
TENANT_TRANSCRIPT = (
    "SYNTHETIC EXPERT INTERVIEW: This is a synthetic reconstruction from the same Harbour "
    "Exchange basement incident. No real tenants, personnel, or actions are involved.\n"
    "\n"
    "Scenario: During the basement incident, tenant arrivals were expected. The tempting "
    "shortcut was to propose a new access plan without checking the route. An operationally "
    "convenient access plan can conflict with tenant safety constraints.\n"
    "\n"
    "Scope: only our synthetic wet-weather office basement context is covered. Asset type is "
    "office, equipment is basement_sump, context is wet_weather. Not a live emergency procedure. "
    "A site-specific emergency plan takes precedence. Unknown conditions require qualified human "
    "assessment.\n"
    "\n"
    "Required observations: two verified boolean inputs, both required, no older than 900 "
    "seconds. First, alternative_route_verified — true if a safe alternative route has been "
    "verified by the tenant team. Second, tenant_arrivals_expected — true if tenant arrivals "
    "are currently expected.\n"
    "\n"
    "Allowed human actions, all requiring human approval: review_access_plan — ask the incident "
    "lead to review an access plan after safe-route verification. draft_tenant_update — prepare "
    "a factual tenant update for the duty manager's review; do not send. tenant_liaison — ask "
    "the tenant duty manager to maintain incident liaison.\n"
    "\n"
    "Prohibited actions: never send the message or change access automatically. No automatic "
    "equipment control, automatic access changes, automatic tenant messaging, or automatic "
    "knowledge release.\n"
    "\n"
    "Guardrails: advisory output only; a qualified human owns consequential decisions. Do not "
    "enter water-affected areas on the basis of this demo.\n"
    "\n"
    "Decision rules: If alternative_route_verified is false, there is no verified alternative "
    "route, so the access plan is not ready for approval. Recommend tenant_liaison, block "
    "review_access_plan, and escalate to the Tenant duty manager. If alternative_route_verified "
    "is true and tenant_arrivals_expected is true, a verified route with expected arrivals "
    "justifies preparing options for human review. Recommend review_access_plan and "
    "draft_tenant_update. If alternative_route_verified is true and tenant_arrivals_expected "
    "is false, maintain coordination even if tenant arrivals are not currently expected. "
    "Recommend tenant_liaison.\n"
    "\n"
    "Evidence basis: the primary evidence is this synthetic expert interview, covering the "
    "access-plan shortcut risk and tenant safety constraints. Secondary context is the PUB "
    "Singapore flood-resilience guidebook; context only, does not validate our rules.\n"
    "\n"
    "Test scenarios: First, unverified — alternative_route_verified is false, "
    "tenant_arrivals_expected is true. Expected decision is ESCALATE; expected recommended "
    "action is tenant_liaison; expected blocked action is review_access_plan. Second, verified "
    "— alternative_route_verified is true, tenant_arrivals_expected is true. Expected decision "
    "is HUMAN_REVIEW; expected recommended actions are review_access_plan and "
    "draft_tenant_update. Third, missing inputs — no observations supplied. Expected decision "
    "is ABSTAIN.\n"
    "\n"
    "I consider the scope, inputs, assumptions, exceptions, actions, prohibited actions, "
    "guardrails, rules, escalation recipients, evidence, and evaluation cases described above "
    "complete for this synthetic workflow. There are no known contradictions in what I have "
    "described. Any condition outside the stated scope is already handled by the stated exception "
    "that unknown conditions require qualified human assessment."
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
