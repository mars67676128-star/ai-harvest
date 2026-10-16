import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiffResult, PillVersion, RecommendationRecord } from "../types";
import { getFeedback, getPillDiff, getPillVersions, getRecommendation, getRecommendations, getRole, proposeCandidate, recordOutcome, submitFeedback, transitionPill } from "../api";
import { candidateForFeedback, nextCandidateVersion } from "../lib/demoState";

const OPS_ID = "asset.monsoon.triage";
const REC_KEY = "harvest.ke.recId";
const fbKey = (recId: string) => `harvest.ke.feedback.${recId}`;

function getStoredRec(): string | null { try { return localStorage.getItem(REC_KEY); } catch { return null; } }
function setStoredRec(id: string) { try { localStorage.setItem(REC_KEY, id); } catch { /* ignore */ } }
function feedbackIds(recId: string): string[] { try { const raw = localStorage.getItem(fbKey(recId)); if (!raw) return []; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []; } catch { return []; } }
function addFeedback(recId: string, id: string) { try { const ids = feedbackIds(recId).filter((x) => x !== id); ids.push(id); localStorage.setItem(fbKey(recId), JSON.stringify(ids)); } catch { /* ignore */ } }
function short(id: string | null) { return id ? `${id.slice(0, 8)}…` : "—"; }

export function ReviewedEvolution({ preselectedRecId, onGoLive, onGoPills }: { preselectedRecId?: string | null; onGoLive: () => void; onGoPills: () => void }) {
  const role = getRole();
  const [recId, setRecId] = useState<string | null>(preselectedRecId ?? getStoredRec());
  const [rec, setRec] = useState<RecommendationRecord | null>(null);
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<PillVersion | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("Duty team assessment identified intermittent drain backflow. Water readings appeared flat but the drain was backflowing.");
  const [correction, setCorrection] = useState("SYNTHETIC CORRECTION: A flat water trend can hide drain backflow. Require a verified drain_backflow observation. If backflow is present, escalate to the duty facilities engineer and block routine monitoring as the sole response, even when water is not rising.");
  const [note, setNote] = useState("");
  const [revisionText, setRevisionText] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const vers = await getPillVersions(OPS_ID);
      setVersions(vers);
      let target = preselectedRecId ?? recId ?? getStoredRec();
      if ((role === "operator" || role === "approver") && !target) {
        const rs = await getRecommendations();
        target = rs[rs.length - 1]?.id ?? null;
      }
      if (target) { setRecId(target); setStoredRec(target); }
      if (target && (role === "operator" || role === "approver")) {
        setRec(await getRecommendation(target));
      } else {
        setRec(null);
      }
      let latestFeedback: string | null = null;
      if (target) {
        const ids = feedbackIds(target);
        for (const id of ids) {
          try { await getFeedback(id); latestFeedback = id; } catch { /* stale pointer */ }
        }
      }
      setFeedbackId(latestFeedback);
      const cand = candidateForFeedback(vers, latestFeedback);
      setCandidate(cand);
      if (cand && ["DRAFT", "IN_REVIEW", "REJECTED"].includes(cand.status)) {
        try { setDiff(await getPillDiff(OPS_ID, cand.previous_version ?? "1.0.0", cand.version)); } catch { setDiff(null); }
      } else setDiff(null);
      if (cand?.status === "REJECTED" && !revisionText) setRevisionText(`${cand.change_reason}\n\nREVISED AFTER REVIEW: `);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [preselectedRecId, recId, role, revisionText]);

  useEffect(() => { void load(); }, [load]);

  const nextVersion = useMemo(() => nextCandidateVersion(versions), [versions]);
  const active = versions.find((v) => v.status === "APPROVED");

  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const submitOutcome = () => recId && act(async () => { await recordOutcome(recId, outcome, true, true); });
  const submitCorrection = () => recId && act(async () => { const fb = await submitFeedback(recId, OPS_ID, correction, nextVersion) as Record<string, unknown>; const id = String(fb.id ?? fb.feedback_id ?? ""); if (!id) throw new Error("Feedback ID missing from backend response"); addFeedback(recId, id); setFeedbackId(id); });
  const generateProposal = () => feedbackId && act(async () => { await proposeCandidate(feedbackId); });
  const submitReview = () => candidate && act(async () => { await transitionPill(OPS_ID, candidate.version, "submit", "Expert reviewed the structured diff and submitted the candidate for independent review."); });
  const recordReview = () => candidate && act(async () => { await transitionPill(OPS_ID, candidate.version, "review", note.trim() || "Independent review completed."); });
  const validate = () => candidate && act(async () => { await transitionPill(OPS_ID, candidate.version, "validate", note.trim() || "Regression suite executed against the candidate."); });
  const reject = () => candidate && act(async () => { if (!note.trim()) throw new Error("A rejection reason is required."); await transitionPill(OPS_ID, candidate.version, "reject", note.trim()); });
  const approve = () => candidate && act(async () => { await transitionPill(OPS_ID, candidate.version, "approve", note.trim() || "Approved after review and passing validation."); });
  const revise = () => recId && candidate && act(async () => { if (!revisionText.trim()) throw new Error("Enter a revised correction before resubmitting."); const fb = await submitFeedback(recId, OPS_ID, revisionText.trim(), nextVersion) as Record<string, unknown>; const id = String(fb.id ?? fb.feedback_id ?? ""); if (!id) throw new Error("Feedback ID missing from backend response"); addFeedback(recId, id); setFeedbackId(id); await proposeCandidate(id); setRevisionText(""); });

  const operatorNeedsDecision = role === "operator" && rec && !rec.human_decision;
  const operatorNeedsOutcome = role === "operator" && rec && rec.human_decision && !rec.outcome;
  const operatorNeedsFeedback = role === "operator" && rec && rec.outcome && !feedbackId && !candidate;

  return (
    <div>
      <div className="case-header"><div className="case-title">Knowledge Evolution</div><div className="case-subtitle">Recommendation {short(recId)} · production knowledge changes only after human governance</div></div>
      {error && <div className="error-box mb-16">{error}</div>}
      <div className="source-attribution"><span className="source-label">Current production release:</span><span>{active ? `Monsoon Near-Miss Triage v${active.version}` : "No approved release"}</span>{candidate && <span className="badge badge-neutral">Candidate v{candidate.version} · {candidate.status}</span>}</div>

      {operatorNeedsDecision && <div className="callout callout-warning"><strong>First record the escalation.</strong> The learning loop starts only after an accountable human decision. <button className="btn btn-primary ml-8" onClick={onGoLive}>Open Live Case</button></div>}

      {role === "operator" && !rec && <div className="callout callout-info">Operational recommendation details are available only to Operator/Approver. No recommendation is cached in the browser for other roles. <button className="btn btn-primary ml-8" onClick={onGoLive}>Open Live Case</button></div>}

      {operatorNeedsOutcome && <div className="card"><div className="card-header"><span className="card-title">1. Record Outcome</span><span className="card-meta">Operator</span></div><div className="card-body"><textarea className="note-input mb-8" rows={4} value={outcome} onChange={(e) => setOutcome(e.target.value)} /><button className="btn btn-primary" disabled={busy || !outcome.trim()} onClick={submitOutcome}>Record Outcome</button></div></div>}

      {operatorNeedsFeedback && <div className="card"><div className="card-header"><span className="card-title">2. Submit Correction</span><span className="card-meta">Operator</span></div><div className="card-body"><div className="text-dim mb-8">Feedback is persisted as its own record; submitting it does not change the approved Pill.</div><textarea className="note-input mb-8" rows={5} value={correction} onChange={(e) => setCorrection(e.target.value)} /><div className="text-muted mb-8">Proposed version: v{nextVersion}</div><button className="btn btn-primary" disabled={busy || !correction.trim()} onClick={submitCorrection}>Submit Feedback</button></div></div>}

      {role === "expert" && feedbackId && !candidate && <div className="card"><div className="card-header"><span className="card-title">3. Generate AI Candidate</span><span className="card-meta">Expert</span></div><div className="card-body"><div className="callout callout-ai mb-16"><strong>AI proposal — not production knowledge.</strong> Feedback {short(feedbackId)} will create a separate DRAFT.</div><button className="btn btn-primary" disabled={busy} onClick={generateProposal}>Generate AI Proposal</button></div></div>}

      {candidate?.status === "DRAFT" && <div className="card"><div className="card-header"><span className="card-title">4. Review Candidate Diff</span><span className="card-meta">Expert · v{candidate.previous_version} → v{candidate.version}</span></div><div className="card-body"><div className="callout callout-warning mb-16"><strong>v{candidate.previous_version} remains active.</strong> This draft cannot affect runtime until review, validation and approval complete.</div>{diff ? <div>{diff.changes.map((c, i) => <div key={i} className="diff-added"><div className="diff-path">{c.path}</div><div className="text-sm">Before: {JSON.stringify(c.before)}<br/>After: {JSON.stringify(c.after)}</div></div>)}</div> : <div className="text-muted">Diff unavailable for this role.</div>}{role === "expert" ? <button className="btn btn-primary mt-16" disabled={busy} onClick={submitReview}>Submit for Independent Review</button> : <div className="switch-role-hint mt-16">Switch to Expert to submit the candidate.</div>}</div></div>}

      {candidate?.status === "IN_REVIEW" && <div className="card"><div className="card-header"><span className="card-title">5. Independent Review & Validation</span><span className="card-meta">Reviewer</span></div><div className="card-body"><div className="kv mb-16"><div><dt>Review</dt><dd>{candidate.review ? "Recorded" : "Pending"}</dd></div><div><dt>Validation</dt><dd>{candidate.validation ? (candidate.validation.passed === true ? "Passed" : "Failed") : "Pending"}</dd></div></div>{role === "reviewer" ? <><textarea className="note-input mb-8" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note / rejection reason" />{!candidate.review && <button className="btn btn-primary mr-8" disabled={busy} onClick={recordReview}>Record Review</button>}{candidate.review && !candidate.validation && <><button className="btn btn-primary mr-8" disabled={busy} onClick={validate}>Run Validation</button><button className="btn btn-danger" disabled={busy || !note.trim()} onClick={reject}>Reject with Reason</button></>}</> : candidate.review && candidate.validation ? <div className="text-muted">Review and validation complete. Switch to Approver for release decision.</div> : <div className="switch-role-hint">Switch to Reviewer to continue.</div>}</div></div>}

      {candidate?.status === "IN_REVIEW" && candidate.review && candidate.validation && role === "approver" && <div className="card"><div className="card-header"><span className="card-title">6. Release Decision</span><span className="card-meta">Approver</span></div><div className="card-body"><div className="callout callout-warning mb-16">Approving v{candidate.version} will supersede v{candidate.previous_version}. Approval rechecks the exact reviewed artifact and inherited regressions.</div><textarea className="note-input mb-8" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note" /><button className="btn btn-primary" disabled={busy || candidate.validation.passed !== true} onClick={approve}>Approve v{candidate.version}</button></div></div>}

      {candidate?.status === "REJECTED" && <div className="card"><div className="card-header"><span className="card-title">Rejected Candidate</span><span className="card-meta">v{candidate.version}</span></div><div className="card-body"><div className="callout callout-danger mb-16"><strong>Not released.</strong> v{candidate.previous_version} remains active. A rejected version is never edited in place.</div>{role === "expert" ? <><div className="section-heading">Revised correction</div><textarea className="note-input mb-8" rows={6} value={revisionText} onChange={(e) => setRevisionText(e.target.value)} placeholder="Address the review feedback and state the corrected knowledge explicitly." /><div className="text-muted mb-8">This will create new feedback and a new candidate v{nextVersion}.</div><button className="btn btn-primary" disabled={busy || !revisionText.trim()} onClick={revise}>Revise & Resubmit as v{nextVersion}</button></> : <div className="switch-role-hint">Switch to Expert to create a corrected successor candidate. Reviewer reasons remain in the governed audit trail.</div>}</div></div>}

      {candidate?.status === "APPROVED" && <div className="card"><div className="card-header"><span className="card-title">Governance Cycle Complete</span></div><div className="card-body"><div className="callout callout-success"><strong>v{candidate.version} is approved and active.</strong> v{candidate.previous_version} is preserved as superseded history.</div><div className="flex gap-8 mt-16"><button className="btn btn-primary" onClick={onGoLive}>Run the learned backflow scenario</button><button className="btn" onClick={onGoPills}>Inspect version lineage</button></div></div></div>}
    </div>
  );
}
