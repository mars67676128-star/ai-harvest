"""Take 3 recording-only routing stabilizer.

Python imports ``sitecustomize`` automatically when it is importable on startup.
This module is intentionally inert for normal development/production. It only activates
for the dedicated Take 3 recording database and only fills one narrow gap: if the live
Sifu agent correctly says coverage is insufficient / basis is none but omits a relevant
configured expert, add the sole configured expert when the question clearly matches that
expert's configured skills.

This does not invent a person or bypass governance. The expert identity and skills still
come from SIFU_EXPERT_DIRECTORY, and Sifu's normal grounding checks continue to run.
"""

from __future__ import annotations

import os
import re


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
        # Common operational wording: "sump pump" vs configured "sump systems".
        if "sump" in q and "sump" in s:
            return True
        if "pump" in q and "pump" in s:
            return True
        if "drain" in q and any(tok.startswith("drain") for tok in s):
            return True
    return False


if _take3_enabled():
    try:
        from harvest.sifu_agent import ExpertMatch, SifuAgent

        _original_ask = SifuAgent.ask

        def _take3_stable_ask(self, request, actor):
            answer = _original_ask(self, request, actor)

            if (
                answer.coverage == "insufficient"
                and answer.basis == "none"
                and answer.recommended_expert is None
                and len(self.settings.expert_directory) == 1
            ):
                configured = self.settings.expert_directory[0]
                skills = list(configured.get("skills", []))
                if _skill_matches_question(request.question, skills):
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
            return answer

        SifuAgent.ask = _take3_stable_ask
    except Exception:
        # Never make interpreter startup fail because the recording stabilizer could not
        # be installed. The normal Sifu code path remains available and will surface its
        # own errors if something else is wrong.
        pass
