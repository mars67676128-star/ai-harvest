"""REST adapter. Caller-controlled role/identity fields are never trusted."""

import hmac
import logging
import sqlite3
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.exceptions import HTTPException

from .config import Settings
from .db import Database
from .errors import DomainError
from .fixtures import ELICITATION
from .models import (
    Actor,
    CaptureRequest,
    CaseInput,
    CaseRecord,
    CompileRequest,
    CreatePill,
    ErrorEnvelope,
    Feedback,
    HumanDecision,
    InvokeRequest,
    Note,
    Outcome,
    PillContent,
    PillVersion,
    RecommendationRecord,
)
from .providers import make_provider
from .service import Service

logger = logging.getLogger("harvest")
bearer = HTTPBearer(auto_error=False)


def create_app(settings: Settings | None = None, provider=None):
    settings = settings or Settings.from_env()
    service = Service(Database(settings.database), provider or make_provider(settings))
    app = FastAPI(
        title="AI HARVEST",
        version="0.1.0",
        description="Governed, portable expert capabilities. Synthetic demo; advisory output only.",
        responses={code: {"model": ErrorEnvelope} for code in (401, 403, 404, 409, 422, 502)},
    )
    app.state.service, app.state.settings = service, settings

    def error_response(request, status, code, message, details=None):
        request_id = getattr(request.state, "request_id", str(uuid4()))
        return JSONResponse(
            status_code=status,
            content={
                "error": {"code": code, "message": message, "details": details},
                "request_id": request_id,
            },
            headers={"X-Request-ID": request_id},
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        if request.method in ("POST", "PUT", "PATCH") and len(await request.body()) > 250000:
            return error_response(
                request, 413, "BODY_TOO_LARGE", "Request exceeds 250 KB demo limit"
            )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Request-ID"],
    )

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return error_response(request, exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        details = [
            {"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
            for e in exc.errors()
        ]
        return error_response(
            request, 422, "VALIDATION_ERROR", "Request schema validation failed", details
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(request, exc.status_code, "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, exc):
        return error_response(
            request,
            409,
            "INTEGRITY_CONFLICT",
            "Write conflicts with immutable history or uniqueness constraints",
        )

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        # Exception type only: provider errors can contain tokens or submitted data.
        logger.error(
            "Request %s failed: %s",
            getattr(request.state, "request_id", "unknown"),
            type(exc).__name__,
        )
        return error_response(
            request, 500, "INTERNAL_ERROR", "Unexpected server error; refer to the request ID"
        )

    def identity(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if credentials and credentials.scheme.lower() == "bearer":
            for token, actor in settings.tokens.items():
                if hmac.compare_digest(credentials.credentials.encode(), token.encode()):
                    return actor
        raise DomainError(401, "UNAUTHENTICATED", "A configured bearer token is required")

    CurrentActor = Annotated[Actor, Depends(identity)]
    prefix = "/api/v1"

    @app.get("/health", tags=["system"])
    def health():
        return {
            "status": "ok",
            "environment": settings.environment,
            "provider": settings.provider,
            "synthetic_demo": settings.environment == "demo",
        }

    @app.get(prefix + "/schema/pill", tags=["registry"])
    def schema(actor: CurrentActor):
        return PillContent.model_json_schema()

    @app.get(prefix + "/dashboard", tags=["system"])
    def dashboard(actor: CurrentActor):
        return service.dashboard()

    @app.get(prefix + "/elicitation", tags=["capture"])
    def elicitation(actor: CurrentActor):
        return ELICITATION

    @app.post(prefix + "/captures", status_code=201, tags=["capture"])
    def capture(body: CaptureRequest, actor: CurrentActor):
        return service.capture(body, actor)

    @app.get(prefix + "/captures/{capture_id}", tags=["capture"])
    def get_capture(capture_id: str, actor: CurrentActor):
        return service.get(capture_id, "capture")

    @app.post(prefix + "/captures/{capture_id}/extract", tags=["capture"])
    def extract(capture_id: str, actor: CurrentActor):
        return service.extract(capture_id, actor)

    @app.post(
        prefix + "/captures/{capture_id}/compile",
        response_model=PillVersion,
        status_code=201,
        tags=["capture"],
    )
    def compile_capture(capture_id: str, body: CompileRequest, actor: CurrentActor):
        return service.compile(capture_id, body, actor)

    @app.post(prefix + "/pills", response_model=PillVersion, status_code=201, tags=["registry"])
    def create_pill(body: CreatePill, actor: CurrentActor):
        return service.governance.create(body, actor)

    @app.get(prefix + "/pills", response_model=list[PillVersion], tags=["registry"])
    def pills(actor: CurrentActor):
        return service.governance.list()

    @app.get(
        prefix + "/pills/{pill_id}/versions", response_model=list[PillVersion], tags=["registry"]
    )
    def versions(pill_id: str, actor: CurrentActor):
        return service.governance.list(pill_id)

    @app.get(
        prefix + "/pills/{pill_id}/versions/{version}",
        response_model=PillVersion,
        tags=["registry"],
    )
    def version(pill_id: str, version: str, actor: CurrentActor):
        return service.governance.get(pill_id, version)

    @app.get(prefix + "/pills/{pill_id}/diff", tags=["governance"])
    def diff(pill_id: str, from_version: str, to_version: str, actor: CurrentActor):
        return service.governance.diff(pill_id, from_version, to_version)

    def register_transition(operation):
        def transition(pill_id: str, version: str, body: Note, actor: CurrentActor):
            return service.governance.transition(pill_id, version, operation, actor, body.note)

        transition.__name__ = f"{operation}_pill"
        app.post(
            prefix + "/pills/{pill_id}/versions/{version}/" + operation,
            response_model=PillVersion,
            tags=["governance"],
        )(transition)

    for operation in ("submit", "review", "validate", "approve", "reject", "deprecate"):
        register_transition(operation)

    @app.post(prefix + "/cases", response_model=CaseRecord, status_code=201, tags=["runtime"])
    def create_case(body: CaseInput, actor: CurrentActor):
        return service.create_case(body, actor)

    @app.get(prefix + "/cases", response_model=list[CaseRecord], tags=["runtime"])
    def cases(actor: CurrentActor):
        return service.list_objects("case")

    @app.get(prefix + "/cases/{case_id}", response_model=CaseRecord, tags=["runtime"])
    def get_case(case_id: str, actor: CurrentActor):
        return service.get(case_id, "case")

    @app.post(
        prefix + "/cases/{case_id}/invoke",
        response_model=RecommendationRecord,
        status_code=201,
        tags=["runtime"],
    )
    def invoke(case_id: str, body: InvokeRequest, actor: CurrentActor):
        return service.invoke(case_id, body, actor)

    @app.get(
        prefix + "/recommendations/{recommendation_id}",
        response_model=RecommendationRecord,
        tags=["runtime"],
    )
    def recommendation(recommendation_id: str, actor: CurrentActor):
        return service.get(recommendation_id, "recommendation")

    @app.get(
        prefix + "/recommendations", response_model=list[RecommendationRecord], tags=["runtime"]
    )
    def recommendations(actor: CurrentActor):
        return service.list_objects("recommendation")

    @app.post(
        prefix + "/recommendations/{recommendation_id}/decision", status_code=201, tags=["learning"]
    )
    def decision(recommendation_id: str, body: HumanDecision, actor: CurrentActor):
        return service.decide(recommendation_id, body, actor)

    @app.post(
        prefix + "/recommendations/{recommendation_id}/outcome", status_code=201, tags=["learning"]
    )
    def outcome(recommendation_id: str, body: Outcome, actor: CurrentActor):
        return service.outcome(recommendation_id, body, actor)

    @app.post(
        prefix + "/recommendations/{recommendation_id}/feedback", status_code=201, tags=["learning"]
    )
    def feedback(recommendation_id: str, body: Feedback, actor: CurrentActor):
        return service.feedback(recommendation_id, body, actor)

    @app.post(
        prefix + "/feedback/{feedback_id}/propose",
        response_model=PillVersion,
        status_code=201,
        tags=["learning"],
    )
    def propose(feedback_id: str, actor: CurrentActor):
        return service.propose(feedback_id, actor)

    @app.get(prefix + "/feedback/{feedback_id}", tags=["learning"])
    def get_feedback(feedback_id: str, actor: CurrentActor):
        return service.get(feedback_id, "feedback")

    @app.get(prefix + "/audit", tags=["audit"])
    def audit_history(
        actor: CurrentActor,
        entity_id: str | None = None,
        after: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ):
        return service.governance.audit_history(entity_id, after, limit)

    return app
