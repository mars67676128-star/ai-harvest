"""Candidate Knowledge Pill routes for SIFU expert conversations."""

from typing import Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field

from .db import add_object, audit, object_from_row
from .errors import DomainError
from .governance import require_role
from .models import Actor
from .service import Service, read_object
from .sifu_agent import ConversationTurn
from .sifu_candidates import draft_candidate


class CandidateRouteModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftCandidateRequest(CandidateRouteModel):
    source_request_id: str = Field(min_length=1, max_length=120)


class CandidateDecision(CandidateRouteModel):
    decision: Literal["confirm", "not_reusable"]
    note: str = Field(default="", max_length=4000)


class KnowledgeOwnerDecision(CandidateRouteModel):
    decision: Literal["validate", "request_changes", "reject"]
    note: str = Field(default="", max_length=4000)


def _messages(service: Service, conversation_id: str) -> list[dict]:
    with service.db.connection() as con:
        rows = con.execute(
            "SELECT * FROM objects WHERE parent_id=? "
            "AND kind IN ('employee_message','expert_message','sifu_message') "
            "ORDER BY created_at,id",
            (conversation_id,),
        ).fetchall()
    return [object_from_row(row) for row in rows]


def _turns(service: Service, conversation_id: str) -> list[ConversationTurn]:
    return [
        ConversationTurn(role=item["role"], speaker=item["speaker"], content=item["content"])
        for item in _messages(service, conversation_id)
    ]


def _latest_sifu_message(service: Service, conversation_id: str) -> dict | None:
    with service.db.connection() as con:
        row = con.execute(
            "SELECT * FROM objects WHERE parent_id=? AND kind='sifu_message' "
            "ORDER BY created_at DESC,id DESC LIMIT 1",
            (conversation_id,),
        ).fetchone()
    return object_from_row(row) if row else None


def _decision(service: Service, candidate_id: str, kind: str) -> dict | None:
    with service.db.connection() as con:
        row = con.execute(
            "SELECT * FROM objects WHERE parent_id=? AND kind=? "
            "ORDER BY created_at DESC,id DESC LIMIT 1",
            (candidate_id, kind),
        ).fetchone()
    return object_from_row(row) if row else None


def _candidate_view(service: Service, candidate: dict) -> dict:
    expert_decision = _decision(service, candidate["id"], "candidate_decision")
    owner_decision = _decision(service, candidate["id"], "knowledge_owner_decision")
    if expert_decision and expert_decision["decision"] == "not_reusable":
        status = "not_reusable"
    elif not expert_decision:
        status = "awaiting_expert_confirmation"
    elif owner_decision and owner_decision["decision"] == "validate":
        status = "validated"
    elif owner_decision and owner_decision["decision"] == "request_changes":
        status = "changes_requested"
    elif owner_decision and owner_decision["decision"] == "reject":
        status = "rejected"
    else:
        status = "awaiting_owner_validation"
    return {
        **candidate,
        "status": status,
        "expert_decision": expert_decision,
        "owner_decision": owner_decision,
    }


def _resolve_domain_owner(settings, expert_id: str) -> tuple[str, dict]:
    expert = next((entry for entry in settings.expert_directory if entry["id"] == expert_id), None)
    if not expert:
        raise DomainError(409, "EXPERT_CONFIGURATION_MISSING", "Source expert is not configured")
    matches = []
    for owner in settings.knowledge_owners:
        shared = [domain for domain in expert.get("domains", []) if domain in owner["domains"]]
        for domain in shared:
            matches.append((domain, owner))
    if not matches:
        raise DomainError(
            409,
            "KNOWLEDGE_OWNER_NOT_CONFIGURED",
            "No Knowledge Owner is configured for the source expert's domain",
        )
    if len(matches) > 1:
        raise DomainError(
            409,
            "KNOWLEDGE_OWNER_AMBIGUOUS",
            "The source expert maps to multiple Knowledge Owners; provide a narrower domain assignment",
        )
    return matches[0]


def attach_sifu_candidate_routes(
    app: FastAPI,
    service: Service,
    settings,
    identity,
    prefix: str = "/api/v1",
) -> None:
    @app.post(
        prefix + "/sifu/conversations/{conversation_id}/candidate",
        status_code=201,
        tags=["sifu"],
    )
    def create_candidate(
        conversation_id: str,
        body: DraftCandidateRequest,
        actor: Actor = Depends(identity),
    ):
        require_role(actor, "expert")
        with service.db.connection() as con:
            conversation = read_object(con, conversation_id, "sifu_conversation")
            request = read_object(con, body.source_request_id, "expertise_request")
            response = con.execute(
                "SELECT * FROM objects WHERE parent_id=? AND kind='expertise_response' LIMIT 1",
                (body.source_request_id,),
            ).fetchone()
            duplicate_rows = con.execute(
                "SELECT * FROM objects WHERE parent_id=? AND kind='knowledge_candidate'",
                (conversation_id,),
            ).fetchall()
        if request["parent_id"] != conversation_id:
            raise DomainError(
                409,
                "REQUEST_CONVERSATION_MISMATCH",
                "Expertise request belongs to another conversation",
            )
        if request["expert_id"] != actor.id:
            raise DomainError(
                403, "FORBIDDEN", "Only the contributing expert may review this insight"
            )
        if not response:
            raise DomainError(
                409,
                "EXPERT_RESPONSE_REQUIRED",
                "The expert must respond before Sifu can draft a candidate",
            )
        for row in duplicate_rows:
            candidate = object_from_row(row)
            if candidate.get("source_request_id") == body.source_request_id:
                raise DomainError(
                    409,
                    "CANDIDATE_EXISTS",
                    "A Candidate Knowledge Pill already exists for this expert response",
                )

        latest = _latest_sifu_message(service, conversation_id)
        insight = ((latest or {}).get("answer") or {}).get("reusable_insight") or {}
        if not insight.get("detected") or not insight.get("summary"):
            raise DomainError(
                409,
                "REUSABLE_INSIGHT_NOT_DETECTED",
                "Sifu has not identified a reusable insight in the latest conversation state",
            )

        domain, owner = _resolve_domain_owner(settings, actor.id)
        draft, meta = draft_candidate(service, _turns(service, conversation_id), insight["summary"])
        with service.db.transaction() as con:
            candidate = add_object(
                con,
                "knowledge_candidate",
                {
                    **draft.model_dump(mode="json"),
                    "domain": domain,
                    "knowledge_owner_id": owner["id"],
                    "knowledge_owner_name": owner["name"],
                    "source_request_id": body.source_request_id,
                    "source_expert_id": actor.id,
                    "source_expert_name": request["expert_name"],
                    "created_from_conversation": conversation["id"],
                    "ai": meta,
                },
                conversation_id,
            )
            audit(
                con,
                "KNOWLEDGE_CANDIDATE_DRAFTED",
                candidate["id"],
                actor.id,
                {
                    "conversation_id": conversation_id,
                    "source_request_id": body.source_request_id,
                    "domain": domain,
                    "knowledge_owner_id": owner["id"],
                },
            )
        return _candidate_view(service, candidate)

    @app.get(prefix + "/sifu/knowledge-candidates/{candidate_id}", tags=["sifu"])
    def get_candidate(candidate_id: str, actor: Actor = Depends(identity)):
        require_role(actor, "expert", "reviewer", "approver")
        with service.db.connection() as con:
            candidate = read_object(con, candidate_id, "knowledge_candidate")
        if "expert" in actor.roles and not set(actor.roles).intersection({"reviewer", "approver"}):
            if candidate["source_expert_id"] != actor.id:
                raise DomainError(403, "FORBIDDEN", "This candidate belongs to another expert")
        if "approver" in actor.roles and candidate["knowledge_owner_id"] != actor.id:
            raise DomainError(403, "FORBIDDEN", "This candidate belongs to another Knowledge Owner")
        return _candidate_view(service, candidate)

    @app.post(prefix + "/sifu/knowledge-candidates/{candidate_id}/decision", tags=["sifu"])
    def decide_candidate(
        candidate_id: str,
        body: CandidateDecision,
        actor: Actor = Depends(identity),
    ):
        require_role(actor, "expert")
        with service.db.connection() as con:
            candidate = read_object(con, candidate_id, "knowledge_candidate")
            existing = con.execute(
                "SELECT 1 FROM objects WHERE parent_id=? AND kind='candidate_decision'",
                (candidate_id,),
            ).fetchone()
        if candidate["source_expert_id"] != actor.id:
            raise DomainError(
                403, "FORBIDDEN", "Only the source expert may confirm Sifu's interpretation"
            )
        if existing:
            raise DomainError(
                409, "CANDIDATE_ALREADY_DECIDED", "This candidate already has an expert decision"
            )
        with service.db.transaction() as con:
            decision = add_object(
                con,
                "candidate_decision",
                {"decision": body.decision, "note": body.note, "actor": actor.id},
                candidate_id,
            )
            audit(
                con,
                "KNOWLEDGE_CANDIDATE_CONFIRMED"
                if body.decision == "confirm"
                else "KNOWLEDGE_CANDIDATE_NOT_REUSABLE",
                candidate_id,
                actor.id,
                {"note": body.note},
            )
        return {**_candidate_view(service, candidate), "expert_decision": decision}

    @app.get(prefix + "/sifu/reviews", tags=["sifu"])
    def list_reviews(actor: Actor = Depends(identity)):
        require_role(actor, "approver")
        with service.db.connection() as con:
            rows = con.execute(
                "SELECT * FROM objects WHERE kind='knowledge_candidate' ORDER BY created_at DESC"
            ).fetchall()
        result = []
        for row in rows:
            candidate = object_from_row(row)
            if candidate["knowledge_owner_id"] != actor.id:
                continue
            view = _candidate_view(service, candidate)
            if view["status"] not in {"awaiting_expert_confirmation", "not_reusable"}:
                result.append(view)
        return result

    @app.post(prefix + "/sifu/knowledge-candidates/{candidate_id}/owner-decision", tags=["sifu"])
    def owner_decision(
        candidate_id: str,
        body: KnowledgeOwnerDecision,
        actor: Actor = Depends(identity),
    ):
        require_role(actor, "approver")
        with service.db.connection() as con:
            candidate = read_object(con, candidate_id, "knowledge_candidate")
            expert_decision = con.execute(
                "SELECT * FROM objects WHERE parent_id=? AND kind='candidate_decision' "
                "ORDER BY created_at DESC,id DESC LIMIT 1",
                (candidate_id,),
            ).fetchone()
            existing = con.execute(
                "SELECT 1 FROM objects WHERE parent_id=? AND kind='knowledge_owner_decision'",
                (candidate_id,),
            ).fetchone()
        if candidate["knowledge_owner_id"] != actor.id:
            raise DomainError(
                403, "FORBIDDEN", "Only the configured Knowledge Owner may decide this candidate"
            )
        if not expert_decision or object_from_row(expert_decision)["decision"] != "confirm":
            raise DomainError(
                409,
                "EXPERT_CONFIRMATION_REQUIRED",
                "The source expert must confirm Sifu's interpretation before owner validation",
            )
        if existing:
            raise DomainError(
                409,
                "OWNER_DECISION_EXISTS",
                "This candidate already has a Knowledge Owner decision",
            )
        with service.db.transaction() as con:
            decision = add_object(
                con,
                "knowledge_owner_decision",
                {"decision": body.decision, "note": body.note, "actor": actor.id},
                candidate_id,
            )
            event = {
                "validate": "KNOWLEDGE_CANDIDATE_VALIDATED",
                "request_changes": "KNOWLEDGE_CANDIDATE_CHANGES_REQUESTED",
                "reject": "KNOWLEDGE_CANDIDATE_REJECTED",
            }[body.decision]
            audit(con, event, candidate_id, actor.id, {"note": body.note})
        return {**_candidate_view(service, candidate), "owner_decision": decision}
