import { FormEvent, useEffect, useState } from "react";
import { demoPersona } from "./demoIdentity";
import {
  getSifuConversation,
  listExpertiseRequests,
  respondToExpertiseRequest,
  type ExpertiseRequest,
  type SifuConversation,
} from "./sifuThreadsApi";

type Outcome = "answer" | "not_my_area" | "need_more_information" | "dont_know";

export default function ExpertRequestsView() {
  const [requests, setRequests] = useState<ExpertiseRequest[]>([]);
  const [selected, setSelected] = useState<ExpertiseRequest | null>(null);
  const [conversation, setConversation] = useState<SifuConversation | null>(null);
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

  if (selected && conversation) {
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
