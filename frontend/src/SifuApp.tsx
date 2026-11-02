import { FormEvent, useMemo, useState } from "react";

type View = "ask" | "knowledge" | "cases" | "requests" | "reviews" | "expertise";
type ChatPhase = "empty" | "gap" | "expert" | "candidate" | "confirmed";

type KnowledgeItem = {
  id: string;
  title: string;
  domain: string;
  source: string;
  status: "validated" | "candidate" | "superseded";
  used: number;
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
  const [chatPhase, setChatPhase] = useState<ChatPhase>("empty");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [validated, setValidated] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");

  const knowledge = useMemo(() => {
    if (!validated) return seededKnowledge;
    return seededKnowledge.map((item) =>
      item.id === "backflow" ? { ...item, status: "validated" as const, used: 1 } : item,
    );
  }, [validated]);

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setQuestion(text);
    setDraft("");
    setChatPhase("gap");
  };

  const startPreview = () => {
    setQuestion(sampleQuestion);
    setChatPhase("gap");
  };

  const resetConversation = () => {
    setQuestion("");
    setDraft("");
    setChatPhase("empty");
    setCandidateOpen(false);
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
      />

      <div className="sifu-stage">
        <header className="sifu-topbar">
          <div className="topbar-context">
            <span className="topbar-kicker">Shared Intelligence From Us</span>
            <span className="topbar-motto">Ask once. Teach forever.</span>
          </div>
          <div className="topbar-user">
            <button className="quiet-icon" aria-label="Search"><SearchIcon /></button>
            <div className="user-avatar">AL</div>
            <div className="user-copy"><strong>Amanda Lee</strong><span>Operations</span></div>
          </div>
        </header>

        <main className="sifu-main">
          {view === "ask" && (
            <AskView
              phase={chatPhase}
              question={question}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={submitQuestion}
              onPreview={startPreview}
              onAskExpert={() => setChatPhase("expert")}
              onReviewInsight={() => setCandidateOpen(true)}
              candidateConfirmed={chatPhase === "confirmed"}
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
          {view === "requests" && <RequestsView onOpen={() => { setView("ask"); setQuestion(sampleQuestion); setChatPhase("expert"); }} />}
          {view === "reviews" && (
            <ReviewsView
              validated={validated}
              onValidate={() => setValidated(true)}
            />
          )}
          {view === "expertise" && <ExpertiseView />}
        </main>
      </div>

      {candidateOpen && (
        <CandidateOverlay
          onClose={() => setCandidateOpen(false)}
          onConfirm={() => {
            setCandidateOpen(false);
            setChatPhase("confirmed");
          }}
        />
      )}
    </div>
  );
}

function Sidebar(props: {
  view: View;
  onNavigate: (view: View) => void;
  onNewQuestion: () => void;
  requestCount: number;
  reviewCount: number;
}) {
  const { view, onNavigate, onNewQuestion, requestCount, reviewCount } = props;
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
      <div className="sidebar-footer"><span className="presence-dot" />Sifu is ready</div>
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
  phase: ChatPhase;
  question: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPreview: () => void;
  onAskExpert: () => void;
  onReviewInsight: () => void;
  candidateConfirmed: boolean;
}) {
  if (props.phase === "empty") {
    return (
      <section className="ask-empty page-fade">
        <div className="mentor-hero"><SifuAvatar size="hero" mood="calm" /></div>
        <p className="eyebrow">Good evening, Amanda.</p>
        <h1>What can I help you with?</h1>
        <p className="hero-copy">Ask about a situation at work. I’ll use validated organisational knowledge, or find the right person when I don’t know.</p>
        <Composer value={props.draft} onChange={props.onDraftChange} onSubmit={props.onSubmit} />
        <div className="starter-row">
          <button onClick={props.onPreview}>Equipment issue</button>
          <button onClick={() => props.onDraftChange("What is the correct escalation path for a tenant access issue?")}>Procedure</button>
          <button onClick={() => props.onDraftChange("Who has experience with BMS telemetry faults?")}>Find an expert</button>
        </div>
        <div className="recent-learning">
          <span>Recently learned</span>
          <button onClick={props.onPreview}>RUNNING status ≠ effective drainage <ArrowIcon /></button>
          <button>Alternative access routes must be verified <ArrowIcon /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="conversation-page page-fade">
      <div className="conversation-title"><span>Basement drainage question</span><button>•••</button></div>
      <div className="conversation-stream">
        <HumanMessage name="Amanda Lee">{props.question}</HumanMessage>

        {props.phase === "gap" && (
          <SifuMessage mood="searching">
            <p>I don’t have validated organisational knowledge that fully covers this exact situation.</p>
            <p className="muted-copy">Rather than guess, I found someone whose experience is closely related.</p>
            <PersonInline
              initials="TW"
              name="Tan Wei Ming"
              role="Senior M&E Technician"
              tags={["Sump systems · Strong", "Drainage · Strong", "23 related cases"]}
              action="Ask Tan"
              onAction={props.onAskExpert}
            />
          </SifuMessage>
        )}

        {(props.phase === "expert" || props.phase === "confirmed") && (
          <>
            <SystemLine>Tan Wei Ming joined · Sifu shared only the relevant case context</SystemLine>
            <HumanMessage name="Tan Wei Ming" tone="expert">
              A RUNNING indication only tells you that the motor has been commanded to operate. It doesn’t prove that water is actually being discharged. Check the water-level trend and actual discharge first.
            </HumanMessage>
            <SifuMessage mood="thinking">
              <p>Tan, one clarification so I don’t preserve this too broadly:</p>
              <p><strong>Does this apply generally, or specifically where RUNNING reflects command or motor state?</strong></p>
            </SifuMessage>
            <HumanMessage name="Tan Wei Ming" tone="expert">
              Specifically where RUNNING comes from command or motor state. If actual discharge is measured independently, that is different. If water is still climbing despite RUNNING, I would escalate and verify the drainage path.
            </HumanMessage>
            <div className="insight-event">
              <span className="spark">✦</span>
              <div><strong>Sifu noticed a reusable teaching</strong><span>This could help someone facing the same condition later.</span></div>
              <button onClick={props.onReviewInsight}>Review what I understood <ArrowIcon /></button>
            </div>
            {props.candidateConfirmed && (
              <div className="confirmed-event">
                <span>✓</span>
                <div><strong>Meaning confirmed by Tan Wei Ming</strong><p>Candidate Pill created and sent to Jennifer Lim, Knowledge Owner for Technical Services.</p></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="conversation-composer-wrap"><Composer value={props.draft} onChange={props.onDraftChange} onSubmit={props.onSubmit} compact /></div>
    </section>
  );
}

function Composer(props: { value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; compact?: boolean }) {
  return (
    <form className={`composer ${props.compact ? "compact" : ""}`} onSubmit={props.onSubmit}>
      <textarea
        aria-label="Ask Sifu"
        value={props.value}
        rows={props.compact ? 2 : 3}
        placeholder="Ask Sifu about your work..."
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-actions">
        <button type="button" className="composer-tool" aria-label="Attach"><PlusIcon /></button>
        <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
        <button type="submit" className="send-button" aria-label="Send"><SendIcon /></button>
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

function CandidateOverlay(props: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="candidate-backdrop" role="dialog" aria-modal="true" aria-label="Candidate knowledge review">
      <button className="candidate-close" onClick={props.onClose} aria-label="Close">×</button>
      <article className="candidate-manuscript">
        <div className="manuscript-kicker">Candidate Knowledge Pill</div>
        <h2>RUNNING status does not confirm effective drainage</h2>
        <p className="manuscript-intro">Sifu extracted this from Tan’s explanation. Tan is confirming that the interpretation is accurate — not approving company policy.</p>
        <KnowledgeSection title="Principle">A RUNNING state confirms command or motor state, not actual drainage effectiveness.</KnowledgeSection>
        <KnowledgeSection title="Applies when">RUNNING is derived from control or motor status rather than independently measured discharge.</KnowledgeSection>
        <KnowledgeSection title="Check"><ul><li>Water-level trend</li><li>Actual discharge</li></ul></KnowledgeSection>
        <KnowledgeSection title="Escalate when">Water continues rising despite RUNNING status.</KnowledgeSection>
        <KnowledgeSection title="Source"><p>Tan Wei Ming · Senior M&E Technician</p><p>Case #4387 · Basement B2</p></KnowledgeSection>
        <div className="manuscript-actions"><button className="text-action" onClick={props.onClose}>Not reusable</button><button className="text-action">Edit</button><button className="primary-action" onClick={props.onConfirm}>Looks right <CheckIcon /></button></div>
      </article>
    </div>
  );
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
      <div className="page-heading"><div><span className="eyebrow">Questions routed to you</span><h1>Expertise requests</h1><p>Sifu asks when your experience is relevant. Saying “I don’t know” is a valid outcome.</p></div></div>
      <section className="timeline-group"><h2>Needs your input</h2>
        <button className="timeline-row high" onClick={onOpen}><span className="request-pulse" /><span className="timeline-title"><strong>Pump RUNNING while water rises</strong><small>Amanda Lee · Basement B2 · Strong expertise match</small></span><span>8 min</span><ArrowIcon /></button>
        <button className="timeline-row"><span className="request-pulse" /><span className="timeline-title"><strong>Chiller restart after brief outage</strong><small>Daniel Wong · Tower C · Relevant</small></span><span>41 min</span><ArrowIcon /></button>
      </section>
      <section className="timeline-group"><h2>Previously handled</h2>
        <button className="timeline-row"><span className="timeline-title"><strong>Repeated sump alarm after storm</strong><small>Resolved · Candidate knowledge created</small></span><span>Yesterday</span><ArrowIcon /></button>
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
