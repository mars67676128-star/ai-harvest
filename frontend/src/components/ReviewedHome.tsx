const ROLE_COPY: Record<string, string> = {
  operator: "Run governed assessments, record accountable decisions, and capture what actually happened.",
  expert: "Own the knowledge: review AI-proposed revisions and submit corrected candidates for independent review.",
  reviewer: "Independently challenge candidate knowledge and run regression validation before release.",
  approver: "Decide whether validated knowledge becomes the next approved operational version.",
  viewer: "Inspect Intelligence Pills and governance metadata. Operational recommendations remain role-restricted.",
};

export function ReviewedHome({ role, onGoLive, onGoPills, onGoEvolution }: { role: string; onGoLive: () => void; onGoPills: () => void; onGoEvolution: () => void }) {
  return (
    <div className="home">
      <div className="home-hero">
        <div>
          <div className="home-eyebrow">Signed in as {role} · demo persona</div>
          <h1 className="home-title">Expert judgement, captured once and governed for reuse.</h1>
          <p className="home-sub">{ROLE_COPY[role] ?? ROLE_COPY.viewer}</p>
        </div>
      </div>
      <div className="home-grid">
        <section className="home-main">
          <h2 className="home-h2">How AI HARVEST works</h2>
          <ol className="how-steps">
            <li className="how-step"><span className="how-n">1</span><div><div className="how-title">Capture <span className="how-who">Expert</span></div><div className="how-body">Tacit judgement, exceptions and escalation logic become structured candidate knowledge.</div></div></li>
            <li className="how-step"><span className="how-n">2</span><div><div className="how-title">Govern <span className="how-who">Reviewer · Approver</span></div><div className="how-body">Candidates are reviewed, regression-tested, versioned and approved before operational use.</div></div></li>
            <li className="how-step"><span className="how-n">3</span><div><div className="how-title">Apply <span className="how-who">Operator</span></div><div className="how-body">Deterministic rules produce bounded recommendations. AI may explain, but does not decide or execute.</div></div></li>
            <li className="how-step"><span className="how-n">4</span><div><div className="how-title">Learn <span className="how-who">Everyone</span></div><div className="how-body">Outcomes and corrections create candidate revisions; production knowledge changes only after governance.</div></div></li>
          </ol>
          <div className="flex gap-8 flex-wrap mt-24">
            <button className="btn btn-primary" onClick={onGoLive}>Open Live Case</button>
            <button className="btn" onClick={onGoPills}>Inspect Intelligence Pills</button>
            <button className="btn" onClick={onGoEvolution}>Open Knowledge Evolution</button>
          </div>
        </section>
        <aside className="home-side">
          <h2 className="home-h2">What makes it different</h2>
          <div className="callout callout-info"><strong>Not a chatbot.</strong> The reusable asset is the governed Intelligence Pill, not a one-off model answer.</div>
          <div className="callout callout-warning mt-16"><strong>Humans retain authority.</strong> execution_allowed remains false; consequential actions and knowledge release require people.</div>
          <div className="callout callout-info mt-16"><strong>Safe learning.</strong> A new AI proposal cannot silently replace an approved version.</div>
        </aside>
      </div>
    </div>
  );
}
