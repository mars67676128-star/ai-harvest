import { useEffect, useState } from "react";
import type { PillVersion, RecommendationRecord } from "../types";
import { getPills, getPillVersions, getRecommendations, getRecommendation, getAuditHistory, getRole } from "../api";
import type { AuditEntry } from "../api";
import { DomainIcon } from "./DomainIcon";
import { getFeedbackIds, candidateForFeedback, getRememberedRejection, setActiveRec } from "../lib/demoState";

type Go = {
  onGoToHowItWorks: () => void;
  onGoToLiveCase: () => void;
  onGoToEvolution: (recId?: string) => void;
  onGoToPill: (pillId: string) => void;
};

interface Task {
  key: string;
  tone: "action" | "warning" | "danger" | "ai";
  title: string;
  detail: string;
  cta: string;
  go: () => void;
}

const ROLE_INTRO: Record<string, string> = {
  operator: "You run assessments on live situations, record escalations and report what actually happened.",
  expert: "You own the knowledge. You review AI proposals and submit them for independent review.",
  reviewer: "You independently review candidate knowledge and run the regression tests.",
  approver: "You release approved knowledge into operations — or keep the current version active.",
  viewer: "You can read every pill and decision, but cannot change anything.",
};


function humanise(s: string) {
  const t = s.replace(/^demo[-_]/, "").replace(/[_-]+/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
const STATUS_TEXT: Record<string, string> = {
  APPROVED: "Approved and active", IN_REVIEW: "In review", DRAFT: "AI proposal (draft)",
  REJECTED: "Rejected", SUPERSEDED: "Superseded", DEPRECATED: "Deprecated",
};
const EVENT_TEXT: Record<string, string> = {
  PILL_CREATED: "created a pill version", CANDIDATE_REVISION_CREATED: "created a candidate revision",
  AI_REVISION_PROPOSED: "generated an AI proposal", REVIEW_REQUESTED: "submitted for review",
  EXPERT_REVIEWED: "recorded an independent review", PILL_VALIDATED: "ran regression validation",
  PILL_APPROVED: "approved a release", PILL_REJECTED: "rejected a candidate", PILL_SUPERSEDED: "superseded a version",
  PILL_DEPRECATED: "deprecated a version", FEEDBACK_SUBMITTED: "submitted outcome feedback",
  DECISION_RECORDED: "recorded a decision", OUTCOME_RECORDED: "recorded an operational outcome",
  HUMAN_DECISION: "recorded a decision", RECOMMENDATION_GENERATED: "generated a recommendation",
  CASE_CREATED: "opened an operational case", PILL_INVOKED: "applied a pill to a case",
  KNOWLEDGE_CAPTURED: "captured an expert interview", KNOWLEDGE_EXTRACTED: "extracted knowledge from an interview",
};

export function Home({ onGoToHowItWorks, onGoToLiveCase, onGoToEvolution, onGoToPill }: Go) {
  const role = getRole();
  const [versions, setVersions] = useState<PillVersion[]>([]);
  const [recs, setRecs] = useState<RecommendationRecord[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pills = await getPills();
        const ids = [...new Set(pills.map((p) => p.pill_id))];
        const all = (await Promise.all(ids.map((pid) => getPillVersions(pid).catch(() => [] as PillVersion[])))).flat();
        if (!cancelled) setVersions(all);
      } catch { /* backend down — shown below */ }
      try {
        const list = await getRecommendations();
        const hydrated = await Promise.all(list.map((r) => getRecommendation(r.id).catch(() => r)));
        if (!cancelled) setRecs(hydrated);
      } catch { if (!cancelled) setRecs(null); }
      try {
        const h = await getAuditHistory(undefined, 0, 500);
        if (!cancelled) setAudit(h.items);
      } catch { if (!cancelled) setAudit(null); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [role]);

  const successors = versions.filter((v) => v.previous_version);
  const latestByPill = new Map<string, PillVersion>();
  for (const v of successors) {
    const cur = latestByPill.get(v.pill_id);
    if (!cur || v.created_at > cur.created_at) latestByPill.set(v.pill_id, v);
  }
  const openCandidates = [...latestByPill.values()];
  const name = (pillId: string) => versions.find((v) => v.pill_id === pillId)?.content.name ?? pillId;

  // ---- Role-specific tasks, derived from backend state ----
  const tasks: Task[] = [];
  const goRec = (id: string) => { setActiveRec(id); onGoToEvolution(id); };

  if (role === "operator" || role === "approver") {
    for (const r of recs ?? []) {
      if (r.result.decision === "ESCALATE" && !r.human_decision && role === "operator") {
        tasks.push({ key: `dec-${r.id}`, tone: "warning", title: "Escalation awaiting your decision",
          detail: `Assessment at ${r.created_at.slice(11, 16)} UTC — AI HARVEST will not act on its own.`,
          cta: "Open case", go: onGoToLiveCase });
      } else if (r.human_decision && !r.outcome && role === "operator") {
        tasks.push({ key: `out-${r.id}`, tone: "action", title: "Record what actually happened",
          detail: `Escalation at ${r.created_at.slice(11, 16)} UTC has no outcome yet. Outcomes are how the system learns.`,
          cta: "Record outcome", go: () => goRec(r.id) });
      } else if (r.outcome && role === "operator") {
        const fbs = getFeedbackIds(r.id);
        if (fbs.length === 0) {
          tasks.push({ key: `fb-${r.id}`, tone: "action", title: "Was anything missing from the recommendation?",
            detail: "Submit a correction so the expert knowledge can be improved.",
            cta: "Give feedback", go: () => goRec(r.id) });
        }
      }
    }
  }
  for (const c of openCandidates) {
    if (c.status === "DRAFT" && role === "expert") {
      tasks.push({ key: `draft-${c.version}`, tone: "ai", title: `AI proposed ${name(c.pill_id)} v${c.version}`,
        detail: "Check the change against your expertise, then submit it for independent review.",
        cta: "Review proposal", go: () => onGoToEvolution() });
    }
    if (c.status === "REJECTED" && role === "expert") {
      const why = getRememberedRejection(c.pill_id, c.version);
      tasks.push({ key: `rej-${c.version}`, tone: "danger", title: `v${c.version} was rejected`,
        detail: why ? `Reviewer: “${why.note}”` : "See the reviewer's reason and resubmit a revised candidate.",
        cta: "Revise & resubmit", go: () => onGoToEvolution() });
    }
    if (c.status === "IN_REVIEW" && role === "reviewer" && !(c.review && c.validation)) {
      tasks.push({ key: `rev-${c.version}`, tone: "warning", title: `Review ${name(c.pill_id)} v${c.version}`,
        detail: c.review ? "Review recorded — regression validation still to run." : "Independent review and regression tests required.",
        cta: "Open review", go: () => onGoToEvolution() });
    }
    if (c.status === "IN_REVIEW" && role === "approver" && c.review && c.validation) {
      tasks.push({ key: `app-${c.version}`, tone: "warning", title: `Release decision: ${name(c.pill_id)} v${c.version}`,
        detail: "Reviewed and validated. Approving supersedes the current version.",
        cta: "Decide", go: () => onGoToEvolution() });
    }
  }
  if (role === "operator" && (recs?.length ?? 0) === 0) {
    tasks.push({ key: "first", tone: "action", title: "Run your first operational assessment",
      detail: "Harbour Exchange basement sump — wet weather, synthetic demo case.", cta: "Start", go: onGoToLiveCase });
  }

  const updates = [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const activity = (audit ?? []).slice(-7).reverse();
  // Keep candidateForFeedback referenced for type-checking of shared helpers
  void candidateForFeedback;

  return (
    <div className="home">
      <div className="home-hero">
        <div>
          <div className="home-eyebrow">Signed in as {humanise(role)} · demo persona</div>
          <h1 className="home-title">Expert judgement, captured once and used safely every day.</h1>
          <p className="home-sub">{ROLE_INTRO[role] ?? ROLE_INTRO.viewer}</p>
        </div>
      </div>

      <div className="home-grid">
        <section className="home-main">
          <h2 className="home-h2">Your tasks {tasks.length > 0 && <span className="home-count">{tasks.length}</span>}</h2>
          {loading ? (
            <div className="text-muted">Loading…</div>
          ) : tasks.length === 0 ? (
            <div className="home-empty">You're all caught up. Switch role (top right) to see what others need to do.</div>
          ) : (
            <ul className="task-list">
              {tasks.map((t) => (
                <li key={t.key} className={`task task-${t.tone}`} onClick={t.go}>
                  <span className="task-dot" />
                  <div className="task-body">
                    <div className="task-title">{t.title}</div>
                    <div className="task-detail">{t.detail}</div>
                  </div>
                  <span className="task-cta">{t.cta} →</span>
                </li>
              ))}
            </ul>
          )}

          <div className="how-teaser" onClick={onGoToHowItWorks}>
            New here? <b>See how AI HARVEST works →</b>
          </div>
        </section>

        <aside className="home-side">
          <h2 className="home-h2">Knowledge updates</h2>
          <ul className="update-list">
            {updates.map((v) => (
              <li key={`${v.pill_id}@${v.version}`} className="update" onClick={() => onGoToPill(v.pill_id)}>
                <DomainIcon domain={v.content.domain} size={30} />
                <div>
                  <div className="update-title">{v.content.name} <span className="update-ver">v{v.version}</span></div>
                  <div className={`update-status st-${v.status.toLowerCase()}`}>{STATUS_TEXT[v.status] ?? v.status} · {ago(v.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="home-h2 mt-24">Recent activity</h2>
          {audit === null ? (
            <div className="home-locked">The audit trail is visible to Reviewer and Approver roles only — access is controlled by role.</div>
          ) : (
            <ul className="activity-list">
              {activity.map((a) => (
                <li key={a.sequence}>
                  <b>{humanise(a.actor)}</b> {EVENT_TEXT[a.event] ?? humanise(a.event)}
                  {a.detail?.version ? <> · v{String(a.detail.version)}</> : null}
                  <span className="activity-time">{ago(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
