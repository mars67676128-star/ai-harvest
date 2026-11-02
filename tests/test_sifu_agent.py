from fastapi.testclient import TestClient

from harvest.api import create_app
from harvest.config import Settings
from harvest.demo import BASE, call, release
from harvest.fixtures import OPS_ID, operations_content


class StaticProvider:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def structured_generate(self, operation, payload, schema):
        self.calls.append((operation, payload, schema))
        response = self.response(payload) if callable(self.response) else self.response
        return response, {"provider": "test", "model": "test-model", "live": True}


def live_settings(tmp_path, experts=None):
    return Settings(
        database=str(tmp_path / "sifu.db"),
        provider="compatible",
        model="test-model",
        api_key="test-key",
        expert_directory=experts or [],
    )


def post_ask(client, body):
    return client.post(
        BASE + "/sifu/ask",
        headers={"Authorization": "Bearer demo-operator"},
        json=body,
    )


def base_output(**overrides):
    output = {
        "coverage": "insufficient",
        "basis": "none",
        "answer": "I do not have validated organisational guidance for this yet.",
        "known_points": [],
        "missing_information": ["Validated guidance for this situation"],
        "follow_up_question": None,
        "recommended_expert": None,
        "citations": [],
        "risk": "unknown",
        "risk_reason": "The available organisational evidence does not establish the consequence.",
        "reusable_insight": {
            "detected": False,
            "summary": None,
            "rationale": None,
            "needs_expert_confirmation": True,
        },
    }
    output.update(overrides)
    return output


def test_mock_mode_refuses_canned_sifu_answer(client):
    response = post_ask(client, {"question": "What should I do with an unfamiliar alarm?"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SIFU_AI_NOT_CONFIGURED"
    assert "canned answers" in response.json()["error"]["message"]


def test_live_sifu_can_route_only_to_configured_expert(tmp_path):
    expert = {
        "id": "tan",
        "name": "Tan Wei Ming",
        "role": "Senior M&E Technician",
        "skills": ["sump systems", "drainage"],
        "domains": ["Technical Services"],
    }
    provider = StaticProvider(
        base_output(
            recommended_expert={
                "id": "tan",
                "name": "Tan Wei Ming",
                "role": "Senior M&E Technician",
                "skills": ["sump systems", "drainage"],
                "reason": "His configured expertise covers sump systems and drainage.",
            }
        )
    )
    settings = live_settings(tmp_path, [expert])
    with TestClient(create_app(settings, provider=provider)) as client:
        response = post_ask(client, {"question": "The basement sump is behaving strangely."})

    assert response.status_code == 200
    body = response.json()
    assert body["recommended_expert"]["id"] == "tan"
    assert body["ai"]["live"] is True
    assert provider.calls[0][0] == "sifu_answer"


def test_sifu_rejects_invented_expert(tmp_path):
    provider = StaticProvider(
        base_output(
            recommended_expert={
                "id": "invented-person",
                "name": "Invented Person",
                "role": "Imaginary Specialist",
                "skills": ["everything"],
                "reason": "Made up by the model.",
            }
        )
    )
    settings = live_settings(
        tmp_path,
        [
            {
                "id": "tan",
                "name": "Tan Wei Ming",
                "role": "Senior M&E Technician",
                "skills": ["drainage"],
            }
        ],
    )
    with TestClient(create_app(settings, provider=provider)) as client:
        response = post_ask(client, {"question": "Who should I ask?"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "SIFU_UNKNOWN_EXPERT"


def test_sifu_rejects_reusable_insight_without_human_expert(tmp_path):
    provider = StaticProvider(
        base_output(
            reusable_insight={
                "detected": True,
                "summary": "A supposedly reusable rule invented from the employee question.",
                "rationale": "The model thinks it sounds useful.",
                "needs_expert_confirmation": True,
            }
        )
    )
    with TestClient(create_app(live_settings(tmp_path), provider=provider)) as client:
        response = post_ask(client, {"question": "Can this become a rule?"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "SIFU_PREMATURE_KNOWLEDGE_CAPTURE"


def test_sifu_rejects_unapproved_or_altered_citation(tmp_path):
    provider = StaticProvider(
        base_output(
            coverage="full",
            basis="validated_knowledge",
            citations=[
                {
                    "pill_id": "not-approved",
                    "version": "1.0.0",
                    "title": "Invented knowledge",
                    "domain": "Technical Services",
                    "source_expert": "invented",
                    "validator": "invented",
                }
            ],
        )
    )
    with TestClient(create_app(live_settings(tmp_path), provider=provider)) as client:
        response = post_ask(client, {"question": "What does our organisation say?"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "SIFU_UNTRUSTED_CITATION"


def test_sifu_accepts_exact_approved_pill_provenance(tmp_path):
    def grounded_response(payload):
        citation = payload["approved_knowledge"][0]
        return base_output(
            coverage="full",
            basis="validated_knowledge",
            answer="The approved organisational teaching supports escalation in this condition.",
            known_points=["The cited Pill contains the applicable escalation guidance."],
            missing_information=[],
            citations=[
                {
                    "pill_id": citation["pill_id"],
                    "version": citation["version"],
                    "title": citation["title"],
                    "domain": citation["domain"],
                    "source_expert": citation["source_expert"],
                    "validator": citation["validator"],
                }
            ],
            risk="medium",
            risk_reason="The condition can affect operations if handled incorrectly.",
        )

    provider = StaticProvider(grounded_response)
    with TestClient(create_app(live_settings(tmp_path), provider=provider)) as client:
        content = operations_content().model_dump(mode="json")
        call(
            client,
            "POST",
            "/pills",
            "expert",
            {
                "pill_id": OPS_ID,
                "version": "1.0.0",
                "owner": "approver",
                "reviewers": ["reviewer"],
                "content": content,
                "previous_version": None,
                "change_reason": "Synthetic SIFU grounding test",
            },
        )
        release(client, OPS_ID, "1.0.0")
        response = post_ask(client, {"question": "What does the approved guidance say?"})

    assert response.status_code == 200
    body = response.json()
    assert body["coverage"] == "full"
    assert body["citations"][0]["pill_id"] == OPS_ID
    assert body["citations"][0]["source_expert"] == "expert"
    assert body["citations"][0]["validator"] == "approver"
