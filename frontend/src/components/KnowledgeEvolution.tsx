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
  getFeedback,
  getAuditHistory,
} from "../api";
import {
  getActiveRec,
  setActiveRec,
  cacheRec,
  getCachedRec,
  forgetRec,
  getFeedbackIds,
  addFeedbackId,
  setFeedbackIds,
  rememberRejection,
  getRememberedRejection,
  semverCmp,
  nextCandidateVersion,
  candidateForFeedback,
} from "../lib/demoState";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}

function fmtHash(hash: string): string {
  if (!hash) return "—";
  return hash.length > 16 ? hash.slice(0, 12) + "…" : hash;
}

function capitaliseActor(actor: string): string {
  if (!actor) return "—";
  // Strip "demo-" prefix and capitalise: "demo-operator" → "Operator"
  const name = actor.replace(/^demo[-_]/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function loadRec(id: string): Promise<RecommendationRecord | null> {
  try {
    const r = await getRecommendation(id);
    cacheRec(r);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("NOT_FOUND")) {
      forgetRec(id); // fresh database — drop stale pointers
      return null;
    }
    // This role cannot read recommendations (expert/reviewer): use the copy last loaded here.
    return getCachedRec<RecommendationRecord>(id);
  }
}

// --- Main component ---

export function KnowledgeEvolution({
  preselectedRecId,
  onGoToPill,
  onRefreshPills,
  onGoToLiveCase,
  onSelectRec,
}: {
  onSelectRec?: (recId: string) => void;
  preselectedRecId?: string | null;
  onGoToPill?: (pillId: string) => void;
  onRefreshPills?: () => void;
  onGoToLiveCase?: () => void;
}) {
  const role = getRole();
  const [recs, setRecs] = useState<RecommendationRecord[]>([]);
  const [selectedRec, setSelectedRec] = useState<RecommendationRecord | null>(null);
  const [pillVersions, setPillVersions] = useState<PillVersion[]>([]);
  const [candidate, setCandidate] = useState<PillVersion | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);

  // Rebuild the whole flow from backend state (plus browser-side pointers).
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Pill versions — readable by every role.
      const vers = await getPillVersions(OPS_ID);
      setPillVersions(vers);

      // 2. Which recommendation are we following?
      let target: RecommendationRecord | null = null;
      const pointer = preselectedRecId ?? getActiveRec();
      try {
        const all = await getRecommendations();
        const hydrated = await Promise.all(all.map((r) => getRecommendation(r.id).catch(() => r)));
        hydrated.forEach(cacheRec);
        setRecs(hydrated);
        target =
          hydrated.find((r) => r.id === pointer) ??
          hydrated[hydrated.length - 1] ??
          null;
      } catch {
        if (pointer) target = await loadRec(pointer);
      }
      if (target) setActiveRec(target.id);
      setSelectedRec(target);

      // 3. Feedback for this recommendation — verified against the backend.
      let fb: string | null = null;
      if (target) {
        const ids = getFeedbackIds(target.id);
        const valid: string[] = [];
        for (const id of ids) {
          try { await getFeedback(id); valid.push(id); } catch { /* stale */ }
        }
        if (valid.length !== ids.length) setFeedbackIds(target.id, valid);
        fb = valid[valid.length - 1] ?? null;
      }
      setFeedbackId(fb);

      // 4. The candidate produced from the latest feedback (if any).
      const cand = candidateForFeedback(vers, fb);
      setCandidate(cand);
      setDiff(null);
      if (cand && (cand.status === "DRAFT" || cand.status === "IN_REVIEW")) {
        try {
          setDiff(await getPillDiff(OPS_ID, cand.previous_version ?? "1.0.0", cand.version));
        } catch { /* ignore */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [preselectedRecId]);

  // Reload on mount, and on role change (endpoint access differs by role).
  useEffect(() => {
    loadData();
  }, [loadData, role]);

  // Step completion — derived only from backend state.
  const feedbackDone = !!feedbackId || !!candidate;
  const doneStates = {
    outcome: !!selectedRec?.outcome || feedbackDone,
    feedback: feedbackDone,
    proposal: !!candidate,
    diff: !!candidate && candidate.status !== "DRAFT",
    tests: !!candidate?.review && !!candidate?.validation,
  };

  // Compute current step
  const currentStep = computeCurrentStep(selectedRec, feedbackDone, candidate);
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

  const allDone =
    !!candidate && ["APPROVED", "REJECTED", "DEPRECATED", "SUPERSEDED"].includes(candidate.status);

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
              onChange={(e) => {
                setActiveRec(e.target.value);
                onSelectRec?.(e.target.value);
                loadData();
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
      {candidate && (candidate.status === "DRAFT" || candidate.status === "IN_REVIEW") && (
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
        doneStates={doneStates}
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
          rec={selectedRec}
          onGoToPill={onGoToPill}
          onGoToLiveCase={onGoToLiveCase}
          onResubmitted={async (fbId) => {
            addFeedbackId(selectedRec.id, fbId);
            await loadData();
            onRefreshPills?.();
          }}
          onDeprecated={async () => {
            await loadData();
            onRefreshPills?.();
          }}
        />
      ) : currentStep === "outcome" && !selectedRec.human_decision ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Step 1: Record Outcome</span>
            <span className="card-meta">Role: Operator</span>
          </div>
          <div className="card-body">
            <div className="callout callout-info">
              <strong>No escalation recorded yet.</strong> Record the escalation on the Live Case first to
              start the Knowledge Evolution flow.
            </div>
            <div className="mt-8">
              <button className="btn btn-primary" onClick={() => onGoToLiveCase?.()}>
                Record the escalation on the Live Case first →
              </button>
            </div>
          </div>
        </div>
      ) : currentStep === "outcome" ? (
        <OutcomeStep
          rec={selectedRec}
          canAct={canDoCurrentStep}
          onOutcomeRecorded={async () => {
            const updated = await getRecommendation(selectedRec.id);
            cacheRec(updated);
            setSelectedRec(updated);
          }}
        />
      ) : currentStep === "feedback" ? (
        <FeedbackStep
          rec={selectedRec}
          canAct={canDoCurrentStep}
          proposedVersion={nextCandidateVersion(pillVersions)}
          onFeedbackSubmitted={(id) => {
            if (id) {
              addFeedbackId(selectedRec.id, id);
              setFeedbackId(id);
            }
          }}
        />
      ) : currentStep === "proposal" ? (
        <ProposalStep
          rec={selectedRec}
          feedbackId={feedbackId}
          canAct={canDoCurrentStep}
          onProposed={async () => {
            await loadData();
            onRefreshPills?.();
          }}
        />
      ) : currentStep === "diff" ? (
        <DiffStep
          diff={diff}
          candidate={candidate}
          canAct={canDoCurrentStep}
          onReviewed={async () => {
            await loadData();
            onRefreshPills?.();
          }}
          onGoToPill={onGoToPill}
        />
      ) : currentStep === "tests" ? (
        <TestsStep
          candidate={candidate}
          canAct={canDoCurrentStep}
          onReviewed={async () => {
            await loadData();
          }}
          onValidated={async () => {
            await loadData();
          }}
          onRejected={async () => {
            await loadData();
            onRefreshPills?.();
          }}
        />
      ) : currentStep === "approval" ? (
        <ApprovalStep
          candidate={candidate}
          canAct={canDoCurrentStep}
          onApproved={async () => {
            await loadData();
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
  feedbackDone: boolean,
  candidate: PillVersion | null
): StepKey {
  if (candidate) {
    if (candidate.status === "DRAFT") return "diff"; // expert reviews the diff and submits
    if (candidate.status === "IN_REVIEW") {
      // Reviewer must record review AND validation — both confirmed by the backend.
      return candidate.review && candidate.validation ? "approval" : "tests";
    }
    return "approval"; // APPROVED / REJECTED / DEPRECATED — shown as the end state
  }
  if (feedbackDone) return "proposal";
  if (!rec || !rec.human_decision || !rec.outcome) return "outcome";
  return "feedback";
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
  proposedVersion,
  onFeedbackSubmitted,
}: {
  rec: RecommendationRecord;
  canAct: boolean;
  proposedVersion: string;
  onFeedbackSubmitted: (feedbackId: string | null) => void;
}) {
  const [correction, setCorrection] = useState(
    "SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified drain_backflow observation. If backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising."
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = (await submitFeedback(rec.id, OPS_ID, correction, proposedVersion)) as Record<string, unknown>;
      const id = (res.id as string) ?? (res.feedback_id as string) ?? null;
      onFeedbackSubmitted(id);
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
  feedbackId: knownFeedbackId,
  canAct,
  onProposed,
}: {
  rec: RecommendationRecord;
  feedbackId: string | null;
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
      let feedbackId = knownFeedbackId;
      if (!feedbackId) {
        const fbResponse = (await submitFeedback(rec.id, OPS_ID, correction, "1.1.0")) as Record<string, unknown>;
        feedbackId = (fbResponse.id as string) ?? (fbResponse.feedback_id as string);
      }
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
        <div className="callout callout-ai mb-16">
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
          {(() => {
            const eval_ = candidate.content.evaluation;
            // Build titles and detect collisions
            const rawTitles = eval_.map((tc) => buildRegressionTitleFromInputs(tc as Record<string, unknown>));
            const titleCounts = new Map<string, number>();
            for (const t of rawTitles) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
            return eval_.map((tc, i) => {
            const id = (tc.id as string) ?? `case-${i}`;
            const isNew = id === "flat-but-backflow";
            const expectedDecision = (tc.expected_decision as string) ?? "ABSTAIN";
            const expectedActions = (tc.expected_actions as string[]) ?? [];
            const expectedBlocked = (tc.expected_blocked as string[]) ?? [];
            let title = rawTitles[i] || id;
            // Disambiguate when multiple cases share the same title
            if ((titleCounts.get(title) ?? 0) > 1) title = `${title} (${id.replace(/_/g, " ")})`;
            const decisionLabel = expectedDecision === "ESCALATE" ? "Escalate" : expectedDecision === "HUMAN_REVIEW" ? "Needs review" : "Abstain — not enough data";
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
          });
          })()}
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
  onReviewed,
  onValidated,
  onRejected,
}: {
  candidate: PillVersion | null;
  canAct: boolean;
  onReviewed: (updated: PillVersion) => void;
  onValidated: (updated: PillVersion) => void;
  onRejected: (updated: PillVersion) => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!candidate) return null;

  const review = candidate.review as Record<string, unknown> | null;
  const validation = candidate.validation as Record<string, unknown> | null;
  const results = validation?.results as Array<Record<string, unknown>> | undefined;
  const passed = validation?.passed === true;

  const handleReview = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await transitionPill(OPS_ID, candidate.version, "review", note.trim() || "Reviewed regression cases and content.");
      onReviewed(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await transitionPill(OPS_ID, candidate.version, "validate", note.trim() || "Regression cases passed.");
      onValidated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const reason = note.trim() || "Rejected with reason.";
      const updated = await transitionPill(OPS_ID, candidate.version, "reject", reason);
      rememberRejection(OPS_ID, candidate.version, reason, getRole());
      onRejected(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Step 5: Review &amp; Tests</span>
        <span className="card-meta">Role: Reviewer</span>
      </div>
      <div className="card-body">
        {/* Review gate */}
        <div className="mb-16">
          <div className="section-heading">Review Gate</div>
          {review ? (
            <div className="kv">
              <div><dt>Reviewed by</dt><dd>{capitaliseActor(String(review.actor ?? "—"))} <span className="demo-persona">· demo persona</span></dd></div>
              <div><dt>Note</dt><dd>{String(review.note ?? "—")}</dd></div>
              <div><dt>Content hash</dt><dd>{fmtHash(String(review.content_hash ?? ""))}</dd></div>
            </div>
          ) : (
            <div className="text-dim mb-8">
              Record a review to confirm the candidate content has no unresolved questions or contradictions.
            </div>
          )}
        </div>

        <div className="section-divider" />

        {/* Validation gate */}
        <div className="mb-16 mt-16">
          <div className="section-heading">Validation Gate</div>
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
              <div className="kv">
                <div><dt>Validated by</dt><dd>{capitaliseActor(String(validation.actor ?? "—"))} <span className="demo-persona">· demo persona</span></dd></div>
                <div><dt>Note</dt><dd>{String(validation.note ?? "—")}</dd></div>
              </div>
              {results && (
                <div className="mt-16">
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
            <div className="text-dim mb-8">
              Run the regression suite against the candidate. All inherited cases must pass.
            </div>
          )}
        </div>

        {/* Actions */}
        {error && <div className="error-box mb-16">{error}</div>}
        <div className="mb-16">
          <div className="section-heading">Note (optional)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="note-input"
            placeholder="Add a note for the audit trail…"
            disabled={submitting || !canAct}
          />
        </div>
        <div className="flex gap-8 flex-wrap">
          {!review && (
            <button
              className="btn btn-primary"
              onClick={handleReview}
              disabled={submitting || !canAct}
            >
              {submitting ? "Recording…" : "Record Review"}
            </button>
          )}
          {review && !validation && (
            <button
              className="btn btn-primary"
              onClick={handleValidate}
              disabled={submitting || !canAct}
            >
              {submitting ? "Running tests…" : "Run Validation"}
            </button>
          )}
          {review && !validation && (
            <button
              className="btn btn-danger"
              onClick={handleReject}
              disabled={submitting || !canAct || !note.trim()}
              title={note.trim() ? "" : "A reason is required to reject"}
            >
              {submitting ? "Rejecting…" : "Reject with reason"}
            </button>
          )}
        </div>
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
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    if (!candidate) return;
    setSubmitting(true);
    setError(null);
    try {
      const approved = await transitionPill(OPS_ID, candidate.version, "approve", note.trim() || "Approved via Knowledge Evolution flow.");
      onApproved(approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!candidate) return null;

  const approval = candidate.approval as Record<string, unknown> | null;
  const isRejected = candidate.status === "REJECTED";

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
        ) : isRejected ? (
          <div>
            <div className="flex gap-8 mb-16">
              <span className="badge badge-danger">Rejected</span>
            </div>
            <div className="callout callout-info mb-16">
              This candidate was rejected. The active version (v{candidate.previous_version ?? "1.0.0"}) remains in production.
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
            <div className="mb-16">
              <div className="section-heading">Approval note (optional)</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="note-input"
                placeholder="Add a note for the audit trail…"
                disabled={submitting || !canAct}
              />
            </div>
            {error && <div className="error-box mb-16">{error}</div>}
            <div className="flex gap-8 flex-wrap">
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={submitting || !canAct}
              >
                {submitting ? "Approving…" : `Approve v${candidate.version}`}
              </button>
              <span className="text-muted text-sm" style={{ alignSelf: "center" }}>
                Not satisfied? Rejection is made by the independent reviewer at the Tests step.
              </span>
            </div>
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
  rec,
  onGoToPill,
  onGoToLiveCase,
  onResubmitted,
  onDeprecated,
}: {
  pillVersions: PillVersion[];
  candidate: PillVersion | null;
  rec: RecommendationRecord;
  onGoToPill?: (pillId: string) => void;
  onGoToLiveCase?: () => void;
  onResubmitted: (feedbackId: string) => Promise<void>;
  onDeprecated?: (updated: PillVersion) => void;
}) {
  const role = getRole();
  const [deprecateNote, setDeprecateNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDeprecate = role === "approver" && candidate?.status === "APPROVED";
  // Sort versions: oldest first
  const sorted = [...pillVersions].sort((a, b) => semverCmp(a.version, b.version));

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Version Timeline</span>
        <span className="card-meta">Governance cycle complete</span>
      </div>
      <div className="card-body">
        {candidate?.status === "APPROVED" && (
          <div className="callout callout-success mb-16">
            <strong>v{candidate.version} is now APPROVED and active.</strong>{" "}
            v{candidate.previous_version} has been superseded but remains readable.
          </div>
        )}
        {candidate?.status === "REJECTED" && (
          <RejectedPanel
            candidate={candidate}
            rec={rec}
            nextVersion={nextCandidateVersion(pillVersions)}
            onResubmitted={onResubmitted}
          />
        )}
        {candidate?.status === "APPROVED" && onGoToLiveCase && (
          <div className="text-dim mb-16">
            The next operational assessment will use v{candidate.version}.{" "}
            <span className="pill-link" onClick={onGoToLiveCase}>Run a new assessment →</span>
          </div>
        )}
        {candidate?.status === "DEPRECATED" && (
          <div className="callout callout-warning mb-16">
            <strong>v{candidate.version} has been deprecated</strong> and is no longer used for decisions.
          </div>
        )}
        <div className="version-timeline">
          {sorted.map((v, i) => (
            <div key={`${v.pill_id}:${v.version}`} className="version-timeline-item">
              <div className="version-timeline-marker">
                <div className={`version-timeline-dot ${v.status === "SUPERSEDED" ? "superseded" : ""} ${v.status === "REJECTED" || v.status === "DEPRECATED" ? "rejected" : ""} ${v.status === "IN_REVIEW" || v.status === "DRAFT" ? "pending" : ""}`} />
                {i < sorted.length - 1 && <div className="version-timeline-line" />}
              </div>
              <div className="version-timeline-content">
                <div className="flex gap-8" style={{ alignItems: "center", marginBottom: 4 }}>
                  <span className="version-timeline-version">v{v.version}</span>
                  <span className={
                    v.status === "APPROVED" ? "badge badge-success" :
                    v.status === "SUPERSEDED" ? "badge badge-neutral" :
                    v.status === "DRAFT" ? "badge badge-neutral" :
                    v.status === "IN_REVIEW" ? "badge badge-warning" :
                    v.status === "REJECTED" || v.status === "DEPRECATED" ? "badge badge-danger" :
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

        {/* Deprecate action for approver */}
        {canDeprecate && (
          <details className="mt-16">
            <summary className="text-dim" style={{ cursor: "pointer" }}>
              Advanced: retire this version
            </summary>
            <div className="section-divider mb-16 mt-8" />
            <div className="section-heading">Deprecate Version</div>
            <div className="text-dim mb-8">
              Deprecating v{candidate.version} retires it from operational use. This is irreversible and is
              not part of the normal learning flow — use only when a version must be withdrawn.
            </div>
            {error && <div className="error-box mb-16">{error}</div>}
            <textarea
              value={deprecateNote}
              onChange={(e) => setDeprecateNote(e.target.value)}
              rows={2}
              className="note-input mb-8"
              placeholder="Reason for deprecation (required)…"
              disabled={submitting}
            />
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!candidate || !deprecateNote.trim()) return;
                setSubmitting(true);
                setError(null);
                try {
                  const updated = await transitionPill(OPS_ID, candidate.version, "deprecate", deprecateNote.trim());
                  onDeprecated?.(updated);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting || !deprecateNote.trim()}
            >
              {submitting ? "Deprecating…" : `Deprecate v${candidate.version}`}
            </button>
          </details>
        )}
      </div>
    </div>
  );
}

// --- Rejected candidate: reason + governed resubmission ---

function RejectedPanel({
  candidate,
  rec,
  nextVersion,
  onResubmitted,
}: {
  candidate: PillVersion;
  rec: RecommendationRecord;
  nextVersion: string;
  onResubmitted: (feedbackId: string) => Promise<void>;
}) {
  const role = getRole();
  const [reason, setReason] = useState<{ note: string; actor: string; at: string; source: "audit" | "local" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Authoritative source: the audit trail (readable by reviewer/approver).
      try {
        const hist = await getAuditHistory(candidate.pill_id, 0, 500);
        const ev = [...hist.items].reverse().find(
          (e) => e.event === "PILL_REJECTED" && String(e.detail?.version) === candidate.version
        );
        if (ev && !cancelled) {
          setReason({ note: String(ev.detail?.note ?? ""), actor: ev.actor, at: ev.created_at, source: "audit" });
          return;
        }
      } catch { /* role cannot read audit */ }
      const local = getRememberedRejection(candidate.pill_id, candidate.version);
      if (local && !cancelled) setReason({ ...local, source: "local" });
    })();
    return () => { cancelled = true; };
  }, [candidate.pill_id, candidate.version]);

  const canResubmit = role === "expert";

  const handleResubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const fb = (await submitFeedback(rec.id, OPS_ID, candidate.change_reason, nextVersion)) as Record<string, unknown>;
      const fbId = (fb.id as string) ?? (fb.feedback_id as string);
      if (!fbId) throw new Error("Could not determine feedback ID");
      await proposeCandidate(fbId);
      await onResubmitted(fbId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rejected-panel mb-16">
      <div className="rejected-panel-head">
        <span className="badge badge-danger">Rejected</span>
        <strong>v{candidate.version} was not released.</strong>
        <span className="text-dim">v{candidate.previous_version} remains the active approved version — no knowledge changed.</span>
      </div>
      <div className="rejected-reason">
        <div className="rejected-reason-label">Reviewer&apos;s reason</div>
        {reason ? (
          <>
            <div className="rejected-reason-text">&ldquo;{reason.note || "No reason given"}&rdquo;</div>
            <div className="text-muted text-sm">
              — {capitaliseActor(reason.actor)} <span className="demo-persona">· demo persona</span>
              {reason.at ? ` · ${fmtDate(reason.at)}` : ""}
              {reason.source === "audit" ? " · from audit trail" : ""}
            </div>
          </>
        ) : (
          <div className="text-muted">
            Recorded in the audit trail, which is visible to Reviewer and Approver roles.
          </div>
        )}
      </div>
      <div className="rejected-actions">
        {canResubmit ? (
          <button className="btn btn-primary" onClick={handleResubmit} disabled={submitting}>
            {submitting ? "Creating revised candidate…" : `Revise & resubmit as v${nextVersion}`}
          </button>
        ) : (
          <span className="switch-role-inline">Switch to <b>Expert</b> to revise and resubmit.</span>
        )}
        <span className="text-muted text-sm">
          A rejected version is never edited. Resubmitting creates a new candidate that goes through review,
          validation and approval again.
        </span>
      </div>
      {error && <div className="error-box mt-8">{error}</div>}
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
