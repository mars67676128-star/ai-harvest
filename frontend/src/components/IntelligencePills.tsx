import { useState, useEffect, useCallback, Fragment } from "react";
import type { PillVersion, Status } from "../types";
import { downloadPillJson, printPillSheet } from "../lib/pillExport";
import { DomainIcon } from "./DomainIcon";
import { Term, Avatar } from "./Term";
import { persona } from "../lib/glossary";
import { actorLabel, sgTime, readingLabel, conditionsText, cleanText, isDemoDisclaimer } from "../lib/format";
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
    case "APPROVED": return "badge badge-success";
    case "IN_REVIEW": return "badge badge-info";
    case "DRAFT": return "badge badge-neutral";
    case "REJECTED": return "badge badge-danger";
    case "SUPERSEDED": return "badge badge-neutral";
    case "DEPRECATED": return "badge badge-danger";
    default: return "badge badge-neutral";
  }
}

const LIFECYCLE_STEPS: Status[] = ["DRAFT", "IN_REVIEW", "APPROVED"];

function lifecycleIndex(status: Status): number {
  if (status === "APPROVED") return 2;
  if (status === "IN_REVIEW") return 1;
  if (status === "DRAFT") return 0;
  return -1;
}

function fmtDate(iso: string | null): string {
  return sgTime(iso);
}

function fmtHash(hash: string): string {
  if (!hash) return "—";
  return hash.length > 16 ? hash.slice(0, 12) + "…" : hash;
}

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
  CANDIDATE_REVISION_CREATED: "Candidate Revision Created",
  AI_REVISION_PROPOSED: "AI Revision Proposed",
  KNOWLEDGE_CAPTURED: "Knowledge Captured",
  KNOWLEDGE_EXTRACTED: "Knowledge Extracted",
  CASE_CREATED: "Case Created",
  RECOMMENDATION_GENERATED: "Recommendation Generated",
  HUMAN_DECISION: "Human Decision Recorded",
  OUTCOME_RECORDED: "Outcome Recorded",
  FEEDBACK_SUBMITTED: "Feedback Submitted",
};

function auditEventLabel(event: string): string {
  return AUDIT_EVENT_LABELS[event] ?? event.replace(/_/g, " ");
}

function capitaliseActor(actor: string): string {
  return actorLabel(actor);
}

function auditEventToLifecycleStep(event: string): number {
  if (event === "PILL_CREATED" || event === "REVIEW_REQUESTED") return 0;
  if (event === "EXPERT_REVIEWED" || event === "PILL_VALIDATED") return 1;
  if (event === "PILL_APPROVED") return 2;
  return -1;
}

// --- Your work computation ---

interface YourWorkResult {
  label: string;
  count: number;
  emptyText: string;
}

function computeYourWork(role: string, pills: PillVersion[]): YourWorkResult {
  if (role === "reviewer") {
    const count = pills.filter((p) => p.status === "IN_REVIEW").length;
    return {
      label: "Pills awaiting your review",
      count,
      emptyText: "Nothing awaiting your review.",
    };
  }
  if (role === "approver") {
    const count = pills.filter((p) => p.status === "IN_REVIEW").length;
    return {
      label: "Pills awaiting your approval",
      count,
      emptyText: "Nothing awaiting your approval.",
    };
  }
  if (role === "expert") {
    const count = pills.filter((p) => p.status === "DRAFT").length;
    return {
      label: "Drafts to submit",
      count,
      emptyText: "No drafts awaiting submission.",
    };
  }
  // operator and viewer — active escalated cases
  return {
    label: "Active escalated cases",
    count: 0,
    emptyText: "No active escalated cases.",
  };
}

// --- Component ---

export function IntelligencePills({
  selectedPillId: externalSelectedPillId,
  onSelectedPillIdChange,
}: {
  selectedPillId?: string | null;
  onSelectedPillIdChange?: (id: string) => void;
}) {
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [draftVersions, setDraftVersions] = useState<Array<{ pillId: string; version: PillVersion }>>([]);
  const [selectedPillId, setSelectedPillId] = useState<string>(externalSelectedPillId ?? PRIMARY_PILL_ID);
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = getRole();
  const governanceExpanded = role === "expert" || role === "reviewer" || role === "approver";

  // Sync external pill selection (e.g. when navigating from Live Case)
  useEffect(() => {
    if (externalSelectedPillId) {
      setSelectedPillId(externalSelectedPillId);
      onSelectedPillIdChange?.(externalSelectedPillId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSelectedPillId]);

  const handleSelectPill = useCallback((id: string) => {
    setSelectedPillId(id);
    onSelectedPillIdChange?.(id);
  }, [onSelectedPillIdChange]);

  const loadPills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await getPills();
      // Show one row per pill_id, but prefer approved/active version as the representative.
      // If there's also a draft/in_review version, surface it as a secondary line.
      const byId = new Map<string, PillVersion>();
      const drafts = new Map<string, PillVersion>();
      for (const p of all) {
        if (p.status === "DRAFT" || p.status === "IN_REVIEW") {
          drafts.set(p.pill_id, p);
        }
        const existing = byId.get(p.pill_id);
        if (!existing || p.version > existing.version) {
          byId.set(p.pill_id, p);
        }
      }
      // If the representative is not approved but there is an approved version, prefer approved
      for (const [id, p] of byId) {
        if (p.status !== "APPROVED") {
          const approved = all.find((x) => x.pill_id === id && x.status === "APPROVED");
          if (approved) byId.set(id, approved);
        }
      }
      const unique = Array.from(byId.values());
      setPills(unique);
      // Attach draft versions for display in the registry
      const draftList: Array<{ pillId: string; version: PillVersion }> = [];
      for (const [id, v] of drafts) {
        draftList.push({ pillId: id, version: v });
      }
      setDraftVersions(draftList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPills();
  }, [loadPills]);

  useEffect(() => {
    if (!selectedPillId) return;
    let cancelled = false;
    (async () => {
      try {
        const vers = await getPillVersions(selectedPillId);
        if (!cancelled) setVersions(vers);
      } catch {
        if (!cancelled) setVersions([]);
      }
      const r = getRole();
      if (r === "reviewer" || r === "approver") {
        setAuditError(null);
        try {
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
          Ensure the backend is running: <code className="code-inline">python -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000</code>
        </div>
      </div>
    );
  }

  const yourWork = computeYourWork(role, pills);

  const selectedPillVersions = versions.length > 0
    ? versions
    : pills.filter((p) => p.pill_id === selectedPillId);
  const approvedVersion = selectedPillVersions.find((p) => p.status === "APPROVED");
  const selectedPill = approvedVersion ?? selectedPillVersions[0];

  if (!selectedPill) {
    return (
      <div className="callout callout-warning">
        No Pill versions found for <code className="code-inline">{selectedPillId}</code>. Seed the backend first.
      </div>
    );
  }

  return (
    <div>
      {/* Your work summary */}
      <div className="your-work">
        <span className="your-work-label">Your work</span>
        {yourWork.count > 0 ? (
          <>
            <span className="your-work-text">{yourWork.label}</span>
            <span className="your-work-count">{yourWork.count}</span>
          </>
        ) : (
          <span className="your-work-empty">{yourWork.emptyText}</span>
        )}
      </div>

      {/* Pill selector */}
      <PillRegistry
        pills={pills}
        draftVersions={draftVersions}
        selectedPillId={selectedPillId}
        onSelect={handleSelectPill}
      />

      {/* Pill header — name, domain, version, status appear ONCE here */}
      <PillHeader pill={selectedPill} />

      {/* Key heuristic quote at the top of the pill */}
      <KeyHeuristicQuote pill={selectedPill} />

      {/* Governance lifecycle */}
      <GovernanceLifecycle
        pill={selectedPill}
        auditEntries={auditEntries}
        auditError={auditError}
        defaultOpen={governanceExpanded}
      />

      {/* Capability definition */}
      <CapabilityDefinition pill={selectedPill} defaultOpen={governanceExpanded} />

      {/* Evidence and provenance */}
      <EvidenceProvenance pill={selectedPill} defaultOpen={governanceExpanded} />

      {/* Regression / validation obligations */}
      <ValidationObligations pill={selectedPill} defaultOpen={governanceExpanded} />

      {/* Version lineage */}
      <VersionLineage versions={selectedPillVersions} currentVersion={selectedPill.version} defaultOpen={governanceExpanded} />
    </div>
  );
}

// --- Pill Registry / Selector ---

function PillRegistry({
  pills,
  draftVersions,
  selectedPillId,
  onSelect,
}: {
  pills: PillVersion[];
  draftVersions: Array<{ pillId: string; version: PillVersion }>;
  selectedPillId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <span className="card-title">Pill Registry</span>
        <span className="card-meta">{pills.length} pills</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <table className="pill-table">
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
            {pills.map((p) => {
              const draft = draftVersions.find((d) => d.pillId === p.pill_id);
              return (
                <Fragment key={p.pill_id}>
                  <tr
                    className={`pill-table-row ${p.pill_id === selectedPillId ? "selected" : ""}`}
                    onClick={() => onSelect(p.pill_id)}
                  >
                    <td>
                      <div className="pill-name-cell">
                        <DomainIcon domain={p.content.domain} size={34} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.content.name}</div>
                          {getRole() !== "operator" && <div className="tech-meta pill-id-meta">{p.pill_id}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{p.content.domain}</td>
                    <td><span className="code-inline">v{p.version}</span></td>
                    <td><span className={statusBadgeClass(p.status)}>{STATUS_LABELS[p.status]}</span></td>
                    <td>{persona(p.owner).name}</td>
                  </tr>
                  {draft && (
                    <tr
                      className={`pill-table-row pill-table-row-sub ${p.pill_id === selectedPillId ? "selected" : ""}`}
                      onClick={() => onSelect(p.pill_id)}
                    >
                      <td style={{ paddingLeft: 24 }}>
                        <div className="text-muted text-sm">↳ candidate revision</div>
                      </td>
                      <td />
                      <td><span className="code-inline">v{draft.version.version}</span></td>
                      <td><span className={statusBadgeClass(draft.version.status)}>{STATUS_LABELS[draft.version.status]}</span></td>
                      <td>{persona(draft.version.author).name}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Selected Pill Header — name, domain, version, status appear ONCE ---

function PillHeader({ pill }: { pill: PillVersion }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <div className="flex-between flex-wrap gap-16">
          <div className="pill-name-cell">
            <DomainIcon domain={pill.content.domain} size={52} />
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>
                {pill.content.name}
              </div>
              <div className="text-muted" style={{ marginTop: 2, fontSize: 14 }}>
                {pill.content.description}
              </div>
              <PillByline pill={pill} />
            </div>
          </div>
          <div className="flex gap-8 flex-wrap" style={{ alignItems: "center" }}>
            <span className="badge badge-accent">{pill.content.domain}</span>
            <span className="badge badge-neutral">v{pill.version}</span>
            <span className={statusBadgeClass(pill.status)}>{STATUS_LABELS[pill.status]}</span>
          </div>
        </div>
        <div className="pill-export-row">
          <button className="btn btn-quiet" onClick={() => printPillSheet(pill)}>
            Download pill sheet (PDF)
          </button>
          <button className="btn btn-quiet" onClick={() => downloadPillJson(pill)}>
            Export portable JSON
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Byline: where this knowledge came from and who signed it off (Guru-style trust line) ---

function PillByline({ pill }: { pill: PillVersion }) {
  const interview = pill.content.evidence.find((e) => e.kind === "expert_interview");
  const fromFeedback = pill.content.evidence.some((e) => e.kind === "feedback");
  const author = persona(pill.author);
  const reviewer = persona(pill.reviewers[0]);
  const owner = persona(pill.owner);
  const current = pill.status === "APPROVED";
  return (
    <div className="pill-byline">
      <span className="byline-item">
        <Avatar actor={pill.author} size={22} />
        {interview ? <>Captured from an <Term k="evidence">interview</Term> with <b>{author.name}</b></> : <>Written by <b>{author.name}</b></>}
        {fromFeedback && <> · updated from operator feedback</>}
      </span>
      <span className="byline-item"><Avatar actor={pill.reviewers[0] ?? "reviewer"} size={22} /><Term k="review">Reviewed</Term> by <b>{reviewer.name}</b></span>
      <span className="byline-item"><Avatar actor={pill.owner} size={22} />Owned by <b>{owner.name}</b></span>
      <span className={`byline-trust ${current ? "ok" : ""}`}>
        {current ? "✓ Current approved version" : pill.status === "SUPERSEDED" ? "Replaced by a newer version" : "Not in use"}
      </span>
    </div>
  );
}

// --- Key heuristic quote ---

function KeyHeuristicQuote({ pill }: { pill: PillVersion }) {
  const heuristic = pill.content.expert_observations.find((o) =>
    o.toLowerCase().includes("running") && o.toLowerCase().includes("drain")
  );
  if (!heuristic) return null;
  return (
    <div className="heuristic-callout">
      <div className="heuristic-label">The expert's <Term k="heuristic">rule of thumb</Term></div>
      <div className="heuristic-text">&ldquo;{heuristic}&rdquo;</div>
      <div className="text-muted text-sm mt-8">
        — {pill.content.name} v{pill.version}
      </div>
    </div>
  );
}

// --- Collapsible wrapper ---

function Collapsible({
  title,
  hint,
  meta,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""}`} style={{ marginBottom: 24 }}>
      <div className="collapsible-trigger" onClick={() => setOpen(!open)}>
        <span className="coll-title"><span className="coll-title-main">{title}</span>{hint && <span className="coll-hint">{hint}</span>}</span>
        <div className="flex gap-16" style={{ alignItems: "center" }}>
          {meta && (
            <span className="badge badge-neutral">{meta}</span>
          )}
          <span className="collapsible-chevron">▼</span>
        </div>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// --- Governance Lifecycle ---

function GovernanceLifecycle({
  pill,
  auditEntries,
  auditError,
  defaultOpen,
}: {
  pill: PillVersion;
  auditEntries: AuditEntry[];
  auditError: string | null;
  defaultOpen: boolean;
}) {
  const currentStep = lifecycleIndex(pill.status);
  const role = getRole();
  const canSeeAudit = role === "reviewer" || role === "approver";

  const lifecycleAudit = auditEntries.filter((a) =>
    ["PILL_CREATED", "REVIEW_REQUESTED", "EXPERT_REVIEWED", "PILL_VALIDATED", "PILL_APPROVED", "PILL_REJECTED", "PILL_DEPRECATED", "PILL_SUPERSEDED", "CANDIDATE_REVISION_CREATED", "AI_REVISION_PROPOSED"]
      .includes(a.event)
  );

  return (
    <Collapsible title="Sign-off history" hint="Who reviewed, tested and approved this version — and when." meta={`Draft → In Review → Approved`} defaultOpen={defaultOpen}>
      {/* Lifecycle stepper */}
      <div className="lifecycle-stepper">
        {LIFECYCLE_STEPS.map((step, i) => {
          const isDone = currentStep >= 0 && i <= currentStep;
          const isCurrent = currentStep === i;
          return (
            <div key={step} className={`lifecycle-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}>
              <div className="lifecycle-dot" />
              <div className="lifecycle-label">{STATUS_LABELS[step]}</div>
            </div>
          );
        })}
      </div>

      {/* Governance gates */}
      <div className="mt-16">
        <div className="section-heading">Governance Gates</div>
        <div className="grid-3">
          <GovernanceGate title="Review" record={pill.review} summaryFields={["actor", "at", "content_hash", "note"]} />
          <GovernanceGate title="Validation" record={pill.validation} summaryFields={["actor", "at", "content_hash", "passed"]} extraSummary={(rec) => {
            const results = rec.results as Array<Record<string, unknown>> | undefined;
            if (!results) return null;
            const passed = results.filter((r) => r.passed === true).length;
            return `Regression: ${passed}/${results.length} cases passed`;
          }} />
          <GovernanceGate title="Approval" record={pill.approval} summaryFields={["actor", "at", "content_hash", "note"]} />
        </div>
      </div>

      {/* Audit-backed timeline */}
      {canSeeAudit ? (
        lifecycleAudit.length > 0 ? (
          <div className="mt-16">
            <div className="section-heading">Governance Audit Trail</div>
            <ul className="timeline">
              {lifecycleAudit.map((entry, i) => (
                <li key={i} className={`timeline-item ${auditEventToLifecycleStep(entry.event) >= 0 ? "active" : ""}`}>
                  <div className="flex-between">
                    <div><strong>{auditEventLabel(entry.event)}</strong></div>
                    <span className="timeline-time">{fmtDate(entry.created_at)}</span>
                  </div>
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                    Actor: <strong>{capitaliseActor(entry.actor)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-muted text-sm mt-16">No governance audit entries available for this Pill.</div>
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
    </Collapsible>
  );
}

// --- Governance Gate ---

const GATE_FIELD_LABELS: Record<string, string> = {
  actor: "Signed by",
  at: "When",
  content_hash: "Content fingerprint",
  note: "Note",
  passed: "All test situations passed",
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
      <div className="tile">
        <div className="flex-between mb-8">
          <span className="tile-value" style={{ fontSize: 15 }}>{title}</span>
          <span className="badge badge-neutral">Pending</span>
        </div>
        <div className="text-muted text-sm">Not yet recorded.</div>
      </div>
    );
  }

  const passed = record.passed;
  const isValidation = title === "Validation";

  return (
    <div className="tile">
      <div className="flex-between mb-8">
        <span className="tile-value" style={{ fontSize: 15 }}>{title}</span>
        {isValidation ? (
          passed === true ? (
            <span className="badge badge-success">Passed</span>
          ) : passed === false ? (
            <span className="badge badge-danger">Failed</span>
          ) : (
            <span className="badge badge-neutral">Recorded</span>
          )
        ) : (
          <span className="badge badge-success">Recorded</span>
        )}
      </div>
      <div className="kv kv-tech">
        {summaryFields.map((field) => {
          const val = record[field];
          if (val === undefined || val === null || val === "") return null;
          if (field === "content_hash" && getRole() === "operator") return null;
          const display = field === "at" ? fmtDate(String(val)) :
            field === "actor" ? actorLabel(String(val)) :
            field === "note" ? cleanText(String(val)) :
            field === "content_hash" ? fmtHash(String(val)) :
            typeof val === "boolean" ? (val ? "Yes" : "No") : String(val);
          return (
            <div key={field}><dt>{GATE_FIELD_LABELS[field] ?? field}</dt><dd>{display}</dd></div>
          );
        })}
      </div>
      {extraSummary && (
        <div className="text-sm text-muted mt-8">{extraSummary(record)}</div>
      )}
    </div>
  );
}

// --- Capability Definition ---

function CapabilityDefinition({ pill, defaultOpen }: { pill: PillVersion; defaultOpen: boolean }) {
  const { content } = pill;
  const { scope, inputs, facts, expert_observations, assumptions, exceptions, rules, actions, prohibited_actions, guardrails, dependencies } = content;

  return (
    <Collapsible title="What this pill checks and recommends" hint="When it applies, which readings it needs, and its rules." meta={`${rules.length} rules · ${actions.length} actions`} defaultOpen={defaultOpen}>
      {/* Applicability / Scope */}
      <div className="section-heading">When this applies</div>
      <div className="scope-chips mb-16">
        {scope.asset_types.map((t, i) => <span key={`at-${i}`} className="scope-chip">{t}</span>)}
        {scope.equipment.map((e, i) => <span key={`eq-${i}`} className="scope-chip">{e}</span>)}
        {scope.contexts.map((c, i) => <span key={`cx-${i}`} className="scope-chip">{c}</span>)}
        {scope.prerequisites.map((p, i) => <span key={`pr-${i}`} className="scope-chip">Requires: {p}</span>)}
        {scope.exclusions.map((e, i) => <span key={`ex-${i}`} className="scope-chip">Excludes: {e}</span>)}
      </div>

      <div className="section-divider" />

      {/* Required Inputs */}
      <div className="section-heading">Readings it needs</div>
      <div className="obs-grid mb-16">
        {inputs.map((inp) => (
          <div key={inp.key} className="input-card">
            <div className="input-card-name">{readingLabel(inp.key)}</div>
            {!/^synthetic/i.test(inp.description) && <div className="input-card-desc">{inp.description}</div>}
            <div className="input-card-meta">
              <span className="input-card-chip">{inp.kind === "boolean" ? "Yes / No" : inp.kind === "number" ? "Number" : "Text"}</span>
              {inp.required && <span className="input-card-chip" style={{ color: "var(--warning)", borderColor: "var(--warning-border)" }}>Required</span>}
              {inp.unit && <span className="input-card-chip">Unit: {inp.unit}</span>}
              <span className="input-card-chip">Must be under {Math.round(inp.max_age_seconds / 60)} min old</span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-divider" />

      {/* Expert Facts & Heuristics */}
      {(facts.length > 0 || expert_observations.length > 0 || assumptions.length > 0 || exceptions.length > 0) && (
        <>
          <div className="section-heading">What the expert knows</div>
          <div className="mb-16">
            {facts.filter((f) => !isDemoDisclaimer(f)).length > 0 && (
              <div className="mb-16">
                <div className="text-muted text-sm mb-8">Facts</div>
                <ul className="boundary-list">
                  {facts.filter((f) => !isDemoDisclaimer(f)).map((f, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--accent)" }}>•</span><span>{f}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {expert_observations.length > 0 && (
              <div className="mb-16">
                <div className="text-muted text-sm mb-8">Expert Observations</div>
                <ul className="boundary-list">
                  {expert_observations.map((o, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--accent)" }}>•</span><span>{o}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {assumptions.length > 0 && (
              <div className="mb-16">
                <div className="text-muted text-sm mb-8">Assumptions</div>
                <ul className="boundary-list">
                  {assumptions.map((a, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--text-muted)" }}>•</span><span>{a}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {exceptions.length > 0 && (
              <div className="mb-16">
                <div className="text-muted text-sm mb-8">Exceptions</div>
                <ul className="boundary-list">
                  {exceptions.map((e, i) => (
                    <li key={i}><span className="boundary-icon" style={{ color: "var(--warning)" }}>•</span><span>{e}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="section-divider" />
        </>
      )}

      {/* Deterministic Rules */}
      <div className="section-heading">Rules (checked the same way every time)</div>
      <div className="mb-16">
        {rules.map((r, i) => (
          <div key={i} className={`rule-card ${r.category}`}>
            <div className="rule-card-head">
              <div>
                <span className="rule-card-name">If {conditionsText(r.when).toLowerCase()}</span>
              </div>
              <span className="rule-card-category">{r.category}</span>
            </div>
            <div className="rule-card-rationale">{r.rationale}</div>

            {r.recommend.length > 0 && (
              <div className="rule-card-evidence">
                <strong>Recommend:</strong> {r.recommend.map(actionLabel).join(", ")}
              </div>
            )}
            {r.block.length > 0 && (
              <div className="rule-card-evidence">
                <strong>Block:</strong> {r.block.map(actionLabel).join(", ")}
              </div>
            )}
            {r.escalate_to && (
              <div className="rule-card-evidence">
                <strong>Escalate to:</strong> {r.escalate_to}
              </div>
            )}
            {getRole() !== "operator" && (
              <details className="tech-details"><summary>Technical details</summary>
                <div className="tech-meta">Rule ID: {r.id} · Condition: {r.when.map((w) => `${w.input} ${w.op} ${String(w.value)}`).join(" ∧ ")} · Evidence: {r.evidence_ids.join(", ")}</div>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="section-divider" />

      {/* Recommended Actions */}
      <div className="section-heading">Recommended Actions</div>
      <div className="action-list mb-16">
        {actions.map((a) => (
          <div key={a.id} className="action-item">
            <div className="action-item-content">
              <div className="action-item-title">{actionLabel(a.id)}</div>
              <div className="action-item-desc">{a.description}</div>
            </div>
            <span className="badge badge-warning">Authorization required</span>
          </div>
        ))}
      </div>

      <div className="section-divider" />

      {/* Guardrails */}
      {guardrails.length > 0 && (
        <>
          <div className="section-heading">Safety limits</div>
          <ul className="boundary-list mb-16">
            {guardrails.map((g, i) => (
              <li key={i}><span className="boundary-icon" style={{ color: "var(--warning)" }}>!</span><span>{g}</span></li>
            ))}
          </ul>
          <div className="section-divider" />
        </>
      )}

      {/* Prohibited Actions */}
      {prohibited_actions.length > 0 && (
        <>
          <div className="section-heading">Never allowed</div>
          <ul className="boundary-list mb-16">
            {prohibited_actions.map((p, i) => (
              <li key={i}><span className="boundary-icon">×</span><span>{actionLabel(p)}</span></li>
            ))}
          </ul>
          <div className="section-divider" />
        </>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <>
          <div className="section-heading">Dependencies</div>
          <div className="scope-chips mb-16">
            {dependencies.map((d, i) => (
              <span key={i} className="scope-chip"><span className="code-inline">{d.pill_id}</span> v{d.version}</span>
            ))}
          </div>
          <div className="section-divider" />
        </>
      )}

      {/* Open Questions & Contradictions */}
      {(content.unresolved_questions.length > 0 || content.contradictions.length > 0) && (
        <>
          <div className="section-heading">Open Questions & Contradictions</div>
          {content.unresolved_questions.length > 0 && (
            <div className="callout callout-warning mb-16">
              <strong>Unresolved:</strong> {content.unresolved_questions.join("; ")}
            </div>
          )}
          {content.contradictions.length > 0 && (
            <div className="callout callout-danger mb-16">
              <strong>Contradictions:</strong> {content.contradictions.join("; ")}
            </div>
          )}
        </>
      )}
    </Collapsible>
  );
}

// --- Evidence and Provenance ---

function EvidenceProvenance({ pill, defaultOpen }: { pill: PillVersion; defaultOpen: boolean }) {
  const { evidence } = pill.content;

  return (
    <Collapsible title={<>Where this knowledge came from <Term k="evidence" tag>evidence</Term></>} hint="The interviews, incidents and feedback behind the rules." meta={`${evidence.length} items`} defaultOpen={defaultOpen}>
      <div className="obs-grid">
        {evidence.map((e) => (
          <div key={e.id} className="input-card">
            <div className="flex-between mb-8">
              <span className="input-card-name">{e.kind === "expert_interview" ? "Expert interview" : e.kind === "public_context" ? "Public guidance" : e.kind === "feedback" ? "Operator feedback" : e.kind === "incident" ? "Past incident" : e.kind}</span>
              {e.kind === "public_context" && <span className="badge badge-neutral">Context only</span>}
            </div>
            <div className="input-card-desc">{cleanText(e.summary)}</div>
            {/^https?:/.test(e.citation) && <div className="tech-meta mt-8">{e.citation}</div>}
          </div>
        ))}
      </div>
    </Collapsible>
  );
}

// --- Regression / Validation Obligations ---

const DECISION_LABELS: Record<string, string> = {
  ESCALATE: "Escalate",
  HUMAN_REVIEW: "Needs review",
  ABSTAIN: "Abstain — not enough data",
};

function decisionBadgeClass(decision: string): string {
  if (decision === "ESCALATE") return "badge badge-warning";
  if (decision === "HUMAN_REVIEW") return "badge badge-info";
  return "badge badge-neutral";
}

const REGRESSION_TITLES: Record<string, string> = {
  rising: "Water rising while the pump shows running",
  stable: "Water steady, pump running, no equipment at risk",
  critical: "Electrical equipment at risk",
  missing: "Required readings missing",
  scope: "Outside this pill's scope (different equipment)",
  "flat-but-backflow": "Water looks steady but is backing up from the drain",
};

function buildRegressionTitle(tc: Record<string, unknown>): string {
  const inputs = (tc.inputs as Record<string, unknown>) ?? {};
  const parts: string[] = [];
  const waterRise = inputs.water_rise_mm_min;
  const pumpRunning = inputs.pump_running;
  const drainBackflow = inputs.drain_backflow;
  const routeVerified = inputs.alternative_route_verified;
  const arrivals = inputs.tenant_arrivals_expected;
  const criticalExposed = inputs.critical_equipment_exposed;

  if (waterRise !== undefined) {
    parts.push(waterRise === 0 || waterRise === "0" ? "Flat water" : `Water rising ${waterRise}`);
  }
  if (pumpRunning !== undefined) parts.push(pumpRunning ? "pump running" : "pump not running");
  if (drainBackflow !== undefined) parts.push(drainBackflow ? "drain backflow" : "no backflow");
  if (routeVerified !== undefined) parts.push(routeVerified ? "route verified" : "route unverified");
  if (arrivals !== undefined) parts.push(arrivals ? "arrivals expected" : "no arrivals");
  if (criticalExposed !== undefined) parts.push(criticalExposed ? "critical exposed" : "no critical exposure");

  return parts.length > 0 ? parts.join(", ") : "Readings missing";
}

function ValidationObligations({ pill, defaultOpen }: { pill: PillVersion; defaultOpen: boolean }) {
  const { evaluation } = pill.content;

  // Determine which cases are new (only in this version, not in previous)
  const newCaseIds = pill.previous_version
    ? new Set(evaluation.map((tc) => (tc.id as string) ?? "").filter(Boolean))
    : null;

  return (
    <Collapsible title={<>Test situations it must pass <Term k="regression" tag>regression tests</Term></>} hint="Saved examples with the answer the pill must give." meta={`${evaluation.length} cases`} defaultOpen={defaultOpen}>
      {(() => {
        // Build titles and detect collisions for uniqueness
        const rawTitles = evaluation.map((tc) => buildRegressionTitle(tc));
        const titleCounts = new Map<string, number>();
        for (const t of rawTitles) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
        return evaluation.map((tc, i) => {
        const id = (tc.id as string) ?? `case-${i}`;
        const expectedDecision = (tc.expected_decision as string) ?? "ABSTAIN";
        const expectedActions = (tc.expected_actions as string[]) ?? [];
        const expectedBlocked = (tc.expected_blocked as string[]) ?? [];
        let title = REGRESSION_TITLES[id] ?? (rawTitles[i] || id);
        if ((titleCounts.get(title) ?? 0) > 1) title = `${title} (${id.replace(/_/g, " ")})`;
        const isNew = pill.previous_version && newCaseIds && newCaseIds.size > 0 && id === "flat-but-backflow";

        return (
          <div key={i} className={`regression-row ${pill.previous_version && !isNew ? "locked" : ""}`}>
            <div className="regression-row-header">
              <span className="regression-row-title">{title}</span>
              <span className="regression-row-arrow">→</span>
              <span className={decisionBadgeClass(expectedDecision)}>
                {expectedDecision === "HUMAN_REVIEW" && expectedActions.includes("monitor_trend") ? "Keep monitoring (person confirms)" : (DECISION_LABELS[expectedDecision] ?? expectedDecision)}
              </span>
              {isNew ? (
                <span className="regression-row-badge-new">New in v{pill.version}</span>
              ) : pill.previous_version ? (
                <span className="regression-row-badge-inherited">Inherited — cannot be removed</span>
              ) : null}
            </div>
            <div className="regression-row-actions">
              {expectedActions.length > 0 && (
                <div className="action-group">
                  <span className="action-group-label">Expects:</span>
                  <span>{expectedActions.map(actionLabel).join(", ")}</span>
                </div>
              )}
              {expectedBlocked.length > 0 && (
                <div className="action-group" style={{ color: "var(--danger)" }}>
                  <span className="action-group-label">Blocks:</span>
                  <span>{expectedBlocked.map(actionLabel).join(", ")}</span>
                </div>
              )}
            </div>
          </div>
        );
      });
      })()}
      
    </Collapsible>
  );
}

// --- Version Lineage ---

function VersionLineage({
  versions,
  currentVersion,
  defaultOpen,
}: {
  versions: PillVersion[];
  currentVersion: string;
  defaultOpen: boolean;
}) {
  return (
    <Collapsible title="Version history" hint="Every version ever made." meta={`${versions.length} version${versions.length !== 1 ? "s" : ""}`} defaultOpen={defaultOpen}>
      {versions.length <= 1 ? (
        <div className="text-muted text-sm">
          Only <strong>v{currentVersion}</strong> exists at this point. No previous or successor versions have been published.
        </div>
      ) : (
        <ul className="timeline">
          {versions.map((v) => (
            <li key={`${v.pill_id}:${v.version}`} className={`timeline-item ${v.version === currentVersion ? "active" : ""}`}>
              <div className="flex-between">
                <div className="flex gap-8" style={{ alignItems: "center" }}>
                  <span className="code-inline">v{v.version}</span>
                  <span className={statusBadgeClass(v.status)}>{STATUS_LABELS[v.status]}</span>
                  {v.version === currentVersion && <span className="badge badge-accent">Current</span>}
                </div>
                <span className="timeline-time">{fmtDate(v.created_at)}</span>
              </div>
              {v.change_reason && (
                <div className="text-sm text-muted mt-8">{cleanText(v.change_reason)}</div>
              )}
              <div className="text-sm text-muted mt-8">
                Written by {actorLabel(v.author)}{v.previous_version ? ` · replaces v${v.previous_version}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}

// --- Readable action labels ---

const ACTION_LABELS: Record<string, string> = {
  inspect_drainage: "Inspect drainage",
  monitor_trend: "Monitor trend",
  review_access_plan: "Review access plan",
  draft_tenant_update: "Draft tenant update",
  tenant_liaison: "Tenant liaison",
};

function actionLabel(id: string): string {
  return ACTION_LABELS[id] ?? id.replace(/_/g, " ");
}
