import { useState, useEffect, useCallback } from "react";
import type {
  RecommendationRecord,
  PillVersion,
  DiffResult,
  DiffChange,
} from "../types";
import {
  getRecommendation,
  getRecommendations,
  getPillVersions,
  getPillDiff,
  recordOutcome,
  submitFeedback,
  proposeCandidate,
  transitionPill,
  getRole,
} from "../api";

const OPS_ID = "asset.monsoon.triage";

const STEPS = [
  { key: "outcome", label: "Outcome", role: "operator" },
  { key: "feedback", label: "Feedback", role: "operator" },
  { key: "proposal", label: "AI proposal", role: "expert" },
  { key: "diff", label: "Diff", role: "expert" },
  { key: "tests", label: "Tests", role: "reviewer" },
  { key: "approval", label: "Approval", role: "approver" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

interface StepState {
  outcomeDone: boolean;
  feedbackDone: boolean;
  proposalDone: boolean;
  diffDone: boolean;
  testsDone: boolean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}

function capitaliseActor(actor: string): string {
  if (!actor) return "—";
  return actor.charAt(0).toUpperCase() + actor.slice(1);
}

// --- Main component ---

export function KnowledgeEvolution({
  preselectedRecId,
  onGoToPill,
  onRefreshPills,
}: {
  preselectedRecId?: string | null;
  onGoToPill?: (pillId: string) => void;
  onRefreshPills?: () => void;
}) {
  const role = getRole();
  const [recs, setRecs] = useState<RecommendationRecord[]>([]);
  const [selectedRec, setSelectedRec] = useState<RecommendationRecord | null>(null);
  const [pillVersions, setPillVersions] = useState<PillVersion[]>([]);
  const [candidate, setCandidate] = useState<PillVersion | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepDone, setStepDone] = useState<StepState>({
    outcomeDone: false,
    feedbackDone: false,
    proposalDone: false,
    diffDone: false,
    testsDone: false,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let target: RecommendationRecord | null = null;
      if (preselectedRecId) {
        target = await getRecommendation(preselectedRecId);
      } else {
        // Try to get all recommendations (operator/approver only)
        // If forbidden, we'll get the specific one from the candidate pill's audit history
        try {
          const allRecs = await getRecommendations();
          setRecs(allRecs);
          target = allRecs.find((r) => r.human_decision && !r.outcome) ?? allRecs[allRecs.length - 1] ?? null;
        } catch {
          // Fall back: if there's a candidate pill, find the recommendation from its evidence
          const vers = await getPillVersions(OPS_ID);
          setPillVersions(vers);
          const candidate = vers.find((v) => v.status === "DRAFT" || v.status === "IN_REVIEW");
          if (candidate) {
            // Use the candidate's previous recommendation as the target
            // For now, try the first recommendation via the audit endpoint
            // We'll need to find the rec_id from the candidate's content
            // The change_reason contains the recommendation context
            // For the demo, we know the first recommendation
            const fbEvidence = candidate.content.evidence.find((e) => e.kind === "feedback");
            if (fbEvidence) {
              const recIdMatch = fbEvidence.citation.match(/rec[_-]?([a-f0-9]{8})/i);
              if (recIdMatch) {
                try {
                  target = await getRecommendation(recIdMatch[1]);
                } catch { /* ignore */ }
              }
            }
          }
        }
      }
      if (target) {
        setSelectedRec(target);
        await refreshState(target);
      } else if (!preselectedRecId) {
        // No preselected rec and no accessible recs — show a helpful message
        setError("No recommendations accessible from this role. Start from the Live Case screen as an Operator.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedRecId]);

  const refreshState = useCallback(async (rec: RecommendationRecord) => {
    // Reset state
    setCandidate(null);
    setDiff(null);

    let candidatePill: PillVersion | null = null;

    // Load pill versions
    try {
      const vers = await getPillVersions(OPS_ID);
      setPillVersions(vers);
      // Find DRAFT (candidate) if exists
      const draft = vers.find((v) => v.status === "DRAFT" || v.status === "IN_REVIEW") ?? null;
      if (draft) {
        setCandidate(draft);
        candidatePill = draft;
        // Load diff
        try {
          const d = await getPillDiff(OPS_ID, draft.previous_version ?? "1.0.0", draft.version);
          setDiff(d);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    // Update step state — based on the candidate pill only
    setStepDone({
      outcomeDone: !!rec.outcome,
      feedbackDone: !!rec.outcome, // feedback requires outcome first
      proposalDone: !!candidatePill,
      diffDone: !!diff,
      testsDone: !!candidatePill?.validation,
    });
  }, [diff]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-load data on role change (some endpoints require specific roles)
  useEffect(() => {
    if (selectedRec) {
      refreshState(selectedRec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Compute current step
  const currentStep = computeCurrentStep(selectedRec, stepDone, candidate);
  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const currentStepRole = STEPS[currentStepIndex]?.role ?? "operator";

  const canDoCurrentStep = role === currentStepRole;

  if (loading) {
    return <div className="loading">Loading Knowledge Evolution flow from backend…</div>;
  }

  if (error && !selectedRec) {
    return (
      <div>
        <div className="error-box">
          <strong>Backend connection error:</strong> {error}
        </div>
        <div className="callout callout-info">
          Knowledge Evolution requires a recommendation with an escalation decision.
          Start from the <strong>Live Case</strong> screen.
        </div>
      </div>
    );
  }

  if (!selectedRec) {
    return (
      <div className="callout callout-info">
        No recommendations found. Create a case on the <strong>Live Case</strong> screen first.
      </div>
    );
  }

  const allDone = currentStepIndex >= STEPS.length || (candidate?.status === "APPROVED");

  return (
    <div>
      {/* Header */}
      <div className="case-header">
        <div className="flex-between">
          <div className="flex gap-16 flex-wrap" style={{ alignItems: "center" }}>
            <span className="case-title">Knowledge Evolution</span>
            <span className="synthetic-badge">Synthetic demo flow</span>
          </div>
          {recs.length > 1 && (
            <select
              className="rec-select"
              value={selectedRec.id}
              onChange={async (e) => {
                const r = await getRecommendation(e.target.value);
                setSelectedRec(r);
                await refreshState(r);
              }}
            >
              {recs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.result.decision} · {r.created_at.slice(11, 19)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="case-subtitle">
          Recommendation: {selectedRec.id.slice(0, 8)}… · Decision: {selectedRec.result.decision}
          {selectedRec.human_decision ? ` · Escalation recorded by ${capitaliseActor(selectedRec.human_decision.actor)}` : ""}
        </div>
      </div>

      {/* AI proposal banner if candidate exists */}
      {candidate && candidate.status !== "APPROVED" && (
        <div className="ai-proposal-banner">
          <span className="banner-icon">⚠</span>
          <span className="banner-text">AI PROPOSAL — NOT PRODUCTION KNOWLEDGE.</span>
          <span className="banner-sub">v{candidate.previous_version ?? "1.0.0"} remains active.</span>
        </div>
      )}

      {/* Progress stepper */}
      <ProgressStepper
        steps={STEPS}
        currentIndex={currentStepIndex}
        doneStates={{
          outcome: stepDone.outcomeDone,
          feedback: stepDone.feedbackDone,
          proposal: stepDone.proposalDone,
          diff: stepDone.diffDone,
          tests: stepDone.testsDone,
        }}
        allDone={allDone}
      />

      {/* Role gate */}
      {!canDoCurrentStep && !allDone && (
        <div className="switch-role-hint">
          <span className="hint-text">
            Switch to <span className="hint-role">{currentStepRole}</span> to continue.
          </span>
        </div>
      )}

      {/* Step content */}
      {allDone ? (
        <PostApprovalTimeline
          pillVersions={pillVersions}
          candidate={candidate}
          onGoToPill={onGoToPill}
        />
      ) : currentStep === "outcome" ? (
        <OutcomeStep
          rec={selectedRec}
          canAct={canDoCurrentStep}
          onOutcomeRecorded={async () => {
            const updated = await getRecommendation(selectedRec.id);
            setSelectedRec(updated);
            setStepDone((s) => ({ ...s, outcomeDone: true }));
          }}
        />
      ) : currentStep === "feedback" ? (
        <FeedbackStep
          rec={selectedRec}
          canAct={canDoCurrentStep}
          onFeedbackSubmitted={async () => {
            const updated = await getRecommendation(selectedRec.id);
            setSelectedRec(updated);
            setStepDone((s) => ({ ...s, feedbackDone: true }));
          }}
        />
      ) : currentStep === "proposal" ? (
        <ProposalStep
          rec={selectedRec}
          canAct={canDoCurrentStep}
          onProposed={async (c) => {
            setCandidate(c);
            const vers = await getPillVersions(OPS_ID);
            setPillVersions(vers);
            try {
              const d = await getPillDiff(OPS_ID, c.previous_version ?? "1.0.0", c.version);
              setDiff(d);
            } catch { /* ignore */ }
            setStepDone((s) => ({ ...s, proposalDone: true }));
          }}
        />
      ) : currentStep === "diff" ? (
        <DiffStep
          diff={diff}
          candidate={candidate}
          canAct={canDoCurrentStep}
          onReviewed={() => {
            setStepDone((s) => ({ ...s, diffDone: true }));
          }}
          onGoToPill={onGoToPill}
        />
      ) : currentStep === "tests" ? (
        <TestsStep
          candidate={candidate}
          canAct={canDoCurrentStep}
          onValidated={async (updated) => {
            setCandidate(updated);
            setStepDone((s) => ({ ...s, testsDone: true }));
          }}
        />
      ) : currentStep === "approval" ? (
        <ApprovalStep
          candidate={candidate}
          canAct={canDoCurrentStep}
          onApproved={async (approved) => {
            setCandidate(approved);
            const vers = await getPillVersions(OPS_ID);
            setPillVersions(vers);
            setStepDone((s) => ({
              ...s,
              testsDone: true,
              diffDone: true,
              proposalDone: true,
            }));
            onRefreshPills?.();
          }}
        />
      ) : null}
    </div>
  );
}

// --- Progress Stepper ---

function ProgressStepper({
  steps,
  currentIndex,
  doneStates,
  allDone,
}: {
  steps: typeof STEPS;
  currentIndex: number;
  doneStates: Record<string, boolean>;
  allDone: boolean;
}) {
  return (
    <div className="progress-stepper">
      {steps.map((step, i) => {
        const isDone = allDone || (doneStates[step.key] === true);
        const isCurrent = !allDone && i === currentIndex;
        return (
          <div key={step.key} className={`progress-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}>
            <div className="progress-step-dot">{i + 1}</div>
            <div className="progress-step-label">{step.label}</div>
            <div className="progress-step-role">{step.role}</div>
            {i < steps.length - 1 && <div className="progress-step-connector" />}
          </div>
        );
      })}
    </div>
  );
}

// --- Compute current step ---

function computeCurrentStep(
  rec: RecommendationRecord | null,
  done: StepState,
  candidate: PillVersion | null
): StepKey {
  if (!rec) return "outcome";
  if (!rec.human_decision) return "outcome";
  if (!rec.outcome) return "outcome";
  if (!candidate) {
    if (!done.feedbackDone) return "feedback";
    return "proposal";
  }
  if (candidate.status === "DRAFT") {
    if (!done.diffDone) return "diff";
    return "tests";
  }
  if (candidate.status === "IN_REVIEW") {
    if (!candidate.validation) return "tests";
    return "approval";
  }
  if (candidate.status === "APPROVED") return "approval"; // all done
  return "outcome";
}

// --- Outcome Step ---

function OutcomeStep({
  rec,
  canAct,
  onOutcomeRecorded,
}: {
  rec: RecommendationRecord;
  canAct: boolean;
  onOutcomeRecorded: () => void;
}) {
  const [summary, setSummary] = useState(
    "Duty team assessment identified intermittent drain backflow. Water readings appeared flat but the drain was backflowing."
  );
  const [resolved, setResolved] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await recordOutcome(rec.id, summary, resolved, true);
      onOutcomeRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 1: Record Outcome</span>
        <span className="card-meta">Role: Operator</span>
      </div>
      <div className="card-body">
        {rec.outcome ? (
          <div>
            <div className="flex gap-8 mb-16 flex-wrap">
              <span className="badge badge-success">Outcome recorded</span>
            </div>
            <div className="kv">
              <div><dt>Summary</dt><dd>{rec.outcome.summary}</dd></div>
              <div><dt>Resolved</dt><dd>{String(rec.outcome.resolved)}</dd></div>
              <div><dt>Recorded by</dt><dd>{capitaliseActor(rec.outcome.actor)} <span className="demo-persona">· demo persona</span></dd></div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-dim mb-16">
              Record what actually happened after the escalation. This feeds the feedback loop.
            </div>
            <div className="mb-16">
              <div className="section-heading">Outcome Summary</div>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="note-input"
                disabled={submitting || !canAct}
              />
            </div>
            <div className="mb-16">
              <label className="flex gap-8" style={{ alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={resolved}
                  onChange={(e) => setResolved(e.target.checked)}
                  disabled={submitting || !canAct}
                />
                <span className="text-dim">Issue resolved</span>
              </label>
            </div>
            {error && <div className="error-box mb-16">{error}</div>}
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || !summary.trim() || !canAct}
            >
              {submitting ? "Recording…" : "Record Outcome"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Feedback Step ---

function FeedbackStep({
  rec,
  canAct,
  onFeedbackSubmitted,
}: {
  rec: RecommendationRecord;
  canAct: boolean;
  onFeedbackSubmitted: () => void;
}) {
  const [correction, setCorrection] = useState(
    "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified drain_backflow observation. If backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising."
  );
  const [proposedVersion] = useState("1.1.0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback(rec.id, OPS_ID, correction, proposedVersion);
      onFeedbackSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 2: Submit Feedback</span>
        <span className="card-meta">Role: Operator</span>
      </div>
      <div className="card-body">
        <div className="text-dim mb-16">
          What was wrong or missing in the recommendation? This correction feeds the AI proposal.
        </div>
        <div className="mb-16">
          <div className="section-heading">Correction</div>
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={3}
            className="note-input"
            disabled={submitting || !canAct}
          />
        </div>
        <div className="mb-16">
          <div className="section-heading">Proposed Version</div>
          <span className="code-inline">v{proposedVersion}</span>
        </div>
        {error && <div className="error-box mb-16">{error}</div>}
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={submitting || !correction.trim() || !canAct}
        >
          {submitting ? "Submitting…" : "Submit Feedback"}
        </button>
      </div>
    </div>
  );
}

// --- Proposal Step ---

function ProposalStep({
  rec,
  canAct,
  onProposed,
}: {
  rec: RecommendationRecord;
  canAct: boolean;
  onProposed: (candidate: PillVersion) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePropose = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // The feedback was already submitted in Step 2 — use it to get the feedback_id
      // by re-submitting with the same text (the backend will return the existing feedback)
      const correction = "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified drain_backflow observation. If backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising.";
      const fbResponse = await submitFeedback(rec.id, OPS_ID, correction, "1.1.0") as Record<string, unknown>;
      const feedbackId = (fbResponse.id as string) ?? (fbResponse.feedback_id as string);
      if (!feedbackId) throw new Error("Could not determine feedback ID");
      const candidate = await proposeCandidate(feedbackId);
      onProposed(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 3: AI Proposal</span>
        <span className="card-meta">Role: Expert</span>
      </div>
      <div className="card-body">
        <div className="callout callout-warning mb-16">
          <strong>AI Proposal — not production knowledge.</strong> The AI will generate a draft
          revision (v1.1.0) based on the feedback. v1.0.0 remains the active approved version
          until the full governance cycle completes.
        </div>
        <div className="text-dim mb-16">
          The AI reads the feedback and current pill content, then proposes a revised draft.
          The draft includes new rules, inputs, and regression cases derived from the correction.
        </div>
        {error && <div className="error-box mb-16">{error}</div>}
        <button
          className="btn btn-primary"
          onClick={handlePropose}
          disabled={submitting || !canAct}
        >
          {submitting ? "Generating proposal…" : "Generate AI Proposal"}
        </button>
      </div>
    </div>
  );
}

// --- Diff Step ---

function DiffStep({
  diff,
  candidate,
  canAct,
  onReviewed,
  onGoToPill,
}: {
  diff: DiffResult | null;
  candidate: PillVersion | null;
  canAct: boolean;
  onReviewed: () => void;
  onGoToPill?: (pillId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitForReview = async () => {
    if (!candidate) return;
    setSubmitting(true);
    setError(null);
    try {
      await transitionPill(OPS_ID, candidate.version, "submit", "Submitted for review after diff review.");
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!diff || !candidate) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">Step 4: Review Diff</span>
          <span className="card-meta">Role: Expert</span>
        </div>
        <div className="card-body">
          <div className="text-muted">No diff available.</div>
        </div>
      </div>
    );
  }

  const isDraft = candidate.status === "DRAFT";

  const changes = diff.changes;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 4: Review Diff</span>
        <span className="card-meta">Role: Expert · v{diff.from_version} → v{diff.to_version}</span>
      </div>
      <div className="card-body">
        {/* AI proposal banner */}
        <div className="ai-proposal-banner">
          <span className="banner-icon">⚠</span>
          <span className="banner-text">AI PROPOSAL — NOT PRODUCTION KNOWLEDGE.</span>
          <span className="banner-sub">v{diff.from_version} remains active.</span>
        </div>

        {/* Change reason */}
        <div className="mb-16">
          <div className="section-heading">Change Reason</div>
          <div className="text-dim">{diff.change_reason}</div>
        </div>

        {/* Readable changes */}
        <div className="section-heading">Changes in Readable Language</div>
        <div className="mb-16">
          {changes.map((change, i) => (
            <DiffChangeRow key={i} change={change} />
          ))}
        </div>

        {/* Regression cases */}
        <div className="section-divider" />
        <div className="section-heading">Regression Cases</div>
        <div className="mb-16">
          {candidate.content.evaluation.map((tc, i) => {
            const id = (tc.id as string) ?? `case-${i}`;
            const isNew = id === "flat-but-backflow";
            const expectedDecision = (tc.expected_decision as string) ?? "ABSTAIN";
            const expectedActions = (tc.expected_actions as string[]) ?? [];
            const expectedBlocked = (tc.expected_blocked as string[]) ?? [];
            const title = buildRegressionTitleFromInputs(tc as Record<string, unknown>) || id;
            const decisionLabel = expectedDecision === "ESCALATE" ? "Escalate" : expectedDecision === "HUMAN_REVIEW" ? "Human review" : "Abstain — not enough data";
            return (
              <div key={i} className={`regression-row ${!isNew ? "locked" : ""}`}>
                <div className="regression-row-header">
                  <span className="regression-row-title">{title}</span>
                  <span className="regression-row-arrow">→</span>
                  <span className={
                    expectedDecision === "ESCALATE" ? "badge badge-warning" :
                    expectedDecision === "HUMAN_REVIEW" ? "badge badge-info" :
                    "badge badge-neutral"
                  }>{decisionLabel}</span>
                  {isNew ? (
                    <span className="regression-row-badge-new">New in v{candidate.version}</span>
                  ) : (
                    <span className="regression-row-badge-inherited">Inherited — cannot be removed</span>
                  )}
                </div>
                {expectedActions.length > 0 && (
                  <div className="regression-row-actions">
                    <div className="action-group">
                      <span className="action-group-label">Expects:</span>
                      <span>{expectedActions.map(formatActionName).join(", ")}</span>
                    </div>
                  </div>
                )}
                {expectedBlocked.length > 0 && (
                  <div className="regression-row-actions">
                    <div className="action-group" style={{ color: "var(--danger)" }}>
                      <span className="action-group-label">Blocks:</span>
                      <span>{expectedBlocked.map(formatActionName).join(", ")}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        {error && <div className="error-box mb-16">{error}</div>}
        {canAct && isDraft && (
          <button
            className="btn btn-primary"
            onClick={handleSubmitForReview}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit for Review"}
          </button>
        )}
        {canAct && !isDraft && (
          <button className="btn btn-primary" onClick={onReviewed}>
            Reviewed — Proceed to Tests
          </button>
        )}
        {onGoToPill && (
          <div className="mt-8">
            <span className="pill-link" onClick={() => onGoToPill(OPS_ID)}>
              View full pill on Intelligence Pills →
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffChangeRow({ change }: { change: DiffChange }) {
  const readablePath = humanisePath(change.path);
  const before = change.before;
  const after = change.after;

  // Determine change type
  const isAdded = before === null || before === undefined;
  const isRemoved = after === null || after === undefined;

  const cls = isAdded ? "diff-added" : isRemoved ? "diff-removed" : "diff-modified";
  const label = isAdded ? "Added" : isRemoved ? "Removed" : "Modified";
  const summary = summariseChange(change);

  return (
    <div className={cls}>
      <div className="diff-path">{readablePath} — {label}</div>
      <div className="text-sm">{summary}</div>
    </div>
  );
}

function summariseChange(change: DiffChange): React.ReactNode {
  const { before, after } = change;
  const isAdded = before === null || before === undefined;
  const isRemoved = after === null || after === undefined;

  if (isAdded) return describeObject(after, "Now");
  if (isRemoved) return describeObject(before, "Was");
  if (typeof before === "string" && typeof after === "string") {
    return <span>Was: <em>&ldquo;{truncate(before, 80)}&rdquo;</em> → Now: <em>&ldquo;{truncate(after, 80)}&rdquo;</em></span>;
  }
  return <span>Was: <strong>{formatValue(before)}</strong> → Now: <strong>{formatValue(after)}</strong></span>;
}

function describeObject(val: unknown, prefix: string): React.ReactNode {
  if (typeof val !== "object" || val === null) {
    return <span>{prefix}: <strong>{formatValue(val)}</strong></span>;
  }
  const obj = val as Record<string, unknown>;
  if (obj.key && obj.kind) {
    return <span>{prefix}: New <strong>{String(obj.kind)}</strong> input <strong>&ldquo;{String(obj.key)}&rdquo;</strong>{obj.description ? <> — {truncate(String(obj.description), 100)}</> : null}</span>;
  }
  if (obj.id && obj.category) {
    return <span>{prefix}: New <strong>{String(obj.category)}</strong> rule <strong>&ldquo;{String(obj.id).replace(/_/g, " ")}&rdquo;</strong>{obj.rationale ? <> — {truncate(String(obj.rationale), 100)}</> : null}</span>;
  }
  if (obj.kind && obj.summary) {
    return <span>{prefix}: New <strong>{String(obj.kind).replace(/_/g, " ")}</strong> evidence — {truncate(String(obj.summary), 100)}</span>;
  }
  if (obj.id && obj.expected_decision) {
    return <span>{prefix}: New regression case <strong>&ldquo;{String(obj.id)}&rdquo;</strong> — expects <strong>{String(obj.expected_decision)}</strong></span>;
  }
  if (obj.id && obj.rationale) {
    return <span>{prefix}: New <strong>{String(obj.category ?? "rule")}</strong> <strong>&ldquo;{String(obj.id).replace(/_/g, " ")}&rdquo;</strong> — {truncate(String(obj.rationale), 100)}</span>;
  }
  return <span>{prefix}: <strong>{formatValue(val)}</strong></span>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function humanisePath(path: string): string {
  // /content/inputs/drain_backflow/description → "Input: Drain backflow → description"
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return path;

  const entity = parts[2] ?? ""; // inputs, rules, evaluation, etc.
  const id = parts[3] ?? ""; // the id
  const field = parts.slice(4).join(" → ");

  const sectionLabel: Record<string, string> = {
    inputs: "Input",
    rules: "Rule",
    evaluation: "Regression case",
    evidence: "Evidence",
    facts: "Fact",
    expert_observations: "Expert observation",
    assumptions: "Assumption",
    exceptions: "Exception",
    guardrails: "Guardrail",
    prohibited_actions: "Prohibited action",
    actions: "Action",
    scope: "Scope",
  };

  const entityLabel = sectionLabel[entity] ?? entity;
  const idLabel = id ? id.replace(/_/g, " ") : "";

  return [entityLabel, idLabel, field].filter(Boolean).join(": ");
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val;
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  return JSON.stringify(val);
}

// --- Tests Step ---

function TestsStep({
  candidate,
  canAct,
  onValidated,
}: {
  candidate: PillVersion | null;
  canAct: boolean;
  onValidated: (updated: PillVersion) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    if (!candidate) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await transitionPill(OPS_ID, candidate.version, "validate", "Regression cases passed.");
      onValidated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!candidate) return null;

  const validation = candidate.validation as Record<string, unknown> | null;
  const results = validation?.results as Array<Record<string, unknown>> | undefined;
  const passed = validation?.passed === true;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 5: Run Tests (Validation)</span>
        <span className="card-meta">Role: Reviewer</span>
      </div>
      <div className="card-body">
        {validation ? (
          <div>
            <div className="flex gap-8 mb-16 flex-wrap">
              <span className={passed ? "badge badge-success" : "badge badge-danger"}>
                {passed ? "All tests passed" : "Tests failed"}
              </span>
              {results && (
                <span className="badge badge-neutral">
                  {results.filter((r) => r.passed === true).length}/{results.length} cases
                </span>
              )}
            </div>
            {results && (
              <div className="mb-16">
                {results.map((r, i) => {
                  const caseId = (r.case_id as string) ?? `case-${i}`;
                  const resultPassed = r.passed === true;
                  return (
                    <div key={i} className="regression-row">
                      <div className="regression-row-header">
                        <span className="regression-row-title">{caseId.replace(/_/g, " ")}</span>
                        <span className="regression-row-arrow">→</span>
                        <span className={resultPassed ? "badge badge-success" : "badge badge-danger"}>
                          {resultPassed ? "Passed" : "Failed"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-dim mb-16">
              Run the regression suite against the candidate. All inherited cases must pass.
            </div>
            <div className="callout callout-info mb-16">
              The validation runs all evaluation cases deterministically. Inherited regression
              obligations cannot be weakened.
            </div>
            {error && <div className="error-box mb-16">{error}</div>}
            <button
              className="btn btn-primary"
              onClick={handleValidate}
              disabled={submitting || !canAct}
            >
              {submitting ? "Running tests…" : "Run Validation"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Approval Step ---

function ApprovalStep({
  candidate,
  canAct,
  onApproved,
}: {
  candidate: PillVersion | null;
  canAct: boolean;
  onApproved: (approved: PillVersion) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    if (!candidate) return;
    setSubmitting(true);
    setError(null);
    try {
      const approved = await transitionPill(OPS_ID, candidate.version, "approve", "Approved via Knowledge Evolution flow.");
      onApproved(approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!candidate) return null;

  const approval = candidate.approval as Record<string, unknown> | null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 6: Approval</span>
        <span className="card-meta">Role: Approver</span>
      </div>
      <div className="card-body">
        {approval ? (
          <div>
            <div className="flex gap-8 mb-16">
              <span className="badge badge-success">Approved</span>
            </div>
            <div className="kv">
              <div><dt>Version</dt><dd>v{candidate.version}</dd></div>
              <div><dt>Approved by</dt><dd>{capitaliseActor(String(approval.actor ?? "—"))} <span className="demo-persona">· demo persona</span></dd></div>
              <div><dt>Note</dt><dd>{String(approval.note ?? "—")}</dd></div>
            </div>
          </div>
        ) : (
          <div>
            <div className="callout callout-warning mb-16">
              <strong>Final approval gate.</strong> Approving v{candidate.version} will supersede
              v{candidate.previous_version ?? "1.0.0"}. The previous version remains readable but
              is no longer active.
            </div>
            <div className="text-dim mb-16">
              Only the pill owner (approver) who is not the author can approve.
            </div>
            {error && <div className="error-box mb-16">{error}</div>}
            <button
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={submitting || !canAct}
            >
              {submitting ? "Approving…" : `Approve v${candidate.version}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Post-Approval Version Timeline ---

function PostApprovalTimeline({
  pillVersions,
  candidate,
  onGoToPill,
}: {
  pillVersions: PillVersion[];
  candidate: PillVersion | null;
  onGoToPill?: (pillId: string) => void;
}) {
  // Sort versions: oldest first
  const sorted = [...pillVersions].sort((a, b) => {
    const av = a.version.split(".").map(Number);
    const bv = b.version.split(".").map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const ai = av[i] ?? 0;
      const bi = bv[i] ?? 0;
      if (ai !== bi) return ai - bi;
    }
    return 0;
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Version Timeline</span>
        <span className="card-meta">Knowledge Evolution Complete</span>
      </div>
      <div className="card-body">
        <div className="callout callout-success mb-16">
          <strong>v{candidate?.version ?? "1.1.0"} is now APPROVED and active.</strong>
          The previous version has been superseded but remains readable.
        </div>
        <div className="version-timeline">
          {sorted.map((v, i) => (
            <div key={`${v.pill_id}:${v.version}`} className="version-timeline-item">
              <div className="version-timeline-marker">
                <div className={`version-timeline-dot ${v.status === "SUPERSEDED" ? "superseded" : ""}`} />
                {i < sorted.length - 1 && <div className="version-timeline-line" />}
              </div>
              <div className="version-timeline-content">
                <div className="flex gap-8" style={{ alignItems: "center", marginBottom: 4 }}>
                  <span className="version-timeline-version">v{v.version}</span>
                  <span className={
                    v.status === "APPROVED" ? "badge badge-success" :
                    v.status === "SUPERSEDED" ? "badge badge-neutral" :
                    v.status === "DRAFT" ? "badge badge-neutral" :
                    v.status === "IN_REVIEW" ? "badge badge-info" :
                    "badge badge-neutral"
                  }>{v.status}</span>
                </div>
                <div className="text-sm text-muted">{v.change_reason}</div>
                <div className="text-sm text-muted mt-8">
                  Created: {fmtDate(v.created_at)} · Previous: {v.previous_version ? `v${v.previous_version}` : "—"}
                </div>
                {onGoToPill && (
                  <div className="mt-8">
                    <span className="version-timeline-link" onClick={() => onGoToPill(v.pill_id)}>
                      View pill on Intelligence Pills →
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Helper: build regression row title from inputs ---

function buildRegressionTitleFromInputs(tc: Record<string, unknown>): string {
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

  return parts.length > 0 ? parts.join(", ") : "Default case";
}

const ACTION_DISPLAY: Record<string, string> = {
  inspect_drainage: "Inspect drainage",
  monitor_trend: "Monitor trend",
  review_access_plan: "Review access plan",
  draft_tenant_update: "Draft tenant update",
  tenant_liaison: "Tenant liaison",
};

function formatActionName(id: string): string {
  return ACTION_DISPLAY[id] ?? id.replace(/_/g, " ");
}
