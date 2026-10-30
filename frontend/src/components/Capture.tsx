// Capture know-how: guided expert interview → AI draft of a pill → human review.
// Answers Keppel's first requirement: collect knowledge that is not already documented.
import { useEffect, useState } from "react";
import { createCapture, extractCapture, getElicitation, getRole } from "../api";
import type { ElicitationQuestion, ExtractionRecord } from "../api";
import { DEMO_INTERVIEWS } from "../lib/demoInterviews";
import { DomainIcon } from "./DomainIcon";
import { Term, Avatar } from "./Term";
import { persona } from "../lib/glossary";
import { cleanText } from "../lib/format";

const TECHNIQUE_PLAIN: Record<string, { label: string; why: string }> = {
  "incident reconstruction": { label: "Walk through a real incident", why: "Anchors the interview in what actually happened, not the textbook." },
  "decision walkthrough": { label: "What changed your mind", why: "Finds the clues an expert reads that others ignore." },
  "novice comparison": { label: "What a junior would miss", why: "Exposes the trap — the exact thing new staff get wrong." },
  counterfactual: { label: "If the signal were wrong", why: "Shows how to catch misleading readings (like a green light that lies)." },
  "exception discovery": { label: "When the rule doesn't apply", why: "Captures the limits, so the rule isn't used out of context." },
  uncertainty: { label: "When to say “I can't tell”", why: "Defines when the pill must refuse to guess." },
  escalation: { label: "Who must take over", why: "Names the person with authority, and what stays outside the pill." },
};

const INPUT_PLAIN: Record<string, string> = {
  water_rise_mm_min: "Water level change (mm/min)",
  pump_running: "Pump light on",
  critical_equipment_exposed: "Electrical equipment at risk",
  alternative_route_verified: "Other entrance checked safe",
  tenant_arrivals_expected: "Tenants arriving",
  drain_backflow: "Water backing up from the drain",
};
const OP_PLAIN: Record<string, string> = { gt: "above", gte: "at or above", lt: "below", lte: "at or below", eq: "is", ne: "is not" };
const PILL_FOR_DOMAIN: Record<string, string> = {
  "Asset Operations": "asset.monsoon.triage",
  "Tenant Experience": "tenant.incident.continuity",
};

function cond(c: { input: string; op: string; value: boolean | number | string }) {
  const label = INPUT_PLAIN[c.input] ?? c.input.replace(/_/g, " ");
  if (typeof c.value === "boolean") return `${label}: ${c.op === "ne" ? (c.value ? "no" : "yes") : c.value ? "yes" : "no"}`;
  return `${label} ${OP_PLAIN[c.op] ?? c.op} ${c.value}`;
}

export function Capture({ onGoToPill }: { onGoToPill: (pillId: string) => void }) {
  const role = getRole();
  const isExpert = role === "expert";
  const [questions, setQuestions] = useState<ElicitationQuestion[]>([]);
  const [which, setWhich] = useState(0);
  const [title, setTitle] = useState(DEMO_INTERVIEWS[0].title);
  const [domain, setDomain] = useState<string>(DEMO_INTERVIEWS[0].domain);
  const [transcript, setTranscript] = useState(cleanText(DEMO_INTERVIEWS[0].transcript));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExtractionRecord | null>(null);

  useEffect(() => {
    getElicitation().then(setQuestions).catch(() => setQuestions([]));
  }, []);

  const pick = (i: number) => {
    setWhich(i);
    setTitle(DEMO_INTERVIEWS[i].title);
    setDomain(DEMO_INTERVIEWS[i].domain);
    setTranscript(cleanText(DEMO_INTERVIEWS[i].transcript));
    setDraft(null);
    setError(null);
  };
  const edited = transcript.trim() !== cleanText(DEMO_INTERVIEWS[which].transcript);
  const transcriptTooShort = transcript.trim().length < 30;

  const run = async () => {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const cap = await createCapture({ title, transcript, domain: domain as never, synthetic: true });
      const started = Date.now();
      const ex = await extractCapture(cap.id);
      const wait = 2800 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setDraft(ex);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("MOCK_FIXTURE_ONLY")
          ? "The offline demo AI can only read the two recorded interviews word-for-word. To extract from your own interview, configure a live AI model (HARVEST_LLM_PROVIDER=tencent). Or press a “Load example” button to continue the demo."
          : msg.includes("LLM_UNAVAILABLE")
          ? "The live AI model is unavailable or returned invalid output. No knowledge was changed. Check server credentials (HARVEST_LLM_API_KEY, HARVEST_LLM_MODEL) and try again, or switch to demo mode."
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const c = draft?.content;
  const actionText = (id: string) => (c?.actions.find((a) => a.id === id)?.description ?? id.replace(/_/g, " ")).replace(/\.$/, "");
  const tan = persona("expert");

  return (
    <div className="capture">
      <div className="home-eyebrow">Capture know-how</div>
      <h1 className="home-title">Record an expert's know-how</h1>
      <p className="home-sub">
        Go through the 7 <Term k="capture">guided questions</Term> about a real incident. AI drafts rules from the
        answers. Nothing is used until the expert, an independent reviewer and the owner have checked it.
      </p>

      {/* 1. Questions */}
      <section className="cap-section">
        <h2 className="cap-h"><span className="how-n">1</span> The guided interview — 7 questions</h2>
        <ol className="q-list">
          {(questions.length ? questions : Object.keys(TECHNIQUE_PLAIN).map((t) => ({ technique: t, question: "" }))).map((q, i) => {
            const plain = TECHNIQUE_PLAIN[q.technique];
            return (
              <li key={q.technique} className="q-item">
                <span className="q-n">{i + 1}</span>
                <div>
                  <div className="q-label">{plain?.label ?? q.technique}</div>
                  {q.question && <div className="q-text">“{q.question}”</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 2. Interview */}
      <section className="cap-section">
        <h2 className="cap-h"><span className="how-n">2</span> What the expert said</h2>
        <div className="cap-tabs">
          {DEMO_INTERVIEWS.map((d, i) => (
            <button key={d.domain} className={`cap-tab ${which === i ? "on" : ""}`} onClick={() => pick(i)}>
              <DomainIcon domain={d.domain} size={24} /> Load example: {d.domain}
            </button>
          ))}
        </div>
        <div className="cap-interview">
          <div className="cap-who">
            <Avatar actor="expert" size={34} />
            <div>
              <div><b>{tan.name}</b> · {tan.title}</div>
              <div className="text-muted text-sm">Type your own interview or load an example above.</div>
            </div>
          </div>
          <div className="cap-form-row">
            <label className="cap-field">
              <span className="cap-label">Title</span>
              <input
                className="cap-input"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setDraft(null); }}
                placeholder="e.g. Interview with the duty engineer about a chiller trip"
                aria-label="Interview title"
              />
            </label>
            <label className="cap-field">
              <span className="cap-label">Domain</span>
              <select
                className="cap-input"
                value={domain}
                onChange={(e) => { setDomain(e.target.value); setDraft(null); }}
                aria-label="Domain"
              >
                <option>Asset Operations</option>
                <option>Energy Optimisation</option>
                <option>Leasing</option>
                <option>Technical Services</option>
                <option>Sustainability</option>
                <option>Tenant Experience</option>
              </select>
            </label>
          </div>
          <textarea
            className="cap-text"
            value={transcript}
            onChange={(e) => { setTranscript(e.target.value); setDraft(null); }}
            rows={7}
            aria-label="Interview transcript"
            placeholder="Paste or type the full expert interview here…"
          />
          <div className="cap-actions">
            <span className="text-muted text-sm">
              {transcriptTooShort
                ? "Interview needs at least 30 characters."
                : edited
                ? "Free-form interview — a live model reads any text. The offline demo AI only reads the two example recordings."
                : "Interview answers, transcribed."}
            </span>
            <div className="flex gap-8">
              {edited && <button className="btn btn-quiet" onClick={() => pick(which)}>Use the recording</button>}
              <button className="btn btn-primary" onClick={run} disabled={busy || !isExpert || transcriptTooShort}>
                {busy ? "AI is drafting…" : "Draft a pill with AI"}
              </button>
            </div>
          </div>
          {!isExpert && (
            <div className="callout callout-info mt-8">
              Only the expert records their own interview. Switch to <b>Expert · {tan.name}</b> (top right) to run this step.
            </div>
          )}
          {error && <div className="error-box mt-8">{error}</div>}
          {busy && (
            <div className="ai-skeleton mt-16" aria-label="Drafting">
              <div className="ai-writing">AI is reading the interview and drafting rules…</div>
              <span /><span /><span />
            </div>
          )}
        </div>
      </section>

      {/* 3. AI draft */}
      {draft && c && (
        <section className="cap-section">
          <h2 className="cap-h"><span className="how-n">3</span> AI's draft — for people to check</h2>
          <div className="callout callout-ai">
            <b>AI-generated, not authoritative.</b> {cleanText(draft.summary)}
            <div className="text-sm mt-8">
              {draft.ai?.live ? "Live model" : "Offline demo AI (recorded output)"} · {String(draft.ai?.model ?? "")} · prompt {String(draft.ai?.prompt_version ?? "")}
            </div>
          </div>

          <div className="draft-grid">
            <div className="draft-block">
              <div className="section-heading">When it applies</div>
              <p>{c.scope.equipment.join(", ").replace(/_/g, " ")} · {c.scope.contexts.join(", ").replace(/_/g, " ")} · {c.scope.asset_types.join(", ")} buildings</p>
              {c.scope.exclusions.map((x) => <p key={x} className="text-muted text-sm">Not for: {x}</p>)}
            </div>
            <div className="draft-block">
              <div className="section-heading">Readings it will need</div>
              <ul className="plain-list">{c.inputs.map((i) => <li key={i.key}>{INPUT_PLAIN[i.key] ?? i.key}</li>)}</ul>
            </div>
          </div>

          <div className="section-heading mt-16">Rules the AI found ({c.rules.length})</div>
          <ul className="draft-rules">
            {c.rules.map((r) => (
              <li key={r.id} className={`draft-rule cat-${r.category}`}>
                <div className="draft-when">If {r.when.map(cond).join(" and ")}</div>
                <div className="draft-then">
                  {r.recommend.length > 0 && <span>→ suggest: {r.recommend.map(actionText).join("; ")}</span>}
                  {r.block.length > 0 && <span className="text-danger">→ <Term k="blocked">block</Term>: {r.block.map(actionText).join("; ")}</span>}
                  {r.escalate_to && <span>→ <Term k="escalate">escalate</Term> to <b>{r.escalate_to}</b></span>}
                </div>
                <div className="draft-why">{r.rationale}</div>
              </li>
            ))}
          </ul>

          <div className="draft-grid mt-16">
            <div className="draft-block">
              <div className="section-heading">Never allowed</div>
              <ul className="plain-list">{c.prohibited_actions.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            <div className="draft-block">
              <div className="section-heading">Questions still open</div>
              {[...c.unresolved_questions, ...draft.elicitation_gaps].length === 0
                ? <p className="text-muted text-sm">None flagged.</p>
                : <ul className="plain-list">{[...c.unresolved_questions, ...draft.elicitation_gaps].map((q) => <li key={q}>{q}</li>)}</ul>}
            </div>
          </div>
        </section>
      )}

      {/* 4. Next */}
      <section className="cap-section">
        <p className="text-dim">Next: <b>{tan.name}</b> checks the draft and submits it for review.</p>
        {PILL_FOR_DOMAIN[domain] ? (
          <div className="how-teaser">
            In this demo, a similar interview already became <a onClick={() => onGoToPill(PILL_FOR_DOMAIN[domain])}>
              {domain === "Asset Operations" ? "Monsoon near-miss triage" : "Tenant incident continuity"} →</a>
          </div>
        ) : (
          <div className="how-teaser">
            For a new domain, compile the draft into a candidate pill and submit it for independent review.
          </div>
        )}
      </section>
    </div>
  );
}
