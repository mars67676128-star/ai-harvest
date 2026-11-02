import { useEffect, useState } from "react";
import { actorLabel, readingLabel, conditionsText, cleanText } from "../lib/format";
import type { PillVersion } from "../types";
import { getPillVersion, getRole } from "../api";
import { DomainIcon } from "./DomainIcon";
import { downloadPillJson, printPillSheet } from "../lib/pillExport";
import { ChecksHeldPanel, ClarificationPanel, CorrectionNote, GovChips, ReleasePath, releaseStepsFor } from "./GovernanceBits";
import { expectedText, failedChecks, openQuestions, testTitle } from "../lib/governance";

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
        <GovChips pill={pill} withVersion />
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
              <GovChips pill={pill} withVersion />
            </div>
          </div>
          <div className="pill-export-row">
            <button className="btn btn-quiet" onClick={() => printPillSheet(pill)}>Download pill sheet (PDF)</button>
            <button className="btn btn-quiet" onClick={() => downloadPillJson(pill)}>Export portable JSON</button>
            <button className="btn" onClick={onBack}>Back to Pill Registry</button>
          </div>
        </div>
      </div>

      <ReleasePath steps={releaseStepsFor(pill)} />
      {openQuestions(pill).length > 0 && (pill.status === "DRAFT" || pill.status === "IN_REVIEW") ? (
        <ClarificationPanel pill={pill} />
      ) : failedChecks(pill).length > 0 && pill.status !== "APPROVED" ? (
        <ChecksHeldPanel pill={pill} />
      ) : pill.status !== "APPROVED" && pill.status !== "SUPERSEDED" ? (
        <div className="callout callout-warning mb-16">
          <strong>v{pill.version}, not in use.</strong> The approved version stays in use until this is approved.
        </div>
      ) : null}
      <CorrectionNote pill={pill} />

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">Sign-off details</span></div>
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
        <div className="card-header"><span className="card-title">Test situations it must pass</span><span className="card-meta">{pill.content.evaluation.length}</span></div>
        <div className="card-body">
          {pill.content.evaluation.map((raw, index) => {
            const test = raw as Record<string, unknown>;
            return <div className="regression-row" key={String(test.id ?? index)}><div className="regression-row-title">{testTitle(String(test.id ?? `case-${index}`), test.description as string | undefined)}</div><div className="text-muted">Should give: {expectedText(test.expected_decision as string | undefined, (test.expected_actions as string[] | undefined) ?? [])}</div></div>;
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Where this knowledge came from</span></div>
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
