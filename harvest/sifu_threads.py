"""Persistent SIFU conversations and human expertise handoff."""

from typing import Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field

from .db import add_object, audit, object_from_row
from .errors import DomainError
from .governance import require_role
from .models import Actor
from .service import Service, read_object
from .sifu_agent import ConversationTurn, SifuAgent, SifuAskRequest


class ThreadModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartConversation(ThreadModel):
    question: str = Field(min_length=2, max_length=8000)
    context: dict[str, str] = Field(default_factory=dict, max_length=30)


class AddConversationMessage(ThreadModel):
    content: str = Field(min_length=1, max_length=8000)
    context: dict[str, str] = Field(default_factory=dict, max_length=30)


class RouteExpert(ThreadModel):
    expert_id: str = Field(min_length=1, max_length=120)


class ExpertResponse(ThreadModel):
    content: str = Field(min_length=1, max_length=8000)
    outcome: Literal["answer", "not_my_area", "need_more_information", "dont_know"] = "answer"


def _all_roles(actor: Actor) -> None:
    require_role(actor, "viewer", "operator", "expert", "reviewer", "approver")


def _children(service: Service, parent_id: str, kinds: tuple[str, ...]) -> list[dict]:
    placeholders = ",".join("?" for _ in kinds)
    query = (
        f"SELECT * FROM objects WHERE parent_id=? AND kind IN ({placeholders}) "
        "ORDER BY created_at,id"
    )
    with service.db.connection() as con:
        rows = con.execute(query, (parent_id, *kinds)).fetchall()
    return [object_from_row(row) for row in rows]


def _messages(service: Service, conversation_id: str) -> list[dict]:
    return _children(
        service,
        conversation_id,
        ("employee_message", "expert_message", "sifu_message"),
    )


def _turns(service: Service, conversation_id: str) -> list[ConversationTurn]:
    return [
        ConversationTurn(role=item["role"], speaker=item["speaker"], content=item["content"])
        for item in _messages(service, conversation_id)
    ]


def _requests(service: Service, conversation_id: str) -> list[dict]:
    items = _children(service, conversation_id, ("expertise_request",))
    with service.db.connection() as con:
        result = []
        for item in items:
            response = con.execute(
                "SELECT * FROM objects WHERE parent_id=? AND kind='expertise_response' ORDER BY created_at LIMIT 1",
                (item["id"],),
            ).fetchone()
            result.append(
                {
                    **item,
                    "status": "responded" if response else "pending",
                    "response": object_from_row(response) if response else None,
                }
            )
        return result


def _can_read(service: Service, conversation: dict, actor: Actor) -> bool:
    if conversation["created_by"] == actor.id:
        return True
    if set(actor.roles).intersection({"reviewer", "approver"}):
        return True
    if "expert" in actor.roles:
        return any(
            request["expert_id"] == actor.id
            for request in _requests(service, conversation["id"])
        )
    return False


def _conversation_view(service: Service, conversation_id: str, actor: Actor) -> dict:
    with service.db.connection() as con:
        conversation = read_object(con, conversation_id, "sifu_conversation")
    if not _can_read(service, conversation, actor):
        raise DomainError(403, "FORBIDDEN", "You do not have access to this Sifu conversation")
    return {
        **conversation,
        "messages": _messages(service, conversation_id),
        "expertise_requests": _requests(service, conversation_id),
    }


def _latest_sifu_answer(service: Service, conversation_id: str) -> dict | None:
    with service.db.connection() as con:
        row = con.execute(
            "SELECT * FROM objects WHERE parent_id=? AND kind='sifu_message' ORDER BY created_at DESC,id DESC LIMIT 1",
            (conversation_id,),
        ).fetchone()
    return object_from_row(row) if row else None


def attach_sifu_thread_routes(
    app: FastAPI,
    service: Service,
    settings,
    identity,
    prefix: str = "/api/v1",
) -> None:
    agent = SifuAgent(service, settings)

    @app.post(prefix + "/sifu/conversations", status_code=201, tags=["sifu"])
    def start_conversation(body: StartConversation, actor: Actor = Depends(identity)):
        _all_roles(actor)
        answer = agent.ask(
            SifuAskRequest(question=body.question, conversation=[], context=body.context), actor
        )
        with service.db.transaction() as con:
            conversation = add_object(
                con,
                "sifu_conversation",
                {
                    "title": body.question.strip()[:120],
                    "created_by": actor.id,
                },
            )
            add_object(
                con,
                "employee_message",
                {"role": "employee", "speaker": actor.id, "content": body.question},
                conversation["id"],
            )
            add_object(
                con,
                "sifu_message",
                {
                    "role": "sifu",
                    "speaker": "Sifu",
                    "content": answer.answer,
                    "answer": answer.model_dump(mode="json"),
                },
                conversation["id"],
            )
            audit(
                con,
                "SIFU_CONVERSATION_STARTED",
                conversation["id"],
                actor.id,
                {"coverage": answer.coverage, "risk": answer.risk},
            )
        return _conversation_view(service, conversation["id"], actor)

    @app.get(prefix + "/sifu/conversations", tags=["sifu"])
    def list_conversations(actor: Actor = Depends(identity)):
        _all_roles(actor)
        with service.db.connection() as con:
            rows = con.execute(
                "SELECT * FROM objects WHERE kind='sifu_conversation' ORDER BY created_at DESC"
            ).fetchall()
        conversations = [object_from_row(row) for row in rows]
        visible = [item for item in conversations if _can_read(service, item, actor)]
        return [
            {
                **item,
                "message_count": len(_messages(service, item["id"])),
                "expertise_requests": _requests(service, item["id"]),
            }
            for item in visible
        ]

    @app.get(prefix + "/sifu/conversations/{conversation_id}", tags=["sifu"])
    def get_conversation(conversation_id: str, actor: Actor = Depends(identity)):
        _all_roles(actor)
        return _conversation_view(service, conversation_id, actor)

    @app.post(prefix + "/sifu/conversations/{conversation_id}/messages", tags=["sifu"])
    def add_message(
        conversation_id: str,
        body: AddConversationMessage,
        actor: Actor = Depends(identity),
    ):
        _all_roles(actor)
        conversation = _conversation_view(service, conversation_id, actor)
        if conversation["created_by"] != actor.id:
            raise DomainError(
                403,
                "FORBIDDEN",
                "Only the employee who started the thread may add employee messages",
            )
        answer = agent.ask(
            SifuAskRequest(
                question=body.content,
                conversation=_turns(service, conversation_id),
                context=body.context,
            ),
            actor,
        )
        with service.db.transaction() as con:
            add_object(
                con,
                "employee_message",
                {"role": "employee", "speaker": actor.id, "content": body.content},
                conversation_id,
            )
            add_object(
                con,
                "sifu_message",
                {
                    "role": "sifu",
                    "speaker": "Sifu",
                    "content": answer.answer,
                    "answer": answer.model_dump(mode="json"),
                },
                conversation_id,
            )
            audit(
                con,
                "SIFU_MESSAGE_GENERATED",
                conversation_id,
                actor.id,
                {"coverage": answer.coverage, "risk": answer.risk},
            )
        return _conversation_view(service, conversation_id, actor)

    @app.post(
        prefix + "/sifu/conversations/{conversation_id}/route", status_code=201, tags=["sifu"]
    )
    def route_expert(
        conversation_id: str,
        body: RouteExpert,
        actor: Actor = Depends(identity),
    ):
        conversation = _conversation_view(service, conversation_id, actor)
        if conversation["created_by"] != actor.id:
            raise DomainError(
                403, "FORBIDDEN", "Only the employee who started the thread may request an expert"
            )
        latest = _latest_sifu_answer(service, conversation_id)
        recommended = ((latest or {}).get("answer") or {}).get("recommended_expert")
        if not recommended or recommended.get("id") != body.expert_id:
            raise DomainError(
                409,
                "EXPERT_NOT_RECOMMENDED",
                "This expert is not the current Sifu recommendation for the conversation",
            )
        if any(
            request["expert_id"] == body.expert_id and request["status"] == "pending"
            for request in _requests(service, conversation_id)
        ):
            raise DomainError(
                409, "EXPERT_REQUEST_EXISTS", "A pending request already exists for this expert"
            )
        expert = next(
            (entry for entry in settings.expert_directory if entry["id"] == body.expert_id), None
        )
        if not expert:
            raise DomainError(404, "EXPERT_NOT_FOUND", "Configured expert not found")
        with service.db.transaction() as con:
            request = add_object(
                con,
                "expertise_request",
                {
                    "expert_id": expert["id"],
                    "expert_name": expert["name"],
                    "expert_role": expert["role"],
                    "reason": recommended["reason"],
                    "requested_by": actor.id,
                },
                conversation_id,
            )
            audit(
                con,
                "EXPERTISE_REQUESTED",
                conversation_id,
                actor.id,
                {"request_id": request["id"], "expert_id": expert["id"]},
            )
        return {**request, "status": "pending", "response": None}

    @app.get(prefix + "/sifu/expertise-requests", tags=["sifu"])
    def list_expertise_requests(actor: Actor = Depends(identity)):
        require_role(actor, "expert")
        with service.db.connection() as con:
            rows = con.execute(
                "SELECT * FROM objects WHERE kind='expertise_request' ORDER BY created_at DESC"
            ).fetchall()
        result = []
        for row in rows:
            request = object_from_row(row)
            if request["expert_id"] != actor.id:
                continue
            conversation = _conversation_view(service, request["parent_id"], actor)
            response = next(
                (
                    item
                    for item in conversation["expertise_requests"]
                    if item["id"] == request["id"]
                ),
                None,
            )
            result.append(
                {
                    **request,
                    "status": response["status"] if response else "pending",
                    "conversation_title": conversation["title"],
                    "created_by": conversation["created_by"],
                }
            )
        return result

    @app.post(prefix + "/sifu/expertise-requests/{request_id}/respond", tags=["sifu"])
    def respond_to_expertise_request(
        request_id: str,
        body: ExpertResponse,
        actor: Actor = Depends(identity),
    ):
        require_role(actor, "expert")
        with service.db.connection() as con:
            request = read_object(con, request_id, "expertise_request")
            conversation = read_object(con, request["parent_id"], "sifu_conversation")
            existing = con.execute(
                "SELECT 1 FROM objects WHERE parent_id=? AND kind='expertise_response'",
                (request_id,),
            ).fetchone()
        if request["expert_id"] != actor.id:
            raise DomainError(
                403, "FORBIDDEN", "This expertise request is assigned to another expert"
            )
        if existing:
            raise DomainError(
                409, "EXPERT_RESPONSE_EXISTS", "This expertise request already has a response"
            )
        with service.db.transaction() as con:
            response = add_object(
                con,
                "expertise_response",
                {"outcome": body.outcome, "content": body.content, "expert_id": actor.id},
                request_id,
            )
            add_object(
                con,
                "expert_message",
                {"role": "expert", "speaker": request["expert_name"], "content": body.content},
                conversation["id"],
            )
            audit(
                con,
                "EXPERT_RESPONDED",
                conversation["id"],
                actor.id,
                {"request_id": request_id, "outcome": body.outcome},
            )
        sifu_answer = None
        sifu_error = None
        try:
            sifu_answer = agent.ask(
                SifuAskRequest(
                    question="Continue the thread after the human expert's latest contribution.",
                    conversation=_turns(service, conversation["id"]),
                    context={"expert_response_outcome": body.outcome},
                ),
                actor,
            )
            with service.db.transaction() as con:
                add_object(
                    con,
                    "sifu_message",
                    {
                        "role": "sifu",
                        "speaker": "Sifu",
                        "content": sifu_answer.answer,
                        "answer": sifu_answer.model_dump(mode="json"),
                    },
                    conversation["id"],
                )
                audit(
                    con,
                    "SIFU_EXPERT_RESPONSE_ANALYSED",
                    conversation["id"],
                    actor.id,
                    {
                        "request_id": request_id,
                        "coverage": sifu_answer.coverage,
                        "reusable_insight": sifu_answer.reusable_insight.detected,
                    },
                )
        except DomainError as exc:
            sifu_error = {"code": exc.code, "message": exc.message}
        return {
            "response": response,
            "sifu": sifu_answer.model_dump(mode="json") if sifu_answer else None,
            "sifu_error": sifu_error,
            "conversation": _conversation_view(service, conversation["id"], actor),
        }
