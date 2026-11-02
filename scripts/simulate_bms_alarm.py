"""Simulated building-system (BMS) alarm feed for the Sifu demo.

Sends readings to Sifu's existing case API, the same way a building management
system integration would, and asks Sifu to assess them with the approved pills.
No one clicks anything in the app: the case appears on the operator's Home page.

This is a SIMULATION for the demo. Readings are synthetic; nothing is connected
to a real building. It uses only the public API (no backend changes).

Usage (with the backend running):
    .venv/bin/python scripts/simulate_bms_alarm.py
    .venv/bin/python scripts/simulate_bms_alarm.py --scenario backflow
"""

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

PILLS = ["asset.monsoon.triage", "tenant.incident.continuity"]

SCENARIOS = {
    # Pump shows running but basement water keeps rising.
    "rising": {
        "water_rise_mm_min": (3, "mm/min", "BMS: basement level sensor"),
        "pump_running": (True, "", "BMS: sump pump controller"),
        "drain_backflow": (False, "", "Duty technician check"),
        "critical_equipment_exposed": (False, "", "Duty technician check"),
        "alternative_route_verified": (False, "", "Security patrol"),
        "tenant_arrivals_expected": (True, "", "Visitor management system"),
    },
    # Water level steady, but the drain is backing up (needs the learned v1.1 pill).
    "backflow": {
        "water_rise_mm_min": (0, "mm/min", "BMS: basement level sensor"),
        "pump_running": (True, "", "BMS: sump pump controller"),
        "drain_backflow": (True, "", "Duty technician check"),
        "critical_equipment_exposed": (False, "", "Duty technician check"),
        "alternative_route_verified": (True, "", "Security patrol"),
        "tenant_arrivals_expected": (False, "", "Visitor management system"),
    },
}


def call(base, method, path, body=None, token="demo-operator"):
    req = urllib.request.Request(
        f"{base}/api/v1{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="rising")
    args = parser.parse_args()

    now = datetime.now(timezone.utc).isoformat()
    observations = {
        key: {"value": v, "unit": unit, "source": src, "observed_at": now, "quality": "verified"}
        for key, (v, unit, src) in SCENARIOS[args.scenario].items()
    }
    print(f"[BMS] Alarm at Harbour Exchange basement sump ({args.scenario}). Sending readings to Sifu...")
    case = call(args.url, "POST", "/cases", {
        "title": "SIMULATED BMS ALARM: basement sump, heavy rain",
        "asset_id": "harbour-exchange-demo",
        "asset_type": "office",
        "equipment": "basement_sump",
        "context": "wet_weather",
        "observations": observations,
        "synthetic": True,
    })
    try:
        rec = call(args.url, "POST", f"/cases/{case['id']}/invoke", {"pill_ids": PILLS, "include_ai_explanation": True})
    except urllib.error.HTTPError as exc:
        print(f"[Sifu] Could not assess: {exc.read().decode()[:300]}")
        raise SystemExit(1)
    result = rec["result"]
    print(f"[Sifu] Advice: {result['decision']}  (blocked: {', '.join(result['blocked_actions']) or 'none'})")
    print("[Sifu] The case is waiting on the operator's Home page. Nothing was triggered automatically.")


if __name__ == "__main__":
    main()
