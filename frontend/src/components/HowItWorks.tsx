import { useState } from "react";
import { GLOSSARY, PERSONAS } from "../lib/glossary";

// "How AI HARVEST works" — a standalone orientation page for first-time users and judges.

const STEPS = [
  {
    n: 1, title: "Capture", who: "Expert",
    body: "Senior engineers are interviewed about real cases and near-misses — the judgement that isn't in any manual.",
    example: "“A running pump indication does not prove effective drainage.”",
  },
  {
    n: 2, title: "Govern", who: "Reviewer · Approver",
    body: "That judgement becomes an Intelligence Pill: explicit rules, safety boundaries and regression tests, independently reviewed and approved as a version.",
    example: "Monsoon near-miss triage · v1.0.0 · Approved",
  },
  {
    n: 3, title: "Apply", who: "Operator",
    body: "When something happens on site, approved pills assess the situation with fixed rules. They recommend, block and escalate — they never act on the building.",
    example: "Pump running + water rising → escalate to the duty facilities engineer",
  },
  {
    n: 4, title: "Learn", who: "Everyone",
    body: "What actually happened feeds back. AI proposes a revised pill; people review the change, run the tests and decide whether to release it.",
    example: "Drain backflow discovered → v1.1 proposed → reviewed → approved",
  },
];

const ROLES = [
  { role: "Operator", who: `Asset Operations Manager on duty — in this demo, ${PERSONAS.operator.name}`, can: "Run assessments, record escalations, report outcomes and feedback" },
  { role: "Expert", who: `Senior technician whose know-how is captured — ${PERSONAS.expert.name}`, can: "Check AI proposals against their expertise, submit for review, revise after rejection" },
  { role: "Reviewer", who: `A different senior engineer — ${PERSONAS.reviewer.name}`, can: "Independently review changes, run regression tests, reject with a reason" },
  { role: "Approver", who: `Owner of the knowledge area — ${PERSONAS.approver.name}`, can: "Release a new version (which supersedes the old one) or retire a version" },
  { role: "Viewer", who: "Management, auditors, colleagues", can: "Read every pill and decision — change nothing" },
];

const PRINCIPLES = [
  { t: "AI never decides", b: "Decisions come from approved, deterministic rules. AI only drafts, proposes and explains — and everything it produces is labelled." },
  { t: "Nothing changes silently", b: "Approved pills are immutable. Every change is a new version with a visible diff, inherited tests and named sign-offs." },
  { t: "People stay accountable", b: "Escalations, reviews and releases are recorded against a role in an audit trail. No one approves their own work." },
  { t: "Keppel owns the knowledge", b: "Pills are portable, versioned records (JSON / PDF) — independent of any AI vendor or model." },
];

export function HowItWorks({ onStart }: { onStart: () => void }) {
  return (
    <div className="howpage">
      <div className="home-eyebrow">How AI HARVEST works</div>
      <h1 className="home-title">Experienced engineers' judgement — captured once, governed like a release, used safely every day.</h1>
      <p className="home-sub">
        When something goes wrong in a building, AI HARVEST checks the situation against experts' know-how and tells the
        team on shift what to do, what not to do, and who must take over. It never acts on its own. What actually happened
        is then used to improve that know-how — but only after people review and approve the change.
      </p>

      <ol className="how-flow">
        {STEPS.map((s, i) => (
          <li key={s.n} className="how-flow-step">
            <div className="how-flow-head">
              <span className="how-n">{s.n}</span>
              <div>
                <div className="how-title">{s.title}</div>
                <div className="how-who">{s.who}</div>
              </div>
            </div>
            <p className="how-body">{s.body}</p>
            <div className="how-example">{s.example}</div>
            {i < STEPS.length - 1 && <span className="how-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>
      <div className="how-loop-note">↺ Step 4 feeds back into step 2 — the knowledge keeps improving, under control.</div>

      <h2 className="home-h2 mt-24">Four principles</h2>
      <div className="principles">
        {PRINCIPLES.map((p) => (
          <div key={p.t} className="principle">
            <div className="principle-t">{p.t}</div>
            <div className="principle-b">{p.b}</div>
          </div>
        ))}
      </div>

      <h2 className="home-h2 mt-24">Who does what</h2>
      <p className="text-dim mb-16">Switch roles with the selector in the top-right corner to see each person's view.</p>
      <ul className="role-list">
        {ROLES.map((r) => (
          <li key={r.role} className="role-row">
            <span className="role-name">{r.role}</span>
            <span className="role-who">{r.who}</span>
            <span className="role-can">{r.can}</span>
          </li>
        ))}
      </ul>

      <h2 className="home-h2 mt-24" id="glossary">Glossary — every term in plain words</h2>
      <Glossary />

      <h2 className="home-h2 mt-24">Reading the colours</h2>
      <div className="how-legend">
        <span><i className="lg lg-teal" />Approved organisational knowledge</span>
        <span><i className="lg lg-ai" />AI-generated — never authoritative</span>
        <span><i className="lg lg-amber" />Needs a person's sign-off</span>
        <span><i className="lg lg-red" />Blocked or rejected</span>
      </div>

      <div className="how-cta">
        <div>
          <div className="how-title">Try the demo story</div>
          <div className="text-dim">Harbour Exchange basement sump, heavy rain — the pump is green, but the water is rising.</div>
        </div>
        <button className="btn btn-primary" onClick={onStart}>Start the demo →</button>
      </div>
      <p className="text-muted text-sm mt-16">All people, buildings, readings and outcomes in this demo are synthetic.</p>
    </div>
  );
}

function Glossary() {
  const [f, setF] = useState("");
  const t = f.toLowerCase().trim();
  const list = GLOSSARY.filter((g) => !t || `${g.term} ${g.plain}`.toLowerCase().includes(t));
  return (
    <div className="glossary">
      <input className="glossary-filter" value={f} onChange={(e) => setF(e.target.value)} placeholder="Filter terms…" aria-label="Filter glossary" />
      <dl className="glossary-list">
        {list.map((g) => (
          <div key={g.key} className="glossary-row">
            <dt>{g.term}</dt>
            <dd>{g.plain}{g.example && <span className="glossary-ex">e.g. {g.example}</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted text-sm mt-8">Terms with a dotted underline anywhere in the app show these definitions when you hover over them.</p>
    </div>
  );
}
