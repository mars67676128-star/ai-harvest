import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError } from "../lib/friendlyError";
import { WaitingFor, DemoHint, PlainChanges } from "./WorkflowBits";
import { persona } from "../lib/glossary";
import { actorLabel, sgTime, cleanText } from "../lib/format";
// The offline demo AI only recognises these exact labelled corrections; the label is added on submit, not shown.
const DEMO_PREFIX = "SYNTHETIC CORRECTION: ";
const withPrefix = (t: string) => (t.startsWith(DEMO_PREFIX) ? t : DEMO_PREFIX + t);
import type { DiffResult, PillVersion, RecommendationRecord } from "../types";
import {
  getFeedback,
  getPillDiff,
  getPillVersions,
  getRecommendation,
  getRecommendations,
  getRole,
  proposeCandidate,
  recordOutcome,
  submitFeedback,
  transitionPill,
} from "../api";
import {
  addFeedbackId,
  candidateForFeedback,
  getActiveRec,
  getFeedbackIds,
  getRememberedRejection,
  nextCandidateVersion,
  rememberRejection,
  semverCmp,
  setActiveRec,
  setFeedbackIds,
} from "../lib/demoState";

const OPS_ID = "asset.monsoon.triage";
const BASE_CORRECTION = "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified drain_backflow observation. If backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising.";
const REVISED_CORRECTION = "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require an explicit verified drain_backflow observation before applying the exception; do not infer backflow from a flat trend alone. If drain_backflow is missing or unverified, abstain and require qualified verification. If verified backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising.";

function statusClass(status: string): string {
  if (status === "APPROVED") return "badge badge-success";
  if (status === "IN_REVIEW") return "badge badge-warning";
  if (status === "REJECTED" || status === "DEPRECATED") return "badge badge-danger";
  return "badge badge-neutral";
}

export function KnowledgeEvolution({
  preselectedRecId,
  onGoToPill,
  onRefreshPills,
  onGoToLiveCase,
}: {
  preselectedRecId?: string | null;
  onGoToPill?: (pillId: string) => void;
  onRefreshPills?: () => void;
  onGoToLiveCase?: () => void;
  onSelectRec?: (recId: string) => void;
}) {
  const role = getRole();
  const [recId, setRecId] = useState<string | null>(preselectedRecId ?? getActiveRec());
  const [rec, setRec] = useState<RecommendationRecord | null>(null);
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<PillVersion | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomeText, setOutcomeText] = useState("Escalation was right. Engineer found the cause: the floor drain was backing up (backflow). Backflow will not always show as rising water. If the pump keeps pace, the level stays steady and looks safe.");
  const [correction, setCorrection] = useState(cleanText(BASE_CORRECTION));
  const [reviewNote, setReviewNote] = useState("Make the verification requirement explicit and distinguish verified backflow from inference.");
  const [revisionText, setRevisionText] = useState(cleanText(REVISED_CORRECTION));

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const vers = await getPillVersions(OPS_ID);
      setVersions(vers);

      let targetId = preselectedRecId ?? recId ?? getActiveRec();
      if (role === "operator" || role === "approver") {
        const list = await getRecommendations();
        if (!targetId) targetId = list[list.length - 1]?.id ?? null;
        if (targetId) {
          try { setRec(await getRecommendation(targetId)); }
          catch { setRec(null); }
        } else setRec(null);
      } else {
        // Do not retain role-restricted recommendation content in memory when the role changes.
        setRec(null);
      }

      if (targetId) {
        setRecId(targetId);
        setActiveRec(targetId);
      }

      let latestFeedback: string | null = null;
      if (targetId) {
        const stored = getFeedbackIds(targetId);
        const valid: string[] = [];
        for (const id of stored) {
          try { await getFeedback(id); valid.push(id); } catch { /* stale pointer */ }
        }
        if (valid.length !== stored.length) setFeedbackIds(targetId, valid);
        latestFeedback = valid[valid.length - 1] ?? null;
      }
      setFeedbackId(latestFeedback);

      let cand = candidateForFeedback(vers, latestFeedback);
      if (!latestFeedback) {
        cand = [...vers].filter((v) => v.previous_version).sort((a, b) => semverCmp(b.version, a.version))[0] ?? null;
      }
      setCandidate(cand);
      setDiff(null);
      if (cand && ["DRAFT", "IN_REVIEW", "REJECTED"].includes(cand.status)) {
        try { setDiff(await getPillDiff(OPS_ID, cand.previous_version ?? "1.0.0", cand.version)); }
        catch { setDiff(null); }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [preselectedRecId, recId, role]);

  useEffect(() => { void loadData(); }, [loadData]);

  const active = versions.find((v) => v.status === "APPROVED");
  const nextVersion = useMemo(() => nextCandidateVersion(versions), [versions]);
  const latestRejected = useMemo(
    () => [...versions].filter((v) => v.status === "REJECTED").sort((a, b) => semverCmp(b.version, a.version))[0] ?? null,
    [versions]
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await loadData();
      onRefreshPills?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const recordOperationalOutcome = () => recId && run(async () => {
    await recordOutcome(recId, outcomeText.trim(), true, true);
  });

  const submitInitialFeedback = () => recId && run(async () => {
    const response = await submitFeedback(recId, OPS_ID, withPrefix(correction.trim()), nextVersion);
    const id = String(response.id ?? response.feedback_id ?? "");
    if (!id) throw new Error("Feedback ID missing from backend response");
    addFeedbackId(recId, id);
    setFeedbackId(id);
  });

  const generateProposal = () => feedbackId && run(async () => {
    // Show the drafting state for at least a moment (a live model takes several seconds).
    setDrafting(true);
    const started = Date.now();
    try {
      await proposeCandidate(feedbackId);
      const wait = 2800 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    } finally {
      setDrafting(false);
    }
  });

  const submitForReview = () => candidate && run(async () => {
    await transitionPill(OPS_ID, candidate.version, "submit", "Expert checked the structured diff and submitted it for independent review.");
  });

  const recordReview = () => candidate && run(async () => {
    await transitionPill(OPS_ID, candidate.version, "review", reviewNote.trim() || "Independent review completed.");
  });

  const validate = () => candidate && run(async () => {
    await transitionPill(OPS_ID, candidate.version, "validate", "Regression suite executed against the exact reviewed candidate.");
  });

  const reject = () => candidate && run(async () => {
    if (!reviewNote.trim()) throw new Error("A rejection reason is required.");
    await transitionPill(OPS_ID, candidate.version, "reject", reviewNote.trim());
    rememberRejection(OPS_ID, candidate.version, reviewNote.trim(), getRole());
    setRevisionText(cleanText(REVISED_CORRECTION));
  });

  const submitRevisionFeedback = () => recId && run(async () => {
    if (!revisionText.trim()) throw new Error("Enter a revised correction before resubmitting.");
    const response = await submitFeedback(recId, OPS_ID, withPrefix(revisionText.trim()), nextVersion);
    const id = String(response.id ?? response.feedback_id ?? "");
    if (!id) throw new Error("Feedback ID missing from backend response");
    addFeedbackId(recId, id);
    setFeedbackId(id);
  });

  const approve = () => candidate && run(async () => {
    await transitionPill(OPS_ID, candidate.version, "approve", "Approved after independent review and passing validation.");
  });

  const rejectedReason = candidate?.status === "REJECTED"
    ? getRememberedRejection(candidate.pill_id, candidate.version)
    : latestRejected ? getRememberedRejection(latestRejected.pill_id, latestRejected.version) : null;

  const operatorNeedsDecision = role === "operator" && rec && !rec.human_decision;
  const operatorNeedsOutcome = role === "operator" && rec && rec.human_decision && !rec.outcome;
  const operatorNeedsFeedback = role === "operator" && rec && rec.outcome && !feedbackId && !candidate;
  const waitingForProposal = role === "expert" && !!feedbackId && !candidate;

  return (
    <div>
      <div className="case-header">
        <div className="flex gap-8 flex-wrap" style={{ alignItems: "center" }}>
          <span className="case-title">Knowledge Evolution</span>
        </div>
        <div className="case-subtitle">{rec ? `Case from ${sgTime(rec.created_at)} · ` : ""}changes to approved knowledge go through review, testing and approval</div>
      </div>

      {error && <div className="error-box mb-16">{friendlyError(error)}</div>}

      <div className="source-attribution">
        <span className="source-label">Production release:</span>
        <span>{active ? `${active.content.name} v${active.version}` : "No approved release"}</span>
        {candidate && <span className={statusClass(candidate.status)}>Candidate v{candidate.version} · {candidate.status}</span>}
      </div>


      {role !== "operator" && role !== "approver" && recId && (
        <div className="text-muted text-sm mb-16">Case details are visible to operators and approvers only.</div>
      )}

      {!recId && role === "operator" && (
        <div className="callout callout-info">No case selected yet. Cases start in Live Case.</div>
      )}

      {operatorNeedsDecision && (
        <div className="callout callout-warning">
          <strong>Record the escalation in Live Case first.</strong>
          {onGoToLiveCase && <button className="btn btn-primary" style={{ marginLeft: 8 }} onClick={onGoToLiveCase}>Open Live Case</button>}
        </div>
      )}

      {operatorNeedsOutcome && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">1. Record What Actually Happened</span><span className="card-meta">Operator</span></div>
          <div className="card-body">
            <textarea className="note-input mb-8" rows={4} value={outcomeText} onChange={(e) => setOutcomeText(e.target.value)} disabled={busy} />
            <button className="btn btn-primary" disabled={busy || !outcomeText.trim()} onClick={recordOperationalOutcome}>{busy ? "Recording…" : "Record Outcome"}</button>
          </div>
        </div>
      )}

      {operatorNeedsFeedback && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">2. Submit a Correction</span><span className="card-meta">Operator</span></div>
          <div className="card-body">
            <textarea className="note-input mb-8" rows={5} value={correction} onChange={(e) => setCorrection(e.target.value)} disabled={busy} />
            <div className="text-muted mb-8">Proposed version: v{nextVersion}</div>
            <button className="btn btn-primary" disabled={busy || !correction.trim()} onClick={submitInitialFeedback}>Submit Feedback</button>
          </div>
        </div>
      )}

      {waitingForProposal && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">3. AI proposal</span><span className="card-meta">Expert</span></div>
          <div className="card-body">
            <div className="text-dim mb-16">AI will draft v{nextVersion} from the feedback.</div>
            {latestRejected && <div className="text-dim mb-16">This feedback follows rejected v{latestRejected.version}; the new proposal will be v{nextVersion} and must pass the full governance cycle again.</div>}
            {drafting ? (
              <div className="ai-skeleton" aria-label="Drafting proposal">
                <div className="ai-writing">AI is drafting v{nextVersion} from the feedback…</div>
                <span /><span /><span />
              </div>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={generateProposal}>Generate AI Proposal</button>
            )}
          </div>
        </div>
      )}

      {candidate?.status === "DRAFT" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">4. Check the proposed changes</span><span className="card-meta">v{candidate.previous_version} → v{candidate.version}</span></div>
          <div className="card-body">
            <div className="callout callout-warning mb-16">v{candidate.previous_version} stays in use until this is approved.</div>
            <div className="section-heading">Why it changed</div><div className="text-dim mb-16">{candidate.change_reason.replace(/^SYNTHETIC CORRECTION:\s*/, "")}</div>
            <div className="section-heading">What changes <span className="ai-tag">AI-drafted</span></div>
            {active ? <PlainChanges before={active.content} after={candidate.content} /> : <div className="text-muted">Current version unavailable.</div>}
            {diff?.changes.length ? (
              <details className="raw-diff mb-16">
                <summary>Technical diff ({diff.changes.length} field changes)</summary>
                {diff.changes.map((change, i) => (
                  <div className="diff-added" key={i}><div className="diff-path">{change.path}</div><div className="text-sm">Before: {JSON.stringify(change.before)}<br />After: {JSON.stringify(change.after)}</div></div>
                ))}
              </details>
            ) : null}
            {role === "expert" ? <button className="btn btn-primary" disabled={busy} onClick={submitForReview}>Submit for Independent Review</button> : <WaitingFor role="expert" task="check and submit this proposal" />}
            {onGoToPill && <div className="mt-8"><span className="pill-link" onClick={() => onGoToPill(OPS_ID)}>Inspect full Pill →</span></div>}
          </div>
        </div>
      )}

      {candidate?.status === "IN_REVIEW" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">5. Independent review & test situations</span><span className="card-meta">Reviewer</span></div>
          <div className="card-body">
            <div className="kv mb-16"><div><dt>Review</dt><dd>{candidate.review ? "Recorded" : "Pending"}</dd></div><div><dt>Validation</dt><dd>{candidate.validation ? (candidate.validation.passed === true ? "Passed" : "Failed") : "Pending"}</dd></div></div>
            {role === "reviewer" ? (
              <>
                {candidate.review && candidate.validation && (
                  <div className="text-dim mb-8">
                    Review and test situations are done — this now goes to {persona("approver").name} (Approver) for the release decision. You can still reject it before release.
                  </div>
                )}
                <div className="section-heading">Reviewer note / rejection reason</div>
                <textarea className="note-input mb-8" rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={busy} />
                <div className="flex gap-8 flex-wrap">
                  {!candidate.review && <button className="btn btn-primary" disabled={busy} onClick={recordReview}>Record Independent Review</button>}
                  {candidate.review && !candidate.validation && <button className="btn btn-primary" disabled={busy} onClick={validate}>Run Validation</button>}
                  {candidate.review && <button className="btn btn-danger" disabled={busy || !reviewNote.trim()} onClick={reject}>Reject with Reason</button>}
                </div>
              </>
            ) : candidate.review && candidate.validation ? (
              <WaitingFor role="approver" task="make the release decision" />
            ) : <WaitingFor role="reviewer" task="review it and run the test situations" />}
          </div>
        </div>
      )}

      {candidate?.status === "REJECTED" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">Rejected — revise and resubmit</span><span className="card-meta">v{candidate.version}</span></div>
          <div className="card-body">
            <div className="callout callout-danger mb-16"><strong>v{candidate.version} was not released.</strong> v{candidate.previous_version} remains active.</div>
            <div className="section-heading">Reviewer&apos;s reason</div>
            <div className="rejected-reason mb-16">{rejectedReason ? `“${rejectedReason.note}” — ${actorLabel(rejectedReason.actor)}` : "The rejection is recorded in the audit trail."}</div>
            {role === "expert" ? (
              <>
                <div className="section-heading">Revised correction</div>
                <div className="text-dim mb-8">Edit the correction to address the reviewer&apos;s reason.</div>
                <textarea className="note-input mb-8" rows={7} value={revisionText} onChange={(e) => setRevisionText(e.target.value)} disabled={busy} />
                <button className="btn btn-primary" disabled={busy || !revisionText.trim() || revisionText.trim() === cleanText(candidate.change_reason)} onClick={submitRevisionFeedback}>Submit Revised Feedback for v{nextVersion}</button>
              </>
            ) : <WaitingFor role="expert" task="revise and resubmit" />}
          </div>
        </div>
      )}

      {candidate?.status === "IN_REVIEW" && candidate.review && candidate.validation && role === "approver" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">6. Release Decision</span><span className="card-meta">Approver</span></div>
          <div className="card-body">
            <div className="callout callout-warning mb-16">Approving v{candidate.version} supersedes v{candidate.previous_version}.</div>
            <button className="btn btn-primary" disabled={busy || candidate.validation.passed !== true} onClick={approve}>{busy ? "Approving…" : `Approve v${candidate.version}`}</button>
          </div>
        </div>
      )}

      {candidate?.status === "APPROVED" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">Governance Cycle Complete</span></div>
          <div className="card-body">
            <div className="callout callout-success mb-16"><strong>v{candidate.version} is approved and active.</strong> v{candidate.previous_version} remains readable as superseded history.</div>
            <div className="text-dim mb-16">The next Operator assessment can now use the learned <strong>flat water + verified backflow</strong> scenario.</div>
            <div className="flex gap-8 flex-wrap">
              {onGoToLiveCase && <button className="btn btn-primary" onClick={onGoToLiveCase}>Open Live Case</button>}
              {onGoToPill && <button className="btn" onClick={() => onGoToPill(OPS_ID)}>Inspect Version Lineage</button>}
            </div>
            {role !== "operator" && <div className="mt-16"><DemoHint>New assessments are run by the operator — switch to Operator at top right.</DemoHint></div>}
          </div>
        </div>
      )}

      {role === "operator" && rec && rec.outcome && feedbackId && !candidate && (
        <WaitingFor role="expert" task="generate the AI proposal" />
      )}

      {role === "expert" && !feedbackId && !candidate && recId && (
        <WaitingFor role="operator" task="report what happened and what was missed" />
      )}
    </div>
  );
}
