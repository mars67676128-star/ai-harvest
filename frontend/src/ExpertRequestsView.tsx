import { FormEvent, useEffect, useState } from "react";
import { demoPersona } from "./demoIdentity";
import {
  decideKnowledgeCandidate,
  draftKnowledgeCandidate,
  getSifuConversation,
  listExpertiseRequests,
  respondToExpertiseRequest,
  type ExpertiseRequest,
  type KnowledgeCandidate,
  type SifuConversation,
} from "./sifuThreadsApi";

type Outcome = "answer" | "not_my_area" | "need_more_information" | "dont_know";

export default function ExpertRequestsView() {
  const [requests, setRequests] = useState<ExpertiseRequest[]>([]);
  const [selected, setSelected] = useState<ExpertiseRequest | null>(null);
  const [conversation, setConversation] = useState<SifuConversation | null>(null);
  const [candidate, setCandidate] = useState<KnowledgeCandidate | null>(null);
  const [draft, setDraft] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("answer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (demoPersona !== "expert") return;
    try {
      setError(null);
      const next = await listExpertiseRequests();
      setRequests(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load expertise requests.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const openRequest = async (request: ExpertiseRequest) => {
    setSelected(request);
    setCandidate(null);
    setLoading(true);
    setError(null);
    try {
      setConversation(await getSifuConversation(request.parent_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the conversation.");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await respondToExpertiseRequest(selected.id, draft.trim(), outcome);
      setConversation(result.conversation);
      setDraft("");
      await refresh();
      setSelected((current) => (current ? { ...current, status: "responded" } : current));
      if (result.sifu_error) {
        setError(
          `Your response was saved, but Sifu could not analyse it: ${result.sifu_error.message}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your response.");
    } finally {
      setLoading(false);
    }
  };

  const reviewInsight = async () => {
    if (!selected || !conversation || loading) return;
    setLoading(true);
    setError(null);
    try {
      setCandidate(await draftKnowledgeCandidate(conversation.id, selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sifu could not draft the candidate teaching.");
    } finally {
      setLoading(false);
    }
  };

  const decideCandidate = async (decision: "confirm" | "not_reusable") => {
    if (!candidate || loading) return;
    setLoading(true);
    setError(null);
    try {
      setCandidate(await decideKnowledgeCandidate(candidate.id, decision));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your candidate decision.");
    } finally {
      setLoading(false);
    }
  };

  if (demoPersona !== "expert") {
    return (
      <section className="index-page page-fade">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Expert workspace</span>
            <h1>Expertise requests</h1>
            <p>Requests appear only for the expert they were routed to.</p>
          </div>
        </div>
        <div className="quiet-success">
          Local demo: open this app in a second tab with <strong>?persona=expert</strong> to view Tan Wei Ming’s real request queue. This switch exists only for local multi-user testing; it is not a product role selector.
        </div>
      </section>
    );
  }

  if (candidate) {
    const statusLabel =
      candidate.status === "validated"
        ? "Validated"
        : candidate.status === "awaiting_owner_validation"
          ? "Meaning confirmed"
          : candidate.status === "changes_requested"
            ? "Changes requested"
            : candidate.status === "rejected"
              ? "Rejected"
              : candidate.status === "not_reusable"
                ? "Not reusable"
                : "Candidate";

    return (
      <section className="review-page page-fade">
        <div className="review-header">
          <button className="back-link" onClick={() => setCandidate(null)}>← Conversation</button>
          <span className={`status-word ${candidate.status === "validated" ? "validated" : "candidate"}`}>
            {statusLabel}
          </span>
        </div>
        <article className="review-manuscript">
          <div className="manuscript-kicker">Candidate Knowledge Pill · {candidate.domain}</div>
          <h1>{candidate.title}</h1>
          <p className="review-byline">Extracted from this conversation · Source: {candidate.source_expert_name}</p>

          <KnowledgeBlock title="Principle"><p>{candidate.principle}</p></KnowledgeBlock>
          {candidate.applies_when.length > 0 && <KnowledgeBlock title="Applies when"><BulletList items={candidate.applies_when} /></KnowledgeBlock>}
          {candidate.checks.length > 0 && <KnowledgeBlock title="Check"><BulletList items={candidate.checks} /></KnowledgeBlock>}
          {candidate.escalate_when.length > 0 && <KnowledgeBlock title="Escalate when"><BulletList items={candidate.escalate_when} /></KnowledgeBlock>}
          {candidate.exceptions.length > 0 && <KnowledgeBlock title="Exceptions"><BulletList items={candidate.exceptions} /></KnowledgeBlock>}
          {candidate.rationale && <KnowledgeBlock title="Why"><p>{candidate.rationale}</p></KnowledgeBlock>}
          {candidate.unresolved_questions.length > 0 && <KnowledgeBlock title="Still unresolved"><BulletList items={candidate.unresolved_questions} /></KnowledgeBlock>}

          <KnowledgeBlock title="Source"><p>{candidate.source_experts.join(", ")}</p></KnowledgeBlock>
          <KnowledgeBlock title="Knowledge Owner"><p>{candidate.knowledge_owner_name}</p></KnowledgeBlock>

          {candidate.status === "awaiting_expert_confirmation" ? (
            <div className="manuscript-actions">
              <button className="text-action" disabled={loading} onClick={() => void decideCandidate("not_reusable")}>Not reusable</button>
              <button className="primary-action" disabled={loading} onClick={() => void decideCandidate("confirm")}>Looks right ✓</button>
            </div>
          ) : candidate.status === "awaiting_owner_validation" ? (
            <div className="quiet-success">✓ You confirmed that Sifu understood your meaning. The candidate is now waiting for {candidate.knowledge_owner_name} to validate it before Sifu may teach it organisationally.</div>
          ) : candidate.status === "validated" ? (
            <div className="quiet-success">✓ This teaching is validated organisational knowledge.</div>
          ) : candidate.status === "changes_requested" ? (
            <div className="muted-copy">The Knowledge Owner requested clarification. The revision loop will return this to the Sifu conversation.</div>
          ) : (
            <div className="muted-copy">This insight will not be promoted as validated organisational knowledge.</div>
          )}
          {error && <p className="risk-note">{error}</p>}
        </article>
      </section>
    );
  }

  if (selected && conversation) {
    const latestSifu = [...conversation.messages]
      .reverse()
      .find((message) => message.role === "sifu" && message.answer);
    const reusableInsight = latestSifu?.answer?.reusable_insight;

    return (
      <section className="conversation-page page-fade">
        <div className="conversation-title">
          <button className="back-link" onClick={() => { setSelected(null); setConversation(null); }}>← Expertise requests</button>
          <span>{selected.status === "responded" ? "Responded" : "Needs your input"}</span>
        </div>

        <div className="conversation-stream">
          <div className="page-heading compact-heading">
            <div>
              <span className="eyebrow">Why Sifu routed this to you</span>
              <h1>{conversation.title}</h1>
              <p>{selected.reason}</p>
            </div>
          </div>

          {conversation.messages.map((message) => (
            <article
              className={`message ${message.role === "sifu" ? "sifu-message" : "human-message"} ${message.role === "expert" ? "expert" : ""}`}
              key={message.id}
            >
              <div className="message-author">
                <span className="person-dot" />
                {message.role === "sifu" ? "Sifu" : message.role === "expert" ? message.speaker : "Employee"}
              </div>
              <div className="message-body">{message.content}</div>
            </article>
          ))}

          {selected.status === "responded" && reusableInsight?.detected && (
            <div className="insight-event">
              <span className="spark">✦</span>
              <div>
                <strong>Sifu noticed something reusable</strong>
                <span>{reusableInsight.summary}</span>
              </div>
              <button disabled={loading} onClick={() => void reviewInsight()}>
                Review what I understood →
              </button>
            </div>
          )}

          {error && <p className="risk-note">{error}</p>}
        </div>

        {selected.status === "pending" && (
          <form className="conversation-composer-wrap expert-response-composer" onSubmit={submit}>
            <div className="filter-line expert-outcomes" aria-label="Response outcome">
              <button type="button" className={outcome === "answer" ? "selected" : ""} onClick={() => setOutcome("answer")}>I can help</button>
              <button type="button" className={outcome === "need_more_information" ? "selected" : ""} onClick={() => setOutcome("need_more_information")}>Need more information</button>
              <button type="button" className={outcome === "not_my_area" ? "selected" : ""} onClick={() => setOutcome("not_my_area")}>Not my area</button>
              <button type="button" className={outcome === "dont_know" ? "selected" : ""} onClick={() => setOutcome("dont_know")}>I don’t know</button>
            </div>
            <div className="composer compact">
              <textarea
                rows={3}
                value={draft}
                disabled={loading}
                placeholder={outcome === "answer" ? "Share what you would do and why…" : "Explain what is missing or who you would normally ask…"}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="composer-actions">
                <span className="composer-hint">Sifu will analyse your response, not silently publish it.</span>
                <button className="send-button" type="submit" disabled={loading || !draft.trim()} aria-label="Send expert response">↑</button>
              </div>
            </div>
          </form>
        )}
      </section>
    );
  }

  const pending = requests.filter((request) => request.status === "pending");
  const handled = requests.filter((request) => request.status === "responded");

  return (
    <section className="index-page page-fade">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Questions routed to you</span>
          <h1>Expertise requests</h1>
          <p>Sifu asks when your experience is relevant. “I don’t know” and “not my area” are valid outcomes.</p>
        </div>
      </div>

      {error && <p className="risk-note">{error}</p>}
      {loading && requests.length === 0 && <p className="muted-copy">Loading your requests…</p>}

      <section className="timeline-group">
        <h2>Needs your input</h2>
        {pending.length === 0 ? (
          <p className="muted-copy">No pending expertise requests.</p>
        ) : pending.map((request) => (
          <button className="timeline-row high" key={request.id} onClick={() => void openRequest(request)}>
            <span className="request-pulse" />
            <span className="timeline-title">
              <strong>{request.conversation_title ?? "Sifu question"}</strong>
              <small>From {request.created_by ?? request.requested_by} · {request.reason}</small>
            </span>
            <span>Needs input</span>
            <span>→</span>
          </button>
        ))}
      </section>

      <section className="timeline-group">
        <h2>Previously handled</h2>
        {handled.length === 0 ? (
          <p className="muted-copy">No handled requests yet.</p>
        ) : handled.map((request) => (
          <button className="timeline-row" key={request.id} onClick={() => void openRequest(request)}>
            <span className="timeline-title">
              <strong>{request.conversation_title ?? "Sifu question"}</strong>
              <small>Response recorded</small>
            </span>
            <span>Responded</span>
            <span>→</span>
          </button>
        ))}
      </section>
    </section>
  );
}

function KnowledgeBlock(props: { title: string; children: React.ReactNode }) {
  return <section className="knowledge-section"><h3>{props.title}</h3><div>{props.children}</div></section>;
}

function BulletList({ items }: { items: string[] }) {
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
