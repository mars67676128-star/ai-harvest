import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  askSifu,
  getSifuStatus,
  type SifuAnswer,
  type SifuExpertMatch,
  type SifuStatus,
} from "./api";

type View = "ask" | "knowledge" | "cases" | "requests" | "reviews" | "expertise";

type KnowledgeItem = {
  id: string;
  title: string;
  domain: string;
  source: string;
  status: "validated" | "candidate" | "superseded";
  used: number;
};

type Exchange = {
  id: number;
  question: string;
  answer: SifuAnswer;
};

const seededKnowledge: KnowledgeItem[] = [
  {
    id: "drainage-running",
    title: "RUNNING status does not confirm effective drainage",
    domain: "Technical Services · Drainage",
    source: "Tan Wei Ming",
    status: "validated",
    used: 14,
  },
  {
    id: "backflow",
    title: "Drain backflow can mask drainage failure",
    domain: "Technical Services · Drainage",
    source: "Tan Wei Ming",
    status: "candidate",
    used: 0,
  },
  {
    id: "chiller-restart",
    title: "Check bearing condition after interrupted chiller restart",
    domain: "Technical Services · HVAC",
    source: "Marcus Lee",
    status: "validated",
    used: 8,
  },
  {
    id: "access-route",
    title: "Alternative access routes must be verified before rerouting tenants",
    domain: "Tenant Experience",
    source: "Sarah Koh",
    status: "validated",
    used: 21,
  },
];

const sampleQuestion = "Pump says RUNNING but the basement water is still rising. What should I do?";

export default function SifuApp() {
  const [view, setView] = useState<View>("ask");
  const [draft, setDraft] = useState("");
  const [validated, setValidated] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<SifuStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestedExpert, setRequestedExpert] = useState<SifuExpertMatch | null>(null);

  useEffect(() => {
    getSifuStatus()
      .then(setAgentStatus)
      .catch(() => setAgentStatus(null));
  }, []);

  const knowledge = useMemo(() => {
    if (!validated) return seededKnowledge;
    return seededKnowledge.map((item) =>
      item.id === "backflow" ? { ...item, status: "validated" as const, used: 1 } : item,
    );
  }, [validated]);

  const runQuestion = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    setLoading(true);
    setPendingQuestion(question);
    setAgentError(null);
    setRequestedExpert(null);
    setDraft("");

    const conversation = exchanges.flatMap((exchange) => [
      { role: "employee" as const, speaker: "Amanda Lee", content: exchange.question },
      { role: "sifu" as const, speaker: "Sifu", content: exchange.answer.answer },
    ]);

    try {
      const answer = await askSifu({ question, conversation });
      setExchanges((current) => [
        ...current,
        { id: Date.now(), question, answer },
      ]);
      setAgentStatus((current) => current ? { ...current, configured: true } : current);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Sifu AI request failed.");
    } finally {
      setPendingQuestion("");
      setLoading(false);
    }
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    void runQuestion(draft);
  };

  const resetConversation = () => {
    setDraft("");
    setExchanges([]);
    setPendingQuestion("");
    setAgentError(null);
    setRequestedExpert(null);
  };

  return (
    <div className="sifu-app">
      <Sidebar
        view={view}
        onNavigate={setView}
        onNewQuestion={() => {
          resetConversation();
          setView("ask");
        }}
        requestCount={2}
        reviewCount={validated ? 2 : 3}
        agentStatus={agentStatus}
      />

      <div className="sifu-stage">
        <header className="sifu-topbar">
          <div className="topbar-context">
            <span className="topbar-kicker">Shared Intelligence From Us</span>
            <span className="topbar-motto">Ask once. Teach forever.</span>
          </div>
          <div className="topbar-user">
            <span className={`ai-connection ${agentStatus?.configured ? "live" : "offline"}`}>
              <span />{agentStatus?.configured ? "Live AI" : "AI not configured"}
            </span>
            <button className="quiet-icon" aria-label="Search"><SearchIcon /></button>
            <div className="user-avatar">AL</div>
            <div className="user-copy"><strong>Amanda Lee</strong><span>Operations</span></div>
          </div>
        </header>

        <main className="sifu-main">
          {view === "ask" && (
            <AskView
              exchanges={exchanges}
              pendingQuestion={pendingQuestion}
              draft={draft}
              loading={loading}
              error={agentError}
              requestedExpert={requestedExpert}
              onDraftChange={setDraft}
              onSubmit={submitQuestion}
              onPreview={() => void runQuestion(sampleQuestion)}
              onAskExpert={setRequestedExpert}
            />
          )}
          {view === "knowledge" && (
            <KnowledgeView
              knowledge={knowledge}
              query={knowledgeQuery}
              onQuery={setKnowledgeQuery}
              validated={validated}
            />
          )}
          {view === "cases" && <CasesView />}
          {view === "requests" && (
            <RequestsView
              onOpen={() => {
                setView("ask");
                setDraft(sampleQuestion);
              }}
            />
          )}
          {view === "reviews" && (
            <ReviewsView
              validated={validated}
              onValidate={() => setValidated(true)}
            />
          )}
          {view === "expertise" && <ExpertiseView />}
        </main>
      </div>
    </div>
  );
}

function Sidebar(props: {
  view: View;
  onNavigate: (view: View) => void;
  onNewQuestion: () => void;
  requestCount: number;
  reviewCount: number;
  agentStatus: SifuStatus | null;
}) {
  const { view, onNavigate, onNewQuestion, requestCount, reviewCount, agentStatus } = props;
  return (
    <aside className="sifu-sidebar">
      <div className="brand-lockup">
        <SifuAvatar size="small" mood="calm" />
        <div><div className="brand-word">SIFU</div><div className="brand-line">Shared intelligence</div></div>
      </div>

      <button className="new-question" onClick={onNewQuestion}><PlusIcon />New question</button>

      <nav className="primary-nav" aria-label="Primary">
        <NavItem active={view === "ask"} icon={<ChatIcon />} label="Ask Sifu" onClick={() => onNavigate("ask")} />
        <NavItem active={view === "knowledge"} icon={<BookIcon />} label="Knowledge" onClick={() => onNavigate("knowledge")} />
        <NavItem active={view === "cases"} icon={<CasesIcon />} label="Cases" onClick={() => onNavigate("cases")} />
      </nav>

      <div className="sidebar-section-label">Your work</div>
      <nav className="primary-nav" aria-label="Work queues">
        <NavItem active={view === "requests"} icon={<PeopleIcon />} label="Expertise requests" badge={requestCount} onClick={() => onNavigate("requests")} />
        <NavItem active={view === "reviews"} icon={<ReviewIcon />} label="Reviews" badge={reviewCount} onClick={() => onNavigate("reviews")} />
        <NavItem active={view === "expertise"} icon={<NetworkIcon />} label="Expertise" onClick={() => onNavigate("expertise")} />
      </nav>

      <div className="sidebar-spacer" />
      <div className="recent-block">
        <div className="sidebar-section-label">Recent</div>
        <button onClick={() => onNavigate("ask")}>Pump rising water</button>
        <button onClick={() => onNavigate("ask")}>Chiller restart</button>
        <button onClick={() => onNavigate("ask")}>Tenant access</button>
      </div>
      <div className={`sidebar-footer ${agentStatus?.configured ? "live" : "offline"}`}>
        <span className="presence-dot" />
        {agentStatus?.configured ? `Live AI · ${agentStatus.provider}` : "Live AI not configured"}
      </div>
    </aside>
  );
}

function NavItem(props: { active?: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void }) {
  return (
    <button className={`nav-row ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-icon">{props.icon}</span>
      <span>{props.label}</span>
      {props.badge ? <span className="nav-badge">{props.badge}</span> : null}
    </button>
  );
}

function AskView(props: {
  exchanges: Exchange[];
  pendingQuestion: string;
  draft: string;
  loading: boolean;
  error: string | null;
  requestedExpert: SifuExpertMatch | null;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPreview: () => void;
  onAskExpert: (expert: SifuExpertMatch) => void;
}) {
  const empty = props.exchanges.length === 0 && !props.pendingQuestion && !props.error;

  if (empty) {
    return (
      <section className="ask-empty page-fade">
        <div className="mentor-hero"><SifuAvatar size="hero" mood="calm" /></div>
        <p className="eyebrow">Good evening, Amanda.</p>
        <h1>What can I help you with?</h1>
        <p className="hero-copy">Ask about a situation at work. I’ll use validated organisational knowledge, or find the right person when I don’t know.</p>
        <Composer value={props.draft} onChange={props.onDraftChange} onSubmit={props.onSubmit} disabled={props.loading} />
        <div className="starter-row">
          <button onClick={props.onPreview}>Equipment issue</button>
          <button onClick={() => props.onDraftChange("What is the correct escalation path for a tenant access issue?")}>Procedure</button>
          <button onClick={() => props.onDraftChange("Who has experience with BMS telemetry faults?")}>Find an expert</button>
        </div>
        <div className="recent-learning">
          <span>Try Sifu</span>
          <button onClick={props.onPreview}>Ask an unseen free-form question <ArrowIcon /></button>
          <button onClick={() => props.onDraftChange("What should I check before escalating a chiller restart issue?")}>Ask about another situation <ArrowIcon /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="conversation-page page-fade">
      <div className="conversation-title"><span>Sifu conversation</span><button>•••</button></div>
      <div className="conversation-stream">
        {props.exchanges.map((exchange) => (
          <div className="exchange" key={exchange.id}>
            <HumanMessage name="Amanda Lee">{exchange.question}</HumanMessage>
            <SifuAnswerMessage answer={exchange.answer} onAskExpert={props.onAskExpert} />
          </div>
        ))}

        {props.pendingQuestion && (
          <div className="exchange pending-exchange">
            <HumanMessage name="Amanda Lee">{props.pendingQuestion}</HumanMessage>
            <SifuMessage mood="searching">
              <p>Checking approved organisational knowledge and relevant expertise…</p>
            </SifuMessage>
          </div>
        )}

        {props.error && (
          <SifuMessage mood="calm">
            <p><strong>I couldn’t produce a live AI answer.</strong></p>
            <p className="muted-copy">{props.error}</p>
            <p className="muted-copy">I won’t substitute a canned response. Configure a live provider or check the backend connection, then try again.</p>
          </SifuMessage>
        )}

        {props.requestedExpert && (
          <>
            <SystemLine>Expert request prepared for {props.requestedExpert.name} · awaiting a human response</SystemLine>
            <SifuMessage mood="calm">
              <p>I’ve kept your question and the relevant source context together for {props.requestedExpert.name}.</p>
              <p className="muted-copy">Until that person responds and the organisation validates any reusable teaching, I’ll treat this as an unresolved knowledge gap.</p>
            </SifuMessage>
          </>
        )}
      </div>
      <div className="conversation-composer-wrap">
        <Composer value={props.draft} onChange={props.onDraftChange} onSubmit={props.onSubmit} compact disabled={props.loading} />
      </div>
    </section>
  );
}

function SifuAnswerMessage(props: { answer: SifuAnswer; onAskExpert: (expert: SifuExpertMatch) => void }) {
  const { answer } = props;
  const mood = answer.coverage === "insufficient" ? "searching" : answer.reusable_insight.detected ? "thinking" : "calm";
  return (
    <SifuMessage mood={mood}>
      <div className={`coverage-line coverage-${answer.coverage}`}>
        <span>{answer.coverage === "full" ? "Validated coverage" : answer.coverage === "partial" ? "Partial coverage" : "Knowledge gap"}</span>
        <span>Risk · {answer.risk}</span>
      </div>
      <p className="sifu-answer-text">{answer.answer}</p>

      {answer.known_points.length > 0 && (
        <div className="answer-detail">
          <strong>What I can support</strong>
          <ul>{answer.known_points.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      )}

      {answer.missing_information.length > 0 && (
        <div className="answer-detail muted">
          <strong>Still unresolved</strong>
          <ul>{answer.missing_information.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      )}

      {answer.follow_up_question && (
        <p className="follow-up-question"><span>One useful clarification</span>{answer.follow_up_question}</p>
      )}

      {answer.citations.length > 0 && (
        <div className="knowledge-provenance">
          <span className="provenance-label">✓ Validated organisational knowledge</span>
          {answer.citations.map((citation) => (
            <div className="provenance-item" key={`${citation.pill_id}-${citation.version}`}>
              <strong>{citation.title}</strong>
              <span>{citation.domain} · v{citation.version}</span>
              <span>Taught by {citation.source_expert ?? "recorded expert"}{citation.validator ? ` · Validated by ${citation.validator}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {answer.basis === "expert_context" || answer.basis === "mixed" ? (
        <p className="current-guidance-note">Current expert guidance is helping this case, but it is not automatically validated organisational knowledge.</p>
      ) : null}

      {answer.recommended_expert && (
        <PersonInline
          initials={initials(answer.recommended_expert.name)}
          name={answer.recommended_expert.name}
          role={answer.recommended_expert.role}
          tags={[...answer.recommended_expert.skills.slice(0, 2), answer.recommended_expert.reason]}
          action={`Ask ${firstName(answer.recommended_expert.name)}`}
          onAction={() => props.onAskExpert(answer.recommended_expert!)}
        />
      )}

      {answer.risk === "high" && <p className="risk-note"><strong>High consequence if wrong.</strong> {answer.risk_reason}</p>}

      {answer.reusable_insight.detected && (
        <div className="insight-event inline-insight">
          <span className="spark">✦</span>
          <div>
            <strong>Sifu noticed a possible reusable teaching</strong>
            <span>{answer.reusable_insight.summary}</span>
          </div>
          <span className="insight-status">Expert confirmation required</span>
        </div>
      )}

      <div className="ai-trace">Live AI · {String(answer.ai.provider ?? "provider")} · {String(answer.ai.model ?? "model")}</div>
    </SifuMessage>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function firstName(name: string) {
  return name.split(/\s+/).filter(Boolean)[0] ?? name;
}

function Composer(props: { value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <form className={`composer ${props.compact ? "compact" : ""}`} onSubmit={props.onSubmit}>
      <textarea
        aria-label="Ask Sifu"
        value={props.value}
        rows={props.compact ? 2 : 3}
        placeholder="Ask Sifu about your work..."
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-actions">
        <button type="button" className="composer-tool" aria-label="Attach" disabled={props.disabled}><PlusIcon /></button>
        <span className="composer-hint">{props.disabled ? "Sifu is thinking…" : "Enter to send · Shift + Enter for a new line"}</span>
        <button type="submit" className="send-button" aria-label="Send" disabled={props.disabled}><SendIcon /></button>
      </div>
    </form>
  );
}

function HumanMessage(props: { name: string; children: React.ReactNode; tone?: "expert" }) {
  return (
    <article className={`message human-message ${props.tone === "expert" ? "expert" : ""}`}>
      <div className="message-author"><span className="person-dot" />{props.name}</div>
      <div className="message-body">{props.children}</div>
    </article>
  );
}

function SifuMessage(props: { children: React.ReactNode; mood: "thinking" | "searching" | "calm" }) {
  return (
    <article className="message sifu-message">
      <div className="message-avatar"><SifuAvatar size="small" mood={props.mood} /></div>
      <div>
        <div className="message-author sifu-author">Sifu <span>organisational mentor</span></div>
        <div className="message-body">{props.children}</div>
      </div>
    </article>
  );
}

function PersonInline(props: { initials: string; name: string; role: string; tags: string[]; action: string; onAction: () => void }) {
  return (
    <div className="person-inline">
      <div className="person-avatar">{props.initials}</div>
      <div className="person-info"><strong>{props.name}</strong><span>{props.role}</span><div className="person-tags">{props.tags.map((tag) => <em key={tag}>{tag}</em>)}</div></div>
      <button onClick={props.onAction}>{props.action}<ArrowIcon /></button>
    </div>
  );
}

function SystemLine({ children }: { children: React.ReactNode }) {
  return <div className="system-line"><span />{children}<span /></div>;
}

function KnowledgeSection(props: { title: string; children: React.ReactNode }) {
  return <section className="knowledge-section"><h3>{props.title}</h3><div>{props.children}</div></section>;
}

function KnowledgeView(props: { knowledge: KnowledgeItem[]; query: string; onQuery: (value: string) => void; validated: boolean }) {
  const filtered = props.knowledge.filter((item) => `${item.title} ${item.domain} ${item.source}`.toLowerCase().includes(props.query.toLowerCase()));
  const groups = Array.from(new Set(filtered.map((item) => item.domain.split(" · ")[0])));
  return (
    <section className="index-page page-fade">
      <div className="page-heading"><div><span className="eyebrow">Organisational memory</span><h1>Knowledge</h1><p>What Sifu is allowed to teach, with provenance attached.</p></div></div>
      <div className="index-search"><SearchIcon /><input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search what Sifu knows..." /></div>
      <div className="filter-line"><button className="selected">All</button><button>Validated</button><button>Candidate</button><button>Superseded</button></div>
      {groups.map((group) => (
        <section className="knowledge-group" key={group}>
          <h2>{group}</h2>
          {filtered.filter((item) => item.domain.startsWith(group)).map((item) => (
            <button className="knowledge-row" key={item.id}>
              <StatusDot status={item.status} />
              <span className="knowledge-row-copy"><strong>{item.title}</strong><small>{item.domain}{item.source ? ` · ${item.source}` : ""}</small></span>
              <span className="knowledge-row-meta">{item.status === "validated" ? `Used ${item.used} ${item.used === 1 ? "time" : "times"}` : "Awaiting validation"}</span>
              <ArrowIcon />
            </button>
          ))}
        </section>
      ))}
      {props.validated && <div className="quiet-success">✓ The backflow teaching is now validated and available to future Sifu answers.</div>}
    </section>
  );
}

function CasesView() {
  return (
    <section className="index-page page-fade">
      <div className="page-heading"><div><span className="eyebrow">What happened once</span><h1>Cases</h1><p>Real questions and incidents. A case only becomes organisational knowledge when something reusable is validated.</p></div></div>
      <TimelineGroup title="Today" rows={[
        ["Pump RUNNING while water rises", "Amanda Lee · Basement B2", "Resolved with Tan Wei Ming", "14:32"],
        ["Chiller rattling after outage", "Daniel Wong · Tower C", "Awaiting Marcus Lee", "13:08"],
        ["Access route blocked during maintenance", "Sarah Tan · Tower A", "Resolved from validated knowledge", "10:44"],
      ]} />
      <TimelineGroup title="Yesterday" rows={[
        ["FCU condensation after schedule change", "Jamie Goh · Tower B", "Needs more information", "16:18"],
        ["Unexpected BMS telemetry drop", "Marcus Lee · Central Plant", "Resolved", "11:06"],
      ]} />
    </section>
  );
}

function TimelineGroup(props: { title: string; rows: string[][] }) {
  return (
    <section className="timeline-group"><h2>{props.title}</h2>{props.rows.map((row) => <button className="timeline-row" key={row[0]}><span className="timeline-title"><strong>{row[0]}</strong><small>{row[1]}</small></span><span>{row[2]}</span><time>{row[3]}</time><ArrowIcon /></button>)}</section>
  );
}

function RequestsView({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="index-page page-fade">
      <div className="page-heading"><div><span className="eyebrow">Workflow preview</span><h1>Expertise requests</h1><p>This queue is the next live workflow to connect. Sifu’s Ask surface no longer fabricates expert replies.</p></div></div>
      <section className="timeline-group"><h2>Design-state examples</h2>
        <button className="timeline-row high" onClick={onOpen}><span className="request-pulse" /><span className="timeline-title"><strong>Pump RUNNING while water rises</strong><small>Amanda Lee · Basement B2 · example request</small></span><span>Preview</span><ArrowIcon /></button>
        <button className="timeline-row"><span className="request-pulse" /><span className="timeline-title"><strong>Chiller restart after brief outage</strong><small>Daniel Wong · Tower C · example request</small></span><span>Preview</span><ArrowIcon /></button>
      </section>
    </section>
  );
}

function ReviewsView(props: { validated: boolean; onValidate: () => void }) {
  if (props.validated) {
    return (
      <section className="review-page page-fade">
        <div className="validation-celebration"><SifuAvatar size="hero" mood="proud" /><span className="validation-check">✓</span><h1>Teaching validated</h1><p>Drain backflow can mask drainage failure</p><div className="validation-meta">Taught by Tan Wei Ming · Validated by Jennifer Lim · Version 1</div><div className="motto-large">Ask once. Teach forever.</div></div>
      </section>
    );
  }
  return (
    <section className="review-page page-fade">
      <div className="review-header"><button className="back-link">← Reviews</button><span className="status-word candidate">Candidate</span></div>
      <article className="review-manuscript">
        <div className="manuscript-kicker">Technical Services · Drainage</div>
        <h1>Drain backflow can mask drainage failure</h1>
        <p className="review-byline">Taught by Tan Wei Ming · Captured from Case #4387</p>
        <KnowledgeSection title="Principle">Verified drain backflow can indicate ineffective drainage even when the water level is temporarily flat.</KnowledgeSection>
        <KnowledgeSection title="Scope">Basement sump drainage systems where downstream conditions can force water back toward the sump.</KnowledgeSection>
        <KnowledgeSection title="What to check"><ul><li>Verified backflow at the drain</li><li>Actual discharge effectiveness</li><li>Water-level trend</li></ul></KnowledgeSection>
        <KnowledgeSection title="Escalate when">Backflow is verified, or effective drainage cannot be confirmed.</KnowledgeSection>
        <KnowledgeSection title="Source"><p>Tan Wei Ming · Senior M&E Technician</p><button className="source-link">View original discussion →</button></KnowledgeSection>
        <aside className="margin-comment"><span>Jennifer Lim</span><p>Should this be restricted to systems without a non-return valve?</p><button>Request clarification</button></aside>
      </article>
      <div className="review-actions"><button className="text-action">Request clarification</button><button className="primary-action" onClick={props.onValidate}>Validate teaching <CheckIcon /></button></div>
    </section>
  );
}

function ExpertiseView() {
  return (
    <section className="index-page page-fade">
      <div className="page-heading"><div><span className="eyebrow">Who knows what</span><h1>Expertise</h1><p>Organisation-assigned expertise combined with evidence from resolved Sifu interactions.</p></div></div>
      <div className="index-search"><SearchIcon /><input placeholder="Search people, systems or topics..." /></div>
      <ExpertiseGroup title="Drainage" people={[
        ["TW", "Tan Wei Ming", "Senior M&E Technician", "Sump systems · Drainage failures · Pump maintenance", "23 questions resolved · 12 validated teachings"],
        ["JL", "Jennifer Lim", "Facilities Engineering Lead", "Drainage engineering · System design · Failure escalation", "Knowledge Owner · 8 questions resolved"],
      ]} />
      <ExpertiseGroup title="Building controls" people={[
        ["ML", "Marcus Lee", "BMS Engineer", "BMS telemetry · Control logic · Sensor anomalies", "17 questions resolved · 7 validated teachings"],
      ]} />
    </section>
  );
}

function ExpertiseGroup(props: { title: string; people: string[][] }) {
  return (
    <section className="expertise-group"><h2>{props.title}</h2>{props.people.map((person) => <button className="expert-row" key={person[1]}><span className="person-avatar large">{person[0]}</span><span className="expert-copy"><strong>{person[1]}</strong><small>{person[2]}</small><em>{person[3]}</em></span><span className="expert-meta">{person[4]}</span><ArrowIcon /></button>)}</section>
  );
}

function StatusDot({ status }: { status: KnowledgeItem["status"] }) {
  return <span className={`status-dot ${status}`} aria-label={status} />;
}

function SifuAvatar({ size, mood }: { size: "small" | "hero"; mood: "calm" | "thinking" | "searching" | "proud" }) {
  return (
    <div className={`sifu-avatar ${size} mood-${mood}`} aria-label={`Sifu ${mood}`}>
      <svg viewBox="0 0 96 96" role="img" aria-hidden="true">
        <path className="ear left" d="M22 31 13 13l24 11Z" />
        <path className="ear right" d="m74 31 9-18-24 11Z" />
        <circle className="head" cx="48" cy="46" r="31" />
        <path className="mask" d="M24 39c7-9 15-12 24-8 9-4 17-1 24 8-4 4-9 8-16 10-4 1-12 1-16 0-7-2-12-6-16-10Z" />
        <ellipse className="eye" cx="37" cy="42" rx="3" ry="4" />
        <ellipse className="eye" cx="59" cy="42" rx="3" ry="4" />
        <path className="muzzle" d="M36 54c7 6 17 6 24 0-1 12-6 20-12 24-6-4-11-12-12-24Z" />
        <path className="brow left" d="M31 35c4-3 8-4 12-2" />
        <path className="brow right" d="M53 33c4-2 8-1 12 2" />
        <circle className="nose" cx="48" cy="51" r="3" />
      </svg>
      <span className="avatar-spark">✦</span>
    </div>
  );
}

function PlusIcon() { return <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24"><path d="M5 18 3 21l5-2h9a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v7a4 4 0 0 0 2 4Z" /></svg>; }
function BookIcon() { return <svg viewBox="0 0 24 24"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z" /><path d="M18 20V7a3 3 0 0 1 3-3v13a3 3 0 0 1-3 3Z" /></svg>; }
function CasesIcon() { return <svg viewBox="0 0 24 24"><path d="M4 5h16v15H4z" /><path d="M8 2v6M16 2v6M4 10h16" /></svg>; }
function PeopleIcon() { return <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 2-7 6-7s6 3 6 7" /><circle cx="17" cy="9" r="2" /><path d="M16 14c3 0 5 2 5 5" /></svg>; }
function ReviewIcon() { return <svg viewBox="0 0 24 24"><path d="M5 3h14v18H5z" /><path d="m8 12 2 2 5-5M8 6h8" /></svg>; }
function NetworkIcon() { return <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m9 11 6-4M9 13l6 4" /></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24"><path d="m4 12 16-8-6 16-3-6Z" /><path d="m11 14 9-10" /></svg>; }
function ArrowIcon() { return <svg className="arrow-icon" viewBox="0 0 24 24"><path d="M5 12h13M14 7l5 5-5 5" /></svg>; }
function CheckIcon() { return <svg className="check-icon" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>; }
