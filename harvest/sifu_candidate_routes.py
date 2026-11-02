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


def _candidate_view(service: Service, candidate: dict) -> dict:
    with service.db.connection() as con:
        row = con.execute(
            "SELECT * FROM objects WHERE parent_id=? AND kind='candidate_decision' "
            "ORDER BY created_at DESC,id DESC LIMIT 1",
            (candidate["id"],),
        ).fetchone()
    decision = object_from_row(row) if row else None
    status = (
        "confirmed"
        if decision and decision["decision"] == "confirm"
        else "not_reusable"
        if decision
        else "awaiting_expert_confirmation"
    )
    return {**candidate, "status": status, "decision": decision}


def attach_sifu_candidate_routes(
    app: FastAPI,
    service: Service,
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
            raise DomainError(409, "REQUEST_CONVERSATION_MISMATCH", "Expertise request belongs to another conversation")
        if request["expert_id"] != actor.id:
            raise DomainError(403, "FORBIDDEN", "Only the contributing expert may review this insight")
        if not response:
            raise DomainError(409, "EXPERT_RESPONSE_REQUIRED", "The expert must respond before Sifu can draft a candidate")
        for row in duplicate_rows:
            candidate = object_from_row(row)
            if candidate.get("source_request_id") == body.source_request_id:
                raise DomainError(409, "CANDIDATE_EXISTS", "A Candidate Knowledge Pill already exists for this expert response")

        latest = _latest_sifu_message(service, conversation_id)
        insight = ((latest or {}).get("answer") or {}).get("reusable_insight") or {}
        if not insight.get("detected") or not insight.get("summary"):
            raise DomainError(
                409,
                "REUSABLE_INSIGHT_NOT_DETECTED",
                "Sifu has not identified a reusable insight in the latest conversation state",
            )

        draft, meta = draft_candidate(service, _turns(service, conversation_id), insight["summary"])
        with service.db.transaction() as con:
            candidate = add_object(
                con,
                "knowledge_candidate",
                {
                    **draft.model_dump(mode="json"),
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
            raise DomainError(403, "FORBIDDEN", "Only the source expert may confirm Sifu's interpretation")
        if existing:
            raise DomainError(409, "CANDIDATE_ALREADY_DECIDED", "This candidate already has an expert decision")
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
        return {**_candidate_view(service, candidate), "decision": decision}
