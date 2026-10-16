import { useCallback, useEffect, useMemo, useState } from "react";
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

function actor(value: string): string {
  return value.replace(/^demo[-_]/, "").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function short(value: string | null): string {
  return value ? `${value.slice(0, 8)}…` : "—";
}

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
  const [error, setError] = useState<string | null>(null);
  const [outcomeText, setOutcomeText] = useState("Duty team assessment identified intermittent drain backflow. Water readings appeared flat but the drain was backflowing.");
  const [correction, setCorrection] = useState(BASE_CORRECTION);
  const [reviewNote, setReviewNote] = useState("Make the verification requirement explicit and distinguish verified backflow from inference.");
  const [revisionText, setRevisionText] = useState(REVISED_CORRECTION);

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
    const response = await submitFeedback(recId, OPS_ID, correction.trim(), nextVersion);
    const id = String(response.id ?? response.feedback_id ?? "");
    if (!id) throw new Error("Feedback ID missing from backend response");
    addFeedbackId(recId, id);
    setFeedbackId(id);
  });

  const generateProposal = () => feedbackId && run(async () => {
    await proposeCandidate(feedbackId);
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
    setRevisionText(REVISED_CORRECTION);
  });

  const submitRevisionFeedback = () => recId && run(async () => {
    if (!revisionText.trim()) throw new Error("Enter a revised correction before resubmitting.");
    const response = await submitFeedback(recId, OPS_ID, revisionText.trim(), nextVersion);
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
          <span className="synthetic-badge">Synthetic demo flow</span>
        </div>
        <div className="case-subtitle">Recommendation {short(recId)} · approved knowledge changes only after review, validation and approval</div>
      </div>

      {error && <div className="error-box mb-16">{error}</div>}

      <div className="source-attribution">
        <span className="source-label">Production release:</span>
        <span>{active ? `${active.content.name} v${active.version}` : "No approved release"}</span>
        {candidate && <span className={statusClass(candidate.status)}>Candidate v{candidate.version} · {candidate.status}</span>}
      </div>

      <div className="ai-proposal-banner mb-16">
        <span className="banner-text">AI CAN PROPOSE — IT CANNOT RELEASE KNOWLEDGE.</span>
        <span className="banner-sub">The approved version remains authoritative until the human governance cycle completes.</span>
      </div>

      {role !== "operator" && role !== "approver" && recId && (
        <div className="callout callout-info mb-16">
          Recommendation details are intentionally hidden from this role. This screen keeps only opaque record IDs in browser storage; the governance state below is read from the backend.
        </div>
      )}

      {!recId && (
        <div className="callout callout-info">No operational recommendation is selected. Start from Live Case as Operator.</div>
      )}

      {operatorNeedsDecision && (
        <div className="callout callout-warning">
          <strong>Record the accountable escalation first.</strong> Learning starts only after a human decision.
          {onGoToLiveCase && <button className="btn btn-primary" style={{ marginLeft: 8 }} onClick={onGoToLiveCase}>Open Live Case</button>}
        </div>
      )}

      {operatorNeedsOutcome && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">1. Record What Actually Happened</span><span className="card-meta">Operator</span></div>
          <div className="card-body">
            <div className="text-dim mb-8">The outcome is stored separately from the recommendation so later learning remains traceable.</div>
            <textarea className="note-input mb-8" rows={4} value={outcomeText} onChange={(e) => setOutcomeText(e.target.value)} disabled={busy} />
            <button className="btn btn-primary" disabled={busy || !outcomeText.trim()} onClick={recordOperationalOutcome}>{busy ? "Recording…" : "Record Outcome"}</button>
          </div>
        </div>
      )}

      {operatorNeedsFeedback && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">2. Submit a Correction</span><span className="card-meta">Operator</span></div>
          <div className="card-body">
            <div className="text-dim mb-8">Feedback does not change the approved Pill. It creates a separate learning record for an Expert to assess.</div>
            <textarea className="note-input mb-8" rows={5} value={correction} onChange={(e) => setCorrection(e.target.value)} disabled={busy} />
            <div className="text-muted mb-8">Proposed version: v{nextVersion}</div>
            <button className="btn btn-primary" disabled={busy || !correction.trim()} onClick={submitInitialFeedback}>Submit Feedback</button>
          </div>
        </div>
      )}

      {waitingForProposal && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">3. Generate AI Candidate</span><span className="card-meta">Expert</span></div>
          <div className="card-body">
            <div className="callout callout-ai mb-16"><strong>AI proposal — not production knowledge.</strong> Feedback {short(feedbackId)} will create a DRAFT successor.</div>
            {latestRejected && <div className="text-dim mb-16">This feedback follows rejected v{latestRejected.version}; the new proposal will be v{nextVersion} and must pass the full governance cycle again.</div>}
            <button className="btn btn-primary" disabled={busy} onClick={generateProposal}>{busy ? "Generating…" : "Generate AI Proposal"}</button>
          </div>
        </div>
      )}

      {candidate?.status === "DRAFT" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">4. Expert Review of Candidate Diff</span><span className="card-meta">v{candidate.previous_version} → v{candidate.version}</span></div>
          <div className="card-body">
            <div className="callout callout-warning mb-16"><strong>v{candidate.previous_version} remains active.</strong> This draft cannot affect runtime.</div>
            <div className="section-heading">Change reason</div><div className="text-dim mb-16">{candidate.change_reason}</div>
            <div className="section-heading">Structured changes</div>
            <div className="mb-16">
              {diff?.changes.length ? diff.changes.map((change, i) => (
                <div className="diff-added" key={i}><div className="diff-path">{change.path}</div><div className="text-sm">Before: {JSON.stringify(change.before)}<br />After: {JSON.stringify(change.after)}</div></div>
              )) : <div className="text-muted">Diff unavailable for this role.</div>}
            </div>
            <div className="text-muted mb-8">Regression obligations in candidate: {candidate.content.evaluation.length}</div>
            {role === "expert" ? <button className="btn btn-primary" disabled={busy} onClick={submitForReview}>Submit for Independent Review</button> : <div className="switch-role-hint">Switch to Expert to submit this candidate.</div>}
            {onGoToPill && <div className="mt-8"><span className="pill-link" onClick={() => onGoToPill(OPS_ID)}>Inspect full Pill →</span></div>}
          </div>
        </div>
      )}

      {candidate?.status === "IN_REVIEW" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">5. Independent Review & Regression Validation</span><span className="card-meta">Reviewer</span></div>
          <div className="card-body">
            <div className="kv mb-16"><div><dt>Review</dt><dd>{candidate.review ? "Recorded" : "Pending"}</dd></div><div><dt>Validation</dt><dd>{candidate.validation ? (candidate.validation.passed === true ? "Passed" : "Failed") : "Pending"}</dd></div></div>
            {role === "reviewer" ? (
              <>
                <div className="section-heading">Reviewer note / rejection reason</div>
                <textarea className="note-input mb-8" rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={busy} />
                <div className="flex gap-8 flex-wrap">
                  {!candidate.review && <button className="btn btn-primary" disabled={busy} onClick={recordReview}>Record Independent Review</button>}
                  {candidate.review && !candidate.validation && <button className="btn btn-primary" disabled={busy} onClick={validate}>Run Validation</button>}
                  {candidate.review && <button className="btn btn-danger" disabled={busy || !reviewNote.trim()} onClick={reject}>Reject with Reason</button>}
                </div>
              </>
            ) : candidate.review && candidate.validation ? (
              <div className="switch-role-hint">Review and validation are complete. Switch to Approver for the release decision.</div>
            ) : <div className="switch-role-hint">Switch to Reviewer to continue.</div>}
          </div>
        </div>
      )}

      {candidate?.status === "REJECTED" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">Rejected Candidate — Revise, Do Not Reuse</span><span className="card-meta">v{candidate.version}</span></div>
          <div className="card-body">
            <div className="callout callout-danger mb-16"><strong>v{candidate.version} was not released.</strong> v{candidate.previous_version} remains active.</div>
            <div className="section-heading">Reviewer&apos;s reason</div>
            <div className="rejected-reason mb-16">{rejectedReason ? `“${rejectedReason.note}” — ${actor(rejectedReason.actor)}` : "The rejection is recorded in the audit trail."}</div>
            {role === "expert" ? (
              <>
                <div className="section-heading">Revised correction</div>
                <div className="text-dim mb-8">Edit the knowledge so it actually addresses the reviewer&apos;s concern. A rejected candidate is never edited in place.</div>
                <textarea className="note-input mb-8" rows={7} value={revisionText} onChange={(e) => setRevisionText(e.target.value)} disabled={busy} />
                <div className="text-muted mb-8">This creates new feedback for candidate v{nextVersion}; the reviewer must assess it again.</div>
                <button className="btn btn-primary" disabled={busy || !revisionText.trim() || revisionText.trim() === candidate.change_reason.trim()} onClick={submitRevisionFeedback}>Submit Revised Feedback for v{nextVersion}</button>
              </>
            ) : <div className="switch-role-hint">Switch to Expert to respond to the rejection with an edited correction.</div>}
          </div>
        </div>
      )}

      {candidate?.status === "IN_REVIEW" && candidate.review && candidate.validation && role === "approver" && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">6. Release Decision</span><span className="card-meta">Approver</span></div>
          <div className="card-body">
            <div className="callout callout-warning mb-16">Approving v{candidate.version} supersedes v{candidate.previous_version}. The backend rechecks exact review, validation and inherited regressions at release time.</div>
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
            {role !== "operator" && <div className="callout callout-info mt-16">Switch to <strong>Operator</strong> before running a new assessment. Approver can inspect but cannot create operational cases.</div>}
          </div>
        </div>
      )}

      {role === "operator" && rec && rec.outcome && feedbackId && !candidate && (
        <div className="switch-role-hint">Feedback recorded. Switch to Expert to generate the candidate proposal.</div>
      )}

      {role === "expert" && !feedbackId && !candidate && recId && (
        <div className="callout callout-info">No feedback record is available for this recommendation yet. Switch to Operator and submit feedback first; the UI will not silently create duplicate feedback.</div>
      )}
    </div>
  );
}
