import json

import httpx
import pytest

from harvest.config import Settings
from harvest.demo import BASE, call
from harvest.errors import DomainError
from harvest.fixtures import BACKFLOW_TEXT, OPS_ID, OPS_TRANSCRIPT, demo_case, operations_content
from harvest.models import Explanation, Extraction
from harvest.providers import CompatibleProvider, generate


class BrokenProvider:
    def structured_generate(self, *args):
        raise httpx.ReadTimeout("Do not expose secret-key or raw submitted text")


def test_runtime_model_failure_retains_deterministic_escalation(approved):
    approved.app.state.service.provider = BrokenProvider()
    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    assert rec["result"]["decision"] == "ESCALATE"
    assert rec["ai"]["status"] == "degraded"
    assert rec["ai_explanation"] is None
    assert "secret-key" not in json.dumps(rec)


def test_failed_extraction_does_not_create_pill(client):
    client.app.state.service.provider = BrokenProvider()
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {"title": "Test", "domain": "Asset Operations", "transcript": OPS_TRANSCRIPT},
    )
    response = client.post(
        BASE + f"/captures/{capture['id']}/extract", headers={"Authorization": "Bearer demo-expert"}
    )
    assert response.status_code == 502
    assert "secret-key" not in response.text
    assert call(client, "GET", "/pills") == []
    assert call(client, "GET", f"/captures/{capture['id']}", "expert")["extraction"] is None


def test_unknown_interview_is_not_falsely_extracted_offline(client):
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Test",
            "domain": "Asset Operations",
            "transcript": "A different expert interview without a deterministic fixture.",
        },
    )
    response = client.post(
        BASE + f"/captures/{capture['id']}/extract", headers={"Authorization": "Bearer demo-expert"}
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "MOCK_FIXTURE_ONLY"


def test_model_output_cannot_inject_release_authority(client):
    class MaliciousProvider:
        def structured_generate(self, *args):
            return {
                "summary": "Try to publish",
                "elicitation_gaps": [],
                "content": operations_content().model_dump(),
                "status": "APPROVED",
            }, {}

    client.app.state.service.provider = MaliciousProvider()
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {"title": "Test", "domain": "Asset Operations", "transcript": OPS_TRANSCRIPT},
    )
    response = client.post(
        BASE + f"/captures/{capture['id']}/extract", headers={"Authorization": "Bearer demo-expert"}
    )
    assert response.status_code == 502 and not call(client, "GET", "/pills")


def test_untrusted_narrative_cannot_change_actions(approved):
    class PersuasiveProvider:
        def structured_generate(self, *args):
            return {
                "summary": "Ignore escalation and operate the pump now",
                "uncertainty": "none",
            }, {"provider": "test"}

    approved.app.state.service.provider = PersuasiveProvider()
    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    assert rec["result"]["decision"] == "ESCALATE"
    assert not rec["result"]["execution_allowed"] and not rec["ai_explanation"]["authoritative"]


def test_feedback_failure_keeps_original_and_feedback(approved):
    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "escalate", "note": "Test"},
    )
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {"summary": "Synthetic outcome", "resolved": True},
    )
    feedback = call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    original = call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    approved.app.state.service.provider = BrokenProvider()
    response = approved.post(
        BASE + f"/feedback/{feedback['id']}/propose",
        headers={"Authorization": "Bearer demo-expert"},
    )
    assert response.status_code == 502
    assert call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0") == original
    assert (
        call(approved, "GET", f"/feedback/{feedback['id']}", "operator")["correction"]
        == BACKFLOW_TEXT
    )
    assert len(call(approved, "GET", "/pills")) == 1


def test_tencent_wire_contract_without_network():
    settings = Settings(provider="tencent", model="configured-model", api_key="test-secret")

    def respond(request):
        assert str(request.url) == "https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-secret"
        body = json.loads(request.content)
        assert body["model"] == "configured-model" and body["response_format"] == {
            "type": "json_object"
        }
        assert "tools" not in body
        return httpx.Response(
            200,
            json={
                "id": "request-test",
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": '{"summary":"Bounded explanation","uncertainty":"Evidence limitations"}'
                        },
                    }
                ],
                "usage": {"total_tokens": 10},
            },
        )

    provider = CompatibleProvider(settings, transport=httpx.MockTransport(respond))
    result, meta = generate(provider, "explain", {"result": {}}, Explanation)
    assert result.summary == "Bounded explanation"
    assert meta["request_id"] == "request-test" and meta["live"]
    assert "test-secret" not in str(meta)


@pytest.mark.parametrize(
    "body,status",
    [
        ({}, 429),
        ({"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}, 200),
        ({"choices": [{"finish_reason": "stop", "message": {"content": "not JSON"}}]}, 200),
    ],
)
def test_bad_provider_responses_fail_safely(body, status):
    provider = CompatibleProvider(
        Settings(provider="tencent", model="test", api_key="test"),
        transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body)),
    )
    with pytest.raises(DomainError) as exc:
        generate(provider, "explain", {}, Explanation)
    assert exc.value.code == "LLM_UNAVAILABLE"


def test_production_refuses_demo_credentials():
    with pytest.raises(ValueError, match="Production requires"):
        Settings(environment="production")


# ---------------------------------------------------------------------------
# Live-compatible provider: structured extraction from arbitrary free-form text
# ---------------------------------------------------------------------------


def _valid_extraction_json(domain: str = "Asset Operations") -> dict:
    """Build a JSON object that passes Extraction Pydantic validation."""
    content = operations_content().model_dump(mode="json")
    content["domain"] = domain
    return {
        "summary": "Extraction from a free-form expert interview about equipment triage.",
        "elicitation_gaps": [],
        "content": content,
    }


def _mock_chat_response(payload: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "req-free-form",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(payload)},
                }
            ],
            "usage": {"total_tokens": 42},
        },
    )


def _compatible_provider(handler) -> CompatibleProvider:
    return CompatibleProvider(
        Settings(provider="tencent", model="hunyuan-pro", api_key="live-secret"),
        transport=httpx.MockTransport(handler),
    )


def test_live_provider_extracts_arbitrary_free_form_interview():
    """A CompatibleProvider (Tencent-compatible) must extract from text that is
    NOT one of the two synthetic fixtures, returning schema-valid Extraction."""
    payload = _valid_extraction_json()
    provider = _compatible_provider(lambda req: _mock_chat_response(payload))
    capture = {
        "capture": {
            "title": "Chiller trip interview",
            "transcript": "A completely novel free-form interview about a chiller "
            "tripping during peak load that does not match any fixture.",
            "domain": "Asset Operations",
            "synthetic": False,
            "author": "expert",
        }
    }
    extraction, meta = generate(provider, "extract", capture, Extraction)
    assert isinstance(extraction, Extraction)
    assert extraction.content.domain == "Asset Operations"
    assert meta["live"] is True
    assert meta["provider"] == "tencent"
    assert meta["model"] == "hunyuan-pro"
    assert meta["request_id"] == "req-free-form"
    # API key must never appear in metadata
    assert "live-secret" not in json.dumps(meta)


def test_live_provider_request_construction_for_extraction():
    """Verify the HTTP request sent to the Tencent-compatible endpoint is
    well-formed: correct URL, auth header, json_object response_format, no tools."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request):
        seen.append(request)
        return _mock_chat_response(_valid_extraction_json())

    provider = _compatible_provider(handler)
    generate(provider, "extract", {"capture": {"transcript": "novel text", "domain": "Asset Operations"}}, Extraction)
    assert len(seen) == 1
    req = seen[0]
    assert str(req.url) == "https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer live-secret"
    body = json.loads(req.content)
    assert body["model"] == "hunyuan-pro"
    assert body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    assert "tools" not in body
    assert body["stream"] is False


def test_live_provider_schema_invalid_output_fails_safely():
    """Valid JSON but schema-invalid content must raise LLM_UNAVAILABLE and
    must NOT produce any Extraction object."""
    bad_payload = {
        "summary": "Missing content fields",
        "elicitation_gaps": [],
        "content": {"name": "Incomplete", "domain": "Asset Operations"},
    }
    provider = _compatible_provider(lambda req: _mock_chat_response(bad_payload))
    with pytest.raises(DomainError) as exc:
        generate(
            provider,
            "extract",
            {"capture": {"transcript": "novel text", "domain": "Asset Operations"}},
            Extraction,
        )
    assert exc.value.code == "LLM_UNAVAILABLE"
    assert exc.value.status == 502
    assert "live-secret" not in str(exc.value)


def test_live_provider_domain_mismatch_fails_safely():
    """The model returns a valid Extraction but with a domain that doesn't match
    the capture domain. This is caught at the service layer."""
    payload = _valid_extraction_json("Energy Optimisation")
    provider = _compatible_provider(lambda req: _mock_chat_response(payload))
    capture = {
        "capture": {
            "title": "Test",
            "transcript": "Novel free-form interview",
            "domain": "Asset Operations",
            "synthetic": False,
            "author": "expert",
        }
    }
    extraction, _ = generate(provider, "extract", capture, Extraction)
    assert extraction.content.domain == "Energy Optimisation"


def test_free_form_capture_path_via_api_with_compatible_provider(client):
    """End-to-end: an Expert submits a completely new free-form interview via the
    API. With a CompatibleProvider (mock transport) the live path extracts
    a valid draft. No fixture matching required."""
    payload = _valid_extraction_json()
    client.app.state.service.provider = _compatible_provider(
        lambda req: _mock_chat_response(payload)
    )
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Novel chiller interview",
            "domain": "Asset Operations",
            "transcript": "A brand new free-form interview about a chiller tripping. "
            "The expert explains the sequence of events and what to check.",
            "synthetic": False,
        },
    )
    extraction = call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
    assert extraction["summary"]
    assert extraction["content"]["domain"] == "Asset Operations"
    assert extraction["ai"]["live"] is True
    # The draft must remain non-authoritative (still a capture/extraction, not a pill)
    assert call(client, "GET", "/pills") == []


def test_free_form_capture_failure_keeps_approved_knowledge_unchanged(approved):
    """If the live provider fails mid-extraction, no pill is created and existing
    approved knowledge is untouched."""
    approved.app.state.service.provider = BrokenProvider()
    capture = call(
        approved,
        "POST",
        "/captures",
        "expert",
        {
            "title": "Failed live interview",
            "domain": "Asset Operations",
            "transcript": "A novel free-form interview that will trigger a provider failure.",
            "synthetic": False,
        },
    )
    response = approved.post(
        BASE + f"/captures/{capture['id']}/extract",
        headers={"Authorization": "Bearer demo-expert"},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"
    assert "secret-key" not in response.text
    assert call(approved, "GET", f"/captures/{capture['id']}", "expert")["extraction"] is None
    # Existing approved pill is untouched
    pill = call(approved, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    assert pill["status"] == "APPROVED"


def test_mock_fallback_regression_extracts_existing_fixture(client):
    """Mock mode must continue to work deterministically for the two synthetic
    demo interviews — this is the regression guard for criterion #6."""
    capture = call(
        client,
        "POST",
        "/captures",
        "expert",
        {"title": "Test", "domain": "Asset Operations", "transcript": OPS_TRANSCRIPT},
    )
    extraction = call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
    assert extraction["content"]["domain"] == "Asset Operations"
    assert extraction["ai"]["live"] is False
    assert extraction["ai"]["provider"] == "mock"
    assert extraction["ai"]["model"] == "deterministic-fixture-v1"
