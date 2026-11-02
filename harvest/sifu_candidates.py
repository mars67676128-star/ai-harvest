"""AI-assisted Candidate Knowledge Pill drafting from human expert conversations."""

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .errors import DomainError
from .providers import generate
from .service import Service
from .sifu_agent import ConversationTurn


class CandidateModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CandidateKnowledgeDraft(CandidateModel):
    title: str = Field(min_length=3, max_length=240)
    principle: str = Field(min_length=3, max_length=4000)
    applies_when: list[str] = Field(default_factory=list, max_length=20)
    checks: list[str] = Field(default_factory=list, max_length=20)
    escalate_when: list[str] = Field(default_factory=list, max_length=20)
    exceptions: list[str] = Field(default_factory=list, max_length=20)
    rationale: str | None = Field(default=None, max_length=4000)
    source_experts: list[str] = Field(min_length=1, max_length=20)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def nonempty_entries(self):
        fields = (
            self.applies_when,
            self.checks,
            self.escalate_when,
            self.exceptions,
            self.source_experts,
            self.unresolved_questions,
        )
        if any(any(not item.strip() for item in values) for values in fields):
            raise ValueError("Candidate list entries must be nonempty strings")
        return self


def draft_candidate(
    service: Service,
    conversation: list[ConversationTurn],
    candidate_hint: str,
) -> tuple[CandidateKnowledgeDraft, dict]:
    expert_names = {turn.speaker for turn in conversation if turn.role == "expert"}
    if not expert_names:
        raise DomainError(
            409,
            "CANDIDATE_REQUIRES_EXPERT",
            "A Candidate Knowledge Pill requires at least one human expert contribution.",
        )

    payload = {
        "candidate_hint": candidate_hint,
        "conversation": [turn.model_dump(mode="json") for turn in conversation],
        "policy": {
            "human_expert_content_only": True,
            "candidate_is_not_validated_knowledge": True,
            "preserve_uncertainty": True,
        },
    }
    draft, meta = generate(
        service.provider,
        "sifu_candidate",
        payload,
        CandidateKnowledgeDraft,
    )
    unknown_sources = set(draft.source_experts) - expert_names
    if unknown_sources:
        raise DomainError(
            502,
            "SIFU_CANDIDATE_SOURCE_MISMATCH",
            "Sifu attributed candidate knowledge to a person who did not contribute as an expert.",
        )
    return draft, meta
