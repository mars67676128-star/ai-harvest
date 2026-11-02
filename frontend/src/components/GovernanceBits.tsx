// Governed review states shown as intentional workflow steps, never as errors.
import type { PillVersion } from "../types";
import { getRole } from "../api";
import { persona } from "../lib/glossary";
import { reviewInfo, shortDate, usageText, type Usage } from "../lib/pillSignals";
import {
  checkDifference,
  checkName,
  correctionSource,
  failedChecks,
  openQuestions,
  provenanceOf,
  stageOf,
  type AcceptanceRow,
  type StageKey,
} from "../lib/governance";

const ICON: Partial<Record<StageKey, string>> = {
  ai_draft: "✦",
  corrected_draft: "✎",
  validation_passed: "✓",
  approved: "✓",
  clarification: "⏸",
  rejected: "↩",
};

export function StageChip({ k, label }: { k: StageKey; label: string }) {
  return (
    <span className={`gov-chip gov-${k}`}>
      {ICON[k] && <span aria-hidden="true" className="gov-chip-icon">{ICON[k]}</span>}
      {label}
    </span>
  );
}

/** Provenance + stage, e.g. [AI-drafted] [Needs review] or [Human corrected] [Approved]. */
export function GovChips({ pill, withVersion = false }: { pill: PillVersion; withVersion?: boolean }) {
  const stage = stageOf(pill);
  const prov = provenanceOf(pill);
  return (
    <span className="gov-chips">
      {withVersion && <span className="code-inline">v{pill.version}</span>}
      {prov && <StageChip k={prov.key} label={prov.label} />}
      <StageChip k={stage.key} label={stage.label} />
    </span>
  );
}

function CheckRow({ row }: { row: AcceptanceRow }) {
  const tech = getRole() !== "operator";
  return (
    <li className="gov-check">
      <span className="gov-check-mark" aria-hidden="true">✕</span>
      <span className="gov-check-body">
        <b>{checkName(row.case_id)}</b>
        <span className="gov-check-detail">{checkDifference(row)}</span>
        {tech && <span className="gov-check-id">{row.case_id}</span>}
      </span>
    </li>
  );
}

/** SEMANTIC_REGRESSION: an AI draft did not pass the server's source-grounded checks. */
export function ChecksHeldPanel({ pill, activeVersion }: { pill: PillVersion; activeVersion?: string | null }) {
  const failed = failedChecks(pill);
  if (failed.length === 0) return null;
  return (
    <div className="gov-panel gov-panel-review" role="status">
      <div className="gov-panel-head">
        <StageChip k="checks_failed" label="AI draft needs review" />
        <span className="gov-panel-meta">v{pill.version}</span>
      </div>
      <ul className="gov-lines">
        <li>Source-grounded checks did not pass ({failed.length})</li>
        <li>Human correction required before approval</li>
        {activeVersion && <li>Approved v{activeVersion} remains active</li>}
      </ul>
      <ul className="gov-checks">{failed.map((r) => <CheckRow key={r.case_id} row={r} />)}</ul>
    </div>
  );
}

/** UNRESOLVED_KNOWLEDGE: the draft holds questions only an expert can answer. */
export function ClarificationPanel({
  pill,
  questions,
  activeVersion,
}: {
  pill?: PillVersion | null;
  questions?: string[];
  activeVersion?: string | null;
}) {
  const qs = questions ?? openQuestions(pill);
  if (qs.length === 0) return null;
  const isRevision = !!pill?.previous_version;
  return (
    <div className="gov-panel gov-panel-hold" role="status">
      <div className="gov-panel-head">
        <StageChip k="clarification" label="Expert clarification required" />
        {pill && <span className="gov-panel-meta">v{pill.version}</span>}
      </div>
      <ul className="gov-lines">
        <li>{isRevision ? "Revision blocked from release" : "Draft blocked from release"}</li>
        {activeVersion ? <li>Current approved Pill v{activeVersion} remains active</li> : isRevision ? <li>Current approved Pill remains active</li> : null}
      </ul>
      <div className="gov-q-head">Open questions</div>
      <ol className="gov-questions">{qs.map((q, i) => <li key={i}>{q}</li>)}</ol>
    </div>
  );
}

/** A version created by a person correcting an AI draft. */
export function CorrectionNote({ pill }: { pill: PillVersion }) {
  const src = correctionSource(pill);
  if (!src) return null;
  return (
    <div className="gov-panel gov-panel-corrected">
      <div className="gov-panel-head">
        <StageChip k="corrected_draft" label="Human corrected" />
        {src.aiDraft && <span className="gov-panel-meta">replaces AI draft v{src.aiDraft}</span>}
      </div>
      {src.failed.length > 0 && (
        <div className="text-sm">
          AI draft did not pass: {src.failed.map(checkName).join(" · ")}
        </div>
      )}
    </div>
  );
}

export type FlowState = "done" | "current" | "held" | "skipped" | "todo";

/** A short release path, e.g. Interview → AI draft → Validation → Correction → Revalidation → Approved. */
export function ReleasePath({ steps }: { steps: Array<{ label: string; state: FlowState }> }) {
  return (
    <ol className="gov-path" aria-label="Release path">
      {steps.filter((s) => s.state !== "skipped").map((s, i) => (
        <li key={i} className={`gov-step gov-step-${s.state}`}>
          <span className="gov-step-dot" aria-hidden="true" />
          <span className="gov-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Release path for one pill version, derived from what the backend recorded. */
export function releaseStepsFor(pill: PillVersion): Array<{ label: string; state: FlowState }> {
  const stage = stageOf(pill);
  const approved = pill.status === "APPROVED" || pill.status === "SUPERSEDED";
  const corrected = correctionSource(pill);
  const isRevision = !!pill.previous_version;
  const reviewed = !!pill.review;
  const validated = !!pill.validation;

  if (stage.key === "clarification") {
    return [
      { label: isRevision ? "Feedback" : "Expert interview", state: "done" },
      { label: isRevision ? "AI proposes revision" : "AI draft", state: "done" },
      { label: "Blocked pending expert clarification", state: "held" },
      { label: "Approved", state: "todo" },
    ];
  }
  if (isRevision) {
    return [
      { label: "Feedback", state: "done" },
      { label: "AI proposes revision", state: "done" },
      { label: "Independent review", state: reviewed ? "done" : pill.status === "IN_REVIEW" ? "current" : "todo" },
      { label: "Validation", state: stage.key === "checks_failed" ? "held" : validated ? "done" : reviewed ? "current" : "todo" },
      { label: "Human correction", state: stage.key === "checks_failed" ? "current" : "skipped" },
      { label: "Approved", state: approved ? "done" : stage.key === "validation_passed" ? "current" : "todo" },
    ];
  }
  return [
    { label: "Expert interview", state: "done" },
    { label: corrected ? `AI draft${corrected.aiDraft ? ` v${corrected.aiDraft}` : ""}` : "AI draft", state: "done" },
    { label: "Validation", state: corrected || stage.key === "checks_failed" ? "held" : validated ? "done" : reviewed ? "current" : "todo" },
    { label: "Human correction", state: corrected ? "done" : stage.key === "checks_failed" ? "current" : "skipped" },
    { label: "Revalidation", state: corrected ? (validated ? "done" : "current") : "skipped" },
    { label: "Approved", state: approved ? "done" : stage.key === "validation_passed" ? "current" : "todo" },
  ];
}

/** When the pill was signed off, when it is due for review, and how much it is used. */
export function PillSignals({ pill, usage }: { pill: PillVersion; usage?: Usage | null }) {
  const r = pill.status === "APPROVED" ? reviewInfo(pill) : null;
  if (!r && usage === undefined) return null;
  return (
    <div className="pill-signals">
      {r && (
        <>
          <span className="sig">Signed off {shortDate(r.approvedAt)}{r.approvedBy ? ` by ${persona(r.approvedBy).name}` : ""}</span>
          <span className={`sig sig-${r.state}`}>
            {r.state === "overdue" ? `Review overdue since ${shortDate(r.dueAt)}` : r.state === "soon" ? `Review due by ${shortDate(r.dueAt)}` : `Next review by ${shortDate(r.dueAt)}`}
          </span>
        </>
      )}
      {usage !== undefined && usage !== null && <span className="sig">{usageText(usage)}</span>}
    </div>
  );
}
