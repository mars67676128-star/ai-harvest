import { useState } from "react";
import { GLOSSARY, PERSONAS } from "../lib/glossary";

// Guide — an operational help page: workflow, roles, system rules, glossary, colours.

const STEPS = [
  {
    n: 1, title: "Capture", who: "Expert",
    body: "The expert answers 7 guided questions about a real incident on the Capture page. AI drafts rules from the answers.",
    example: "“A running pump indication does not prove effective drainage.”",
  },
  {
    n: 2, title: "Review & approve", who: "Expert · Reviewer · Approver",
    body: "The draft becomes a pill version. The expert submits it, a different engineer reviews it and runs its test situations, and the owner approves it.",
    example: "Monsoon near-miss triage · v1.0.0 · Approved",
  },
  {
    n: 3, title: "Use on a live case", who: "Operator",
    body: "The operator enters the readings. Approved pills recommend, block or escalate. They never control equipment, change access or message tenants.",
    example: "Pump running + water rising → escalate to the duty facilities engineer",
  },
  {
    n: 4, title: "Improve", who: "Operator · Expert · Reviewer · Approver",
    body: "After the event the operator records what happened and what was missed. AI drafts a revised version, which goes through step 2 again before it replaces the current one.",
    example: "Drain backflow missed → revision proposed → reviewed → approved",
  },
];

const ROLES = [
  { role: "Operator", who: `Asset Operations Manager on duty — in this demo, ${PERSONAS.operator.name}`, can: "Run assessments, record escalations, report outcomes and feedback" },
  { role: "Expert", who: `Senior technician whose know-how is captured — ${PERSONAS.expert.name}`, can: "Check AI proposals against their expertise, submit for review, revise after rejection" },
  { role: "Reviewer", who: `A different senior engineer — ${PERSONAS.reviewer.name}`, can: "Independently review changes, run regression tests, reject with a reason" },
  { role: "Approver", who: `Owner of the knowledge area — ${PERSONAS.approver.name}`, can: "Release a new version (which supersedes the old one) or retire a version" },
  { role: "Viewer", who: "Management, auditors, colleagues", can: "Inspect Intelligence Pills and governance metadata; operational recommendations remain role-restricted" },
];

const PRINCIPLES = [
  { t: "Decisions come from approved rules", b: "AI drafts, proposes and explains. Its output is always labelled and is never used as a decision." },
  { t: "Approved pills don't change", b: "Every change is a new version with a visible diff, inherited test situations and named sign-offs. To undo a release, retire it and re-approve the earlier content as a new version." },
  { t: "No one approves their own work", b: "The reviewer and the approver must be different people from the author. Every action is recorded in the audit trail." },
  { t: "Pills can be exported", b: "Download any pill as a PDF or JSON file. Pills don't depend on a particular AI model or vendor." },
];

export function HowItWorks({ onStart }: { onStart: () => void }) {
  return (
    <div className="howpage">
      <div className="home-eyebrow">Guide</div>
      <h1 className="home-title">How the workflow runs</h1>
      <p className="home-sub">
        Sifu holds the building team's checked know-how as Intelligence Pills. This guide covers the workflow, who does
        what, the system rules and the terms used across the app.
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

      <h2 className="home-h2 mt-24">System rules</h2>
      <div className="principles">
        {PRINCIPLES.map((p) => (
          <div key={p.t} className="principle">
            <div className="principle-t">{p.t}</div>
            <div className="principle-b">{p.b}</div>
          </div>
        ))}
      </div>

      <h2 className="home-h2 mt-24">Who does what</h2>
      <p className="text-dim mb-16">Demo: switch roles with the selector in the top-right corner to see each person's view.</p>
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
          <div className="how-title">Demo scenario</div>
          <div className="text-dim">Harbour Exchange basement sump, heavy rain — the pump is green, but the water is rising.</div>
        </div>
        <button className="btn btn-primary" onClick={onStart}>Open Live Case</button>
      </div>
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
