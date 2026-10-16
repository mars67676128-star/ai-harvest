import { useCallback, useEffect, useState } from "react";
import type { Observation, PillVersion, RecommendationRecord } from "../types";
import { createCase, getPillVersion, getPills, getRecommendation, getRecommendations, getRole, invokeCase, recordDecision } from "../api";

const OPS_ID = "asset.monsoon.triage";
const TENANT_ID = "tenant.incident.continuity";
const REC_KEY = "harvest.ke.recId";

type Scenario = "rising" | "backflow";

function rememberRec(id: string) { try { localStorage.setItem(REC_KEY, id); } catch { /* ignore */ } }
function label(id: string) { return id.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()); }
function actorLabel(id: string) { return label(id.replace(/^demo[-_]/, "")); }

function observationsFor(scenario: Scenario): Record<string, Observation> {
  const now = new Date().toISOString();
  const raw: Record<string, { value: number | boolean; unit: string }> = scenario === "backflow" ? {
    water_rise_mm_min: { value: 0, unit: "mm/min" },
    pump_running: { value: true, unit: "" },
    critical_equipment_exposed: { value: false, unit: "" },
    alternative_route_verified: { value: true, unit: "" },
    tenant_arrivals_expected: { value: false, unit: "" },
    drain_backflow: { value: true, unit: "" },
  } : {
    water_rise_mm_min: { value: 3, unit: "mm/min" },
    pump_running: { value: true, unit: "" },
    critical_equipment_exposed: { value: false, unit: "" },
    alternative_route_verified: { value: false, unit: "" },
    tenant_arrivals_expected: { value: true, unit: "" },
    drain_backflow: { value: false, unit: "" },
  };
  return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, {
    value: item.value,
    unit: item.unit,
    source: "Synthetic verified demo observation",
    observed_at: now,
    quality: "verified" as const,
  }]));
}

export function ReviewedLiveCase({ onGoEvolution, onGoPill }: { onGoEvolution: (recId: string) => void; onGoPill: (pillId: string, version: string) => void }) {
  const role = getRole();
  const [recs, setRecs] = useState<RecommendationRecord[]>([]);
  const [selected, setSelected] = useState<RecommendationRecord | null>(null);
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [exactPills, setExactPills] = useState<Record<string, PillVersion>>({});
  const [scenario, setScenario] = useState<Scenario>("rising");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("Escalated to Duty Facilities Engineer and Tenant Duty Manager for coordinated response.");

  const load = useCallback(async () => {
    setError(null);
    try {
      const ps = await getPills();
      setPills(ps);
      if (role !== "operator" && role !== "approver") return;
      const list = await getRecommendations();
      const hydrated = await Promise.all(list.map((r) => getRecommendation(r.id).catch(() => r)));
      setRecs(hydrated);
      setSelected((cur) => cur ?? hydrated[hydrated.length - 1] ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [role]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setExactPills({}); return; }
    let cancelled = false;
    Promise.all(selected.capabilities.map(async (cap) => [cap.pill_id, await getPillVersion(cap.pill_id, cap.version)] as const))
      .then((rows) => { if (!cancelled) setExactPills(Object.fromEntries(rows)); })
      .catch(() => { if (!cancelled) setExactPills({}); });
    return () => { cancelled = true; };
  }, [selected]);

  if (role !== "operator" && role !== "approver") {
    return <div className="callout callout-info"><strong>Live Case is role-restricted.</strong> Switch to Operator or Approver. Intelligence Pills remain available for knowledge inspection.</div>;
  }

  const activeOps = pills.find((p) => p.pill_id === OPS_ID && p.status === "APPROVED");
  const canRunBackflow = !!activeOps?.content.inputs.some((i) => i.key === "drain_backflow");

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const obs = observationsFor(scenario);
      const c = await createCase({
        title: scenario === "backflow" ? "Flat water trend with verified drain backflow" : "Green pump indicator, rising basement water",
        asset_id: "harbour-exchange-demo", asset_type: "office", equipment: "basement_sump", context: "wet_weather", observations: obs, synthetic: true,
      });
      const rec = await invokeCase(c.id, [OPS_ID, TENANT_ID], true);
      rememberRec(rec.id);
      setRecs((old) => [...old, rec]);
      setSelected(rec);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const recordEscalation = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await recordDecision(selected.id, "escalate", note);
      const hydrated = await getRecommendation(selected.id);
      rememberRec(hydrated.id);
      setSelected(hydrated);
      setRecs((old) => old.map((r) => r.id === hydrated.id ? hydrated : r));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const conflict = selected?.result.blocked_actions.includes("review_access_plan") ?? false;

  return (
    <div>
      <div className="case-header">
        <div className="flex-between flex-wrap gap-16">
          <div><span className="case-title">Harbour Exchange — Governed Operational Case</span><div className="case-subtitle">Synthetic office asset · basement sump · wet weather</div></div>
          {recs.length > 0 && <select className="rec-select" value={selected?.id ?? ""} onChange={async (e) => { const rec = await getRecommendation(e.target.value); setSelected(rec); rememberRec(rec.id); }}>
            {recs.map((r) => <option key={r.id} value={r.id}>{r.result.decision} · {r.created_at.slice(11,19)}</option>)}
          </select>}
        </div>
      </div>

      <div className="plain-english">{scenario === "rising" ? "The pump reports RUNNING while water is rising. AI HARVEST treats the contradiction as the meaningful signal and escalates; Tenant Experience independently blocks an unverified access plan." : "This regression scenario tests the learned v1.1 backflow exception: water appears flat, but verified backflow means routine monitoring alone is unsafe."}</div>

      <div className="card mb-16"><div className="card-body"><div className="flex-between flex-wrap gap-16">
        <div><div className="section-heading">Assessment scenario</div><select className="role-select" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}><option value="rising">Original: pump running + water rising</option><option value="backflow" disabled={!canRunBackflow}>Learned: flat water + drain backflow{!canRunBackflow ? " (available after v1.1 approval)" : ""}</option></select></div>
        <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? "Working…" : "Run Operational Assessment"}</button>
      </div></div></div>

      {error && <div className="error-box mb-16">{error}</div>}

      {selected && <>
        <div className="source-attribution"><span className="source-label">Exact capability snapshot:</span>{selected.capabilities.map((cap) => <span key={cap.pill_id} className="pill-link" onClick={() => onGoPill(cap.pill_id, cap.version)}>{exactPills[cap.pill_id]?.content.name ?? cap.pill_id} v{cap.version}</span>)}</div>

        <div className={`callout ${selected.result.decision === "ESCALATE" ? "callout-warning" : "callout-info"}`}><strong>{selected.result.decision}</strong> · execution_allowed = {String(selected.result.execution_allowed)} · human responsibility: {selected.result.human_responsibility}</div>

        {conflict && <div className="conflict-card"><div className="conflict-side conflict-side-proposes"><div className="conflict-domain">Asset Operations proposes</div><div className="conflict-action">Review access plan</div></div><div className="conflict-divider">→</div><div className="conflict-side conflict-side-blocks"><div className="conflict-domain">Tenant Experience blocks</div><div className="conflict-action">Alternative route unverified</div></div></div>}

        <div className="card"><div className="card-header"><span className="card-title">Rule Trace</span></div><div className="card-body">{selected.capabilities.map((cap) => <div key={cap.pill_id} className="mb-16"><div className="pill-prov-name">{exactPills[cap.pill_id]?.content.name ?? cap.pill_id} · v{cap.version}</div>{cap.trace.length === 0 ? <div className="text-muted">No rule fired.</div> : cap.trace.map((t) => <div className={`rule-card ${t.category}`} key={t.rule_id}><div className="rule-card-name">{label(t.rule_id)}</div><div className="rule-card-rationale">{t.rationale}</div></div>)}</div>)}</div></div>

        <div className="card"><div className="card-header"><span className="card-title">Exact Pill Provenance</span></div><div className="card-body">{selected.capabilities.map((cap) => { const p = exactPills[cap.pill_id]; return <div className="pill-provenance mb-16" key={cap.pill_id}><div className="pill-prov-header"><div><div className="pill-prov-name">{p?.content.name ?? cap.pill_id}</div><div className="tech-meta">{cap.pill_id}</div></div><span className="badge badge-success">Version {cap.version}</span></div><div className="kv"><div><dt>Content hash used</dt><dd>{cap.content_hash}</dd></div>{p && <><div><dt>Owner</dt><dd>{p.owner}</dd></div><div><dt>Author</dt><dd>{p.author}</dd></div><div><dt>Change reason</dt><dd>{p.change_reason}</dd></div></>}</div></div>; })}</div></div>

        <div className="card"><div className="card-header"><span className="card-title">Accountable Human Decision</span></div><div className="card-body">{selected.human_decision ? <><span className="badge badge-warning">Escalated</span><div className="kv mt-8"><div><dt>Actor</dt><dd>{actorLabel(selected.human_decision.actor)}</dd></div><div><dt>Note</dt><dd>{selected.human_decision.note}</dd></div><div><dt>Execution allowed</dt><dd>{String(selected.human_decision.execution_allowed)}</dd></div></div><button className="btn btn-primary mt-16" onClick={() => onGoEvolution(selected.id)}>Next: record outcome →</button></> : selected.result.decision === "ESCALATE" ? <><div className="text-dim mb-8">Routine approval is not available for an escalation. Record the accountable human escalation.</div><textarea className="note-input mb-8" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy || role !== "operator"} />{role !== "operator" && <div className="callout callout-warning mb-8">Switch to Operator to record the decision.</div>}<button className="btn btn-primary" onClick={recordEscalation} disabled={busy || role !== "operator" || !note.trim()}>Record Escalation</button></> : <div className="text-muted">This recommendation does not currently require an escalation decision.</div>}</div></div>

        {selected.ai_explanation && <div className="ai-explanation-box"><div className="card-header"><span className="card-title">AI Explanation — advisory only</span></div><div className="card-body"><div>{selected.ai_explanation.summary}</div><div className="text-muted mt-8">{selected.ai_explanation.uncertainty}</div></div></div>}
      </>}
    </div>
  );
}
