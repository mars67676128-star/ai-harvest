import { useEffect, useState } from "react";
import { demoPersona } from "./demoIdentity";
import {
  decideKnowledgeOwnerReview,
  listKnowledgeReviews,
  type KnowledgeCandidate,
} from "./sifuThreadsApi";

export default function KnowledgeOwnerReviewsView() {
  const [reviews, setReviews] = useState<KnowledgeCandidate[]>([]);
  const [selected, setSelected] = useState<KnowledgeCandidate | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (demoPersona !== "approver") return;
    setLoading(true);
    setError(null);
    try {
      setReviews(await listKnowledgeReviews());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load review queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const decide = async (decision: "validate" | "request_changes" | "reject") => {
    if (!selected || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await decideKnowledgeOwnerReview(selected.id, decision, note.trim());
      setSelected(result);
      setNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record Knowledge Owner decision.");
    } finally {
      setLoading(false);
    }
  };

  if (demoPersona !== "approver") {
    return (
      <section className="index-page page-fade">
        <div className="page-heading"><div><span className="eyebrow">Knowledge governance</span><h1>Reviews</h1><p>Only the configured Knowledge Owner for a domain can validate its candidate teachings.</p></div></div>
      </section>
    );
  }

  if (selected) {
    if (selected.status === "validated") {
      return (
        <section className="review-page page-fade">
          <div className="validation-celebration">
            <span className="validation-check">✓</span>
            <h1>Teaching validated</h1>
            <p>{selected.title}</p>
            <div className="validation-meta">Taught by {selected.source_expert_name} · Validated by {selected.knowledge_owner_name} · Version 1</div>
            <div className="motto-large">Ask once. Teach forever.</div>
            <button className="text-action" onClick={() => { setSelected(null); void refresh(); }}>Back to reviews</button>
          </div>
        </section>
      );
    }

    return (
      <section className="review-page page-fade">
        <div className="review-header">
          <button className="back-link" onClick={() => setSelected(null)}>← Reviews</button>
          <span className="status-word candidate">{selected.status === "changes_requested" ? "Changes requested" : "Candidate"}</span>
        </div>
        <article className="review-manuscript">
          <div className="manuscript-kicker">{selected.domain}</div>
          <h1>{selected.title}</h1>
          <p className="review-byline">Taught by {selected.source_expert_name} · Meaning confirmed by source expert</p>

          <KnowledgeBlock title="Principle"><p>{selected.principle}</p></KnowledgeBlock>
          {selected.applies_when.length > 0 && <KnowledgeBlock title="Applies when"><BulletList items={selected.applies_when} /></KnowledgeBlock>}
          {selected.checks.length > 0 && <KnowledgeBlock title="What to check"><BulletList items={selected.checks} /></KnowledgeBlock>}
          {selected.escalate_when.length > 0 && <KnowledgeBlock title="Escalate when"><BulletList items={selected.escalate_when} /></KnowledgeBlock>}
          {selected.exceptions.length > 0 && <KnowledgeBlock title="Exceptions"><BulletList items={selected.exceptions} /></KnowledgeBlock>}
          {selected.rationale && <KnowledgeBlock title="Why"><p>{selected.rationale}</p></KnowledgeBlock>}
          {selected.unresolved_questions.length > 0 && <KnowledgeBlock title="Unresolved questions"><BulletList items={selected.unresolved_questions} /></KnowledgeBlock>}

          <KnowledgeBlock title="Provenance">
            <p>Source expert: {selected.source_expert_name}</p>
            <p>Knowledge Owner: {selected.knowledge_owner_name}</p>
            <p>Conversation: {selected.parent_id}</p>
          </KnowledgeBlock>

          {selected.status === "awaiting_owner_validation" ? (
            <>
              <label className="owner-note">
                <span>Review note</span>
                <textarea value={note} rows={3} placeholder="Optional note or clarification request…" onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="review-actions">
                <button className="text-action" disabled={loading} onClick={() => void decide("reject")}>Reject</button>
                <button className="text-action" disabled={loading} onClick={() => void decide("request_changes")}>Request clarification</button>
                <button className="primary-action" disabled={loading} onClick={() => void decide("validate")}>Validate teaching ✓</button>
              </div>
            </>
          ) : (
            <div className="muted-copy">This review already has a Knowledge Owner decision.</div>
          )}
          {error && <p className="risk-note">{error}</p>}
        </article>
      </section>
    );
  }

  const pending = reviews.filter((item) => item.status === "awaiting_owner_validation");
  const handled = reviews.filter((item) => item.status !== "awaiting_owner_validation");

  return (
    <section className="index-page page-fade">
      <div className="page-heading"><div><span className="eyebrow">Knowledge governance</span><h1>Reviews</h1><p>Candidate teachings confirmed by their source experts and waiting for your domain decision.</p></div></div>
      {error && <p className="risk-note">{error}</p>}
      {loading && reviews.length === 0 && <p className="muted-copy">Loading review queue…</p>}

      <section className="timeline-group">
        <h2>Needs review</h2>
        {pending.length === 0 ? <p className="muted-copy">No candidate teachings are waiting for validation.</p> : pending.map((item) => (
          <button className="timeline-row high" key={item.id} onClick={() => setSelected(item)}>
            <span className="request-pulse" />
            <span className="timeline-title"><strong>{item.title}</strong><small>{item.domain} · Taught by {item.source_expert_name}</small></span>
            <span>Needs review</span><span>→</span>
          </button>
        ))}
      </section>

      {handled.length > 0 && (
        <section className="timeline-group">
          <h2>Handled</h2>
          {handled.map((item) => (
            <button className="timeline-row" key={item.id} onClick={() => setSelected(item)}>
              <span className="timeline-title"><strong>{item.title}</strong><small>{item.domain}</small></span>
              <span>{item.status.replaceAll("_", " ")}</span><span>→</span>
            </button>
          ))}
        </section>
      )}
    </section>
  );
}

function KnowledgeBlock(props: { title: string; children: React.ReactNode }) {
  return <section className="knowledge-section"><h3>{props.title}</h3><div>{props.children}</div></section>;
}

function BulletList({ items }: { items: string[] }) {
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
