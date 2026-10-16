import { useState, useEffect, useCallback } from "react";
import { DomainIcon } from "./DomainIcon";
import { setActiveRec } from "../lib/demoState";
import type {
  CaseRecord,
  RecommendationRecord,
  PillVersion,
  Observation,
} from "../types";
import {
  getCases,
  getRecommendations,
  getRecommendation,
  getPills,
  invokeCase,
  createCase,
  recordDecision,
  getRole,
} from "../api";

const OPS_ID = "asset.monsoon.triage";
const TENANT_ID = "tenant.incident.continuity";

const ACTION_LABELS: Record<string, string> = {
  inspect_drainage: "Request drainage assessment",
  monitor_trend: "Continue verified observation",
  review_access_plan: "Review access plan",
  draft_tenant_update: "Draft tenant update",
  tenant_liaison: "Maintain tenant liaison",
};

const RULE_LABELS: Record<string, string> = {
  "running-is-not-draining": "Running does not prove drainage",
  "pump-not-running": "Pump not running with rising water",
  "stable-trend": "Stable trend permits monitoring",
  "critical-exposure": "Critical equipment exposure exceeds authority",
  "unverified-route": "Unverified alternative route blocks access plan",
  "verified-arrivals": "Verified route with expected arrivals",
  "no-arrivals": "Verified route, no expected arrivals",
  "backflow-exception": "Drain backflow exception",
};

const PILL_LABELS: Record<string, string> = {
  "asset.monsoon.triage": "Monsoon Near-Miss Triage",
  "tenant.incident.continuity": "Tenant Incident Continuity",
};

const OBS_LABELS: Record<string, string> = {
  water_rise_mm_min: "Water Rise Rate",
  pump_running: "Pump Running",
  critical_equipment_exposed: "Critical Equipment Exposed",
  alternative_route_verified: "Alternative Route Verified",
  tenant_arrivals_expected: "Tenant Arrivals Expected",
  drain_backflow: "Drain Backflow",
};

const EVIDENCE_LABELS: Record<string, string> = {
  "demo-interview": "Synthetic expert interview",
  "pub-context": "PUB flood resilience context",
  "capture-source": "Submitted capture (pending review)",
};

function actionLabel(id: string): string {
  return ACTION_LABELS[id] ?? id.replace(/_/g, " ");
}
function ruleLabel(id: string): string {
  return RULE_LABELS[id] ?? id.replace(/_/g, " ");
}
function pillLabel(id: string): string {
  return PILL_LABELS[id] ?? id;
}
function obsLabel(key: string): string {
  return OBS_LABELS[key] ?? key.replace(/_/g, " ");
}
function evidenceLabel(id: string): string {
  return EVIDENCE_LABELS[id] ?? id;
}

function capitaliseActor(actor: string): string {
  if (!actor) return "—";
  // Strip "demo-" prefix and capitalise: "demo-operator" → "Operator"
  const name = actor.replace(/^demo[-_]/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function extractEscalationRoles(escalations: string[]): string[] {
  const roles: string[] = [];
  for (const esc of escalations) {
    const colonIdx = esc.indexOf(":");
    if (colonIdx >= 0) {
      const role = esc.slice(colonIdx + 1).trim();
      if (role) roles.push(role);
    }
  }
  return [...new Set(roles)];
}

function buildDemoObservations() {
  const now = new Date().toISOString();
  const raw: Record<string, { value: number | boolean; unit: string }> = {
    water_rise_mm_min: { value: 3, unit: "mm/min" },
    pump_running: { value: true, unit: "" },
    critical_equipment_exposed: { value: false, unit: "" },
    alternative_route_verified: { value: false, unit: "" },
    tenant_arrivals_expected: { value: true, unit: "" },
  };
  const obs: Record<string, Observation> = {};
  for (const [k, v] of Object.entries(raw)) {
    obs[k] = {
      value: v.value,
      unit: v.unit,
      source: "Synthetic verified demo observation",
      observed_at: now,
      quality: "verified",
    };
  }
  return obs;
}

function buildCaseBody() {
  return {
    title: "Green pump indicator, rising basement water",
    asset_id: "harbour-exchange-demo",
    asset_type: "office",
    equipment: "basement_sump",
    context: "wet_weather",
    observations: buildDemoObservations(),
    synthetic: true,
  };
}

export function LiveCase({
  onGoToEvolution,
  onGoToPill,
}: {
  onGoToEvolution?: (recId: string) => void;
  onGoToPill?: (pillId: string) => void;
}) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [selectedRec, setSelectedRec] = useState<RecommendationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cs, rs, ps] = await Promise.all([getCases(), getRecommendations(), getPills()]);
      setCases(cs);
      setRecommendations(rs);
      setPills(ps);
      if (rs.length > 0 && !selectedRec) {
        // Fetch the hydrated single-item version (list endpoint doesn't include human_decision/outcome)
        try {
          const hydrated = await getRecommendation(rs[rs.length - 1].id);
          setSelectedRec(hydrated);
        } catch {
          setSelectedRec(rs[rs.length - 1]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedRec]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateAndInvoke = async () => {
    setAction("Running assessment…");
    setError(null);
    try {
      const newCase = await createCase(buildCaseBody());
      const rec = await invokeCase(newCase.id, [OPS_ID, TENANT_ID], true);
      setActiveRec(rec.id); // Knowledge Evolution follows the newest assessment
      setSelectedRec(rec);
      setCases((prev) => [...prev, newCase]);
      setRecommendations((prev) => [...prev, rec]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAction("");
    }
  };

  const handleSelectRec = async (id: string) => {
    try {
      const rec = await getRecommendation(id);
      setSelectedRec(rec);
    } catch {
      const cached = recommendations.find((r) => r.id === id);
      if (cached) setSelectedRec(cached);
    }
  };

  if (loading && cases.length === 0) {
    return <div className="loading">Loading operational data from backend…</div>;
  }

  if (error && cases.length === 0) {
    // Detect role-related permission errors (forbidden)
    const isForbidden = /forbidden|requires|roles/i.test(error);
    if (isForbidden) {
      return (
        <div className="callout callout-info">
          <strong>Live Case is not available for your current role.</strong>{" "}
          Operational cases can only be viewed by <strong>operator</strong> or{" "}
          <strong>approver</strong> roles. Switch role in the topbar to view a case, or use{" "}
          <strong>Intelligence Pills</strong> to inspect the knowledge that drives recommendations.
        </div>
      );
    }
    return (
      <div>
        <div className="error-box">
          <strong>Backend connection error:</strong> {error}
        </div>
        <div className="callout callout-info">
          Ensure the backend is running:{" "}
          <code className="code-inline">python -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000</code>
          <br />
          And seeded:{" "}
          <code className="code-inline">python -m harvest.demo --seed-only --database data/review.db</code>
        </div>
      </div>
    );
  }

  const approvedPills = pills.filter((p) => p.status === "APPROVED");
  const opsPill = approvedPills.find((p) => p.pill_id === OPS_ID);
  const tenantPill = approvedPills.find((p) => p.pill_id === TENANT_ID);

  return (
    <div>
      {/* Case header */}
      <div className="case-header">
        <div className="flex-between">
          <div className="flex gap-16 flex-wrap" style={{ alignItems: "center" }}>
            <span className="case-title">Harbour Exchange — Basement Sump, Wet Weather</span>
            <span className="synthetic-badge">Synthetic demo data</span>
          </div>
          {recommendations.length > 0 && (
            <select
              className="rec-select"
              value={selectedRec?.id ?? ""}
              onChange={(e) => handleSelectRec(e.target.value)}
            >
              {recommendations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.result.decision} · {r.created_at.slice(11, 19)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="case-subtitle">
          Office asset · Harbour Exchange · Basement sump · Wet weather context
        </div>
      </div>

      {/* Plain-English summary */}
      <div className="scenario-context">
        <b>The situation.</b> Harbour Exchange is a fictional office tower. During heavy rain, water
        drains into a pit in the basement (a <i>sump</i>) and a pump pushes it out. If the pump stops
        working, the basement floods — damaging equipment and blocking the way tenants get in and out.
      </div>
      <div className="plain-english">
        The basement pump shows a green "running" light, but water is still rising at 3&nbsp;mm/min.
        A running pump does not prove effective drainage. The alternative access route has not been
        verified, so tenant continuity and asset operations are in conflict. AI HARVEST escalates
        this to the duty facilities engineer and tenant duty manager — no autonomous action is
        authorised.
      </div>

      {/* Status tiles */}
      <div className="tile-grid" style={{ marginBottom: 20 }}>
        <div className="tile">
          <div className="tile-label">Pump Status</div>
          <div className="tile-value warning">Running</div>
          <div className="tile-sub">Drainage not confirmed</div>
        </div>
        <div className="tile">
          <div className="tile-label">Water Trend</div>
          <div className="tile-value warning">Rising — 3 mm/min</div>
          <div className="tile-sub">Active monsoon conditions</div>
        </div>
        <div className="tile">
          <div className="tile-label">Alternative Route</div>
          <div className="tile-value danger">Unverified</div>
          <div className="tile-sub">Access plan blocked</div>
        </div>
        <div className="tile">
          <div className="tile-label">Critical Equipment</div>
          <div className="tile-value neutral">Not exposed</div>
          <div className="tile-sub">No immediate asset damage</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Run assessment button */}
      <div className="flex-between mb-16">
        <span className="text-muted text-sm">
          {selectedRec
            ? `Showing recommendation from ${selectedRec.created_at.slice(11, 19)} UTC`
            : "No recommendations yet"}
        </span>
        <button className="btn btn-primary" onClick={handleCreateAndInvoke} disabled={!!action}>
          {action || "Run Operational Assessment"}
        </button>
      </div>

      {approvedPills.length === 0 && (
        <div className="callout callout-warning">
          No approved Intelligence Pills found. Seed the backend first:
          <code className="code-inline"> python -m harvest.demo --seed-only --database data/review.db</code>
        </div>
      )}

      {selectedRec && (
        <RecommendationDetail
          rec={selectedRec}
          opsPill={opsPill}
          tenantPill={tenantPill}
          onDecisionRecorded={(updated) => {
            setSelectedRec(updated);
            setRecommendations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          }}
          onGoToEvolution={onGoToEvolution}
          onGoToPill={onGoToPill}
        />
      )}
    </div>
  );
}

// ---- Recommendation Detail (the main content area below the fold) ----

function RecommendationDetail({
  rec,
  opsPill,
  tenantPill,
  onDecisionRecorded,
  onGoToEvolution,
  onGoToPill,
}: {
  rec: RecommendationRecord;
  opsPill?: PillVersion;
  tenantPill?: PillVersion;
  onDecisionRecorded: (updated: RecommendationRecord) => void;
  onGoToEvolution?: (recId: string) => void;
  onGoToPill?: (pillId: string) => void;
}) {
  const { result, capabilities, observations, ai_explanation } = rec;
  const role = getRole();
  const governanceExpanded = role === "expert" || role === "reviewer" || role === "approver";

  const decisionBadge = (d: string) => {
    if (d === "ESCALATE") return <span className="badge badge-warning">Escalate</span>;
    if (d === "HUMAN_REVIEW") return <span className="badge badge-info">Needs review</span>;
    return <span className="badge badge-neutral">Abstain</span>;
  };

  const escalationRoles = extractEscalationRoles(result.escalations);
  const isEscalation = result.decision === "ESCALATE";

  const tenantCap = capabilities.find((c) => c.pill_id === TENANT_ID);
  const opsCap = capabilities.find((c) => c.pill_id === OPS_ID);
  const accessPlanBlocked = result.blocked_actions.includes("review_access_plan");
  const tenantBlockedAccess = tenantCap?.blocked_actions.includes("review_access_plan");
  const showConflict = accessPlanBlocked && tenantBlockedAccess;

  return (
    <div>
      {/* Source attribution — WHO decided */}
      <div className="source-attribution">
        <span className="source-label">This recommendation comes from:</span>
        {capabilities.map((cap, i) => (
          <span key={cap.pill_id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {i > 0 && <span className="text-muted">+</span>}
            {onGoToPill ? (
              <span className="pill-link" onClick={() => onGoToPill(cap.pill_id)}>
                {pillLabel(cap.pill_id)}
              </span>
            ) : (
              <span className="text-dim">{pillLabel(cap.pill_id)}</span>
            )}
            <span className="source-version">v{cap.version}</span>
          </span>
        ))}
        <span className="text-muted">— approved expert rules, deterministic evaluation</span>
      </div>

      {/* Escalation banner */}
      {isEscalation && (
        <div className="escalation-banner">
          <span className="escalation-title">Escalation Required</span>
          <span className="no-exec-chip">No autonomous execution</span>
          {escalationRoles.length > 0 && (
            <div className="flex gap-8 flex-wrap" style={{ alignItems: "center" }}>
              <span className="text-muted text-sm">Escalate to:</span>
              {escalationRoles.map((role) => (
                <span key={role} className="escalation-role-chip">{role}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Key heuristic quote — near the top, attributed */}
      {opsCap && opsCap.trace.some((t) => t.rule_id === "running-is-not-draining") && (
        <div className="heuristic-callout">
          <div className="heuristic-label">Key Expert Heuristic</div>
          <div className="heuristic-text">
            &ldquo;A running pump indication does not prove effective drainage.&rdquo;
          </div>
          <div className="text-muted text-sm mt-8">
            — {pillLabel(OPS_ID)} v{opsCap.version}
          </div>
        </div>
      )}

      {/* Cross-domain conflict card — most prominent element after the summary */}
      {showConflict && (
        <div className="conflict-card">
          <div className="conflict-side conflict-side-proposes">
            <div className="conflict-domain"><DomainIcon domain="Asset Operations" size={26} /> Asset Operations proposes</div>
            <div className="conflict-action">Review access plan</div>
            <div className="conflict-reason">
              The pill recommends reviewing the alternative access route to keep tenants safe.
            </div>
          </div>
          <div className="conflict-divider">→</div>
          <div className="conflict-side conflict-side-blocks">
            <div className="conflict-domain"><DomainIcon domain="Tenant Experience" size={26} /> Tenant Experience blocks</div>
            <div className="conflict-action">Access plan blocked</div>
            <div className="conflict-reason">
              The alternative route is unverified. Tenant Experience blocks the access plan until
              it is confirmed safe.
            </div>
          </div>
        </div>
      )}

      {/* Escalation outcome — who must act */}
      {escalationRoles.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Who Must Act</span>
          </div>
          <div className="card-body">
            <div className="flex gap-8 flex-wrap">
              {escalationRoles.map((role) => (
                <span key={role} className="escalation-role-chip">{role}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recommended actions */}
      {result.actions.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recommended Actions</span>
            <span className="card-meta">{result.actions.length} actions · all require human authorization</span>
          </div>
          <div className="card-body">
            <div className="action-list">
              {result.actions.map((a) => (
                <div key={a.id} className="action-item">
                  <div className="action-item-content">
                    <div className="action-item-title">{actionLabel(a.id)}</div>
                    <div className="action-item-desc">{a.description}</div>
                  </div>
                  <span className="badge badge-warning">Authorization required</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Blocked actions */}
      {result.blocked_actions.length > 0 && (
        <div className="callout callout-danger">
          <strong>Blocked actions:</strong>{" "}
          {result.blocked_actions.map(actionLabel).join(", ")}
        </div>
      )}

      {/* Collapsible: Evidence — Observations */}
      <Collapsible title="Evidence — Verified Observations" meta={`${Object.keys(observations).length} observations`} defaultOpen={governanceExpanded}>
        <div className="obs-grid">
          {Object.entries(observations).map(([key, obs]) => (
            <div key={key} className="obs-tile">
              <div className="obs-tile-label">{obsLabel(key)}</div>
              <div className="obs-tile-value">
                {String(obs.value)}{obs.unit ? ` ${obs.unit}` : ""}
              </div>
              <div className="obs-tile-meta">
                {obs.quality} · {obs.observed_at.slice(11, 19)} UTC
              </div>
              <div className="obs-tile-meta">{obs.source}</div>
            </div>
          ))}
        </div>
      </Collapsible>

      {/* Collapsible: Rule Trace */}
      <Collapsible title="Rule Trace — Why This Fired" meta={`${capabilities.reduce((n, c) => n + c.trace.length, 0)} rules fired`} defaultOpen={governanceExpanded}>
        {capabilities.map((cap) => (
          <div key={cap.pill_id} className="mb-16">
            <div className="flex-between mb-8">
              <div>
                <div className="pill-prov-name">{pillLabel(cap.pill_id)}</div>
                <div className="tech-meta">{cap.pill_id}</div>
              </div>
              {decisionBadge(cap.decision)}
            </div>
            {cap.trace.length === 0 ? (
              <div className="text-muted text-sm">No rules fired.</div>
            ) : (
              cap.trace.map((t, i) => (
                <div key={i} className={`rule-card ${t.category}`}>
                  <div className="rule-card-head">
                    <div>
                      <span className="rule-card-name">{ruleLabel(t.rule_id)}</span>
                      <div className="tech-meta">{t.rule_id}</div>
                    </div>
                    <span className="rule-card-category">{t.category}</span>
                  </div>
                  <div className="rule-card-rationale">{t.rationale}</div>
                  <div className="rule-card-evidence">
                    Evidence: {t.evidence_ids.map(evidenceLabel).join(", ")}
                    {" ("}
                    {t.evidence_ids.join(", ")}
                    {")"}
                  </div>
                  <div className="rule-card-evidence mt-8">
                    Matched:{" "}
                    {Object.entries(t.observations).map(([k, o]) => (
                      <span key={k} style={{ marginLeft: 6 }}>
                        {obsLabel(k)}={String(o.value)}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
            {cap.escalations.length > 0 && (
              <div className="callout callout-warning mt-8">
                <strong>Escalations:</strong>{" "}
                {cap.escalations.map((esc) => {
                  const colonIdx = esc.indexOf(":");
                  const ruleId = colonIdx >= 0 ? esc.slice(0, colonIdx) : "";
                  const role = colonIdx >= 0 ? esc.slice(colonIdx + 1).trim() : esc;
                  return ruleId ? `${ruleLabel(ruleId)} → ${role}` : role;
                }).join("; ")}
              </div>
            )}
            {cap.blocked_actions.length > 0 && (
              <div className="callout callout-danger mt-8">
                <strong>Blocked by this capability:</strong>{" "}
                {cap.blocked_actions.map(actionLabel).join(", ")}
              </div>
            )}
          </div>
        ))}
      </Collapsible>

      {/* Collapsible: Pill Provenance */}
      <Collapsible title="Pill Provenance — Exact Versions & Hashes" meta={`${capabilities.length} capabilities`} defaultOpen={governanceExpanded}>
        {capabilities.map((cap) => {
          const pill = cap.pill_id === OPS_ID ? opsPill : cap.pill_id === TENANT_ID ? tenantPill : undefined;
          return (
            <div key={cap.pill_id} className="pill-provenance">
              <div className="pill-prov-header">
                <div>
                  <div className="pill-prov-name">{pillLabel(cap.pill_id)}</div>
                  <div className="tech-meta">{cap.pill_id}</div>
                </div>
                <span className="badge badge-success">Approved</span>
              </div>
              <div className="kv">
                <div><dt>Version</dt><dd>{cap.version}</dd></div>
                <div><dt>Domain</dt><dd>{cap.domain}</dd></div>
                {pill && (
                  <>
                    <div><dt>Owner</dt><dd>{pill.owner}</dd></div>
                    <div><dt>Reviewers</dt><dd>{pill.reviewers.join(", ")}</dd></div>
                    <div><dt>Author</dt><dd>{pill.author}</dd></div>
                    <div><dt>Change Reason</dt><dd>{pill.change_reason}</dd></div>
                  </>
                )}
              </div>
              <div className="mt-8 kv kv-tech">
                <div><dt>Content Hash</dt><dd>{cap.content_hash}</dd></div>
                {pill && (
                  <div><dt>Created</dt><dd>{pill.created_at.slice(0, 19).replace("T", " ")} UTC</dd></div>
                )}
              </div>
            </div>
          );
        })}
      </Collapsible>

      {/* Collapsible: Boundaries */}
      <Collapsible title="Boundaries — Prohibited Actions & Guardrails" defaultOpen={governanceExpanded}>
        {capabilities.map((cap) => (
          <div key={cap.pill_id} className="mb-16">
            <div className="pill-prov-name mb-8">{pillLabel(cap.pill_id)}</div>
            <ul className="boundary-list">
              {cap.boundaries.map((b, i) => (
                <li key={i}>
                  <span className="boundary-icon">×</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="callout callout-info mt-8">
          <strong>execution_allowed = false</strong> — No equipment control, access changes, tenant
          messaging, or knowledge release is authorised by this system.
        </div>
      </Collapsible>

      {/* Human Decision Area */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Your decision</span>
        </div>
        <div className="card-body">
          <HumanDecisionArea
            rec={rec}
            isEscalation={isEscalation}
            escalationRoles={escalationRoles}
            onDecisionRecorded={onDecisionRecorded}
            onGoToEvolution={onGoToEvolution}
          />
        </div>
      </div>

      {/* AI Explanation — visually distinct, clearly labelled non-authoritative */}
      {ai_explanation && (
        <div className="ai-explanation-box">
          <div className="card-header">
            <span className="card-title">AI Explanation — not authoritative</span>
            <span className="badge badge-neutral">Advisory only</span>
          </div>
          <div className="card-body">
            <div className="callout callout-info">
              This AI narrative is advisory only. The deterministic rule trace and governance
              records above are authoritative.
            </div>
            <div className="mt-8">
              <strong>Summary:</strong> {ai_explanation.summary}
            </div>
            <div className="mt-8">
              <strong>Uncertainty:</strong> {ai_explanation.uncertainty}
            </div>
          </div>
        </div>
      )}

      {/* Technical metadata */}
      <Collapsible title="Technical Details" defaultOpen={governanceExpanded}>
        <div className="kv kv-tech">
          <div><dt>Execution Allowed</dt><dd>{String(result.execution_allowed)}</dd></div>
          <div><dt>Evaluated At</dt><dd>{rec.evaluated_at?.slice(0, 19).replace("T", " ") ?? "—"} UTC</dd></div>
          <div><dt>Valid Until</dt><dd>{rec.valid_until?.slice(0, 19).replace("T", " ") ?? "—"} UTC</dd></div>
          <div><dt>Recommendation ID</dt><dd>{rec.id}</dd></div>
          <div><dt>Case ID</dt><dd>{rec.case_id}</dd></div>
          <div><dt>Actor</dt><dd>{capitaliseActor(rec.actor)}</dd></div>
        </div>
      </Collapsible>
    </div>
  );
}

// ---- Human Decision Area ----

const DEFAULT_ESCALATION_NOTE =
  "Escalated to Duty Facilities Engineer and Tenant Duty Manager for coordinated response.";

function HumanDecisionArea({
  rec,
  isEscalation,
  escalationRoles,
  onDecisionRecorded,
  onGoToEvolution,
}: {
  rec: RecommendationRecord;
  isEscalation: boolean;
  escalationRoles: string[];
  onDecisionRecorded: (updated: RecommendationRecord) => void;
  onGoToEvolution?: (recId: string) => void;
}) {
  const [note, setNote] = useState(DEFAULT_ESCALATION_NOTE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showRecordAction = isEscalation && !rec.human_decision;
  const isOperator = getRole() === "operator";

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await recordDecision(rec.id, "escalate", note);
      setActiveRec(rec.id);
      const updated = await getRecommendation(rec.id);
      onDecisionRecorded(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="decision-area">
      <div className="decision-area-header">
        {rec.human_decision ? "Escalation Recorded" : "Your Decision Required"}
      </div>

      {rec.human_decision ? (
        <div>
          {onGoToEvolution && (
            <div className="confirmation-banner">
              <span className="confirmation-text">Escalation recorded.</span>
              <span className="next-step-link" onClick={() => onGoToEvolution(rec.id)}>
                Next: record the outcome →
              </span>
            </div>
          )}
          <div className="flex gap-8 mb-16 flex-wrap">
            <span className="badge badge-warning">Escalated</span>
            <span className="no-exec-chip">Execution remains disabled</span>
          </div>
          <div className="kv">
            <div><dt>Decision</dt><dd>Escalated</dd></div>
            <div><dt>Accountable Actor</dt><dd>{capitaliseActor(rec.human_decision.actor)}</dd></div>
            <div><dt>Note</dt><dd>{rec.human_decision.note}</dd></div>
          </div>
          <div className="mt-8 kv kv-tech">
            <div><dt>Execution Allowed</dt><dd>{String(rec.human_decision.execution_allowed)}</dd></div>
            <div><dt>Raw Decision</dt><dd>{rec.human_decision.decision}</dd></div>
          </div>
        </div>
      ) : showRecordAction ? (
        <div>
          <div className="text-dim mb-16">
            This recommendation requires escalation. Routine approval is blocked by the system.
            Record the escalation to complete the audit trail.
          </div>

          {escalationRoles.length > 0 && (
            <div className="mb-16">
              <div className="section-heading">Escalate To</div>
              <div className="flex gap-8 flex-wrap mt-8">
                {escalationRoles.map((role) => (
                  <span key={role} className="escalation-role-chip">{role}</span>
                ))}
              </div>
            </div>
          )}

          {!isOperator && (
            <div className="callout callout-warning mb-16">
              Operator role required to record an operational decision. Current role:{" "}
              <strong>{getRole()}</strong>.
            </div>
          )}

          <div className="mb-16">
            <div className="section-heading">Operator Note</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="note-input"
              placeholder="Enter escalation note…"
              disabled={submitting || !isOperator}
            />
          </div>

          {error && (
            <div className="error-box mb-16">
              <strong>Failed to record escalation:</strong> {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !note.trim() || !isOperator}
          >
            {submitting ? "Recording…" : "Record Escalation"}
          </button>
        </div>
      ) : (
        <div className="text-muted">No decision recorded yet.</div>
      )}

      {rec.outcome && (
        <div className="mt-16">
          <div className="section-heading">Outcome</div>
          <div className="kv">
            <div><dt>Summary</dt><dd>{rec.outcome.summary}</dd></div>
            <div><dt>Resolved</dt><dd>{String(rec.outcome.resolved)}</dd></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Collapsible component ----

function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""}`}>
      <div className="collapsible-trigger" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <div className="flex gap-16" style={{ alignItems: "center" }}>
          {meta && <span className="text-muted text-sm">{meta}</span>}
          <span className="collapsible-chevron">▼</span>
        </div>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
