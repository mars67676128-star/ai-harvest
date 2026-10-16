import { useEffect, useMemo, useState } from "react";
import type { PillVersion } from "../types";
import { getAuditHistory, getPills, getRole, type AuditEntry } from "../api";
import { downloadPillJson, printPillSheet } from "../lib/pillExport";

function keyOf(p: PillVersion) { return `${p.pill_id}@${p.version}`; }
function fmt(v: unknown) { return typeof v === "string" ? v : JSON.stringify(v); }
function statusClass(status: string) { if (status === "APPROVED") return "badge badge-success"; if (status === "IN_REVIEW") return "badge badge-warning"; if (status === "REJECTED" || status === "DEPRECATED") return "badge badge-danger"; return "badge badge-neutral"; }

export function ReviewedPills({ selectedKey, onSelectedKeyChange }: { selectedKey?: string | null; onSelectedKeyChange?: (key: string) => void }) {
  const role = getRole();
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(selectedKey ?? null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPills().then((all) => {
      setVersions(all);
      if (!selected) {
        const preferred = all.find((p) => p.pill_id === "asset.monsoon.triage" && p.status === "APPROVED") ?? all[0];
        if (preferred) setSelected(keyOf(preferred));
      }
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  useEffect(() => { if (selectedKey) setSelected(selectedKey); }, [selectedKey]);

  const pill = useMemo(() => versions.find((p) => keyOf(p) === selected) ?? null, [versions, selected]);
  useEffect(() => {
    if (!pill || (role !== "reviewer" && role !== "approver")) { setAudit([]); return; }
    getAuditHistory(pill.pill_id, 0, 500).then((h) => setAudit(h.items)).catch(() => setAudit([]));
  }, [pill, role]);

  const workCount = role === "expert" ? versions.filter((p) => p.status === "DRAFT").length : role === "reviewer" ? versions.filter((p) => p.status === "IN_REVIEW" && !p.validation).length : role === "approver" ? versions.filter((p) => p.status === "IN_REVIEW" && p.review && p.validation).length : 0;

  if (error) return <div className="error-box">{error}</div>;
  if (!pill) return <div className="loading">Loading Intelligence Pills…</div>;

  return <div>
    <div className="your-work"><span className="your-work-label">Your work</span><span className="your-work-text">{role === "viewer" || role === "operator" ? "Read-only knowledge inspection" : "Candidate governance"}</span>{workCount > 0 && <span className="your-work-count">{workCount}</span>}</div>

    <div className="card mb-16"><div className="card-header"><span className="card-title">Pill Registry — every version is selectable</span><span className="card-meta">{versions.length} versions</span></div><div className="card-body" style={{padding:0}}><table className="pill-table"><thead><tr><th>Pill</th><th>Domain</th><th>Version</th><th>Status</th><th>Owner</th></tr></thead><tbody>{versions.map((p) => <tr key={keyOf(p)} className={`pill-table-row ${keyOf(p) === selected ? "selected" : ""}`} onClick={() => { const k = keyOf(p); setSelected(k); onSelectedKeyChange?.(k); }}><td><div style={{fontWeight:600}}>{p.content.name}</div><div className="tech-meta">{p.pill_id}</div></td><td>{p.content.domain}</td><td><span className="code-inline">v{p.version}</span></td><td><span className={statusClass(p.status)}>{p.status}</span></td><td>{p.owner}</td></tr>)}</tbody></table></div></div>

    <div className="card mb-16"><div className="card-body"><div className="flex-between flex-wrap gap-16"><div><div style={{fontSize:24,fontWeight:800}}>{pill.content.name}</div><div className="text-muted">{pill.content.description}</div><div className="flex gap-8 mt-8"><span className="badge badge-neutral">{pill.content.domain}</span><span className={statusClass(pill.status)}>v{pill.version} · {pill.status}</span></div></div><div className="flex gap-8"><button className="btn" onClick={() => downloadPillJson(pill)}>Export JSON</button><button className="btn" onClick={() => printPillSheet(pill)}>Print / PDF</button></div></div></div></div>

    <div className="card mb-16"><div className="card-header"><span className="card-title">Governance</span></div><div className="card-body"><div className="kv"><div><dt>Author</dt><dd>{pill.author}</dd></div><div><dt>Owner</dt><dd>{pill.owner}</dd></div><div><dt>Reviewers</dt><dd>{pill.reviewers.join(", ")}</dd></div><div><dt>Previous version</dt><dd>{pill.previous_version ?? "—"}</dd></div><div><dt>Content hash</dt><dd>{pill.content_hash}</dd></div><div><dt>Change reason</dt><dd>{pill.change_reason}</dd></div></div><div className="flex gap-8 mt-16"><span className={pill.review ? "badge badge-success" : "badge badge-neutral"}>Review {pill.review ? "recorded" : "pending"}</span><span className={pill.validation ? (pill.validation.passed === true ? "badge badge-success" : "badge badge-danger") : "badge badge-neutral"}>Validation {pill.validation ? (pill.validation.passed === true ? "passed" : "failed") : "pending"}</span><span className={pill.approval ? "badge badge-success" : "badge badge-neutral"}>Approval {pill.approval ? "recorded" : "pending"}</span></div></div></div>

    <div className="card mb-16"><div className="card-header"><span className="card-title">Capability Definition</span></div><div className="card-body"><div className="section-heading">Scope</div><div className="kv"><div><dt>Asset types</dt><dd>{pill.content.scope.asset_types.join(", ")}</dd></div><div><dt>Equipment</dt><dd>{pill.content.scope.equipment.join(", ")}</dd></div><div><dt>Contexts</dt><dd>{pill.content.scope.contexts.join(", ")}</dd></div></div><div className="section-heading mt-16">Expert observations</div><ul>{pill.content.expert_observations.map((x) => <li key={x}>{x}</li>)}</ul><div className="section-heading mt-16">Required inputs</div>{pill.content.inputs.map((i) => <div className="regression-row" key={i.key}><div className="regression-row-title">{i.key}</div><div className="text-muted">{i.description} · {i.kind}{i.unit ? ` · ${i.unit}` : ""} · {i.required ? "required" : "optional"}</div></div>)}<div className="section-heading mt-16">Deterministic rules</div>{pill.content.rules.map((r) => <div className={`rule-card ${r.category}`} key={r.id}><div className="rule-card-name">{r.id}</div><div>{r.rationale}</div><div className="text-muted mt-8">When: {r.when.map((w) => `${w.input} ${w.op} ${fmt(w.value)}`).join(" AND ")}</div></div>)}</div></div>

    <div className="card mb-16"><div className="card-header"><span className="card-title">Regression Obligations</span><span className="card-meta">Inherited safety cases cannot be silently removed</span></div><div className="card-body">{pill.content.evaluation.map((raw, i) => { const c = raw as Record<string, unknown>; return <div className="regression-row" key={String(c.id ?? i)}><div className="regression-row-header"><span className="regression-row-title">{String(c.id ?? `case-${i}`)}</span><span className="regression-row-arrow">→</span><span className="badge badge-neutral">{String(c.expected_decision ?? "")}</span></div></div>; })}</div></div>

    <div className="card mb-16"><div className="card-header"><span className="card-title">Evidence & Provenance</span></div><div className="card-body">{pill.content.evidence.map((e) => <div className="pill-provenance mb-16" key={e.id}><div className="pill-prov-name">{e.kind} {e.synthetic && <span className="badge badge-neutral">synthetic</span>}</div><div>{e.summary}</div><div className="tech-meta mt-8">{e.citation}</div></div>)}</div></div>

    {(role === "reviewer" || role === "approver") && <div className="card"><div className="card-header"><span className="card-title">Audit Trail</span><span className="card-meta">role-restricted</span></div><div className="card-body">{audit.length === 0 ? <div className="text-muted">No audit entries loaded.</div> : audit.slice().reverse().map((a) => <div className="regression-row" key={a.sequence}><div><strong>{a.event}</strong> · {a.actor}</div><div className="text-muted">{a.created_at}</div></div>)}</div></div>}
  </div>;
}
