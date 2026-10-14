import { useState, useEffect, useCallback } from "react";
import type {
  CaseRecord,
  RecommendationRecord,
  PillVersion,
  Observation,
} from "../types";
import {
  getCases,
  getRecommendations,
  getPills,
  invokeCase,
  createCase,
} from "../api";

const OPS_ID = "asset.monsoon.triage";
const TENANT_ID = "tenant.incident.continuity";

// --- Human-readable label maps ---

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

// Extract escalation role from escalation strings like "rule_id: Role Name"
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

// Synthetic demo observations matching harvest/fixtures.py demo_case()
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
    title: "SYNTHETIC: Green pump indicator, rising basement water",
    asset_id: "harbour-exchange-demo",
    asset_type: "office",
    equipment: "basement_sump",
    context: "wet_weather",
    observations: buildDemoObservations(),
    synthetic: true,
  };
}

export function OperationalCase() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
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
      if (cs.length > 0 && !selectedCaseId) {
        setSelectedCaseId(cs[cs.length - 1].id);
      }
      if (rs.length > 0 && !selectedRec) {
        setSelectedRec(rs[rs.length - 1]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCaseId, selectedRec]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateAndInvoke = async () => {
    setAction("Running assessment...");
    setError(null);
    try {
      const newCase = await createCase(buildCaseBody());
      const rec = await invokeCase(newCase.id, [OPS_ID, TENANT_ID], true);
      setSelectedCaseId(newCase.id);
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
      const rec = recommendations.find((r) => r.id === id);
      if (rec) setSelectedRec(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && cases.length === 0) {
    return <div className="loading">Loading operational data from backend...</div>;
  }

  if (error && cases.length === 0) {
    return (
      <div>
        <div className="error-box">
          <strong>Backend connection error:</strong> {error}
        </div>
        <div className="callout callout-info">
          Ensure the backend is running: <code className="mono">python -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000</code>
          <br />
          And seeded: <code className="mono">python -m harvest.demo --seed-only --database data/review.db</code>
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
        <div>
          <div className="case-title">Harbour Exchange — Basement Sump, Wet Weather</div>
          <div className="case-subtitle">
            Synthetic office asset · harbour-exchange-demo · basement_sump · wet_weather
          </div>
        </div>
        <div className="flex gap-8 flex-wrap">
          <span className="badge badge-green">PUMP: RUNNING</span>
          <span className="badge badge-amber">WATER: RISING (3 mm/min)</span>
          <span className="badge badge-gray">CRITICAL EQUIPMENT: NOT EXPOSED</span>
          <span className="badge badge-red">ACCESS PLAN: BLOCKED</span>
        </div>
      </div>

      {/* Incident summary */}
      <div className="incident-summary">
        Pump reports RUNNING, but water is still rising. AI HARVEST requires escalation.
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Action bar */}
      <div className="flex-between mb-16">
        <div className="flex gap-8">
          {recommendations.length > 0 && (
            <select
              value={selectedRec?.id ?? ""}
              onChange={(e) => handleSelectRec(e.target.value)}
              className="btn"
              style={{ minWidth: 300 }}
            >
              {recommendations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.result.decision} · {r.created_at.slice(11, 19)}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleCreateAndInvoke}
          disabled={!!action}
        >
          {action || "Run Operational Assessment"}
        </button>
      </div>

      {/* Approved pills summary */}
      {approvedPills.length === 0 && (
        <div className="callout callout-warning">
          No approved Intelligence Pills found. Seed the backend first:
          <code className="mono"> python -m harvest.demo --seed-only --database data/review.db</code>
        </div>
      )}

      {selectedRec && (
        <RecommendationHierarchy
          rec={selectedRec}
          opsPill={opsPill}
          tenantPill={tenantPill}
        />
      )}
    </div>
  );
}

// --- Recommendation Hierarchy Component ---

function RecommendationHierarchy({
  rec,
  opsPill,
  tenantPill,
}: {
  rec: RecommendationRecord;
  opsPill?: PillVersion;
  tenantPill?: PillVersion;
}) {
  const { result, capabilities, observations, ai_explanation } = rec;

  const decisionBadge = (d: string) => {
    if (d === "ESCALATE") return <span className="badge badge-amber">ESCALATE</span>;
    if (d === "HUMAN_REVIEW") return <span className="badge badge-blue">HUMAN REVIEW</span>;
    return <span className="badge badge-gray">ABSTAIN</span>;
  };

  const escalationRoles = extractEscalationRoles(result.escalations);
  const isEscalation = result.decision === "ESCALATE";

  // Check for the specific tenant conflict
  const tenantCap = capabilities.find((c) => c.pill_id === TENANT_ID);
  const accessPlanBlocked = result.blocked_actions.includes("review_access_plan");
  const tenantBlockedAccess = tenantCap?.blocked_actions.includes("review_access_plan");

  return (
    <div>
      {/* Escalation banner */}
      {isEscalation && (
        <div className="escalation-banner">
          <span className="escalation-banner-title">ESCALATION REQUIRED</span>
          <span className="no-exec-badge">No autonomous execution</span>
          {escalationRoles.length > 0 && (
            <span className="escalation-role">
              <span className="escalation-role-label">Escalate to:</span>
              {escalationRoles.join(" · ")}
            </span>
          )}
        </div>
      )}

      {/* Tenant conflict callout */}
      {accessPlanBlocked && tenantBlockedAccess && (
        <div className="conflict-callout">
          <div className="conflict-callout-title">
            Capability Conflict: Access Plan Blocked by Tenant Experience
          </div>
          <div className="conflict-callout-body">
            Asset Operations recommends <strong>Review access plan</strong>, but
            Tenant Experience <strong>blocks</strong> it because the alternative
            route is <strong>unverified</strong>. The combined result escalates
            to the tenant duty manager.
          </div>
        </div>
      )}

      {/* Step 1: Recommendation */}
      <HierarchyStep number={1} label="Recommendation">
        <div className="panel">
          <div className="panel-header">
            <span>Combined Decision</span>
            {decisionBadge(result.decision)}
          </div>
          <div className="panel-body">
            <div className="kv kv-prominent">
              <div>
                <dt>Decision</dt>
                <dd>{result.decision}</dd>
              </div>
              <div>
                <dt>Human Responsibility</dt>
                <dd>{result.human_responsibility}</dd>
              </div>
            </div>

            {result.actions.length > 0 && (
              <div className="mt-16">
                <div className="hierarchy-label">Recommended Actions</div>
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Description</th>
                      <th>Human Approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.actions.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="action-label">{actionLabel(a.id)}</div>
                          <div className="tech-meta">{a.id}</div>
                        </td>
                        <td className="action-desc">{a.description}</td>
                        <td>
                          <span className="badge badge-amber">REQUIRED</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.blocked_actions.length > 0 && (
              <div className="mt-16">
                <div className="callout callout-danger">
                  <strong>Blocked Actions:</strong>{" "}
                  {result.blocked_actions.map(actionLabel).join(", ")}
                </div>
              </div>
            )}

            {result.escalations.length > 0 && (
              <div className="mt-16">
                <div className="hierarchy-label">Escalations</div>
                <ul className="boundary-list">
                  {result.escalations.map((esc, i) => {
                    const colonIdx = esc.indexOf(":");
                    const ruleId = colonIdx >= 0 ? esc.slice(0, colonIdx) : "";
                    const role = colonIdx >= 0 ? esc.slice(colonIdx + 1).trim() : esc;
                    return (
                      <li key={i}>
                        <span className="boundary-icon">!</span>
                        <span>
                          {ruleId && (
                            <>
                              <strong>{ruleLabel(ruleId)}</strong>
                              {" — "}
                            </>
                          )}
                          Escalate to <strong>{role}</strong>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Technical metadata (de-emphasized) */}
            <div className="mt-16 kv kv-tech">
              <div>
                <dt>Execution Allowed</dt>
                <dd>{String(result.execution_allowed)}</dd>
              </div>
              <div>
                <dt>Evaluated At</dt>
                <dd>{rec.evaluated_at?.slice(0, 19).replace("T", " ")} UTC</dd>
              </div>
              <div>
                <dt>Valid Until</dt>
                <dd>{rec.valid_until?.slice(0, 19).replace("T", " ")} UTC</dd>
              </div>
              <div>
                <dt>Recommendation ID</dt>
                <dd>{rec.id}</dd>
              </div>
            </div>
          </div>
        </div>
      </HierarchyStep>

      {/* Step 2: Evidence (Observations) */}
      <HierarchyStep number={2} label="Evidence — Verified Observations">
        <div className="panel">
          <div className="panel-header">
            <span>Observed Inputs</span>
            <span className="text-sm text-dim">{Object.keys(observations).length} observations</span>
          </div>
          <div className="panel-body">
            <div className="obs-grid">
              {Object.entries(observations).map(([key, obs]) => (
                <div key={key} className="obs-item">
                  <div className="obs-label">{obsLabel(key)}</div>
                  <div className="obs-key-meta">{key}</div>
                  <div className="obs-value">
                    {String(obs.value)}{obs.unit ? ` ${obs.unit}` : ""}
                  </div>
                  <div className="obs-meta">
                    {obs.quality} · {obs.observed_at.slice(11, 19)} UTC
                  </div>
                  <div className="obs-meta">{obs.source}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </HierarchyStep>

      {/* Step 3: Rule Trace */}
      <HierarchyStep number={3} label="Rule Trace — Why This Fired">
        <div className="panel">
          <div className="panel-header">
            <span>Deterministic Rule Evaluation</span>
            <span className="text-sm text-dim">{capabilities.reduce((n, c) => n + c.trace.length, 0)} rules fired</span>
          </div>
          <div className="panel-body">
            {capabilities.map((cap) => (
              <div key={cap.pill_id} className="mb-16">
                <div className="flex-between mb-8">
                  <div>
                    <div className="pill-display-name">{pillLabel(cap.pill_id)}</div>
                    <div className="pill-id-meta">{cap.pill_id}</div>
                  </div>
                  {decisionBadge(cap.decision)}
                </div>
                {cap.trace.length === 0 ? (
                  <div className="text-dim text-sm">No rules fired.</div>
                ) : (
                  cap.trace.map((t, i) => (
                    <div key={i} className={`rule-trace-item ${t.category}`}>
                      <div className="flex-between">
                        <div>
                          <span className="rule-label">{ruleLabel(t.rule_id)}</span>
                          <div className="tech-meta">{t.rule_id}</div>
                        </div>
                        <span className="rule-category">{t.category}</span>
                      </div>
                      <div className="rule-rationale">{t.rationale}</div>
                      <div className="rule-evidence">
                        Evidence: {t.evidence_ids.map(evidenceLabel).join(", ")}
                        <span className="tech-meta" style={{ marginLeft: 8 }}>
                          ({t.evidence_ids.join(", ")})
                        </span>
                      </div>
                      <div className="rule-evidence mt-8">
                        Matched conditions:
                        {Object.entries(t.observations).map(([k, o]) => (
                          <span key={k} style={{ marginLeft: 8 }}>
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
          </div>
        </div>
      </HierarchyStep>

      {/* Step 4: Pill Provenance */}
      <HierarchyStep number={4} label="Pill Provenance — Exact Versions & Hashes">
        <div className="panel">
          <div className="panel-header">
            <span>Intelligence Pills Used</span>
            <span className="text-sm text-dim">{capabilities.length} capabilities</span>
          </div>
          <div className="panel-body">
            {capabilities.map((cap) => {
              const pill = cap.pill_id === OPS_ID ? opsPill : cap.pill_id === TENANT_ID ? tenantPill : undefined;
              return (
                <div key={cap.pill_id} className="pill-card">
                  <div className="pill-card-header">
                    <div>
                      <div className="pill-display-name">{pillLabel(cap.pill_id)}</div>
                      <div className="pill-id-meta">{cap.pill_id}</div>
                    </div>
                    <span className="badge badge-green">APPROVED</span>
                  </div>
                  <div className="kv kv-prominent">
                    <div>
                      <dt>Version</dt>
                      <dd>{cap.version}</dd>
                    </div>
                    <div>
                      <dt>Domain</dt>
                      <dd>{cap.domain}</dd>
                    </div>
                    {pill && (
                      <>
                        <div>
                          <dt>Owner</dt>
                          <dd>{pill.owner}</dd>
                        </div>
                        <div>
                          <dt>Reviewers</dt>
                          <dd>{pill.reviewers.join(", ")}</dd>
                        </div>
                        <div>
                          <dt>Author</dt>
                          <dd>{pill.author}</dd>
                        </div>
                        <div>
                          <dt>Change Reason</dt>
                          <dd>{pill.change_reason}</dd>
                        </div>
                      </>
                    )}
                  </div>
                  {/* Technical metadata (de-emphasized) */}
                  <div className="mt-8 kv kv-tech">
                    <div>
                      <dt>Content Hash</dt>
                      <dd>{cap.content_hash}</dd>
                    </div>
                    {pill && (
                      <div>
                        <dt>Created</dt>
                        <dd>{pill.created_at.slice(0, 19).replace("T", " ")} UTC</dd>
                      </div>
                    )}
                  </div>
                  {pill && (
                    <div className="mt-8">
                      <div className="hierarchy-label">Pill Evidence</div>
                      <table>
                        <thead>
                          <tr>
                            <th>Evidence</th>
                            <th>Kind</th>
                            <th>Citation</th>
                            <th>Synthetic</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cap.evidence.map((e) => (
                            <tr key={e.id}>
                              <td>
                                <div className="human-label">{evidenceLabel(e.id)}</div>
                                <div className="tech-meta">{e.id}</div>
                              </td>
                              <td>{e.kind}</td>
                              <td className="text-sm">{e.citation}</td>
                              <td>{e.synthetic ? "true" : "false"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </HierarchyStep>

      {/* Step 5: Boundaries */}
      <HierarchyStep number={5} label="Boundaries — Prohibited Actions & Guardrails">
        <div className="panel">
          <div className="panel-header">
            <span>Operational Boundaries</span>
          </div>
          <div className="panel-body">
            {capabilities.map((cap) => (
              <div key={cap.pill_id} className="mb-16">
                <div className="pill-display-name mb-8">{pillLabel(cap.pill_id)}</div>
                <ul className="boundary-list">
                  {cap.boundaries.map((b, i) => (
                    <li key={i}>
                      <span className="boundary-icon">!</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="callout callout-info mt-8">
              <strong>execution_allowed = false</strong> — No equipment control, access changes,
              tenant messaging, or knowledge release is authorised by this system.
            </div>
          </div>
        </div>
      </HierarchyStep>

      {/* Step 6: Human Decision Area */}
      <HierarchyStep number={6} label="Accountable Human Decision Area">
        <div className="decision-area">
          <div className="decision-area-header">
            <span>Human Decision Required</span>
          </div>
          {rec.human_decision ? (
            <div className="kv kv-prominent">
              <div>
                <dt>Decision</dt>
                <dd>{rec.human_decision.decision}</dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>{rec.human_decision.note}</dd>
              </div>
              <div>
                <dt>Actor</dt>
                <dd>{rec.human_decision.actor}</dd>
              </div>
            </div>
          ) : (
            <div className="text-dim" style={{ fontSize: 14 }}>
              No human decision recorded yet. This recommendation requires escalation —
              routine approval is blocked by the system.
            </div>
          )}
          {rec.outcome && (
            <div className="mt-16">
              <div className="hierarchy-label">Outcome</div>
              <div className="kv kv-prominent">
                <div>
                  <dt>Summary</dt>
                  <dd>{rec.outcome.summary}</dd>
                </div>
                <div>
                  <dt>Resolved</dt>
                  <dd>{String(rec.outcome.resolved)}</dd>
                </div>
              </div>
            </div>
          )}
          {/* Technical metadata */}
          {rec.human_decision && (
            <div className="mt-8 kv kv-tech">
              <div>
                <dt>Execution Allowed</dt>
                <dd>{String(rec.human_decision.execution_allowed)}</dd>
              </div>
            </div>
          )}
        </div>
      </HierarchyStep>

      {/* AI Explanation (non-authoritative) */}
      {ai_explanation && (
        <div className="panel mt-16">
          <div className="panel-header">
            <span>AI Explanation</span>
            <span className="badge badge-gray">NON-AUTHORITATIVE</span>
          </div>
          <div className="panel-body">
            <div className="ai-disclaimer">
              <div className="ai-disclaimer-header">
                <span className="badge badge-gray">ADVISORY ONLY</span>
                <span>This AI narrative is not an executable command. Deterministic rule trace and governance records above are authoritative.</span>
              </div>
              <div className="mb-8" style={{ fontSize: 14 }}>
                <strong>Summary:</strong> {ai_explanation.summary}
              </div>
              <div style={{ fontSize: 14 }}>
                <strong>Uncertainty:</strong> {ai_explanation.uncertainty}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HierarchyStep({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hierarchy-step">
      <div className="hierarchy-number">{number}</div>
      <div className="hierarchy-content">
        <div className="hierarchy-label">{label}</div>
        {children}
      </div>
    </div>
  );
}
