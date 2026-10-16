import { useEffect, useState } from "react";
import { actorLabel, readingLabel, conditionsText, cleanText } from "../lib/format";
import type { PillVersion } from "../types";
import { getPillVersion, getRole } from "../api";
import { DomainIcon } from "./DomainIcon";
import { downloadPillJson, printPillSheet } from "../lib/pillExport";

function badge(status: string): string {
  if (status === "APPROVED") return "badge badge-success";
  if (status === "IN_REVIEW") return "badge badge-info";
  if (status === "REJECTED" || status === "DEPRECATED") return "badge badge-danger";
  return "badge badge-neutral";
}

export function ExactPillView({
  pillId,
  version,
  onBack,
}: {
  pillId: string;
  version: string;
  onBack: () => void;
}) {
  const [pill, setPill] = useState<PillVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const role = getRole();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getPillVersion(pillId, version)
      .then((value) => { if (!cancelled) setPill(value); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pillId, version]);

  if (error) {
    return <div><div className="error-box mb-16">{error}</div><button className="btn" onClick={onBack}>Back to Pill Registry</button></div>;
  }
  if (!pill) return <div className="loading">Loading exact Pill version…</div>;

  return (
    <div>
      <div className="source-attribution mb-16">
        <span className="source-label">Version:</span>
        <span>{pill.content.name}</span>
        <span className={badge(pill.status)}>v{pill.version} · {pill.status}</span>
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <div className="flex-between flex-wrap gap-16">
            <div className="pill-name-cell">
              <DomainIcon domain={pill.content.domain} size={52} />
              <div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{pill.content.name}</div>
                <div className="text-muted">{pill.content.description}</div>
              </div>
            </div>
            <div className="flex gap-8 flex-wrap">
              <span className="badge badge-accent">{pill.content.domain}</span>
              <span className={badge(pill.status)}>v{pill.version} · {pill.status}</span>
            </div>
          </div>
          <div className="pill-export-row">
            <button className="btn btn-quiet" onClick={() => printPillSheet(pill)}>Download pill sheet (PDF)</button>
            <button className="btn btn-quiet" onClick={() => downloadPillJson(pill)}>Export portable JSON</button>
            <button className="btn" onClick={onBack}>Back to Pill Registry</button>
          </div>
        </div>
      </div>

      {pill.status !== "APPROVED" && (
        <div className="callout callout-warning mb-16">
          <strong>Draft v{pill.version}, not in use.</strong> The approved version stays in use until this is approved.
        </div>
      )}

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">Governance Metadata</span><span className="card-meta">viewer: {role}</span></div>
        <div className="card-body">
          <div className="kv">
            <div><dt>Version</dt><dd>v{pill.version}</dd></div>
            <div><dt>Status</dt><dd>{pill.status}</dd></div>
            <div><dt>Written by</dt><dd>{actorLabel(pill.author)}</dd></div>
            <div><dt>Owner</dt><dd>{actorLabel(pill.owner)}</dd></div>
            <div><dt>Reviewers</dt><dd>{pill.reviewers.map(actorLabel).join(", ")}</dd></div>
            <div><dt>Previous version</dt><dd>{pill.previous_version ?? "—"}</dd></div>
            {getRole() !== "operator" && <div><dt>Content fingerprint</dt><dd className="tech-meta">{pill.content_hash.slice(0, 16)}…</dd></div>}
            <div><dt>Change reason</dt><dd>{cleanText(pill.change_reason)}</dd></div>
          </div>
          <div className="flex gap-8 flex-wrap mt-16">
            <span className={pill.review ? "badge badge-success" : "badge badge-neutral"}>Review {pill.review ? "recorded" : "pending"}</span>
            <span className={pill.validation ? (pill.validation.passed === true ? "badge badge-success" : "badge badge-danger") : "badge badge-neutral"}>Validation {pill.validation ? (pill.validation.passed === true ? "passed" : "failed") : "pending"}</span>
            <span className={pill.approval ? "badge badge-success" : "badge badge-neutral"}>Approval {pill.approval ? "recorded" : "pending"}</span>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">What this version checks</span></div>
        <div className="card-body">
          <div className="section-heading">Expert observations</div>
          <ul>{pill.content.expert_observations.map((item) => <li key={item}>{item}</li>)}</ul>
          <div className="section-heading mt-16">Readings it needs</div>
          {pill.content.inputs.map((input) => (
            <div className="regression-row" key={input.key}>
              <div className="regression-row-title">{readingLabel(input.key)}</div>
              <div className="text-muted">{input.kind === "boolean" ? "Yes / No" : "Number"}{input.unit ? ` · ${input.unit}` : ""} · {input.required ? "required" : "optional"}</div>
            </div>
          ))}
          <div className="section-heading mt-16">Rules</div>
          {pill.content.rules.map((rule) => (
            <div className={`rule-card ${rule.category}`} key={rule.id}>
              <div className="rule-card-name">If {conditionsText(rule.when).toLowerCase()}</div>
              <div>{rule.rationale}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">Regression Obligations</span><span className="card-meta">{pill.content.evaluation.length} cases</span></div>
        <div className="card-body">
          {pill.content.evaluation.map((raw, index) => {
            const test = raw as Record<string, unknown>;
            return <div className="regression-row" key={String(test.id ?? index)}><div className="regression-row-title">{String(test.id ?? `case-${index}`)}</div><div className="text-muted">Expected decision: {String(test.expected_decision ?? "—")}</div></div>;
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Evidence & Provenance</span></div>
        <div className="card-body">
          {pill.content.evidence.map((evidence) => (
            <div className="pill-provenance mb-16" key={evidence.id}>
              <div className="pill-prov-name">{evidence.kind === "expert_interview" ? "Expert interview" : evidence.kind === "public_context" ? "Public guidance" : evidence.kind === "feedback" ? "Operator feedback" : evidence.kind}</div>
              <div>{cleanText(evidence.summary)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
