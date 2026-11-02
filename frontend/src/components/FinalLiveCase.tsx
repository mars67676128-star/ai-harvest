import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "../lib/friendlyError";
import { DemoHint } from "./WorkflowBits";
import { actorLabel, sgTime, readingLabel, readingValue, conditionsText, cleanText } from "../lib/format";
import type { Observation, PillVersion, RecommendationRecord } from "../types";
import {
  createCase,
  getPillVersion,
  getPills,
  getRecommendation,
  getRecommendations,
  getRole,
  invokeCase,
  recordDecision,
} from "../api";
import { setActiveRec } from "../lib/demoState";

const OPS_ID = "asset.monsoon.triage";
const TENANT_ID = "tenant.incident.continuity";

type Scenario = "rising" | "backflow";

const ACTION_LABELS: Record<string, string> = {
  inspect_drainage: "Request a drainage assessment",
  monitor_trend: "Keep monitoring",
  review_access_plan: "Change the access plan",
  draft_tenant_update: "Draft a tenant update",
  tenant_liaison: "Keep tenants informed",
};

const READING_ORDER = ["water_rise_mm_min", "pump_running", "drain_backflow", "critical_equipment_exposed", "alternative_route_verified"];

function humanise(value: string): string {
  return value.replace(/^demo[-_]/, "").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function actionLabel(id: string): string {
  return ACTION_LABELS[id] ?? humanise(id);
}

const READING_SOURCE: Record<string, string> = {
  water_rise_mm_min: "Basement level sensor",
  pump_running: "Pump controller (BMS)",
  critical_equipment_exposed: "Duty technician check",
  alternative_route_verified: "Security patrol",
  tenant_arrivals_expected: "Visitor management system",
  drain_backflow: "Duty technician check",
};

function observation(value: boolean | number, observedAt: string, unit = "", key = ""): Observation {
  return {
    value,
    unit,
    source: READING_SOURCE[key] ?? "Duty team",
    observed_at: observedAt,
    quality: "verified",
  };
}

function buildObservations(scenario: Scenario, supportsBackflow: boolean): Record<string, Observation> {
  const now = new Date().toISOString();
  const backflow = scenario === "backflow";
  const result: Record<string, Observation> = {
    water_rise_mm_min: observation(backflow ? 0 : 3, now, "mm/min", "water_rise_mm_min"),
    pump_running: observation(true, now, "", "pump_running"),
    critical_equipment_exposed: observation(false, now, "", "critical_equipment_exposed"),
    alternative_route_verified: observation(backflow, now, "", "alternative_route_verified"),
    tenant_arrivals_expected: observation(!backflow, now, "", "tenant_arrivals_expected"),
  };
  if (supportsBackflow) result.drain_backflow = observation(backflow, now, "", "drain_backflow");
  return result;
}

function escalationRoles(rec: RecommendationRecord): string[] {
  const roles = rec.result.escalations.map((entry) => {
    const idx = entry.indexOf(":");
    return idx >= 0 ? entry.slice(idx + 1).trim() : entry;
  }).filter(Boolean);
  return [...new Set(roles)];
}

export function LiveCase({
  onGoToEvolution,
  onGoToPill,
  openRecId,
}: {
  onGoToEvolution?: (recId: string) => void;
  onGoToPill?: (pillId: string) => void;
  openRecId?: string | null;
}) {
  const role = getRole();
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [selectedRec, setSelectedRec] = useState<RecommendationRecord | null>(null);
  const [exactPills, setExactPills] = useState<Record<string, PillVersion>>({});
  const [scenario, setScenario] = useState<Scenario>("rising");
  // AI summary is written on request (button), like "Summarise" in Gmail/Notion.
  const [summaryWriting, setSummaryWriting] = useState<string | null>(null);
  const [summaryShown, setSummaryShown] = useState<string[]>([]);
  const summaryTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(summaryTimer.current), []);
  const writeSummary = (id: string) => {
    setSummaryWriting(id);
    window.clearTimeout(summaryTimer.current);
    summaryTimer.current = window.setTimeout(() => {
      setSummaryShown((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setSummaryWriting(null);
    }, 2200);
  };
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ps = await getPills();
      setPills(ps);
      if (role === "operator" || role === "approver") {
        const list = await getRecommendations();
        const hydrated = await Promise.all(list.map((r) => getRecommendation(r.id).catch(() => r)));
        setRecommendations(hydrated);
        setSelectedRec((current) => {
          if (current) return hydrated.find((r) => r.id === current.id) ?? current;
          if (openRecId) return hydrated.find((r) => r.id === openRecId) ?? null; // opened from a Home task
          return null; // Live Case opens empty; past cases are in the dropdown
        });
      } else {
        setRecommendations([]);
        setSelectedRec(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [role, openRecId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const activeOps = useMemo(
    () => pills.find((p) => p.pill_id === OPS_ID && p.status === "APPROVED"),
    [pills]
  );
  const supportsBackflow = !!activeOps?.content.inputs.some((i) => i.key === "drain_backflow");

  useEffect(() => {
    if (!supportsBackflow && scenario === "backflow") setScenario("rising");
  }, [supportsBackflow, scenario]);

  useEffect(() => {
    if (!selectedRec) {
      setExactPills({});
      return;
    }
    let cancelled = false;
    Promise.all(
      selectedRec.capabilities.map(async (cap) => [cap.pill_id, await getPillVersion(cap.pill_id, cap.version)] as const)
    )
      .then((rows) => { if (!cancelled) setExactPills(Object.fromEntries(rows)); })
      .catch(() => { if (!cancelled) setExactPills({}); });
    return () => { cancelled = true; };
  }, [selectedRec]);

  const handleRun = async () => {
    if (role !== "operator") return;
    setBusy(true);
    setError(null);
    try {
      const observations = buildObservations(scenario, supportsBackflow);
      const newCase = await createCase({
        title: scenario === "backflow"
          ? "Flat water trend with verified drain backflow"
          : "Green pump indicator, rising basement water",
        asset_id: "harbour-exchange-demo",
        asset_type: "office",
        equipment: "basement_sump",
        context: "wet_weather",
        observations,
        synthetic: true,
      });
      const rec = await invokeCase(newCase.id, [OPS_ID, TENANT_ID], true);
      setActiveRec(rec.id);
      setRecommendations((prev) => [...prev, rec]);
      setSelectedRec(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSelect = async (id: string) => {
    setError(null);
    try {
      const rec = await getRecommendation(id);
      setActiveRec(rec.id);
      setSelectedRec(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleEscalation = async () => {
    if (!selectedRec || role !== "operator") return;
    setBusy(true);
    setError(null);
    try {
      await recordDecision(selectedRec.id, "escalate", note.trim());
      const updated = await getRecommendation(selectedRec.id);
      setActiveRec(updated.id);
      setSelectedRec(updated);
      setRecommendations((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading">Loading operational data from backend…</div>;

  if (role !== "operator" && role !== "approver") {
    return (
      <div className="callout callout-info">
        Live cases are handled by the operator on duty and visible to approvers.
        <div className="mt-8"><DemoHint>Switch to Operator or Approver at top right.</DemoHint></div>
      </div>
    );
  }

  const preview = buildObservations(scenario, supportsBackflow);
  const shownObs = selectedRec?.observations ?? preview;
  const conflict = selectedRec?.result.blocked_actions.includes("review_access_plan") ?? false;
  const roles = selectedRec ? escalationRoles(selectedRec) : [];

  const decision = selectedRec?.result.decision;
  const fromAlarm = !!selectedRec && Object.values(selectedRec.observations ?? {}).some((o) => /^BMS\b/i.test(o.source));
  const verdictWord = decision === "ESCALATE" ? "Escalate" : decision === "ABSTAIN" ? "No advice" : "Review on site";
  const roleText = roles.map((r) => `the ${r.charAt(0).toLowerCase()}${r.slice(1)}`);
  const verdictLine = decision === "ESCALATE"
    ? `Call ${roleText.length > 1 ? `${roleText.slice(0, -1).join(", ")} and ${roleText[roleText.length - 1]}` : roleText[0] ?? "the duty team"}.`
    : decision === "ABSTAIN"
    ? "There aren't enough verified readings to advise. Check on site."
    : "A person should look before anything changes.";
  const obsEntries = Object.entries(shownObs).filter(([key]) => ["water_rise_mm_min", "pump_running", "drain_backflow", "critical_equipment_exposed", "alternative_route_verified"].includes(key))
    .sort(([a], [b]) => READING_ORDER.indexOf(a) - READING_ORDER.indexOf(b));

  return (
    <div className="lc">
      <header className="lc-head">
        <div>
          <h1 className="lc-title">Basement sump, Harbour Exchange</h1>
          <p className="lc-sub">Heavy rain. The sump should be pumping water out of the basement.</p>
        </div>
        {recommendations.length > 0 && (
          <select className="rec-select" aria-label="Open a past case" value={selectedRec?.id ?? ""} onChange={(e) => void handleSelect(e.target.value)}>
            <option value="" disabled>Past cases ({recommendations.length})</option>
            {recommendations.map((r) => (
              <option key={r.id} value={r.id}>{sgTime(r.created_at)}, {r.result.decision === "HUMAN_REVIEW" ? "review on site" : r.result.decision === "ESCALATE" ? "escalate" : "no advice"}</option>
            ))}
          </select>
        )}
      </header>

      <section className="lc-panel" aria-label="Readings">
        <div className="lc-panel-bar">
          <label className="lc-panel-pick">
            <span>Readings</span>
            <select className="role-select" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)} disabled={role !== "operator" || busy}>
              <option value="rising">Example: pump running, water rising</option>
              <option value="backflow" disabled={!supportsBackflow}>Example: water steady, drain backing up</option>
            </select>
          </label>
          {role === "operator" ? (
            <button className="btn btn-primary" onClick={handleRun} disabled={busy}>{busy ? "Checking…" : "Check these readings"}</button>
          ) : (
            <DemoHint>The operator on duty runs checks. Switch to Operator at top right.</DemoHint>
          )}
        </div>
        <div className="lc-readings">
          {obsEntries.map(([key, value]) => (
            <div className="lc-reading" key={key}>
              <div className="lc-reading-name">{readingLabel(key)}</div>
              <div className="lc-reading-value">{readingValue(key, value.value, value.unit)}</div>
              <div className="lc-reading-src">{cleanText(value.source) === "Verified reading" ? "Verified" : cleanText(value.source)}, {sgTime(value.observed_at).split(", ").pop()}</div>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="error-box mb-16">{friendlyError(error)}</div>}

      {!selectedRec && (
        <p className="lc-empty">{role === "operator" ? "No case open. Check the readings above, or open a past case." : "No case open. Open a past case from the list above."}</p>
      )}

      {selectedRec && (
        <>
          {fromAlarm && (
            <p className="lc-alarm"><span className="lc-alarm-dot" aria-hidden="true" />Raised automatically by the building system (BMS alarm) at {sgTime(selectedRec.created_at)}</p>
          )}
          <section className={`lc-verdict lc-verdict-${(decision ?? "").toLowerCase()}`} aria-live="polite">
            <div className="lc-verdict-word">{verdictWord}</div>
            <div className="lc-verdict-text">
              <p className="lc-verdict-line">{verdictLine}</p>
              <p className="lc-verdict-note">Advice only. You make the call; Sifu doesn't trigger equipment or send messages.</p>
              <p className="lc-verdict-src">
                From{" "}
                {selectedRec.capabilities.map((cap, i) => (
                  <span key={cap.pill_id}>
                    {i > 0 && " and "}
                    <button type="button" className="link-btn" onClick={() => onGoToPill?.(cap.pill_id)}>{exactPills[cap.pill_id]?.content.name ?? cap.pill_id} v{cap.version}</button>
                  </span>
                ))}
              </p>
            </div>
          </section>

          {conflict && (
            <section className="lc-section">
              <h2 className="lc-h2">The two teams' rules disagree</h2>
              <div className="lc-conflict">
                <div className="lc-side">
                  <div className="lc-side-who">Asset Operations suggests</div>
                  <div className="lc-side-what">Change the access plan</div>
                  <div className="lc-side-why">Water is rising, so move people away from the basement entrance.</div>
                </div>
                <div className="lc-vs" aria-hidden="true">vs</div>
                <div className="lc-side lc-side-block">
                  <div className="lc-side-who">Tenant Experience blocks it</div>
                  <div className="lc-side-what">The other entrance hasn't been checked</div>
                  <div className="lc-side-why">Tenants can't be sent another way until it's checked safe.</div>
                </div>
              </div>
            </section>
          )}

          {(selectedRec.result.actions.length > 0 || selectedRec.result.blocked_actions.length > 0) && (
            <section className="lc-section">
              <h2 className="lc-h2">What to do</h2>
              <ul className="lc-todo">
                {selectedRec.result.actions.map((a) => (
                  <li key={a.id}><span className="lc-dot" aria-hidden="true" /><div><b>{actionLabel(a.id)}</b><span>{a.description}</span></div></li>
                ))}
                {selectedRec.result.blocked_actions.map((id) => (
                  <li key={id} className="lc-todo-not"><span className="lc-dot" aria-hidden="true" /><div><b>Not yet: {actionLabel(id).charAt(0).toLowerCase() + actionLabel(id).slice(1)}</b><span>{id === "review_access_plan" ? "Wait until the other entrance is checked safe." : "Ruled out for these readings."}</span></div></li>
                ))}
              </ul>
            </section>
          )}

          <section className="lc-section lc-decide">
            <h2 className="lc-h2">Your decision</h2>
            {selectedRec.human_decision ? (
              <>
                <div className="confirmation-banner"><span className="confirmation-text">Escalation recorded.</span>{onGoToEvolution && <button type="button" className="link-btn next-step-link" onClick={() => onGoToEvolution(selectedRec.id)}>Record the outcome</button>}</div>
                <div className="kv"><div><dt>Decision</dt><dd>{humanise(selectedRec.human_decision.decision)}</dd></div><div><dt>Recorded by</dt><dd>{actorLabel(selectedRec.human_decision.actor)}</dd></div><div><dt>Note</dt><dd>{selectedRec.human_decision.note}</dd></div></div>
              </>
            ) : selectedRec.result.decision === "ESCALATE" ? (
              <>
                {role !== "operator" && <p className="lc-muted mb-8">Only the operator on duty records the decision.</p>}
                <div className="chip-row mb-8">
                  {["Escalated to the duty facilities engineer.", "Escalated to the tenant duty manager.", "Escalated to both for a coordinated response."].map((t) => (
                    <button key={t} type="button" className="kb-chip" onClick={() => setNote(t)} disabled={busy || role !== "operator"}>{t.replace(/^Escalated to /, "").replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase())}</button>
                  ))}
                </div>
                <textarea className="note-input mb-8" rows={3} value={note} placeholder="Who did you call, and why?" onChange={(e) => setNote(e.target.value)} disabled={busy || role !== "operator"} />
                <button className="btn btn-primary" onClick={handleEscalation} disabled={busy || role !== "operator" || !note.trim()}>{busy ? "Recording…" : "Record escalation"}</button>
              </>
            ) : <p className="lc-muted">Nothing to record for this case.</p>}
          </section>

          {selectedRec.ai_explanation && (
            <section className="ai-summary">
              <div className="ai-summary-head">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" /><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
                <span>Handover summary</span><span className="ai-tag">AI-generated</span>
              </div>
              {summaryWriting === selectedRec.id ? (
                <div className="ai-skeleton" aria-label="Writing summary">
                  <div className="ai-writing">Writing summary…</div>
                  <span /><span /><span />
                </div>
              ) : summaryShown.includes(selectedRec.id) ? (
                <>
                  <p className="ai-summary-text">{selectedRec.ai_explanation.summary}</p>
                  <p className="ai-summary-unc">{cleanText(selectedRec.ai_explanation.uncertainty)}</p>
                </>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => writeSummary(selectedRec.id)}>Summarise this case</button>
              )}
              <div className="ai-summary-foot">AI summaries can be wrong. Check them against the readings.</div>
            </section>
          )}

          <details className="lc-how">
            <summary>How Sifu got this</summary>
            <div className="lc-how-body">
              <h3 className="lc-h3">Rules that matched</h3>
              {selectedRec.capabilities.map((cap) => (
                <div key={cap.pill_id} className="mb-16">
                  <div className="lc-pill-name">{exactPills[cap.pill_id]?.content.name ?? cap.pill_id} <span className="lc-ver">v{cap.version}</span></div>
                  {cap.trace.length === 0 ? <div className="lc-muted">No rule matched.</div> : cap.trace.map((trace) => {
                    const rule = exactPills[cap.pill_id]?.content.rules.find((r) => r.id === trace.rule_id);
                    return (
                      <div className={`rule-card ${trace.category}`} key={trace.rule_id}>
                        <div className="rule-card-name">{rule ? `If ${conditionsText(rule.when).toLowerCase()}` : humanise(trace.rule_id)}</div>
                        <div className="rule-card-rationale">{trace.rationale}</div>
                        <div className="rule-card-evidence">{Object.entries(trace.observations).map(([k, o]) => `${readingLabel(k)}: ${readingValue(k, o.value, o.unit)}`).join("; ")}</div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <h3 className="lc-h3">Pill versions used</h3>
              {selectedRec.capabilities.map((cap) => {
                const pill = exactPills[cap.pill_id];
                return (
                  <div className="pill-provenance" key={cap.pill_id}>
                    <div className="pill-prov-header"><div className="lc-pill-name">{pill?.content.name ?? "Pill"} <span className="lc-ver">v{cap.version}</span></div></div>
                    {pill && <div className="kv"><div><dt>Owner</dt><dd>{actorLabel(pill.owner)}</dd></div><div><dt>Reviewed by</dt><dd>{pill.reviewers.map(actorLabel).join(", ")}</dd></div><div><dt>Written by</dt><dd>{actorLabel(pill.author)}</dd></div><div><dt>Why this version</dt><dd>{cleanText(pill.change_reason)}</dd></div></div>}
                    {role !== "operator" && (
                      <details className="tech-details"><summary>Technical details</summary>
                        <div className="kv kv-tech"><div><dt>Pill ID</dt><dd>{cap.pill_id}</dd></div><div><dt>Content hash</dt><dd>{cap.content_hash}</dd></div></div>
                      </details>
                    )}
                  </div>
                );
              })}

              <h3 className="lc-h3">What Sifu will never do</h3>
              <ul className="boundary-list">{[...new Set(selectedRec.capabilities.flatMap((cap) => cap.boundaries))].map((b) => <li key={b}><span className="boundary-icon" aria-hidden="true">×</span><span>{b}</span></li>)}</ul>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
