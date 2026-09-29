"""Application workflows joining capture, registry, deterministic runtime and feedback."""

from datetime import datetime, timedelta, timezone

from .db import Database, add_object, audit, digest, object_from_row
from .engine import combine, evaluate
from .errors import DomainError
from .governance import Governance, insert_pill, read_pill, require_role, resolve_pills
from .models import (
    Actor,
    CaptureRequest,
    CaseInput,
    CompileRequest,
    CreatePill,
    Evidence,
    Explanation,
    Extraction,
    Feedback,
    HumanDecision,
    InvokeRequest,
    Outcome,
    PillContent,
)
from .providers import LLMProvider, generate


def clock_now():
    return datetime.now(timezone.utc)


def read_object(con, identifier, kind):
    row = con.execute("SELECT * FROM objects WHERE id=? AND kind=?", (identifier, kind)).fetchone()
    if row is None:
        raise DomainError(404, "NOT_FOUND", f"{kind} not found")
    return object_from_row(row)


def child(con, parent_id, kind):
    row = con.execute(
        "SELECT * FROM objects WHERE parent_id=? AND kind=? ORDER BY created_at LIMIT 1",
        (parent_id, kind),
    ).fetchone()
    return object_from_row(row) if row else None


class Service:
    def __init__(self, db: Database, provider: LLMProvider):
        self.db, self.provider = db, provider
        self.governance = Governance(db)

    def get(self, identifier, kind):
        with self.db.connection() as con:
            obj = read_object(con, identifier, kind)
            if kind == "capture":
                obj["extraction"] = child(con, identifier, "extraction")
            if kind == "recommendation":
                obj["human_decision"] = child(con, identifier, "decision")
                obj["outcome"] = child(con, identifier, "outcome")
            return obj

    def list_objects(self, kind):
        with self.db.connection() as con:
            return [
                object_from_row(r)
                for r in con.execute(
                    "SELECT * FROM objects WHERE kind=? ORDER BY created_at", (kind,)
                ).fetchall()
            ]

    def capture(self, request: CaptureRequest, actor: Actor):
        require_role(actor, "expert")
        with self.db.transaction() as con:
            obj = add_object(
                con, "capture", {**request.model_dump(mode="json"), "author": actor.id}
            )
            audit(
                con,
                "KNOWLEDGE_CAPTURED",
                obj["id"],
                actor.id,
                {"synthetic": request.synthetic, "domain": request.domain},
            )
            return obj

    def extract(self, capture_id, actor):
        require_role(actor, "expert")
        capture = self.get(capture_id, "capture")
        if capture["extraction"]:
            return capture["extraction"]
        extraction, meta = generate(self.provider, "extract", {"capture": capture}, Extraction)
        if extraction.content.domain != capture["domain"]:
            raise DomainError(
                502, "LLM_DOMAIN_MISMATCH", "Extracted domain does not match the expert capture"
            )
        # Elicitation gaps are release blockers, never merely cosmetic text.
        extraction.content.unresolved_questions = list(
            dict.fromkeys(extraction.content.unresolved_questions + extraction.elicitation_gaps)
        )
        extraction.content.synthetic = capture["synthetic"]
        evidence = Evidence(
            id="capture-source",
            kind="expert_interview",
            citation=f"capture:{capture_id}",
            summary="Original submitted expert interview; authority pending independent review.",
            synthetic=capture["synthetic"],
        )
        extraction.content.evidence = [
            e for e in extraction.content.evidence if e.id != evidence.id
        ] + [evidence]
        for rule in extraction.content.rules:
            if evidence.id not in rule.evidence_ids:
                rule.evidence_ids.append(evidence.id)
        # Revalidate after server-added provenance.
        extraction = Extraction.model_validate(extraction.model_dump())
        with self.db.transaction() as con:
            existing = child(con, capture_id, "extraction")
            if existing:
                return existing
            obj = add_object(
                con, "extraction", {**extraction.model_dump(mode="json"), "ai": meta}, capture_id
            )
            audit(
                con,
                "KNOWLEDGE_EXTRACTED",
                capture_id,
                actor.id,
                {"extraction_id": obj["id"], "ai": meta},
            )
            return obj

    def compile(self, capture_id, request: CompileRequest, actor):
        require_role(actor, "expert")
        with self.db.transaction() as con:
            read_object(con, capture_id, "capture")
            extraction = child(con, capture_id, "extraction")
            if not extraction:
                raise DomainError(
                    409, "EXTRACTION_REQUIRED", "Extract candidate expertise before compiling"
                )
            req = CreatePill(
                **request.model_dump(),
                content=extraction["content"],
                change_reason=f"Compiled from capture:{capture_id}; extraction:{extraction['id']}",
            )
            return insert_pill(con, req, actor)

    def create_case(self, request: CaseInput, actor):
        require_role(actor, "operator")
        with self.db.transaction() as con:
            obj = add_object(
                con, "case", {"case": request.model_dump(mode="json"), "author": actor.id}
            )
            audit(
                con,
                "CASE_CREATED",
                obj["id"],
                actor.id,
                {"asset_id": request.asset_id, "synthetic": request.synthetic},
            )
            return obj

    def invoke(self, case_id, request: InvokeRequest, actor):
        require_role(actor, "operator")
        with self.db.connection() as con:
            case = CaseInput.model_validate(read_object(con, case_id, "case")["case"])
            pills = resolve_pills(con, request.pill_ids)
        evaluated_at = clock_now()
        evaluations = []
        expirations = []
        for pill in pills:
            content = PillContent.model_validate(pill["content"])
            result = evaluate(content, case, evaluated_at)
            expirations.extend(
                case.observations[spec.key].observed_at + timedelta(seconds=spec.max_age_seconds)
                for spec in content.inputs
                if spec.key in case.observations
            )
            evaluations.append(
                {
                    "pill_id": pill["pill_id"],
                    "version": pill["version"],
                    "content_hash": pill["content_hash"],
                    "domain": pill["content"]["domain"],
                    **result,
                }
            )
        combined = combine(evaluations)
        valid_until = min(expirations, default=evaluated_at)
        narrative = None
        ai = {"status": "not_requested"}
        if request.include_ai_explanation:
            try:
                explanation, meta = generate(
                    self.provider,
                    "explain",
                    {"result": combined, "capabilities": evaluations},
                    Explanation,
                )
                narrative = {**explanation.model_dump(), "authoritative": False}
                ai = {"status": "available", **meta}
            except DomainError as exc:
                ai = {
                    "status": "degraded",
                    "error_code": exc.code,
                    "message": "AI explanation unavailable; deterministic result retained.",
                }
        with self.db.transaction() as con:
            if combined["decision"] != "ABSTAIN" and clock_now() > valid_until:
                raise DomainError(
                    409,
                    "EVIDENCE_EXPIRED",
                    "Evidence expired during reasoning. Supply fresh observations.",
                )
            # A release change during a provider call must not silently change the snapshot used.
            for pill in pills:
                latest = read_pill(con, pill["pill_id"])
                if latest["version"] != pill["version"]:
                    raise DomainError(
                        409,
                        "RELEASE_CHANGED",
                        "A Pill release changed during reasoning. Invoke again.",
                    )
            obj = add_object(
                con,
                "recommendation",
                {
                    "case_id": case_id,
                    "result": combined,
                    "capabilities": evaluations,
                    "observations": case.model_dump(mode="json")["observations"],
                    "ai_explanation": narrative,
                    "ai": ai,
                    "synthetic": case.synthetic,
                    "actor": actor.id,
                    "evaluated_at": evaluated_at.isoformat(),
                    "valid_until": valid_until.isoformat(),
                },
                case_id,
            )
            for pill in pills:
                audit(
                    con,
                    "PILL_INVOKED",
                    pill["pill_id"],
                    actor.id,
                    {
                        "version": pill["version"],
                        "content_hash": pill["content_hash"],
                        "case_id": case_id,
                        "recommendation_id": obj["id"],
                    },
                )
            audit(
                con,
                "RECOMMENDATION_GENERATED",
                obj["id"],
                actor.id,
                {"decision": combined["decision"], "ai": ai},
            )
            return obj

    def decide(self, recommendation_id, request: HumanDecision, actor):
        require_role(actor, "operator")
        with self.db.transaction() as con:
            rec = read_object(con, recommendation_id, "recommendation")
            if child(con, recommendation_id, "decision"):
                raise DomainError(409, "DECISION_EXISTS", "A human decision is already recorded")
            if request.decision == "approve" and rec["result"]["decision"] != "HUMAN_REVIEW":
                raise DomainError(
                    409,
                    "ESCALATION_REQUIRED",
                    "This recommendation requires escalation or correction, not routine approval",
                )
            if request.decision == "approve":
                if not rec.get("valid_until") or clock_now() > datetime.fromisoformat(
                    rec["valid_until"]
                ):
                    raise DomainError(
                        409,
                        "EVIDENCE_EXPIRED",
                        "Reassess with fresh observations before routine approval",
                    )
                for capability in rec["capabilities"]:
                    current = read_pill(con, capability["pill_id"], capability["version"])
                    if current["status"] != "APPROVED":
                        raise DomainError(
                            409, "RELEASE_CHANGED", "Reassess using currently approved expertise"
                        )
            obj = add_object(
                con,
                "decision",
                {**request.model_dump(), "actor": actor.id, "execution_allowed": False},
                recommendation_id,
            )
            audit(
                con,
                "HUMAN_DECISION",
                recommendation_id,
                actor.id,
                {"decision": request.decision, "decision_id": obj["id"]},
            )
            return obj

    def outcome(self, recommendation_id, request: Outcome, actor):
        require_role(actor, "operator")
        with self.db.transaction() as con:
            rec = read_object(con, recommendation_id, "recommendation")
            if not child(con, recommendation_id, "decision"):
                raise DomainError(
                    409, "DECISION_REQUIRED", "Record a human decision before an outcome"
                )
            if child(con, recommendation_id, "outcome"):
                raise DomainError(409, "OUTCOME_EXISTS", "An outcome is already recorded")
            if rec["synthetic"] and not request.synthetic:
                raise DomainError(
                    422,
                    "SYNTHETIC_LINEAGE",
                    "A synthetic case cannot be relabelled as a real outcome",
                )
            obj = add_object(
                con, "outcome", {**request.model_dump(), "actor": actor.id}, recommendation_id
            )
            audit(con, "OUTCOME_RECORDED", recommendation_id, actor.id, {"outcome_id": obj["id"]})
            return obj

    def feedback(self, recommendation_id, request: Feedback, actor):
        require_role(actor, "expert", "operator")
        with self.db.transaction() as con:
            rec = read_object(con, recommendation_id, "recommendation")
            if not child(con, recommendation_id, "outcome"):
                raise DomainError(
                    409,
                    "OUTCOME_REQUIRED",
                    "Record an operational outcome before proposing a learning update",
                )
            capability = next(
                (p for p in rec["capabilities"] if p["pill_id"] == request.pill_id), None
            )
            if capability is None:
                raise DomainError(
                    422,
                    "PILL_NOT_USED",
                    "Feedback must reference a Pill actually used by this recommendation",
                )
            obj = add_object(
                con,
                "feedback",
                {
                    **request.model_dump(),
                    "actor": actor.id,
                    "previous_version": capability["version"],
                    "synthetic": rec["synthetic"],
                },
                recommendation_id,
            )
            audit(
                con,
                "FEEDBACK_SUBMITTED",
                request.pill_id,
                actor.id,
                {"feedback_id": obj["id"], "recommendation_id": recommendation_id},
            )
            return obj

    def propose(self, feedback_id, actor):
        require_role(actor, "expert")
        feedback = self.get(feedback_id, "feedback")
        rec = self.get(feedback["parent_id"], "recommendation")
        current = self.governance.get(feedback["pill_id"], feedback["previous_version"])
        if current["status"] != "APPROVED":
            raise DomainError(
                409,
                "STALE_PARENT",
                "Feedback references a superseded or inactive release; expert reconciliation required",
            )
        content, meta = generate(
            self.provider,
            "revise",
            {"feedback": feedback, "current": current["content"], "outcome": rec["outcome"]},
            PillContent,
        )
        content.synthetic = current["content"]["synthetic"] or feedback["synthetic"]
        evidence_id = "feedback-" + feedback_id
        content.evidence.append(
            Evidence(
                id=evidence_id,
                kind="feedback",
                citation=f"feedback:{feedback_id}",
                summary=feedback["correction"],
                synthetic=feedback["synthetic"],
            )
        )
        original_rules = {r["id"]: r for r in current["content"]["rules"]}
        for rule in content.rules:
            if rule.model_dump(mode="json") != original_rules.get(rule.id):
                rule.evidence_ids.append(evidence_id)
        content = PillContent.model_validate(content.model_dump())
        req = CreatePill(
            pill_id=feedback["pill_id"],
            version=feedback["proposed_version"],
            owner=current["owner"],
            reviewers=current["reviewers"],
            content=content,
            previous_version=current["version"],
            change_reason=feedback["correction"],
        )
        with self.db.transaction() as con:
            candidate = insert_pill(con, req, actor, "CANDIDATE_REVISION_CREATED")
            audit(
                con,
                "AI_REVISION_PROPOSED",
                feedback["pill_id"],
                actor.id,
                {
                    "feedback_id": feedback_id,
                    "version": req.version,
                    "ai": meta,
                    "content_hash": digest(content.model_dump(mode="json")),
                },
            )
            return candidate

    def dashboard(self):
        with self.db.connection() as con:
            states = {
                r["status"]: r["n"]
                for r in con.execute("SELECT status,count(*) n FROM pill_versions GROUP BY status")
            }
            counts = {
                r["kind"]: r["n"]
                for r in con.execute("SELECT kind,count(*) n FROM objects GROUP BY kind")
            }
        return {
            "pill_states": states,
            "workflow_counts": counts,
            "execution_allowed": False,
            "purpose": "Capture expert judgement; govern its release; support human decisions.",
        }
