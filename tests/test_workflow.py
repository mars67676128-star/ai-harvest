from harvest.demo import BASE, call, run
from harvest.fixtures import OPS_ID, demo_case


def test_complete_api_driven_demo(client):
    report = run(client)
    assert report["production_unchanged_before_approval"]
    assert report["candidate"]["status"] == "DRAFT"
    assert report["approved"]["status"] == "APPROVED"
    assert report["history"]["status"] == "SUPERSEDED"
    assert len(report["recommendation"]["capabilities"]) == 2
    assert report["recommendation"]["ai_explanation"]["authoritative"] is False
    changed = {c["path"] for c in report["diff"]["changes"]}
    assert "/content/rules/backflow-exception" in changed
    assert "/content/inputs/drain_backflow" in changed
    events = {e["event"] for e in report["audit"]["items"]}
    assert {
        "KNOWLEDGE_CAPTURED",
        "PILL_CREATED",
        "REVIEW_REQUESTED",
        "PILL_APPROVED",
        "PILL_INVOKED",
        "RECOMMENDATION_GENERATED",
        "HUMAN_DECISION",
        "OUTCOME_RECORDED",
        "FEEDBACK_SUBMITTED",
        "CANDIDATE_REVISION_CREATED",
        "PILL_SUPERSEDED",
    } <= events
    previous_rec = call(client, "GET", f"/recommendations/{report['before_revision']['id']}")
    assert previous_rec["capabilities"][0]["version"] == "1.0.0"
    assert previous_rec["result"]["decision"] == "HUMAN_REVIEW"


def test_escalation_cannot_be_routinely_approved(approved):
    case = call(approved, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    response = approved.post(
        BASE + f"/recommendations/{rec['id']}/decision",
        headers={"Authorization": "Bearer demo-operator"},
        json={"decision": "approve", "note": "Bypass escalation"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ESCALATION_REQUIRED"


def test_outcome_requires_decision_and_is_single_record(approved):
    case = call(
        approved,
        "POST",
        "/cases",
        "operator",
        demo_case(water_rise_mm_min=0).model_dump(mode="json"),
    )
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    endpoint = BASE + f"/recommendations/{rec['id']}/outcome"
    headers = {"Authorization": "Bearer demo-operator"}
    body = {"summary": "Synthetic stable observation", "resolved": True}
    assert approved.post(endpoint, headers=headers, json=body).status_code == 409
    call(
        approved,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {"decision": "approve", "note": "Reviewed advisory; no actuation"},
    )
    assert approved.post(endpoint, headers=headers, json=body).status_code == 201
    assert approved.post(endpoint, headers=headers, json=body).status_code == 409


def test_error_contract_and_roles(client):
    assert client.get(BASE + "/pills").status_code == 401
    assert client.get(BASE + "/pills", headers={"X-Actor": "approver"}).status_code == 401
    response = client.post(
        BASE + "/cases",
        headers={"Authorization": "Bearer demo-viewer"},
        json=demo_case().model_dump(mode="json"),
    )
    assert response.status_code == 403
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    malformed = client.post(
        BASE + "/cases",
        headers={"Authorization": "Bearer demo-operator"},
        json={"asset_id": "unknown"},
    )
    assert malformed.status_code == 422 and malformed.json()["error"]["code"] == "VALIDATION_ERROR"


def test_no_execution_or_mutation_routes(approved):
    for path in ("/execute", "/equipment/actuate", f"/pills/{OPS_ID}/versions/1.0.0"):
        result = approved.put(
            BASE + path,
            headers={"Authorization": "Bearer demo-approver"},
            json={"status": "APPROVED"},
        )
        assert result.status_code in (404, 405)


def test_openapi_has_typed_runtime_and_security(client):
    schema = client.get("/openapi.json").json()
    response = schema["paths"][BASE + "/cases/{case_id}/invoke"]["post"]
    assert response["security"] == [{"HTTPBearer": []}]
    assert "RecommendationRecord" in str(response["responses"]["201"])


def test_expired_recommendation_cannot_receive_routine_approval(approved, monkeypatch):
    from datetime import datetime, timedelta, timezone

    case = call(
        approved,
        "POST",
        "/cases",
        "operator",
        demo_case(water_rise_mm_min=0).model_dump(mode="json"),
    )
    rec = call(approved, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]})
    monkeypatch.setattr(
        "harvest.service.clock_now", lambda: datetime.now(timezone.utc) + timedelta(hours=1)
    )
    response = approved.post(
        BASE + f"/recommendations/{rec['id']}/decision",
        headers={"Authorization": "Bearer demo-operator"},
        json={"decision": "approve", "note": "Old recommendation"},
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "EVIDENCE_EXPIRED"
