from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import BASE


class ThreadProvider:
    def __init__(self):
        self.calls = []

    def structured_generate(self, operation, payload, schema):
        self.calls.append((operation, payload, schema))
        if operation == "sifu_candidate":
            return {
                "title": "RUNNING status does not confirm effective drainage",
                "principle": "A RUNNING indication can represent command state without proving effective drainage.",
                "applies_when": ["RUNNING reflects command or motor state."],
                "checks": ["Check actual discharge.", "Check the water-level trend."],
                "escalate_when": ["Water continues rising despite RUNNING status."],
                "exceptions": ["Actual discharge is independently measured and verified."],
                "rationale": "The expert distinguished motor state from drainage effectiveness.",
                "source_experts": ["Tan Wei Ming"],
                "unresolved_questions": [],
            }, {"provider": "test", "model": "test-model", "live": True}

        has_expert = any(turn["role"] == "expert" for turn in payload["conversation"])
        if has_expert:
            response = {
                "coverage": "partial",
                "basis": "expert_context",
                "answer": "The expert has added useful case guidance. I want to clarify its scope before preserving it.",
                "known_points": ["A human expert has contributed diagnostic judgement."],
                "missing_information": ["The exact scope of the expert's guidance."],
                "follow_up_question": "Does this apply to every sump system or only command-state RUNNING signals?",
                "recommended_expert": None,
                "citations": [],
                "risk": "medium",
                "risk_reason": "Incorrect drainage guidance could delay escalation.",
                "reusable_insight": {
                    "detected": True,
                    "summary": "A RUNNING indication may not prove effective drainage.",
                    "rationale": "The expert supplied a reusable diagnostic distinction.",
                    "needs_expert_confirmation": True,
                },
            }
        else:
            response = {
                "coverage": "insufficient",
                "basis": "none",
                "answer": "I do not have validated guidance for this exact situation yet.",
                "known_points": [],
                "missing_information": ["Validated drainage guidance"],
                "follow_up_question": None,
                "recommended_expert": {
                    "id": "expert",
                    "name": "Tan Wei Ming",
                    "role": "Senior M&E Technician",
                    "skills": ["sump systems", "drainage"],
                    "reason": "His configured expertise covers sump systems and drainage.",
                },
                "citations": [],
                "risk": "medium",
                "risk_reason": "A drainage fault can have meaningful operational consequences.",
                "reusable_insight": {
                    "detected": False,
                    "summary": None,
                    "rationale": None,
                    "needs_expert_confirmation": True,
                },
            }
        return response, {"provider": "test", "model": "test-model", "live": True}


def auth(role):
    return {"Authorization": f"Bearer demo-{role}"}


def test_persistent_employee_to_expert_to_sifu_thread(tmp_path):
    settings = Settings(
        database=str(tmp_path / "threads.db"),
        provider="compatible",
        model="test-model",
        api_key="test-key",
        expert_directory=[
            {
                "id": "expert",
                "name": "Tan Wei Ming",
                "role": "Senior M&E Technician",
                "skills": ["sump systems", "drainage"],
                "domains": ["Technical Services"],
            }
        ],
    )
    provider = ThreadProvider()

    with TestClient(create_app(settings, provider=provider)) as client:
        started = client.post(
            BASE + "/sifu/conversations",
            headers=auth("operator"),
            json={"question": "Pump says RUNNING but basement water is still rising."},
        )
        assert started.status_code == 201
        conversation = started.json()
        conversation_id = conversation["id"]
        assert [item["role"] for item in conversation["messages"]] == ["employee", "sifu"]
        assert conversation["messages"][-1]["answer"]["recommended_expert"]["id"] == "expert"

        routed = client.post(
            BASE + f"/sifu/conversations/{conversation_id}/route",
            headers=auth("operator"),
            json={"expert_id": "expert"},
        )
        assert routed.status_code == 201
        request_id = routed.json()["id"]
        assert routed.json()["status"] == "pending"

        inbox = client.get(BASE + "/sifu/expertise-requests", headers=auth("expert"))
        assert inbox.status_code == 200
        assert [item["id"] for item in inbox.json()] == [request_id]

        responded = client.post(
            BASE + f"/sifu/expertise-requests/{request_id}/respond",
            headers=auth("expert"),
            json={
                "outcome": "answer",
                "content": "RUNNING can be command state only. Check actual discharge and water-level trend.",
            },
        )
        assert responded.status_code == 200
        result = responded.json()
        assert result["sifu"]["basis"] == "expert_context"
        assert result["sifu"]["reusable_insight"]["detected"] is True
        assert [item["role"] for item in result["conversation"]["messages"]] == [
            "employee",
            "sifu",
            "expert",
            "sifu",
        ]

        candidate_response = client.post(
            BASE + f"/sifu/conversations/{conversation_id}/candidate",
            headers=auth("expert"),
            json={"source_request_id": request_id},
        )
        assert candidate_response.status_code == 201
        candidate = candidate_response.json()
        assert candidate["title"] == "RUNNING status does not confirm effective drainage"
        assert candidate["source_expert_name"] == "Tan Wei Ming"
        assert candidate["status"] == "awaiting_expert_confirmation"

        confirmed = client.post(
            BASE + f"/sifu/knowledge-candidates/{candidate['id']}/decision",
            headers=auth("expert"),
            json={"decision": "confirm", "note": "This reflects what I meant."},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"

        employee_view = client.get(
            BASE + f"/sifu/conversations/{conversation_id}", headers=auth("operator")
        )
        assert employee_view.status_code == 200
        body = employee_view.json()
        assert body["expertise_requests"][0]["status"] == "responded"
        assert body["messages"][-1]["answer"]["reusable_insight"]["detected"] is True

    assert [call[0] for call in provider.calls] == ["sifu_answer", "sifu_answer", "sifu_candidate"]


def test_employee_cannot_route_unrecommended_expert(tmp_path):
    settings = Settings(
        database=str(tmp_path / "threads.db"),
        provider="compatible",
        model="test-model",
        api_key="test-key",
        expert_directory=[
            {
                "id": "expert",
                "name": "Tan Wei Ming",
                "role": "Senior M&E Technician",
                "skills": ["sump systems", "drainage"],
            },
            {
                "id": "other",
                "name": "Marcus Lee",
                "role": "BMS Engineer",
                "skills": ["BMS telemetry"],
            },
        ],
    )
    with TestClient(create_app(settings, provider=ThreadProvider())) as client:
        started = client.post(
            BASE + "/sifu/conversations",
            headers=auth("operator"),
            json={"question": "Pump says RUNNING but basement water is still rising."},
        ).json()
        response = client.post(
            BASE + f"/sifu/conversations/{started['id']}/route",
            headers=auth("operator"),
            json={"expert_id": "other"},
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EXPERT_NOT_RECOMMENDED"
