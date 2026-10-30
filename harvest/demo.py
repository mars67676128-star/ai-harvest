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


def check_acceptance(client, pill_id, version):
    """Submit, review, and validate a candidate; return acceptance result.

    Does NOT approve. Returns (validation_response, acceptance_result) where
    acceptance_result is None if the validate step failed before reaching
    acceptance checks.
    """
    path = f"/pills/{pill_id}/versions/{version}"
    call(client, "POST", f"{path}/submit", "expert", {"note": "SYNTHETIC scripted submit"})
    call(client, "POST", f"{path}/review", "reviewer", {"note": "SYNTHETIC scripted review"})
    result = call(
        client, "POST", f"{path}/validate", "reviewer", {"note": "SYNTHETIC scripted validate"}
    )
    acceptance = result.get("validation", {}).get("acceptance", {})
    return result, acceptance


def release_with_correction(client, pill_id, version, domain):
    """Release a pill, applying scripted reviewer correction if acceptance fails.

    This flow is used for live extractions where the AI draft may drift from
    source-grounded behaviour:

    1. Submit + review + validate the AI draft
    2. Check semantic acceptance
    3. If FAILED: create a scripted corrected DRAFT from labelled synthetic
       expert evidence, then release the corrected version
    4. If PASSED: release the original AI draft normally

    The correction is explicit and auditable — never a silent replacement.
    """
    validation, acceptance = check_acceptance(client, pill_id, version)

    if acceptance.get("passed", True):
        # Acceptance passed — approve the AI draft normally.
        result = call(
            client,
            "POST",
            f"/pills/{pill_id}/versions/{version}/approve",
            "approver",
            {
                "note": "SYNTHETIC scripted approve; demo role simulation, not qualified field approval."
            },
        )
        return {
            "approved": result,
            "ai_draft_version": version,
            "corrected": False,
            "semantic_acceptance": acceptance,
        }

    # Semantic acceptance FAILED — do NOT abort.
    failed_cases = [r["case_id"] for r in acceptance.get("results", []) if not r["passed"]]
    print(f"  Semantic acceptance: FAILED [{', '.join(failed_cases)}]")
    print(f"  Live AI draft v{version} retained as unapproved for provenance.")

    # Scripted reviewer correction from labelled synthetic expert evidence.
    corrected_version = bump_version(version)
    correction = call(
        client,
        "POST",
        f"/pills/{pill_id}/versions/{corrected_version}/correct",
        "expert",
        {
            "pill_id": pill_id,
            "version": corrected_version,
            "ai_draft_version": version,
            "failed_cases": failed_cases,
        },
    )
    print(
        f"  Scripted reviewer corrected candidate v{corrected_version} "
        f"from labelled synthetic expert evidence"
    )
    print(f"  AI draft v{version} → corrected v{corrected_version}; provenance recorded in audit.")

    # Revalidate the corrected candidate.
    corrected_validation, corrected_acceptance = check_acceptance(
        client, pill_id, corrected_version
    )
    if not corrected_acceptance.get("passed", False):
        raise RuntimeError(
            f"Corrected candidate v{corrected_version} still fails semantic acceptance: "
            f"{[r['case_id'] for r in corrected_acceptance.get('results', []) if not r['passed']]}"
        )
    print("  Semantic acceptance: PASSED")

    result = call(
        client,
        "POST",
        f"/pills/{pill_id}/versions/{corrected_version}/approve",
        "approver",
        {"note": "SYNTHETIC scripted approve; demo role simulation, not qualified field approval."},
    )
    return {
        "approved": result,
        "ai_draft_version": version,
        "ai_draft_failed_cases": failed_cases,
        "corrected": True,
        "corrected_version": corrected_version,
        "ai_draft_validation": validation.get("validation", {}),
        "corrected_validation": corrected_validation.get("validation", {}),
        "semantic_acceptance": corrected_acceptance,
        "correction_audit": correction,
    }


def bump_version(version: str) -> str:
    """Bump the patch component of a semver string."""
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def seed(client, live=False):
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
        if live:
            print(f"  Live AI draft compiled for {pill_id} v1.0.0")
            approved = release_with_correction(client, pill_id, "1.0.0", domain)
            if approved["corrected"]:
                print(
                    f"  Reviewed > tested > APPROVED {pill_id} v{approved['corrected_version']} "
                    f"(corrected from AI draft v{approved['ai_draft_version']})"
                )
            else:
                print(
                    f"  Reviewed > tested > APPROVED {pill_id} v1.0.0 (AI draft passed acceptance)"
                )
        else:
            approved = release(client, pill_id, "1.0.0")
            print(
                f"  Captured > extracted > compiled > reviewed > tested > APPROVED {pill_id} v1.0.0"
            )
        output.append(
            {"capture": capture, "extraction": extraction, "draft": draft, "approved": approved}
        )
    return output


def run(client, seed_only=False, live=False):
    if live:
        print("AI HARVEST | LIVE DEMO | real AI extraction + deterministic governance")
    else:
        print("AI HARVEST | SYNTHETIC DEMO | scripted human roles | no building actions executed")
    report = {
        "synthetic": True,
        "human_roles_simulated": True,
        "live": live,
        "seed": seed(client, live),
    }
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
    # Find the approved OPS version (may differ in live mode after correction).
    ops_versions = call(client, "GET", f"/pills/{OPS_ID}/versions")
    ops_approved = next(v for v in ops_versions if v["status"] == "APPROVED")
    ops_approved_version = ops_approved["version"]
    original = call(client, "GET", f"/pills/{OPS_ID}/versions/{ops_approved_version}")
    feedback = call(
        client,
        "POST",
        f"/recommendations/{rec['id']}/feedback",
        "operator",
        {"pill_id": OPS_ID, "correction": BACKFLOW_TEXT, "proposed_version": "1.1.0"},
    )
    candidate = call(client, "POST", f"/feedback/{feedback['id']}/propose", "expert")
    unchanged = call(client, "GET", f"/pills/{OPS_ID}/versions/{ops_approved_version}")
    assert (
        original["content_hash"] == unchanged["content_hash"] and unchanged["status"] == "APPROVED"
    )
    print(
        f"  Feedback created DRAFT v1.1.0. Approved {OPS_ID} v{ops_approved_version} "
        f"content and hash remain unchanged."
    )
    diff = call(
        client,
        "GET",
        f"/pills/{OPS_ID}/diff?from_version={ops_approved_version}&to_version=1.1.0",
        "expert",
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
    historical = call(client, "GET", f"/pills/{OPS_ID}/versions/{ops_approved_version}")
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
            report = run(client, args.seed_only, live=args.live)
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
            report = run(client, args.seed_only, live=args.live)
        print(f"  Database: {settings.database}")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  API payloads and audit: {output.resolve()}")


if __name__ == "__main__":
    main()
