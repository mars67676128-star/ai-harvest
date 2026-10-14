import { useState, useEffect, useCallback } from "react";
import type { PillVersion, Status } from "../types";
import {
  getPills,
  getPillVersions,
  getAuditHistory,
  getRole,
  type AuditEntry,
} from "../api";

const PRIMARY_PILL_ID = "asset.monsoon.triage";

const STATUS_LABELS: Record<Status, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  DEPRECATED: "Deprecated",
};

function statusBadgeClass(status: Status): string {
  switch (status) {
    case "APPROVED": return "badge badge-green";
    case "IN_REVIEW": return "badge badge-blue";
    case "DRAFT": return "badge badge-gray";
    case "REJECTED": return "badge badge-red";
    case "SUPERSEDED": return "badge badge-gray";
    case "DEPRECATED": return "badge badge-red";
    default: return "badge badge-gray";
  }
}

const LIFECYCLE_STEPS: Status[] = ["DRAFT", "IN_REVIEW", "APPROVED"];

function lifecycleIndex(status: Status): number {
  if (status === "APPROVED") return 2;
  if (status === "IN_REVIEW") return 1;
  if (status === "DRAFT") return 0;
  // REJECTED, SUPERSEDED, DEPRECATED are off the happy path
  return -1;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}

function fmtHash(hash: string): string {
  if (!hash) return "—";
  return hash.length > 16 ? hash.slice(0, 12) + "…" : hash;
}

// --- Audit event label map ---

const AUDIT_EVENT_LABELS: Record<string, string> = {
  PILL_CREATED: "Pill Created",
  REVIEW_REQUESTED: "Submitted for Review",
  EXPERT_REVIEWED: "Reviewed",
  PILL_VALIDATED: "Validated",
  PILL_APPROVED: "Approved",
  PILL_REJECTED: "Rejected",
  PILL_DEPRECATED: "Deprecated",
  PILL_SUPERSEDED: "Superseded",
  PILL_INVOKED: "Invoked",
};

function auditEventLabel(event: string): string {
  return AUDIT_EVENT_LABELS[event] ?? event;
}

// Map audit events to lifecycle steps for the timeline
function auditEventToLifecycleStep(event: string): number {
  if (event === "PILL_CREATED" || event === "REVIEW_REQUESTED") return 0;
  if (event === "EXPERT_REVIEWED" || event === "PILL_VALIDATED") return 1;
  if (event === "PILL_APPROVED") return 2;
  return -1;
}

export function IntelligencePills() {
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [selectedPillId, setSelectedPillId] = useState<string>(PRIMARY_PILL_ID);
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await getPills();
      // Deduplicate by pill_id, keeping the latest version of each
      const byId = new Map<string, PillVersion>();
      for (const p of all) {
        const existing = byId.get(p.pill_id);
        if (!existing || p.version > existing.version) {
          byId.set(p.pill_id, p);
        }
      }
      const unique = Array.from(byId.values());
      setPills(unique);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPills();
  }, [loadPills]);

  // Load versions + audit for the selected pill
  useEffect(() => {
    if (!selectedPillId) return;
    let cancelled = false;
    (async () => {
      try {
        const vers = await getPillVersions(selectedPillId);
        if (!cancelled) setVersions(vers);
      } catch (e) {
        if (!cancelled) setVersions([]);
      }

      // Audit requires reviewer/approver role
      const role = getRole();
      if (role === "reviewer" || role === "approver") {
        setAuditError(null);
        try {
          // Audit entity_id is the pill_id (used as entity in governance transitions)
          const hist = await getAuditHistory(selectedPillId);
          if (!cancelled) setAuditEntries(hist.items);
        } catch (e) {
          if (!cancelled) {
            setAuditEntries([]);
            setAuditError(e instanceof Error ? e.message : String(e));
          }
        }
      } else {
        if (!cancelled) {
          setAuditEntries([]);
          setAuditError(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPillId]);

  if (loading && pills.length === 0) {
    return <div className="loading">Loading Intelligence Pill registry from backend…</div>;
  }

  if (error && pills.length === 0) {
    return (
      <div>
        <div className="error-box">
          <strong>Backend connection error:</strong> {error}
        </div>
        <div className="callout callout-info">
          Ensure the backend is running: <code className="mono">python -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000</code>
        </div>
      </div>
    );
  }

  // Find the selected pill's latest version (prefer APPROVED)
  const selectedPillVersions = versions.length > 0
    ? versions
    : pills.filter((p) => p.pill_id === selectedPillId);

  const approvedVersion = selectedPillVersions.find((p) => p.status === "APPROVED");
  const selectedPill = approvedVersion ?? selectedPillVersions[0];

  if (!selectedPill) {
    return (
      <div className="callout callout-warning">
        No Pill versions found for <code className="mono">{selectedPillId}</code>. Seed the backend first.
      </div>
    );
  }

  return (
    <div>
      {/* Pill Registry / Selector */}
      <PillRegistry
        pills={pills}
        selectedPillId={selectedPillId}
        onSelect={setSelectedPillId}
      />

      {/* Selected Pill Header */}
      <PillHeader pill={selectedPill} />

      {/* Governance Lifecycle */}
      <GovernanceLifecycle pill={selectedPill} auditEntries={auditEntries} auditError={auditError} />

      {/* Capability Definition sections */}
      <CapabilityDefinition pill={selectedPill} />

      {/* Evidence and Provenance */}
      <EvidenceProvenance pill={selectedPill} />

      {/* Regression / Validation Obligations */}
      <ValidationObligations pill={selectedPill} />

      {/* Version Lineage */}
      <VersionLineage versions={selectedPillVersions} currentVersion={selectedPill.version} />
    </div>
  );
}

// --- Pill Registry / Selector ---

function PillRegistry({
  pills,
  selectedPillId,
  onSelect,
}: {
  pills: PillVersion[];
  selectedPillId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Pill Registry</span>
        <span className="text-sm text-dim">{pills.length} Pills</span>
      </div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Pill Name</th>
              <th>Domain</th>
              <th>Version</th>
              <th>Status</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {pills.map((p) => (
              <tr
                key={p.pill_id}
                onClick={() => onSelect(p.pill_id)}
                style={{
                  cursor: "pointer",
                  background: p.pill_id === selectedPillId ? "rgba(59,130,246,0.08)" : undefined,
                }}
              >
                <td>
                  <div className="human-label">{p.content.name}</div>
                  <div className="tech-meta">{p.pill_id}</div>
                </td>
                <td>{p.content.domain}</td>
                <td className="text-mono">v{p.version}</td>
                <td><span className={statusBadgeClass(p.status)}>{STATUS_LABELS[p.status]}</span></td>
                <td>{p.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Selected Pill Header ---

function PillHeader({ pill }: { pill: PillVersion }) {
  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Selected Pill — Identity</span>
        <span className={statusBadgeClass(pill.status)}>{STATUS_LABELS[pill.status]}</span>
      </div>
      <div className="panel-body">
        <div className="flex-between mb-16">
          <div>
            <div className="pill-display-name">{pill.content.name}</div>
            <div className="pill-id-meta">{pill.pill_id}</div>
          </div>
          <div className="flex gap-8 flex-wrap">
            <span className="badge badge-blue">{pill.content.domain}</span>
            <span className="badge badge-gray">v{pill.version}</span>
            <span className={statusBadgeClass(pill.status)}>{STATUS_LABELS[pill.status]}</span>
          </div>
        </div>
        <div className="kv kv-prominent">
          <div>
            <dt>Domain</dt>
            <dd>{pill.content.domain}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>v{pill.version}</dd>
          </div>
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
            <dt>Description</dt>
            <dd>{pill.content.description}</dd>
          </div>
        </div>
        <div className="mt-8 kv kv-tech">
          <div>
            <dt>Content Hash</dt>
            <dd>{pill.content_hash}</dd>
          </div>
          <div>
            <dt>Schema Version</dt>
            <dd>{pill.content.schema_version}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{fmtDate(pill.created_at)}</dd>
          </div>
          <div>
            <dt>Previous Version</dt>
            <dd>{pill.previous_version ? `v${pill.previous_version}` : "—"}</dd>
          </div>
          <div>
            <dt>Change Reason</dt>
            <dd>{pill.change_reason}</dd>
          </div>
          <div>
            <dt>Synthetic</dt>
            <dd>{String(pill.content.synthetic)}</dd>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Governance Lifecycle ---

function GovernanceLifecycle({
  pill,
  auditEntries,
  auditError,
}: {
  pill: PillVersion;
  auditEntries: AuditEntry[];
  auditError: string | null;
}) {
  const currentStep = lifecycleIndex(pill.status);
  const role = getRole();
  const canSeeAudit = role === "reviewer" || role === "approver";

  // Filter audit entries to governance lifecycle events
  const lifecycleAudit = auditEntries.filter((a) =>
    ["PILL_CREATED", "REVIEW_REQUESTED", "EXPERT_REVIEWED", "PILL_VALIDATED", "PILL_APPROVED", "PILL_REJECTED", "PILL_DEPRECATED", "PILL_SUPERSEDED"]
      .includes(a.event)
  );

  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Governance Lifecycle</span>
        <span className="text-sm text-dim">Draft → In Review → Approved</span>
      </div>
      <div className="panel-body">
        {/* Lifecycle stepper */}
        <div className="lifecycle-stepper">
          {LIFECYCLE_STEPS.map((step, i) => {
            const isDone = currentStep >= 0 && i <= currentStep;
            const isCurrent = currentStep === i;
            return (
              <div
                key={step}
                className={`lifecycle-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}
              >
                <div className="lifecycle-dot" />
                <div className="lifecycle-label">{STATUS_LABELS[step]}</div>
              </div>
            );
          })}
        </div>

        {/* Audit-backed timeline */}
        {canSeeAudit ? (
          lifecycleAudit.length > 0 ? (
            <div className="mt-16">
              <div className="hierarchy-label">Governance Audit Trail</div>
              <ul className="timeline">
                {lifecycleAudit.map((entry, i) => (
                  <li
                    key={i}
                    className={`timeline-item ${auditEventToLifecycleStep(entry.event) >= 0 ? "active" : ""}`}
                  >
                    <div className="flex-between">
                      <div>
                        <span className="human-label">{auditEventLabel(entry.event)}</span>
                      </div>
                      <span className="timeline-time">{fmtDate(entry.created_at)}</span>
                    </div>
                    <div className="text-sm text-dim mt-8">
                      Actor: <strong>{entry.actor}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-dim text-sm mt-16">
              No governance audit entries available for this Pill.
            </div>
          )
        ) : (
          <div className="callout callout-info mt-16">
            <strong>Audit trail restricted.</strong> The current role ({role}) cannot access
            governance audit history. Switch to <strong>reviewer</strong> or{" "}
            <strong>approver</strong> to view the full lifecycle audit trail.
          </div>
        )}

        {auditError && (
          <div className="error-box mt-8">
            <strong>Audit access error:</strong> {auditError}
          </div>
        )}

        {/* Governance gates: Review / Validation / Approval */}
        <div className="mt-16">
          <div className="hierarchy-label">Governance Gates</div>
          <div className="grid-3 mt-8">
            <GovernanceGate
              title="Review"
              record={pill.review}
              summaryFields={["actor", "at", "content_hash", "note"]}
            />
            <GovernanceGate
              title="Validation"
              record={pill.validation}
              summaryFields={["actor", "at", "content_hash", "passed"]}
              extraSummary={(rec) => {
                const results = rec.results as Array<Record<string, unknown>> | undefined;
                if (!results) return null;
                const passed = results.filter((r) => r.passed === true).length;
                return `Regression: ${passed}/${results.length} cases passed`;
              }}
            />
            <GovernanceGate
              title="Approval"
              record={pill.approval}
              summaryFields={["actor", "at", "content_hash", "note"]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Governance Gate ---

const GATE_FIELD_LABELS: Record<string, string> = {
  actor: "Actor",
  at: "Timestamp",
  content_hash: "Content Hash",
  note: "Note",
  passed: "Validation Passed",
};

function GovernanceGate({
  title,
  record,
  summaryFields,
  extraSummary,
}: {
  title: string;
  record: Record<string, unknown> | null;
  summaryFields: string[];
  extraSummary?: (rec: Record<string, unknown>) => string | null;
}) {
  if (!record) {
    return (
      <div className="pill-card">
        <div className="pill-card-header">
          <span className="pill-card-name">{title}</span>
          <span className="badge badge-gray">PENDING</span>
        </div>
        <div className="text-dim text-sm">Not yet recorded.</div>
      </div>
    );
  }

  const passed = record.passed;
  const isValidation = title === "Validation";

  return (
    <div className="pill-card">
      <div className="pill-card-header">
        <span className="pill-card-name">{title}</span>
        {isValidation ? (
          passed === true ? (
            <span className="badge badge-green">PASSED</span>
          ) : passed === false ? (
            <span className="badge badge-red">FAILED</span>
          ) : (
            <span className="badge badge-gray">RECORDED</span>
          )
        ) : (
          <span className="badge badge-green">RECORDED</span>
        )}
      </div>
      <div className="kv kv-tech">
        {summaryFields.map((field) => {
          const val = record[field];
          if (val === undefined || val === null || val === "") return null;
          const display = field === "at"
            ? fmtDate(String(val))
            : field === "content_hash"
              ? fmtHash(String(val))
              : field === "passed"
                ? String(val)
                : String(val);
          return (
            <div key={field}>
              <dt>{GATE_FIELD_LABELS[field] ?? field}</dt>
              <dd>{display}</dd>
            </div>
          );
        })}
      </div>
      {extraSummary && (
        <div className="text-sm mt-8" style={{ color: "var(--text-dim)" }}>
          {extraSummary(record)}
        </div>
      )}
      <details className="mt-8">
        <summary className="tech-meta" style={{ cursor: "pointer" }}>Technical record</summary>
        <pre className="tech-meta mt-8" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {JSON.stringify(record, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// --- Capability Definition ---

function CapabilityDefinition({ pill }: { pill: PillVersion }) {
  const { content } = pill;
  const { scope, inputs, facts, expert_observations, assumptions, exceptions, rules, actions, prohibited_actions, guardrails, dependencies } = content;

  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Capability Definition</span>
        <span className="text-sm text-dim">{rules.length} rules · {actions.length} actions</span>
      </div>
      <div className="panel-body">
        {/* Applicability / Scope */}
        <div className="mb-16">
          <div className="hierarchy-label">Applicability & Scope</div>
          <div className="kv">
            <div><dt>Asset Types</dt><dd>{scope.asset_types.join(", ")}</dd></div>
            <div><dt>Equipment</dt><dd>{scope.equipment.join(", ")}</dd></div>
            <div><dt>Contexts</dt><dd>{scope.contexts.join(", ")}</dd></div>
            <div><dt>Prerequisites</dt><dd>{scope.prerequisites.join("; ")}</dd></div>
            <div><dt>Exclusions</dt><dd>{scope.exclusions.join("; ")}</dd></div>
          </div>
        </div>

        {/* Required Inputs */}
        <div className="mb-16">
          <div className="hierarchy-label">Required Inputs</div>
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th>Type</th>
                <th>Required</th>
                <th>Unit</th>
                <th>Max Age</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((inp) => (
                <tr key={inp.key}>
                  <td>
                    <div className="human-label">{inp.key.replace(/_/g, " ")}</div>
                    <div className="tech-meta">{inp.key}</div>
                    <div className="text-sm text-dim mt-8">{inp.description}</div>
                  </td>
                  <td className="text-mono">{inp.kind}</td>
                  <td>{inp.required ? <span className="badge badge-amber">REQUIRED</span> : "optional"}</td>
                  <td>{inp.unit || "—"}</td>
                  <td className="text-mono">{inp.max_age_seconds}s</td>
                  <td className="text-mono text-sm">
                    {inp.minimum !== null ? `${inp.minimum}` : "−∞"} … {inp.maximum !== null ? `${inp.maximum}` : "∞"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Expert Facts / Heuristics */}
        {(facts.length > 0 || expert_observations.length > 0 || assumptions.length > 0 || exceptions.length > 0) && (
          <div className="mb-16">
            <div className="hierarchy-label">Expert Facts & Heuristics</div>
            {facts.length > 0 && (
              <div className="mt-8">
                <div className="text-sm text-dim mb-8">Facts</div>
                <ul className="boundary-list">
                  {facts.map((f, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--accent)" }}>•</span><span>{f}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {expert_observations.length > 0 && (
              <div className="mt-8">
                <div className="text-sm text-dim mb-8">Expert Observations</div>
                <ul className="boundary-list">
                  {expert_observations.map((o, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--accent)" }}>•</span><span>{o}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {assumptions.length > 0 && (
              <div className="mt-8">
                <div className="text-sm text-dim mb-8">Assumptions</div>
                <ul className="boundary-list">
                  {assumptions.map((a, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--text-dim)" }}>•</span><span>{a}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {exceptions.length > 0 && (
              <div className="mt-8">
                <div className="text-sm text-dim mb-8">Exceptions</div>
                <ul className="boundary-list">
                  {exceptions.map((e, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--amber)" }}>•</span><span>{e}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Deterministic Rules */}
        <div className="mb-16">
          <div className="hierarchy-label">Deterministic Rules</div>
          {rules.map((r, i) => (
            <div key={i} className={`rule-trace-item ${r.category}`}>
              <div className="flex-between">
                <div>
                  <span className="rule-label">{r.id.replace(/_/g, " ")}</span>
                  <div className="tech-meta">{r.id}</div>
                </div>
                <span className="rule-category">{r.category}</span>
              </div>
              <div className="rule-rationale">{r.rationale}</div>
              <div className="rule-evidence mt-8">
                <strong>When:</strong>{" "}
                {r.when.map((w, j) => (
                  <span key={j} style={{ marginLeft: 8 }}>
                    {w.input} {w.op} {String(w.value)}
                    {j < r.when.length - 1 ? " ∧" : ""}
                  </span>
                ))}
              </div>
              {r.recommend.length > 0 && (
                <div className="rule-evidence">
                  <strong>Recommend:</strong> {r.recommend.join(", ")}
                </div>
              )}
              {r.block.length > 0 && (
                <div className="rule-evidence">
                  <strong>Block:</strong> {r.block.join(", ")}
                </div>
              )}
              {r.escalate_to && (
                <div className="rule-evidence">
                  <strong>Escalate to:</strong> {r.escalate_to}
                </div>
              )}
              <div className="rule-evidence">
                <strong>Evidence:</strong> {r.evidence_ids.join(", ")}
              </div>
            </div>
          ))}
        </div>

        {/* Recommended Actions */}
        <div className="mb-16">
          <div className="hierarchy-label">Recommended Actions</div>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Description</th>
                <th>Human Authorization</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="action-label">{a.id.replace(/_/g, " ")}</div>
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

        {/* Guardrails */}
        {guardrails.length > 0 && (
          <div className="mb-16">
            <div className="hierarchy-label">Guardrails</div>
            <ul className="boundary-list">
              {guardrails.map((g, i) => (
                <li key={i}>
                  <span className="boundary-icon" style={{ color: "var(--amber)" }}>!</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Prohibited Actions */}
        {prohibited_actions.length > 0 && (
          <div className="mb-16">
            <div className="hierarchy-label">Prohibited Actions</div>
            <ul className="boundary-list">
              {prohibited_actions.map((p, i) => (
                <li key={i}>
                  <span className="boundary-icon">×</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dependencies */}
        {dependencies.length > 0 && (
          <div className="mb-16">
            <div className="hierarchy-label">Dependencies</div>
            <table>
              <thead>
                <tr>
                  <th>Pill ID</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {dependencies.map((d, i) => (
                  <tr key={i}>
                    <td className="text-mono">{d.pill_id}</td>
                    <td className="text-mono">v{d.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Unresolved Questions & Contradictions */}
        {(content.unresolved_questions.length > 0 || content.contradictions.length > 0) && (
          <div className="mb-16">
            <div className="hierarchy-label">Open Questions & Contradictions</div>
            {content.unresolved_questions.length > 0 && (
              <div className="callout callout-warning mt-8">
                <strong>Unresolved:</strong> {content.unresolved_questions.join("; ")}
              </div>
            )}
            {content.contradictions.length > 0 && (
              <div className="callout callout-danger mt-8">
                <strong>Contradictions:</strong> {content.contradictions.join("; ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Evidence and Provenance ---

function EvidenceProvenance({ pill }: { pill: PillVersion }) {
  const { evidence } = pill.content;

  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Evidence & Provenance</span>
        <span className="text-sm text-dim">{evidence.length} items</span>
      </div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Evidence</th>
              <th>Type</th>
              <th>Citation / Source</th>
              <th>Summary</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="human-label">{e.id}</div>
                </td>
                <td>{e.kind.replace(/_/g, " ")}</td>
                <td className="text-sm">{e.citation}</td>
                <td className="text-sm text-dim">{e.summary}</td>
                <td>
                  {e.synthetic ? (
                    <span className="badge badge-amber">SYNTHETIC</span>
                  ) : (
                    <span className="badge badge-green">PUBLIC CONTEXT</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="callout callout-info mt-8">
          <strong>Provenance distinction:</strong> Synthetic evidence is a demo fixture, not a
          real expert interview. Public-context evidence provides background only and does not
          validate the Pill's rules.
        </div>
      </div>
    </div>
  );
}

// --- Regression / Validation Obligations ---

function ValidationObligations({ pill }: { pill: PillVersion }) {
  const { evaluation } = pill.content;

  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Regression / Validation Obligations</span>
        <span className="text-sm text-dim">{evaluation.length} cases</span>
      </div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Description</th>
              <th>Expected Decision</th>
              <th>Expected Actions</th>
              <th>Expected Blocks</th>
              <th>Scope</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.map((tc, i) => {
              const id = (tc.id as string) ?? `case-${i}`;
              const description = (tc.description as string) ?? "";
              const expectedDecision = (tc.expected_decision as string) ?? "";
              const expectedActions = (tc.expected_actions as string[]) ?? [];
              const expectedBlocked = (tc.expected_blocked as string[]) ?? [];
              const assetType = (tc.asset_type as string) ?? "";
              return (
                <tr key={i}>
                  <td>
                    <div className="human-label">{id}</div>
                  </td>
                  <td className="text-sm text-dim">{description}</td>
                  <td>
                    <span className={
                      expectedDecision === "ESCALATE" ? "badge badge-amber" :
                      expectedDecision === "HUMAN_REVIEW" ? "badge badge-blue" :
                      "badge badge-gray"
                    }>
                      {expectedDecision}
                    </span>
                  </td>
                  <td className="text-sm text-mono">
                    {expectedActions.length > 0 ? expectedActions.join(", ") : "—"}
                  </td>
                  <td className="text-sm text-mono">
                    {expectedBlocked.length > 0 ? expectedBlocked.join(", ") : "—"}
                  </td>
                  <td className="text-sm">{assetType}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="callout callout-info mt-8">
          Approved regression obligations are inherited by successor versions and cannot be
          silently removed or weakened.
        </div>
      </div>
    </div>
  );
}

// --- Version Lineage ---

function VersionLineage({
  versions,
  currentVersion,
}: {
  versions: PillVersion[];
  currentVersion: string;
}) {
  return (
    <div className="panel mb-16">
      <div className="panel-header">
        <span>Version Lineage</span>
        <span className="text-sm text-dim">{versions.length} version{versions.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="panel-body">
        {versions.length <= 1 ? (
          <div className="text-dim text-sm">
            Only <strong>v{currentVersion}</strong> exists at this point. No previous or successor versions have been published.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
                <th>Previous</th>
                <th>Change Reason</th>
                <th>Content Hash</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr
                  key={`${v.pill_id}:${v.version}`}
                  style={{
                    background: v.version === currentVersion ? "rgba(59,130,246,0.08)" : undefined,
                  }}
                >
                  <td>
                    <div className="human-label">v{v.version}</div>
                    {v.version === currentVersion && (
                      <span className="badge badge-blue" style={{ marginTop: 4 }}>CURRENT</span>
                    )}
                  </td>
                  <td><span className={statusBadgeClass(v.status)}>{STATUS_LABELS[v.status]}</span></td>
                  <td className="text-sm text-dim">{fmtDate(v.created_at)}</td>
                  <td className="text-mono text-sm">{v.previous_version ? `v${v.previous_version}` : "—"}</td>
                  <td className="text-sm text-dim">{v.change_reason}</td>
                  <td className="hash">{fmtHash(v.content_hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
