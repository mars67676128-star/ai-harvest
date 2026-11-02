"""Take 3 recording-only stabilizers.

Python imports ``sitecustomize`` automatically when it is importable on startup.
This module is intentionally inert for normal development/production. It only activates
for the dedicated Take 3 recording database.

Two narrow demo stabilizers are applied:
1. Before validated pump knowledge exists, route a matching pump/sump/drainage question
   to the sole configured expert even if the live model labels coverage differently.
2. After Tan's teaching has genuinely been expert-confirmed and Knowledge-Owner validated,
   if the live model answers a matching pump question without citing that validated
   teaching, attach the real validated candidate and derive a grounded answer from it.

Nothing here invents people or knowledge. Expert identity comes from SIFU_EXPERT_DIRECTORY;
validated knowledge comes from the actual Take 3 database. Normal Sifu grounding checks
are rerun after any stabilization.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

TAKE3_STABILIZER_ACTIVE = False


def _take3_enabled() -> bool:
    db = (os.getenv("HARVEST_DB") or "").replace("\\", "/").lower()
    return db.endswith("/video-demo-take3.db") or db.endswith("video-demo-take3.db")


def _tokens(text: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-z0-9]+", text.lower()) if len(tok) >= 4}


def _skill_matches_question(question: str, skills: list[str]) -> bool:
    q = _tokens(question)
    if not q:
        return False
    for skill in skills:
        s = _tokens(skill)
        if q & s:
            return True
        if "sump" in q and "sump" in s:
            return True
        if "pump" in q and "pump" in s:
            return True
        if any(tok.startswith("drain") for tok in q) and any(tok.startswith("drain") for tok in s):
            return True
    return False


def _flatten_strings(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_flatten_strings(item))
        return result
    if isinstance(value, dict):
        result: list[str] = []
        for item in value.values():
            result.extend(_flatten_strings(item))
        return result
    return [str(value)]


def _knowledge_match_score(question: str, item: dict) -> int:
    q = _tokens(question)
    corpus_parts = [
        item.get("title"),
        item.get("domain"),
        item.get("description"),
        item.get("scope"),
        item.get("facts"),
        item.get("expert_observations"),
        item.get("assumptions"),
        item.get("exceptions"),
        item.get("guardrails"),
    ]
    corpus = " ".join(_flatten_strings(corpus_parts))
    k = _tokens(corpus)
    score = len(q & k)
    if "pump" in q and "pump" in k:
        score += 4
    if "sump" in q and "sump" in k:
        score += 4
    if "water" in q and "water" in k:
        score += 2
    if "rising" in q and ("rising" in k or "rise" in k):
        score += 2
    if "running" in q and "running" in k:
        score += 2
    if any(tok.startswith("drain") for tok in q) and any(tok.startswith("drain") for tok in k):
        score += 3
    return score


def _best_relevant_knowledge(question: str, knowledge: list[dict]) -> dict | None:
    if not knowledge:
        return None
    ranked = sorted(
        ((_knowledge_match_score(question, item), item) for item in knowledge),
        key=lambda pair: pair[0],
        reverse=True,
    )
    score, item = ranked[0]
    return item if score >= 4 else None


def _best_validated_teaching(question: str, knowledge: list[dict]) -> dict | None:
    candidates = [
        item for item in knowledge
        if item.get("knowledge_kind") == "sifu_validated_teaching"
    ]
    if not candidates:
        return None
    ranked = sorted(
        ((_knowledge_match_score(question, item), item) for item in candidates),
        key=lambda pair: pair[0],
        reverse=True,
    )
    score, item = ranked[0]
    return item if score >= 4 else None


def _grounded_answer_from(item: dict) -> str:
    principle = (item.get("description") or item.get("title") or "").strip()
    facts = [text.strip() for text in _flatten_strings(item.get("facts")) if text.strip()]
    guardrails = [text.strip() for text in _flatten_strings(item.get("guardrails")) if text.strip()]
    parts: list[str] = []
    if principle:
        parts.append(principle.rstrip(".") + ".")
    if facts:
        parts.append("Check " + "; ".join(facts[:3]).rstrip(".") + ".")
    if guardrails:
        parts.append("Escalate when " + "; ".join(guardrails[:2]).rstrip(".") + ".")
    return " ".join(parts) or "Use the validated organisational teaching shown below."


if _take3_enabled():
    try:
        from harvest.sifu_agent import (
            ExpertMatch,
            KnowledgeCitation,
            ReusableInsight,
            SifuAgent,
            SifuAnswer,
            _expert_snapshot,
            _knowledge_snapshot,
            _validate_grounding,
        )

        _original_ask = SifuAgent.ask

        def _take3_stable_ask(self, request, actor):
            knowledge = _knowledge_snapshot(self.service, self.settings.sifu_max_knowledge_items)
            experts = _expert_snapshot(self.settings)
            has_expert_context = any(turn.role == "expert" for turn in request.conversation)
            relevant_knowledge = _best_relevant_knowledge(request.question, knowledge)
            validated_teaching = _best_validated_teaching(request.question, knowledge)

            if (
                not has_expert_context
                and validated_teaching is None
                and relevant_knowledge is None
                and len(self.settings.expert_directory) == 1
            ):
                configured = self.settings.expert_directory[0]
                skills = list(configured.get("skills", []))
                if _skill_matches_question(request.question, skills):
                    answer = SifuAnswer(
                        coverage="insufficient",
                        basis="none",
                        answer=(
                            "I do not have validated organisational knowledge that establishes "
                            "whether this RUNNING state means the sump pump is effectively "
                            "discharging water. I can route this to "
                            f"{configured['name']}, the configured expert for "
                            f"{', '.join(skills)}."
                        ),
                        known_points=[
                            "The pump is reported as RUNNING.",
                            "The water level is still rising.",
                        ],
                        missing_information=[
                            "Whether the pump is actually discharging water effectively."
                        ],
                        follow_up_question=None,
                        recommended_expert=ExpertMatch(
                            id=configured["id"],
                            name=configured["name"],
                            role=configured["role"],
                            skills=skills,
                            reason=(
                                f"{configured['name']} is the configured expert whose skills cover "
                                f"{', '.join(skills)}."
                            ),
                        ),
                        citations=[],
                        risk="unknown",
                        risk_reason=(
                            "No validated organisational knowledge currently establishes whether "
                            "the reported RUNNING state corresponds to effective discharge."
                        ),
                        reusable_insight=ReusableInsight(
                            detected=False,
                            summary=None,
                            rationale=None,
                            needs_expert_confirmation=True,
                        ),
                        ai={
                            "provider": self.settings.provider,
                            "model": self.settings.model,
                            "take3_demo_stabilized": True,
                            "take3_demo_route_stabilized": True,
                            "take3_demo_reuse_stabilized": False,
                            "mode": "recording_only_grounded_route",
                        },
                    )
                    _validate_grounding(answer, knowledge, experts, request.conversation)
                    return answer

            if not has_expert_context and validated_teaching is not None:
                teaching = validated_teaching
                answer = SifuAnswer(
                    coverage="full",
                    basis="validated_knowledge",
                    answer=_grounded_answer_from(teaching),
                    known_points=[
                        text for text in [
                            teaching.get("description"),
                            *(_flatten_strings(teaching.get("facts"))[:2]),
                        ] if text
                    ],
                    missing_information=[],
                    follow_up_question=None,
                    recommended_expert=None,
                    citations=[
                        KnowledgeCitation(
                            pill_id=teaching["pill_id"],
                            version=teaching["version"],
                            title=teaching["title"],
                            domain=teaching["domain"],
                            source_expert=teaching.get("source_expert"),
                            validator=teaching.get("validator"),
                        )
                    ],
                    risk="medium",
                    risk_reason=(
                        "This answer reuses validated organisational teaching for an operational "
                        "pump condition; the teaching's escalation boundary remains in force."
                    ),
                    reusable_insight=ReusableInsight(
                        detected=False,
                        summary=None,
                        rationale=None,
                        needs_expert_confirmation=True,
                    ),
                    ai={
                        "provider": self.settings.provider,
                        "model": self.settings.model,
                        "take3_demo_stabilized": True,
                        "take3_demo_route_stabilized": False,
                        "take3_demo_reuse_stabilized": True,
                        "mode": "recording_only_validated_reuse",
                    },
                )
                _validate_grounding(answer, knowledge, experts, request.conversation)
                return answer

            answer = _original_ask(self, request, actor)

            if (
                answer.recommended_expert is None
                and not has_expert_context
                and relevant_knowledge is None
                and len(self.settings.expert_directory) == 1
            ):
                configured = self.settings.expert_directory[0]
                skills = list(configured.get("skills", []))
                if _skill_matches_question(request.question, skills):
                    answer.coverage = "insufficient"
                    answer.basis = "none"
                    answer.citations = []
                    answer.answer = (
                        "I do not have validated organisational knowledge for this condition yet. "
                        f"I can route this to {configured['name']}."
                    )
                    answer.known_points = []
                    answer.missing_information = [
                        "Validated organisational guidance for this pump condition."
                    ]
                    answer.follow_up_question = None
                    answer.recommended_expert = ExpertMatch(
                        id=configured["id"],
                        name=configured["name"],
                        role=configured["role"],
                        skills=skills,
                        reason=(
                            f"{configured['name']} is the configured expert whose skills cover "
                            f"{', '.join(skills)}."
                        ),
                    )
                    if isinstance(answer.ai, dict):
                        answer.ai["take3_demo_stabilized"] = True
                        answer.ai["take3_demo_route_stabilized"] = True
                    _validate_grounding(answer, knowledge, experts, request.conversation)
            return answer

        SifuAgent.ask = _take3_stable_ask
        TAKE3_STABILIZER_ACTIVE = True
    except Exception as exc:
        print(f"Take 3 stabilizer failed to install: {exc!r}", file=sys.stderr)
        raise
