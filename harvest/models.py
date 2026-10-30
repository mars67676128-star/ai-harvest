"""Portable knowledge schema and API contracts. No provider or persistence dependencies."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(min_length=1, max_length=4000)]
Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_.-]{0,79}$")]
Version = Annotated[str, Field(pattern=r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")]
Scalar = bool | int | float | str
Decision = Literal["HUMAN_REVIEW", "ESCALATE", "ABSTAIN"]
Status = Literal["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED", "DEPRECATED"]
Domain = Literal[
    "Asset Operations",
    "Energy Optimisation",
    "Leasing",
    "Technical Services",
    "Sustainability",
    "Tenant Experience",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Actor(Model):
    id: Identifier
    roles: list[Literal["expert", "reviewer", "approver", "operator", "viewer"]]


class Scope(Model):
    asset_types: list[Text] = Field(min_length=1)
    equipment: list[Text] = Field(min_length=1)
    contexts: list[Text] = Field(min_length=1)
    prerequisites: list[Text] = Field(min_length=1)
    exclusions: list[Text] = Field(min_length=1)


class InputSpec(Model):
    key: Identifier
    description: Text
    kind: Literal["number", "boolean", "string"]
    required: bool = True
    unit: str = Field(max_length=50)
    max_age_seconds: int = Field(ge=1, le=86400)
    minimum: float | None = None
    maximum: float | None = None
    choices: list[Scalar] = Field(default_factory=list)

    @model_validator(mode="after")
    def coherent(self):
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("input minimum exceeds maximum")
        if self.kind != "number" and (self.minimum is not None or self.maximum is not None):
            raise ValueError("only numeric inputs have numeric bounds")
        if any(not scalar_fits(self.kind, v) for v in self.choices):
            raise ValueError("choice does not match input kind")
        return self


def scalar_fits(kind: str, value: Scalar) -> bool:
    return {
        "number": type(value) in (int, float),
        "boolean": type(value) is bool,
        "string": type(value) is str,
    }[kind]


class Observation(Model):
    value: Scalar
    unit: str = Field(max_length=50)
    source: Text
    observed_at: AwareDatetime
    quality: Literal["verified", "unverified", "conflicting"] = "verified"


class CaseInput(Model):
    title: Text
    asset_id: Identifier
    asset_type: Text
    equipment: Text
    context: Text
    observations: dict[Identifier, Observation] = Field(max_length=100)
    synthetic: bool = True


class Condition(Model):
    input: Identifier
    op: Literal["eq", "ne", "gt", "gte", "lt", "lte"]
    value: Scalar


class Action(Model):
    id: Identifier
    description: Text
    human_approval_required: Literal[True] = True


class Evidence(Model):
    id: Identifier
    kind: Literal["expert_interview", "public_context", "incident", "feedback"]
    citation: Text
    summary: Text
    synthetic: bool


class Rule(Model):
    id: Identifier
    category: Literal["heuristic", "guardrail", "escalation", "exception"]
    when: list[Condition] = Field(min_length=1, max_length=20)
    recommend: list[Identifier] = Field(default_factory=list)
    block: list[Identifier] = Field(default_factory=list)
    escalate_to: Text | None = None
    rationale: Text
    evidence_ids: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def has_effect(self):
        if not (self.recommend or self.block or self.escalate_to):
            raise ValueError("rule must have an advisory, blocking or escalation effect")
        return self


class Dependency(Model):
    pill_id: Identifier
    version: Version


class EvaluationCase(Model):
    id: Identifier
    description: Text
    asset_type: Text
    equipment: Text
    context: Text
    inputs: dict[Identifier, Scalar]
    expected_decision: Decision
    expected_actions: list[Identifier]
    expected_blocked: list[Identifier] = Field(default_factory=list)


class PillContent(Model):
    schema_version: Literal["1.0"] = "1.0"
    name: Text
    domain: Domain
    description: Text
    scope: Scope
    inputs: list[InputSpec] = Field(min_length=1, max_length=50)
    facts: list[Text] = Field(default_factory=list)
    expert_observations: list[Text] = Field(min_length=1)
    assumptions: list[Text] = Field(min_length=1)
    exceptions: list[Text] = Field(min_length=1)
    actions: list[Action] = Field(min_length=1, max_length=50)
    prohibited_actions: list[Text] = Field(min_length=1)
    guardrails: list[Text] = Field(min_length=1)
    rules: list[Rule] = Field(min_length=1, max_length=100)
    evidence: list[Evidence] = Field(min_length=1, max_length=100)
    dependencies: list[Dependency] = Field(default_factory=list, max_length=1)
    evaluation: list[EvaluationCase] = Field(min_length=2, max_length=100)
    unresolved_questions: list[Text] = Field(default_factory=list)
    contradictions: list[Text] = Field(default_factory=list)
    synthetic: bool = True

    @model_validator(mode="after")
    def linked_and_typed(self):
        for label, items, key in [
            ("inputs", self.inputs, "key"),
            ("actions", self.actions, "id"),
            ("rules", self.rules, "id"),
            ("evidence", self.evidence, "id"),
            ("evaluation", self.evaluation, "id"),
        ]:
            ids = [getattr(item, key) for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate identifiers in {label}")
        inputs = {i.key: i for i in self.inputs}
        actions = {a.id for a in self.actions}
        evidence = {e.id for e in self.evidence}
        for rule in self.rules:
            if not set(rule.recommend + rule.block) <= actions:
                raise ValueError(f"unknown action in {rule.id}")
            if not set(rule.evidence_ids) <= evidence:
                raise ValueError(f"unknown evidence in {rule.id}")
            for c in rule.when:
                if c.input not in inputs or not scalar_fits(inputs[c.input].kind, c.value):
                    raise ValueError(f"unknown or mistyped input in {rule.id}")
                if c.op not in ("eq", "ne") and inputs[c.input].kind != "number":
                    raise ValueError("ordered comparisons require numeric inputs")
                if not inputs[c.input].required:
                    raise ValueError(
                        "rule conditions must use required inputs; missing evidence cannot bypass a rule"
                    )
        for case in self.evaluation:
            if not set(case.expected_actions + case.expected_blocked) <= actions:
                raise ValueError("evaluation references an unknown action")
            if not set(case.inputs) <= inputs.keys():
                raise ValueError("evaluation references an unknown input")
        if not any(c.expected_decision == "ESCALATE" for c in self.evaluation):
            raise ValueError("at least one escalation evaluation is required")
        return self


class ExtractionContent(Model):
    """Sparse extraction-draft content.

    Same field structure as PillContent but allows empty collections where
    knowledge may legitimately be missing. The anti-fabrication principle is
    preserved: the model never invents thresholds, rules, evaluation cases, or
    escalation roles to satisfy schema completeness. Missing knowledge surfaces
    in elicitation_gaps / unresolved_questions instead.

    Cross-reference integrity (unknown actions in rules, unknown inputs, etc.)
    is still enforced when items are present — a partial draft with broken
    references is rejected. But a sparse draft with empty collections is valid.

    Compilation into a candidate Pill validates against strict PillContent.
    """

    schema_version: Literal["1.0"] = "1.0"
    name: Text
    domain: Domain
    description: Text
    scope: Scope
    inputs: list[InputSpec] = Field(default_factory=list, max_length=50)
    facts: list[Text] = Field(default_factory=list)
    expert_observations: list[Text] = Field(default_factory=list)
    assumptions: list[Text] = Field(default_factory=list)
    exceptions: list[Text] = Field(default_factory=list)
    actions: list[Action] = Field(default_factory=list, max_length=50)
    prohibited_actions: list[Text] = Field(default_factory=list)
    guardrails: list[Text] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list, max_length=100)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)
    dependencies: list[Dependency] = Field(default_factory=list, max_length=1)
    evaluation: list[EvaluationCase] = Field(default_factory=list, max_length=100)
    unresolved_questions: list[Text] = Field(default_factory=list)
    contradictions: list[Text] = Field(default_factory=list)
    synthetic: bool = True

    @model_validator(mode="after")
    def linked_and_typed(self):
        for label, items, key in [
            ("inputs", self.inputs, "key"),
            ("actions", self.actions, "id"),
            ("rules", self.rules, "id"),
            ("evidence", self.evidence, "id"),
            ("evaluation", self.evaluation, "id"),
        ]:
            ids = [getattr(item, key) for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate identifiers in {label}")
        inputs = {i.key: i for i in self.inputs}
        actions = {a.id for a in self.actions}
        evidence = {e.id for e in self.evidence}
        for rule in self.rules:
            if not set(rule.recommend + rule.block) <= actions:
                raise ValueError(f"unknown action in {rule.id}")
            if not set(rule.evidence_ids) <= evidence:
                raise ValueError(f"unknown evidence in {rule.id}")
            for c in rule.when:
                if c.input not in inputs or not scalar_fits(inputs[c.input].kind, c.value):
                    raise ValueError(f"unknown or mistyped input in {rule.id}")
                if c.op not in ("eq", "ne") and inputs[c.input].kind != "number":
                    raise ValueError("ordered comparisons require numeric inputs")
                if not inputs[c.input].required:
                    raise ValueError(
                        "rule conditions must use required inputs; missing evidence cannot bypass a rule"
                    )
        for case in self.evaluation:
            if not set(case.expected_actions + case.expected_blocked) <= actions:
                raise ValueError("evaluation references an unknown action")
            if not set(case.inputs) <= inputs.keys():
                raise ValueError("evaluation references an unknown input")
        return self


class CreatePill(Model):
    pill_id: Identifier
    version: Version
    owner: Identifier
    reviewers: list[Identifier] = Field(min_length=1)
    content: PillContent
    previous_version: Version | None = None
    change_reason: Text


class PillVersion(CreatePill):
    status: Status
    author: Identifier
    created_at: datetime
    content_hash: str
    review: dict | None = None
    validation: dict | None = None
    approval: dict | None = None


class CaptureRequest(Model):
    title: Text
    transcript: str = Field(min_length=30, max_length=30000)
    domain: Domain
    synthetic: bool = True


class CompileRequest(Model):
    pill_id: Identifier
    version: Version = "1.0.0"
    owner: Identifier = "approver"
    reviewers: list[Identifier] = Field(default_factory=lambda: ["reviewer"], min_length=1)


class CorrectionRequest(Model):
    """Request to create a scripted reviewer correction from source-grounded content.

    Used only in the synthetic demo orchestration to simulate a human reviewer
    correcting an AI draft that failed semantic acceptance.
    """

    pill_id: Identifier
    version: Version
    ai_draft_version: Version
    failed_cases: list[str] = Field(default_factory=list)


class Extraction(Model):
    summary: Text
    elicitation_gaps: list[Text]
    content: ExtractionContent


class Note(Model):
    note: Text


class InvokeRequest(Model):
    pill_ids: list[Identifier] = Field(min_length=1, max_length=2)
    include_ai_explanation: bool = True


class HumanDecision(Model):
    decision: Literal["approve", "reject", "correct", "escalate"]
    note: Text


class Outcome(Model):
    summary: Text
    resolved: bool
    synthetic: bool = True


class Feedback(Model):
    pill_id: Identifier
    correction: Text
    proposed_version: Version


class Explanation(Model):
    summary: Text
    uncertainty: Text


class ErrorDetail(Model):
    code: str
    message: str
    details: list | dict | None = None


class ErrorEnvelope(Model):
    error: ErrorDetail
    request_id: str


class RuntimeResult(Model):
    decision: Decision
    actions: list[Action]
    blocked_actions: list[str]
    escalations: list[str]
    execution_allowed: Literal[False] = False
    human_responsibility: str


class CapabilityResult(Model):
    pill_id: Identifier
    version: Version
    content_hash: str
    domain: str
    decision: Decision
    actions: list[Action]
    blocked_actions: list[str]
    trace: list[dict]
    escalations: list[str]
    assumptions: list[str]
    boundaries: list[str]
    evidence: list[Evidence]
    execution_allowed: Literal[False]


class RecommendationRecord(Model):
    id: str
    kind: Literal["recommendation"]
    parent_id: str
    created_at: datetime
    case_id: str
    result: RuntimeResult
    capabilities: list[CapabilityResult]
    observations: dict[str, Observation]
    ai_explanation: dict | None
    ai: dict
    synthetic: bool
    actor: str
    evaluated_at: datetime | None = None
    valid_until: datetime | None = None
    human_decision: dict | None = None
    outcome: dict | None = None


class CaseRecord(Model):
    id: str
    kind: Literal["case"]
    parent_id: str | None
    created_at: datetime
    case: CaseInput
    author: str
