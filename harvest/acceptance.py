"""Server-owned, source-grounded acceptance validation.

Independent of model-generated ``content.evaluation``, this module defines
deterministic acceptance cases derived from explicit source-transcript
requirements.  The cases are run through the deterministic
:func:`harvest.engine.evaluate` so that a candidate Pill cannot be approved
merely because its AI-generated rules and AI-generated evaluation cases agree
with each other.

Later non-demo domains can register their own regression cases via
:data:`ACCEPTANCE_REGISTRY` without modifying this module's internals.
"""

from dataclasses import dataclass, field

from .engine import evaluate
from .fixtures import OPS_ID, TENANT_ID
from .models import CaseInput, Observation, PillContent

_MAX_AGE_BUFFER = 900


@dataclass(frozen=True)
class AcceptanceCase:
    """A single source-grounded regression case owned by the server."""

    id: str
    description: str
    case: CaseInput
    expected_decision: str
    expected_actions: frozenset[str] = frozenset()
    expected_blocked: frozenset[str] = frozenset()


@dataclass
class AcceptanceResult:
    """Outcome of running the full acceptance suite for one Pill."""

    pill_id: str
    passed: bool
    results: list[dict] = field(default_factory=list)


def _obs(value, unit: str = ""):
    from datetime import datetime, timezone

    return Observation(
        value=value,
        unit=unit,
        source="acceptance-fixture",
        observed_at=datetime.now(timezone.utc),
    )


def _case(
    case_id: str,
    description: str,
    inputs: dict,
    decision: str,
    actions: set[str] | None = None,
    blocked: set[str] | None = None,
    asset_type: str = "office",
    equipment: str = "basement_sump",
    context: str = "wet_weather",
) -> AcceptanceCase:
    observations = {}
    for key, value in inputs.items():
        unit = "mm/min" if key == "water_rise_mm_min" else ""
        observations[key] = _obs(value, unit)
    return AcceptanceCase(
        id=case_id,
        description=description,
        case=CaseInput(
            title=f"Acceptance: {case_id}",
            asset_id="acceptance",
            asset_type=asset_type,
            equipment=equipment,
            context=context,
            observations=observations,
            synthetic=True,
        ),
        expected_decision=decision,
        expected_actions=frozenset(actions or ()),
        expected_blocked=frozenset(blocked or ()),
    )


# ---------------------------------------------------------------------------
# Operations Pill — source-grounded from the synthetic ops interview
# ---------------------------------------------------------------------------

_OPS_CASES: list[AcceptanceCase] = [
    _case(
        "ops-rising-escalate",
        "Rising water with running pump must escalate.",
        {"water_rise_mm_min": 3, "pump_running": True, "critical_equipment_exposed": False},
        "ESCALATE",
        {"inspect_drainage", "review_access_plan"},
    ),
    _case(
        "ops-stable-human-review",
        "Stable trend without critical exposure yields HUMAN_REVIEW.",
        {"water_rise_mm_min": 0, "pump_running": True, "critical_equipment_exposed": False},
        "HUMAN_REVIEW",
        {"monitor_trend"},
    ),
    _case(
        "ops-critical-escalate-blocks-access",
        "Critical equipment exposure must escalate and block access plan.",
        {"water_rise_mm_min": 3, "pump_running": True, "critical_equipment_exposed": True},
        "ESCALATE",
        {"inspect_drainage"},
        {"monitor_trend", "review_access_plan"},
    ),
    _case(
        "ops-missing-abstain",
        "Missing required inputs must abstain.",
        {},
        "ABSTAIN",
    ),
    _case(
        "ops-scope-abstain",
        "Out-of-scope asset type must abstain.",
        {"water_rise_mm_min": 0, "pump_running": True, "critical_equipment_exposed": False},
        "ABSTAIN",
        asset_type="residential",
    ),
]

# ---------------------------------------------------------------------------
# Tenant Pill — source-grounded from the synthetic tenant interview
# ---------------------------------------------------------------------------

_TENANT_CASES: list[AcceptanceCase] = [
    _case(
        "tenant-unverified-escalate",
        "Unverified route with expected arrivals must escalate and block access plan.",
        {"alternative_route_verified": False, "tenant_arrivals_expected": True},
        "ESCALATE",
        {"tenant_liaison"},
        {"review_access_plan"},
    ),
    _case(
        "tenant-verified-human-review",
        "Verified route with expected arrivals yields HUMAN_REVIEW.",
        {"alternative_route_verified": True, "tenant_arrivals_expected": True},
        "HUMAN_REVIEW",
        {"review_access_plan", "draft_tenant_update"},
    ),
    _case(
        "tenant-missing-abstain",
        "Missing required inputs must abstain.",
        {},
        "ABSTAIN",
    ),
]

# ---------------------------------------------------------------------------
# Registry — extensible for non-demo domains
# ---------------------------------------------------------------------------

ACCEPTANCE_REGISTRY: dict[str, list[AcceptanceCase]] = {
    OPS_ID: _OPS_CASES,
    TENANT_ID: _TENANT_CASES,
}


def registered_pill_ids() -> frozenset[str]:
    """Return the set of pill_ids that have server-owned acceptance cases."""
    return frozenset(ACCEPTANCE_REGISTRY)


def run_acceptance(content: PillContent, pill_id: str) -> AcceptanceResult:
    """Run server-owned acceptance cases for *pill_id* against *content*.

    Returns an :class:`AcceptanceResult` with ``passed`` and per-case
    ``results``.  Each result contains only safe identifiers (case ID,
    expected/actual decision and action IDs) — never transcript text,
    model-generated content, or rule internals.

    When the candidate introduces new required inputs that were not in the
    original source-grounded cases (e.g. a v1.1.0 revision adds
    ``drain_backflow``), those inputs are augmented with values drawn from
    the candidate's own evaluation cases so that the original source-grounded
    behaviour is still tested.
    """
    cases = ACCEPTANCE_REGISTRY.get(pill_id, [])
    if not cases:
        return AcceptanceResult(pill_id=pill_id, passed=True, results=[])

    # Build a lookup of values for new inputs from the candidate's evaluation
    # cases, so acceptance cases can be augmented when the Pill adds a
    # required input that wasn't in the original source-grounded set.
    candidate_input_keys = {i.key for i in content.inputs}
    candidate_eval_values: dict[str, object] = {}
    for ec in content.evaluation:
        for k, v in ec.inputs.items():
            candidate_eval_values.setdefault(k, v)

    results = []
    all_passed = True
    for ac in cases:
        case = ac.case
        # Augment with values for required inputs not in the original case.
        # Skip augmentation when the case has no observations at all — that
        # is an explicit missing-inputs regression case that must stay empty.
        existing_obs = set(case.observations)
        new_keys = candidate_input_keys - existing_obs
        if new_keys and existing_obs:
            augmented_obs = dict(case.observations)
            for key in new_keys:
                spec = next((i for i in content.inputs if i.key == key), None)
                if spec and spec.required:
                    value = candidate_eval_values.get(key)
                    if value is None:
                        # No candidate evaluation provides a value; use a safe
                        # default that will not trigger rules: False for
                        # booleans, 0 for numbers.
                        value = False if spec.kind == "boolean" else 0
                    augmented_obs[key] = _obs(value, spec.unit)
            case = CaseInput(
                title=case.title,
                asset_id=case.asset_id,
                asset_type=case.asset_type,
                equipment=case.equipment,
                context=case.context,
                observations=augmented_obs,
                synthetic=case.synthetic,
            )
        actual = evaluate(content, case)
        actual_actions = {a["id"] for a in actual["actions"]}
        actual_blocked = set(actual["blocked_actions"])
        passed = (
            actual["decision"] == ac.expected_decision
            and actual_actions == ac.expected_actions
            and actual_blocked == ac.expected_blocked
        )
        if not passed:
            all_passed = False
        results.append(
            {
                "case_id": ac.id,
                "passed": passed,
                "expected": {
                    "decision": ac.expected_decision,
                    "actions": sorted(ac.expected_actions),
                    "blocked": sorted(ac.expected_blocked),
                },
                "actual": {
                    "decision": actual["decision"],
                    "actions": sorted(actual_actions),
                    "blocked": sorted(actual_blocked),
                },
            }
        )
    return AcceptanceResult(pill_id=pill_id, passed=all_passed, results=results)
