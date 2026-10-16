import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "../lib/friendlyError";
import { DemoHint } from "./WorkflowBits";
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
  inspect_drainage: "Request drainage assessment",
  monitor_trend: "Continue verified observation",
  review_access_plan: "Review access plan",
  draft_tenant_update: "Draft tenant update",
  tenant_liaison: "Maintain tenant liaison",
};

const OBS_LABELS: Record<string, string> = {
  water_rise_mm_min: "Water Rise Rate",
  pump_running: "Pump Running",
  critical_equipment_exposed: "Critical Equipment Exposed",
  alternative_route_verified: "Alternative Route Verified",
  tenant_arrivals_expected: "Tenant Arrivals Expected",
  drain_backflow: "Drain Backflow",
};

function humanise(value: string): string {
  return value.replace(/^demo[-_]/, "").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function actionLabel(id: string): string {
  return ACTION_LABELS[id] ?? humanise(id);
}

function observation(value: boolean | number, observedAt: string, unit = ""): Observation {
  return {
    value,
    unit,
    source: "Synthetic verified demo observation",
    observed_at: observedAt,
    quality: "verified",
  };
}

function buildObservations(scenario: Scenario, supportsBackflow: boolean): Record<string, Observation> {
  const now = new Date().toISOString();
  const backflow = scenario === "backflow";
  const result: Record<string, Observation> = {
    water_rise_mm_min: observation(backflow ? 0 : 3, now, "mm/min"),
    pump_running: observation(true, now),
    critical_equipment_exposed: observation(false, now),
    alternative_route_verified: observation(backflow, now),
    tenant_arrivals_expected: observation(!backflow, now),
  };
  if (supportsBackflow) result.drain_backflow = observation(backflow, now);
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
}: {
  onGoToEvolution?: (recId: string) => void;
  onGoToPill?: (pillId: string) => void;
}) {
  const role = getRole();
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [selectedRec, setSelectedRec] = useState<RecommendationRecord | null>(null);
  const [exactPills, setExactPills] = useState<Record<string, PillVersion>>({});
  const [scenario, setScenario] = useState<Scenario>("rising");
  const [summaryPending, setSummaryPending] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!summaryPending) return;
    const el = summaryRef.current;
    let timer: number | undefined;
    const finish = () => { timer = window.setTimeout(() => setSummaryPending(null), 2500); };
    if (!el || typeof IntersectionObserver === "undefined") { finish(); return () => window.clearTimeout(timer); }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); finish(); }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [summaryPending, selectedRec]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(
    "Escalated to Duty Facilities Engineer and Tenant Duty Manager for coordinated response."
  );

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
          return hydrated[hydrated.length - 1] ?? null;
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
  }, [role]);

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
      // The summary is written when the operator scrolls to it (see effect below).
      setSummaryPending(rec.id);
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

  return (
    <div>
      <div className="case-header">
        <div className="flex-between flex-wrap gap-16">
          <div>
            <div className="flex gap-8 flex-wrap" style={{ alignItems: "center" }}>
              <span className="case-title">Harbour Exchange — Basement Sump, Wet Weather</span>
              <span className="synthetic-badge">Synthetic demo data</span>
            </div>
            <div className="case-subtitle">Office asset · basement sump · heavy-rain scenario</div>
          </div>
          {recommendations.length > 0 && (
            <select className="rec-select" value={selectedRec?.id ?? ""} onChange={(e) => void handleSelect(e.target.value)}>
              {recommendations.map((r) => (
                <option key={r.id} value={r.id}>{r.result.decision} · {r.created_at.slice(11, 19)}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="scenario-context">
        <b>The situation.</b> Harbour Exchange is fictional. During heavy rain, the basement sump should drain water away.
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <div className="flex-between flex-wrap gap-16">
            <div>
              <div className="section-heading">Assessment scenario</div>
              <select className="role-select" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)} disabled={role !== "operator" || busy}>
                <option value="rising">Original: pump running + water rising</option>
                <option value="backflow" disabled={!supportsBackflow}>
                  Learned: flat water + drain backflow{!supportsBackflow ? " (available after v1.1 approval)" : ""}
                </option>
              </select>
            </div>
            {role === "operator" ? (
              <button className="btn btn-primary" onClick={handleRun} disabled={busy}>
                {busy ? "Running…" : "Run Operational Assessment"}
              </button>
            ) : (
              <DemoHint>Assessments are run by the operator on duty — switch to Operator at top right.</DemoHint>
            )}
          </div>
        </div>
      </div>


      <div className="tile-grid" style={{ marginBottom: 20 }}>
        {Object.entries(shownObs).filter(([key]) => ["pump_running", "water_rise_mm_min", "alternative_route_verified", "critical_equipment_exposed", "drain_backflow"].includes(key)).map(([key, value]) => (
          <div className="tile" key={key}>
            <div className="tile-label">{OBS_LABELS[key] ?? humanise(key)}</div>
            <div className="tile-value">{String(value.value)}{value.unit ? ` ${value.unit}` : ""}</div>
            <div className="tile-sub">{value.quality} · {value.source}</div>
          </div>
        ))}
      </div>

      {error && <div className="error-box mb-16">{friendlyError(error)}</div>}

      {!selectedRec && (
        <div className="callout callout-info">
          No recommendation is selected yet. {role === "operator" ? "Run the assessment to create one." : "Assessments are run by the operator on duty."}
        </div>
      )}

      {selectedRec && (
        <>
          <div className="source-attribution">
            <span className="source-label">Based on approved pills:</span>
            {selectedRec.capabilities.map((cap) => (
              <span key={cap.pill_id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span className="pill-link" onClick={() => onGoToPill?.(cap.pill_id)}>
                  {exactPills[cap.pill_id]?.content.name ?? cap.pill_id}
                </span>
                <span className="source-version">v{cap.version}</span>
              </span>
            ))}
          </div>

          <div className={selectedRec.result.decision === "ESCALATE" ? "callout callout-warning mb-16" : "callout callout-info mb-16"}>
            <strong>{selectedRec.result.decision === "HUMAN_REVIEW" ? "Needs review" : humanise(selectedRec.result.decision)}</strong>
            {" · "}Advice only
            <br />{selectedRec.result.human_responsibility}
          </div>

          {conflict && (
            <div className="conflict-card">
              <div className="conflict-side conflict-side-proposes">
                <div className="conflict-domain">Asset Operations proposes</div>
                <div className="conflict-action">Review access plan</div>
                <div className="conflict-reason">Operational continuity suggests reviewing an access plan.</div>
              </div>
              <div className="conflict-divider">→</div>
              <div className="conflict-side conflict-side-blocks">
                <div className="conflict-domain">Tenant Experience blocks</div>
                <div className="conflict-action">Alternative route unverified</div>
                <div className="conflict-reason">Blocked until the other route is checked safe.</div>
              </div>
            </div>
          )}

          {roles.length > 0 && (
            <div className="card mb-16">
              <div className="card-header"><span className="card-title">Who Must Act</span></div>
              <div className="card-body"><div className="flex gap-8 flex-wrap">{roles.map((r) => <span className="escalation-role-chip" key={r}>{r}</span>)}</div></div>
            </div>
          )}

          {selectedRec.result.actions.length > 0 && (
            <div className="card mb-16">
              <div className="card-header"><span className="card-title">Recommended Actions</span><span className="card-meta">all require human authorisation</span></div>
              <div className="card-body"><div className="action-list">{selectedRec.result.actions.map((a) => (
                <div className="action-item" key={a.id}><div className="action-item-content"><div className="action-item-title">{actionLabel(a.id)}</div><div className="action-item-desc">{a.description}</div></div><span className="badge badge-warning">Authorisation required</span></div>
              ))}</div></div>
            </div>
          )}

          {selectedRec.result.blocked_actions.length > 0 && (
            <div className="callout callout-danger mb-16"><strong>Blocked actions:</strong> {selectedRec.result.blocked_actions.map(actionLabel).join(", ")}</div>
          )}

          <div className="card mb-16">
            <div className="card-header"><span className="card-title">Why this recommendation</span></div>
            <div className="card-body">
              {selectedRec.capabilities.map((cap) => (
                <div key={cap.pill_id} className="mb-16">
                  <div className="pill-prov-name">{exactPills[cap.pill_id]?.content.name ?? cap.pill_id} · v{cap.version}</div>
                  {cap.trace.length === 0 ? <div className="text-muted">No rule fired.</div> : cap.trace.map((trace) => (
                    <div className={`rule-card ${trace.category}`} key={trace.rule_id}>
                      <div className="rule-card-name">{humanise(trace.rule_id)}</div>
                      <div className="rule-card-rationale">{trace.rationale}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="card mb-16">
            <div className="card-header"><span className="card-title">Pill versions used</span></div>
            <div className="card-body">
              {selectedRec.capabilities.map((cap) => {
                const pill = exactPills[cap.pill_id];
                return (
                  <div className="pill-provenance mb-16" key={cap.pill_id}>
                    <div className="pill-prov-header"><div><div className="pill-prov-name">{pill?.content.name ?? cap.pill_id}</div><div className="tech-meta">{cap.pill_id}</div></div><span className="badge badge-success">v{cap.version}</span></div>
                    <div className="kv">
                      <div><dt>Content hash used</dt><dd>{cap.content_hash}</dd></div>
                      {pill && <><div><dt>Owner</dt><dd>{pill.owner}</dd></div><div><dt>Reviewers</dt><dd>{pill.reviewers.join(", ")}</dd></div><div><dt>Author</dt><dd>{pill.author}</dd></div><div><dt>Change reason</dt><dd>{pill.change_reason}</dd></div></>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card mb-16">
            <div className="card-header"><span className="card-title">Boundaries</span></div>
            <div className="card-body">
              {selectedRec.capabilities.map((cap) => <div key={cap.pill_id} className="mb-16"><div className="pill-prov-name mb-8">{exactPills[cap.pill_id]?.content.name ?? cap.pill_id}</div><ul className="boundary-list">{cap.boundaries.map((b) => <li key={b}><span className="boundary-icon">×</span><span>{b}</span></li>)}</ul></div>)}
            </div>
          </div>

          <div className="card mb-16">
            <div className="card-header"><span className="card-title">Your decision</span></div>
            <div className="card-body">
              {selectedRec.human_decision ? (
                <>
                  <div className="confirmation-banner"><span className="confirmation-text">Escalation recorded.</span>{onGoToEvolution && <span className="next-step-link" onClick={() => onGoToEvolution(selectedRec.id)}>Next: record the outcome →</span>}</div>
                  <div className="kv"><div><dt>Decision</dt><dd>{humanise(selectedRec.human_decision.decision)}</dd></div><div><dt>Accountable actor</dt><dd>{humanise(selectedRec.human_decision.actor)}</dd></div><div><dt>Note</dt><dd>{selectedRec.human_decision.note}</dd></div></div>
                </>
              ) : selectedRec.result.decision === "ESCALATE" ? (
                <>
                  {role !== "operator" && <div className="callout callout-warning mb-16">Only the operator on duty records the decision.</div>}
                  <textarea className="note-input mb-8" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy || role !== "operator"} />
                  <button className="btn btn-primary" onClick={handleEscalation} disabled={busy || role !== "operator" || !note.trim()}>{busy ? "Recording…" : "Record Escalation"}</button>
                </>
              ) : <div className="text-muted">No escalation decision is required for this recommendation.</div>}
            </div>
          </div>

          {selectedRec.ai_explanation && (
            <div className="ai-summary" ref={summaryRef}>
              <div className="ai-summary-head">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z" /><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
                <span>Summary</span><span className="ai-tag">AI-generated</span>
              </div>
              {summaryPending === selectedRec.id ? (
                <div className="ai-skeleton" aria-label="Writing summary">
                  <div className="ai-writing">Writing summary…</div>
                  <span /><span /><span />
                </div>
              ) : (
                <>
                  <p className="ai-summary-text">{selectedRec.ai_explanation.summary}</p>
                  <p className="ai-summary-unc">{selectedRec.ai_explanation.uncertainty}</p>
                </>
              )}
              <div className="ai-summary-foot">Advisory only · AI summaries can be wrong</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
