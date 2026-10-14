"""API-driven, reproducible demonstration. All people/actions are simulated."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from .api import create_app
from .config import Settings
from .fixtures import BACKFLOW_TEXT, OPS_ID, OPS_TRANSCRIPT, TENANT_ID, TENANT_TRANSCRIPT, demo_case

BASE = "/api/v1"


def call(client, method, path, role="viewer", body=None):
    response = client.request(
        method,
        BASE + path,
        headers={"Authorization": f"Bearer demo-{role}"},
        **({"json": body} if body is not None else {}),
    )
    if not response.is_success:
        raise RuntimeError(f"{method} {path}: {response.status_code} {response.text}")
    return response.json()


def release(client, pill_id, version):
    path = f"/pills/{pill_id}/versions/{version}"
    for operation, role in [
        ("submit", "expert"),
        ("review", "reviewer"),
        ("validate", "reviewer"),
        ("approve", "approver"),
    ]:
        result = call(
            client,
            "POST",
            path + "/" + operation,
            role,
            {
                "note": f"SYNTHETIC scripted {operation}; demo role simulation, not qualified field approval."
            },
        )
        if operation == "validate" and not result["validation"]["passed"]:
            raise RuntimeError(
                "Candidate evaluation failed; release stopped. Inspect the version validation report."
            )
    return result


def seed(client):
    output = []
    existing = call(client, "GET", "/pills")
    for pill_id, transcript, domain in [
        (OPS_ID, OPS_TRANSCRIPT, "Asset Operations"),
        (TENANT_ID, TENANT_TRANSCRIPT, "Tenant Experience"),
    ]:
        if any(p["pill_id"] == pill_id for p in existing):
            output.append({"pill_id": pill_id, "reused": True})
            continue
        capture = call(
            client,
            "POST",
            "/captures",
            "expert",
            {
                "title": f"SYNTHETIC {domain} interview",
                "transcript": transcript,
                "domain": domain,
                "synthetic": True,
            },
        )
        extraction = call(client, "POST", f"/captures/{capture['id']}/extract", "expert")
        draft = call(
            client, "POST", f"/captures/{capture['id']}/compile", "expert", {"pill_id": pill_id}
        )
        approved = release(client, pill_id, "1.0.0")
        output.append(
            {"capture": capture, "extraction": extraction, "draft": draft, "approved": approved}
        )
        print(f"  Captured > extracted > compiled > reviewed > tested > APPROVED {pill_id} v1.0.0")
    return output


def run(client, seed_only=False):
    print("AI HARVEST | SYNTHETIC DEMO | scripted human roles | no building actions executed")
    report = {"synthetic": True, "human_roles_simulated": True, "seed": seed(client)}
    if seed_only:
        return report
    case = call(client, "POST", "/cases", "operator", demo_case().model_dump(mode="json"))
    rec = call(
        client, "POST", f"/cases/{case['id']}/invoke", "operator", {"pill_ids": [OPS_ID, TENANT_ID]}
    )
    print(
        f"  Two capabilities: {rec['result']['decision']}; blocked: {rec['result']['blocked_actions']}"
    )
    assert "review_access_plan" in rec["result"]["blocked_actions"]
    call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/decision",
        "operator",
        {
            "decision": "escalate",
            "note": "SYNTHETIC: referred to duty engineering and tenant leads.",
        },
    )
    call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/outcome",
        "operator",
        {
            "summary": "SYNTHETIC: duty team assessment identified intermittent drain backflow; later readings looked flat.",
            "resolved": True,
            "synthetic": True,
        },
    )
    original = call(client, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    feedback = call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    candidate = call(client, "POST", f"/feedback/{feedback['id']}/propose", "expert")
    unchanged = call(client, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    assert (
        original["content_hash"] == unchanged["content_hash"] and unchanged["status"] == "APPROVED"
    )
    print("  Feedback created DRAFT v1.1.0. Approved v1.0.0 content and hash remain unchanged.")
    diff = call(
        client, "GET", f"/pills/{OPS_ID}/diff?from_version=1.0.0&to_version=1.1.0", "expert"
    )
    print("  Reviewable changes: " + ", ".join(c["path"] for c in diff["changes"]))
    # The same flat-trend/backflow observation has different governed behaviour across releases.
    new_case = call(
        client,
        "POST",
        "/cases",
        "operator",
        demo_case(water_rise_mm_min=0, drain_backflow=True).model_dump(mode="json"),
    )
    before = call(
        client, "POST", f"/cases/{new_case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]}
    )
    approved = release(client, OPS_ID, "1.1.0")
    after = call(
        client, "POST", f"/cases/{new_case['id']}/invoke", "operator", {"pill_ids": [OPS_ID]}
    )
    assert (
        before["result"]["decision"] == "HUMAN_REVIEW" and after["result"]["decision"] == "ESCALATE"
    )
    historical = call(client, "GET", f"/pills/{OPS_ID}/versions/1.0.0")
    assert (
        historical["status"] == "SUPERSEDED"
        and historical["content_hash"] == original["content_hash"]
    )
    print(
        "  Reviewed + tested + approved v1.1.0. Flat-trend/backflow case: HUMAN_REVIEW > ESCALATE."
    )
    print(
        "  Historical v1.0.0 and its recommendation remain readable; audit records the full lifecycle."
    )
    report.update(
        {
            "case": case,
            "recommendation": rec,
            "feedback": feedback,
            "candidate": candidate,
            "production_unchanged_before_approval": True,
            "diff": diff,
            "approved": approved,
            "before_revision": before,
            "after_revision": after,
            "history": historical,
            "audit": call(client, "GET", "/audit?limit=500", "reviewer"),
        }
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Use an already-running API with demo fixture identities")
    parser.add_argument(
        "--database", help="Local SQLite path; defaults to a new timestamped artifact"
    )
    parser.add_argument(
        "--seed-only", action="store_true", help="Seed two initial approved demo capabilities"
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Use configured live provider; requires credentials and can incur cost",
    )
    parser.add_argument("--output", default="artifacts/demo-report.json")
    args = parser.parse_args()
    if args.url:
        with httpx.Client(base_url=args.url, timeout=120) as client:
            report = run(client, args.seed_only)
    else:
        if args.live:
            settings = Settings.from_env()
            if settings.provider == "mock":
                parser.error(
                    "--live requires HARVEST_LLM_PROVIDER=tencent or compatible and credentials"
                )
        else:
            settings = Settings()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        settings.database = args.database or f"artifacts/demo-{stamp}.db"
        with TestClient(create_app(settings)) as client:
            report = run(client, args.seed_only)
        print(f"  Database: {settings.database}")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  API payloads and audit: {output.resolve()}")


if __name__ == "__main__":
    main()
