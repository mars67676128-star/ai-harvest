import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PillVersion, RecommendationRecord } from "../types";
import { getPills, getPillVersions, getRecommendations, getRecommendation, getAuditHistory, getRole } from "../api";
import type { AuditEntry } from "../api";
import { DomainIcon } from "./DomainIcon";
import { Term, Avatar } from "./Term";
import { GLOSSARY, persona } from "../lib/glossary";
import { sgTime } from "../lib/format";
import { getFeedbackIds, candidateForFeedback, getRememberedRejection, setActiveRec } from "../lib/demoState";

type Go = {
  onGoToHowItWorks: (section?: string) => void;
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




type FeedItem = { key: string; actor: string; at: string; text: ReactNode };

function feedFromAudit(items: AuditEntry[], pillName: (id: string) => string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const a of items) {
    const v = a.detail?.version ? ` v${String(a.detail.version)}` : "";
    const n = <b>{pillName(a.entity_id)}{v}</b>;
    let text: ReactNode = null;
    switch (a.event) {
      case "KNOWLEDGE_CAPTURED": text = <>recorded an expert interview ({String(a.detail?.domain ?? "")})</>; break;
      case "KNOWLEDGE_EXTRACTED": text = <>had AI turn the interview into draft rules</>; break;
      case "PILL_CREATED": text = <>created {n}</>; break;
      case "CANDIDATE_REVISION_CREATED": text = <>created a <Term k="candidate">proposal</Term>: {n}</>; break;
      case "REVIEW_REQUESTED": text = <>sent {n} for review</>; break;
      case "EXPERT_REVIEWED": text = <>reviewed {n}</>; break;
      case "PILL_VALIDATED": text = <>ran the test situations on {n}</>; break;
      case "PILL_APPROVED": text = <>approved {n} — now in use</>; break;
      case "PILL_REJECTED": text = <>rejected {n}{a.detail?.note ? <> — “{String(a.detail.note)}”</> : null}</>; break;
      case "PILL_SUPERSEDED": text = <>replaced {n} with v{String(a.detail?.successor ?? "")}</>; break;
      case "PILL_DEPRECATED": text = <>retired {n}</>; break;
      case "CASE_CREATED": text = <>opened an assessment at Harbour Exchange</>; break;
      case "HUMAN_DECISION": text = a.detail?.decision === "escalate" ? <><Term k="escalate">escalated</Term> a situation</> : <>recorded a decision</>; break;
      case "OUTCOME_RECORDED": text = <>reported what actually happened</>; break;
      case "FEEDBACK_SUBMITTED": text = <>flagged something {pillName(a.entity_id) !== a.entity_id ? <b>{pillName(a.entity_id)}</b> : "a pill"} missed</>; break;
      default: text = null; // skip noisy system events (pill invoked, recommendation generated, AI proposal metadata)
    }
    if (text) out.push({ key: `a${a.sequence}`, actor: a.actor, at: a.created_at, text });
  }
  return out.reverse();
}

// Roles that can't read the audit trail still see a feed built from what they're allowed to read.
function feedFromState(versions: PillVersion[], recs: RecommendationRecord[] | null): FeedItem[] {
  const out: FeedItem[] = [];
  for (const v of versions) {
    const n = <b>{v.content.name} v{v.version}</b>;
    out.push({ key: `c${v.pill_id}${v.version}`, actor: v.author, at: v.created_at,
      text: v.previous_version ? <>created a <Term k="candidate">proposal</Term>: {n}</> : <>created {n}</> });
    const rv = v.review as { actor?: string; at?: string } | null;
    if (rv?.at) out.push({ key: `r${v.pill_id}${v.version}`, actor: rv.actor ?? "reviewer", at: rv.at, text: <>reviewed {n}</> });
    const ap = v.approval as { actor?: string; at?: string } | null;
    if (ap?.at) out.push({ key: `p${v.pill_id}${v.version}`, actor: ap.actor ?? "approver", at: ap.at, text: <>approved {n} — now in use</> });
  }
  for (const r of recs ?? []) {
    out.push({ key: `k${r.id}`, actor: r.actor, at: r.created_at, text: <>opened an assessment at Harbour Exchange</> });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const SUGGESTIONS = ["pump", "flood", "tenant access", "escalate", "backflow"];

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
      if (role === "operator" || role === "approver") try {
        const list = await getRecommendations();
        const hydrated = await Promise.all(list.map((r) => getRecommendation(r.id).catch(() => r)));
        if (!cancelled) setRecs(hydrated);
      } catch { if (!cancelled) setRecs(null); } else if (!cancelled) setRecs(null);
      if (role === "reviewer" || role === "approver") try {
        const h = await getAuditHistory(undefined, 0, 500);
        if (!cancelled) setAudit(h.items);
      } catch { if (!cancelled) setAudit(null); } else if (!cancelled) setAudit(null);
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
          detail: `Assessment at ${sgTime(r.created_at)}.`,
          cta: "Open case", go: onGoToLiveCase });
      } else if (r.human_decision && !r.outcome && role === "operator") {
        tasks.push({ key: `out-${r.id}`, tone: "action", title: "Record what actually happened",
          detail: `Escalation at ${sgTime(r.created_at)} has no outcome yet.`,
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
      detail: "Harbour Exchange basement sump, wet weather.", cta: "Start", go: onGoToLiveCase });
  }


  // ---- Library: one current version per pill (approved if there is one) ----
  const library = useMemo(() => {
    const byPill = new Map<string, PillVersion[]>();
    for (const v of versions) byPill.set(v.pill_id, [...(byPill.get(v.pill_id) ?? []), v]);
    return [...byPill.values()].map((vs) => {
      const sorted = [...vs].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const current = vs.find((v) => v.status === "APPROVED") ?? sorted[0];
      const pending = sorted.find((v) => v.status === "DRAFT" || v.status === "IN_REVIEW");
      return { current, pending, count: vs.length };
    });
  }, [versions]);

  // ---- Search: across the content of current pills, plus the glossary ----
  const [q, setQ] = useState("");
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const pillHits = tokens.length === 0 ? [] : library.flatMap(({ current }) => {
    const c = current.content;
    const fields = [c.name, c.description, c.domain, ...c.expert_observations, ...c.facts, ...c.exceptions,
      ...c.rules.map((r) => r.rationale), ...c.scope.equipment, ...c.scope.contexts, ...c.guardrails];
    const hay = fields.join(" \n ").toLowerCase();
    if (!tokens.every((t) => hay.includes(t))) return [];
    const score = (f: string) => tokens.filter((t) => f.toLowerCase().includes(t)).length;
    const snippet = [...fields].sort((x, y) => score(y) - score(x))[0] ?? c.description;
    return [{ v: current, snippet }];
  });
  const termHits = tokens.length === 0 ? [] : GLOSSARY.filter((g) =>
    tokens.every((t) => `${g.term} ${g.plain}`.toLowerCase().includes(t))).slice(0, 4);
  const highlight = (text: string) => {
    if (tokens.length === 0) return text;
    const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
    return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
  };

  const feed = (audit ? feedFromAudit(audit, name) : feedFromState(versions, recs)).slice(0, 8);
  const me = persona(role);
  void candidateForFeedback;

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-eyebrow">Harbour Exchange · building operations knowledge</div>
        <h1 className="home-title">{role === "viewer" ? "Welcome" : `${greeting()}, ${me.name.split(" ")[0]}`}</h1>
        <p className="home-sub">
          <span className="home-me"><Avatar actor={role} size={22} /> {me.name} · {me.title} <span className="text-muted">(demo persona)</span></span>
        </p>

        <div className="kb-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search what the team knows — e.g. “pump running but water rising”"
            aria-label="Search knowledge"
          />
          {q && <button className="kb-clear" onClick={() => setQ("")} aria-label="Clear search">×</button>}
        </div>
        {!q && (
          <div className="kb-suggest">
            <span className="text-muted">Try:</span>
            {SUGGESTIONS.map((sug) => <button key={sug} className="kb-chip" onClick={() => setQ(sug)}>{sug}</button>)}
          </div>
        )}
      </div>

      {q ? (
        <section className="kb-results">
          <h2 className="home-h2">{pillHits.length} pill{pillHits.length === 1 ? "" : "s"} · current versions only</h2>
          {pillHits.length === 0 && <div className="home-empty">No current pill mentions “{q}”. Try a simpler word, or check the glossary below.</div>}
          <ul className="kb-hit-list">
            {pillHits.map(({ v, snippet }) => (
              <li key={v.pill_id} className="kb-hit" onClick={() => onGoToPill(v.pill_id)}>
                <DomainIcon domain={v.content.domain} size={34} />
                <div>
                  <div className="kb-hit-title">{highlight(v.content.name)} <span className="update-ver">v{v.version}</span>
                    {v.status === "APPROVED" && <span className="trust-ok">✓ Approved</span>}</div>
                  <div className="kb-hit-snip">…{highlight(snippet)}…</div>
                  <div className="kb-hit-meta">{v.content.domain} · owned by {persona(v.owner).name}</div>
                </div>
              </li>
            ))}
          </ul>
          {termHits.length > 0 && (
            <>
              <h2 className="home-h2 mt-24">Glossary</h2>
              <ul className="kb-term-list">
                {termHits.map((g) => (
                  <li key={g.key}><b>{g.term}</b> — {g.plain}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : (
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

          <h2 className="home-h2 mt-32">Knowledge library <span className="text-muted home-h2-note">{library.length} <Term k="pill">pills</Term> · one current version each</span></h2>
          <div className="lib-grid">
            {library.map(({ current: v, pending }) => (
              <article key={v.pill_id} className="lib-card" onClick={() => onGoToPill(v.pill_id)}>
                <div className="lib-head">
                  <DomainIcon domain={v.content.domain} size={36} />
                  <div className="lib-domain">{v.content.domain}</div>
                </div>
                <div className="lib-name">{v.content.name}</div>
                <div className="lib-desc">{v.content.description}</div>
                <div className="lib-meta">
                  <span className={v.status === "APPROVED" ? "trust-ok" : "trust-other"}>
                    {v.status === "APPROVED" ? "✓ Approved" : v.status.toLowerCase()} · v{v.version}
                  </span>
                  <span>{v.content.rules.length} rules · {v.content.evaluation.length} test situations</span>
                </div>
                <div className="lib-people">
                  <Avatar actor={v.author} size={22} />
                  <span>From <b>{persona(v.author).name}</b> · owner {persona(v.owner).name}</span>
                </div>
                {pending && <div className="lib-pending">v{pending.version} {pending.status === "DRAFT" ? "drafted" : "in review"} — not in use yet</div>}
              </article>
            ))}
          </div>

          <div className="how-teaser">
            New to the team? Read the <a onClick={() => onGoToHowItWorks()}>Guide</a> · <a onClick={() => onGoToHowItWorks("glossary")}>Glossary</a>
          </div>
        </section>

        <aside className="home-side">
          <h2 className="home-h2">Team activity</h2>
          {feed.length === 0 ? (
            <div className="home-empty">Nothing yet.</div>
          ) : (
            <ul className="feed">
              {feed.map((f) => (
                <li key={f.key} className="feed-item">
                  <Avatar actor={f.actor} size={30} />
                  <div>
                    <div className="feed-text"><b>{persona(f.actor).name}</b> {f.text}</div>
                    <div className="feed-time">{persona(f.actor).title} · {sgTime(f.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!audit && <div className="feed-note">Showing activity visible to your role.</div>}
        </aside>
      </div>
      )}
    </div>
  );
}
