"""Live SIFU agent workflow.

This module deliberately does not use the deterministic demo fixtures. SIFU answers
arbitrary questions only when a live provider is configured. Model output is bounded by
approved organisational knowledge, current expert conversation context and the configured
expert directory; authority remains deterministic and human-controlled.
"""

from typing import Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import Settings
from .errors import DomainError
from .models import Actor
from .providers import generate
from .service import Service


class AgentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConversationTurn(AgentModel):
    role: Literal["employee", "expert", "sifu"]
    speaker: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8000)


class SifuAskRequest(AgentModel):
    question: str = Field(min_length=2, max_length=8000)
    conversation: list[ConversationTurn] = Field(default_factory=list, max_length=80)
    context: dict[str, str] = Field(default_factory=dict, max_length=30)

    @model_validator(mode="after")
    def bounded_context(self):
        for key, value in self.context.items():
            if not key.strip() or len(key) > 80:
                raise ValueError("Context keys must be 1-80 non-whitespace characters")
            if not value.strip() or len(value) > 1000:
                raise ValueError("Context values must be 1-1000 non-whitespace characters")
        return self


class KnowledgeCitation(AgentModel):
    pill_id: str
    version: str
    title: str
    domain: str
    source_expert: str | None = None
    validator: str | None = None


class ExpertMatch(AgentModel):
    id: str
    name: str
    role: str
    skills: list[str] = Field(default_factory=list)
    reason: str


class ReusableInsight(AgentModel):
    detected: bool
    summary: str | None = None
    rationale: str | None = None
    needs_expert_confirmation: bool = True

    @model_validator(mode="after")
    def coherent(self):
        if self.detected and not self.summary:
            raise ValueError("Detected reusable insight requires a summary")
        if not self.detected and (self.summary or self.rationale):
            raise ValueError("No reusable insight should not include candidate content")
        return self


class SifuModelOutput(AgentModel):
    coverage: Literal["full", "partial", "insufficient"]
    basis: Literal["validated_knowledge", "expert_context", "mixed", "none"]
    answer: str = Field(min_length=1, max_length=10000)
    known_points: list[str] = Field(default_factory=list, max_length=20)
    missing_information: list[str] = Field(default_factory=list, max_length=20)
    follow_up_question: str | None = Field(default=None, max_length=1000)
    recommended_expert: ExpertMatch | None = None
    citations: list[KnowledgeCitation] = Field(default_factory=list, max_length=20)
    risk: Literal["low", "medium", "high", "unknown"]
    risk_reason: str = Field(min_length=1, max_length=2000)
    reusable_insight: ReusableInsight


class SifuAnswer(SifuModelOutput):
    ai: dict


class SifuStatus(AgentModel):
    configured: bool
    provider: str
    model: str | None
    approved_knowledge_items: int
    configured_experts: int


def _knowledge_snapshot(service: Service, limit: int) -> list[dict]:
    approved = [pill for pill in service.governance.list() if pill["status"] == "APPROVED"]
    approved.sort(key=lambda pill: pill["created_at"], reverse=True)
    result = []
    for pill in approved[:limit]:
        content = pill["content"]
        result.append(
            {
                "pill_id": pill["pill_id"],
                "version": pill["version"],
                "content_hash": pill["content_hash"],
                "title": content["name"],
                "domain": content["domain"],
                "description": content["description"],
                "scope": content["scope"],
                "facts": content.get("facts", []),
                "expert_observations": content.get("expert_observations", []),
                "assumptions": content.get("assumptions", []),
                "exceptions": content.get("exceptions", []),
                "guardrails": content.get("guardrails", []),
                "prohibited_actions": content.get("prohibited_actions", []),
                "rules": content.get("rules", []),
                "source_expert": pill.get("author"),
                "validator": (pill.get("approval") or {}).get("actor"),
            }
        )
    return result


def _expert_snapshot(settings: Settings) -> list[dict]:
    return [
        {
            "id": entry["id"],
            "name": entry["name"],
            "role": entry["role"],
            "skills": list(entry["skills"]),
            "domains": list(entry.get("domains", [])),
        }
        for entry in settings.expert_directory
    ]


def _validate_grounding(
    output: SifuModelOutput,
    knowledge: list[dict],
    experts: list[dict],
    conversation: list[ConversationTurn],
) -> None:
    allowed_knowledge = {(item["pill_id"], item["version"]): item for item in knowledge}
    for citation in output.citations:
        key = (citation.pill_id, citation.version)
        if key not in allowed_knowledge:
            raise DomainError(
                502,
                "SIFU_UNTRUSTED_CITATION",
                "Sifu returned a citation outside the approved knowledge snapshot.",
            )
        source = allowed_knowledge[key]
        citation_metadata = (
            citation.title,
            citation.domain,
            citation.source_expert,
            citation.validator,
        )
        source_metadata = (
            source["title"],
            source["domain"],
            source["source_expert"],
            source["validator"],
        )
        if citation_metadata != source_metadata:
            raise DomainError(
                502,
                "SIFU_CITATION_MISMATCH",
                "Sifu altered approved knowledge citation metadata.",
            )

    has_expert_context = any(turn.role == "expert" for turn in conversation)
    if output.basis in ("validated_knowledge", "mixed") and not output.citations:
        raise DomainError(
            502,
            "SIFU_UNSUPPORTED_ANSWER",
            "Sifu claimed validated knowledge without citing an approved Pill.",
        )
    if output.basis in ("expert_context", "mixed") and not has_expert_context:
        raise DomainError(
            502,
            "SIFU_UNSUPPORTED_EXPERT_CONTEXT",
            "Sifu claimed expert guidance when no expert had contributed to the conversation.",
        )
    if output.coverage in ("full", "partial") and output.basis == "none":
        raise DomainError(
            502,
            "SIFU_UNGROUNDED_COVERAGE",
            "Sifu claimed coverage without an approved or expert source.",
        )

    allowed_experts = {entry["id"]: entry for entry in experts}
    if output.recommended_expert:
        expert = allowed_experts.get(output.recommended_expert.id)
        if not expert:
            raise DomainError(
                502,
                "SIFU_UNKNOWN_EXPERT",
                "Sifu attempted to route to a person outside the configured expert directory.",
            )
        if (
            output.recommended_expert.name != expert["name"]
            or output.recommended_expert.role != expert["role"]
            or output.recommended_expert.skills != expert["skills"]
        ):
            raise DomainError(
                502,
                "SIFU_EXPERT_MISMATCH",
                "Sifu altered configured expert identity or expertise metadata.",
            )

    if output.reusable_insight.detected and not has_expert_context:
        raise DomainError(
            502,
            "SIFU_PREMATURE_KNOWLEDGE_CAPTURE",
            "Sifu may only propose reusable knowledge after a human expert has contributed.",
        )


class SifuAgent:
    def __init__(self, service: Service, settings: Settings):
        self.service = service
        self.settings = settings

    def status(self) -> SifuStatus:
        knowledge = _knowledge_snapshot(self.service, self.settings.sifu_max_knowledge_items)
        return SifuStatus(
            configured=self.settings.provider != "mock",
            provider=self.settings.provider,
            model=self.settings.model or None,
            approved_knowledge_items=len(knowledge),
            configured_experts=len(self.settings.expert_directory),
        )

    def ask(self, request: SifuAskRequest, actor: Actor) -> SifuAnswer:
        if self.settings.provider == "mock":
            raise DomainError(
                503,
                "SIFU_AI_NOT_CONFIGURED",
                "Live Sifu AI is not configured. Set HARVEST_LLM_PROVIDER, "
                "HARVEST_LLM_MODEL and HARVEST_LLM_API_KEY; Sifu will not substitute "
                "canned answers.",
            )

        knowledge = _knowledge_snapshot(self.service, self.settings.sifu_max_knowledge_items)
        experts = _expert_snapshot(self.settings)
        payload = {
            "question": request.question,
            "conversation": [turn.model_dump(mode="json") for turn in request.conversation],
            "context": request.context,
            "approved_knowledge": knowledge,
            "expert_directory": experts,
            "policy": {
                "only_approved_pills_are_organisational_truth": True,
                "expert_conversation_may_help_current_case_but_is_not_validated_knowledge": True,
                "candidate_knowledge_requires_expert_confirmation_and_human_validation": True,
                "do_not_invent_people": True,
                "do_not_invent_citations": True,
                "do_not_use_numeric_confidence_scores": True,
            },
        }
        output, meta = generate(self.service.provider, "sifu_answer", payload, SifuModelOutput)
        _validate_grounding(output, knowledge, experts, request.conversation)
        return SifuAnswer(**output.model_dump(), ai=meta)


def attach_sifu_routes(
    app: FastAPI,
    service: Service,
    settings: Settings,
    identity,
    prefix: str = "/api/v1",
) -> None:
    agent = SifuAgent(service, settings)

    @app.get(prefix + "/sifu/status", response_model=SifuStatus, tags=["sifu"])
    def sifu_status(actor: Actor = Depends(identity)):
        return agent.status()

    @app.post(prefix + "/sifu/ask", response_model=SifuAnswer, tags=["sifu"])
    def sifu_ask(body: SifuAskRequest, actor: Actor = Depends(identity)):
        return agent.ask(body, actor)
