import { useState } from "react";
import { askSifu, type SifuAnswer } from "./api";
import { friendlyError } from "./lib/friendlyError";

const READINGS = [
  { label: "Water level change", value: "Rising 3 mm/min", source: "Basement level sensor" },
  { label: "Pump status", value: "Running", source: "Pump controller (BMS)" },
  { label: "Electrical equipment at risk", value: "No", source: "Duty technician check" },
  { label: "Other entrance checked safe", value: "No", source: "Security patrol" },
];

export default function SifuCaseGuidance() {
  const [result, setResult] = useState<SifuAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyKnowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await askSifu({
        question:
          "At Harbour Exchange during heavy rain, the basement sump pump shows RUNNING but the water level is rising at 3 mm/min. Critical electrical equipment is not currently exposed, and the other entrance has not been verified safe. Using validated organisational knowledge only, what should the operator do now?",
        context: {
          asset: "Harbour Exchange",
          area: "Basement sump",
          weather: "Heavy rain",
          pump_status: "RUNNING",
          water_level_change: "Rising 3 mm/min",
          critical_equipment_exposed: "No",
          alternative_entrance_verified_safe: "No",
        },
      });
      setResult(answer);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const coverageLabel = result?.coverage === "full"
    ? "Validated knowledge directly applies"
    : result?.coverage === "partial"
      ? "Based on partially matching validated knowledge"
      : "Validated knowledge does not fully cover this situation";

  const recommendsEscalation = !!result && (
    result.risk === "high" || result.known_points.some((point) => /escalat/i.test(point))
  );

  return (
    <div>
      <div className="case-header">
        <div className="case-title">Harbour Exchange — Basement Sump, Wet Weather</div>
        <div className="case-subtitle">Office asset · basement sump · heavy-rain scenario</div>
      </div>

      <div className="scenario-context">
        <b>The situation.</b> During heavy rain, the basement sump should drain water away.
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <div className="flex-between flex-wrap gap-16">
            <div>
              <div className="section-heading">Current situation</div>
              <div style={{ fontWeight: 650 }}>Pump running · water rising</div>
            </div>
            <button className="btn btn-primary" onClick={applyKnowledge} disabled={busy}>
              {busy ? "Applying…" : "Apply Validated Knowledge"}
            </button>
          </div>
        </div>
      </div>

      <div className="tile-grid" style={{ marginBottom: 20 }}>
        {READINGS.map((reading) => (
          <div className="tile" key={reading.label}>
            <div className="tile-label">{reading.label}</div>
            <div className="tile-value">{reading.value}</div>
            <div className="tile-sub">Verified · {reading.source}</div>
          </div>
        ))}
      </div>

      {error && <div className="error-box mb-16">{error}</div>}

      {!result && !error && (
        <div className="callout callout-info">
          Ready to apply validated organisational knowledge to these readings.
        </div>
      )}

      {result && (
        <>
          <section className={`guidance-decision ${recommendsEscalation ? "guidance-decision-escalate" : ""}`}>
            <div className="decision-kicker">Sifu case guidance</div>
            <div className="decision-title">
              {recommendsEscalation ? "ESCALATE" : "REVIEW WITH HUMAN OVERSIGHT"}
            </div>
            <div className="decision-subtitle">{coverageLabel}</div>
            <div className="decision-body">{result.answer}</div>
          </section>

          {result.known_points.length > 0 && (
            <div className="card mb-16">
              <div className="card-header">
                <span className="card-title">What validated knowledge supports</span>
              </div>
              <div className="card-body">
                <ul style={{ paddingLeft: 20 }}>
                  {result.known_points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            </div>
          )}

          {result.missing_information.length > 0 && (
            <div className="card mb-16">
              <div className="card-header">
                <span className="card-title">Still unresolved</span>
              </div>
              <div className="card-body">
                <ul style={{ paddingLeft: 20 }}>
                  {result.missing_information.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          )}

          {result.citations.length > 0 && (
            <div className="card mb-16">
              <div className="card-header">
                <span className="card-title">Validated organisational knowledge used</span>
              </div>
              <div className="card-body">
                {result.citations.map((citation) => (
                  <div className="pill-provenance" key={`${citation.pill_id}-${citation.version}`}>
                    <div className="pill-prov-header">
                      <div>
                        <div className="pill-prov-name">{citation.title}</div>
                        <div className="text-muted">{citation.domain} · v{citation.version}</div>
                      </div>
                      <span className="badge badge-success">Validated</span>
                    </div>
                    <div className="provenance-flow">
                      <div>
                        <span className="provenance-role">Expert</span>
                        <strong>{citation.source_expert ?? "—"}</strong>
                      </div>
                      <span className="provenance-arrow">→</span>
                      <div>
                        <span className="provenance-role">Knowledge Owner</span>
                        <strong>{citation.validator ?? "—"}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="callout callout-info">
            <strong>Human remains in control.</strong> This is advisory guidance from validated organisational knowledge; site action and escalation remain the operator’s responsibility.
          </div>
        </>
      )}
    </div>
  );
}
