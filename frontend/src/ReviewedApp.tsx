import { useEffect, useState } from "react";
import { getHealth, setRole } from "./api";
import { ReviewedHome } from "./components/ReviewedHome";
import { ReviewedLiveCase } from "./components/ReviewedLiveCase";
import { ReviewedPills } from "./components/ReviewedPills";
import { ReviewedEvolution } from "./components/ReviewedEvolution";

type View = "home" | "operational" | "pills" | "evolution";
const ROLE_KEY = "ai-harvest-role";

function initialRole(): string {
  try {
    const saved = localStorage.getItem(ROLE_KEY);
    if (saved && ["viewer", "operator", "expert", "reviewer", "approver"].includes(saved)) {
      setRole(saved);
      return saved;
    }
  } catch { /* ignore */ }
  setRole("operator");
  return "operator";
}

export default function ReviewedApp() {
  const [view, setView] = useState<View>("home");
  const [role, setRoleState] = useState(initialRole);
  const [evolutionRecId, setEvolutionRecId] = useState<string | null>(null);
  const [selectedPillKey, setSelectedPillKey] = useState<string | null>(null);
  const [health, setHealth] = useState<{status:string; environment:string; provider:string; synthetic_demo:boolean} | null>(null);

  useEffect(() => { getHealth().then(setHealth).catch(() => {}); }, []);

  const changeRole = (next: string) => {
    setRole(next);
    setRoleState(next);
    try { localStorage.setItem(ROLE_KEY, next); } catch { /* ignore */ }
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">AI <span className="accent">HARVEST</span></div>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {health && <span className="topbar-env"><span className="topbar-env-dot" />{health.environment} · {health.provider}{health.synthetic_demo ? " · synthetic" : ""}</span>}
          <select className="role-select" value={role} onChange={(e) => changeRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="expert">Expert</option>
            <option value="reviewer">Reviewer</option>
            <option value="approver">Approver</option>
          </select>
        </div>
      </header>
      <div className="app-body">
        <nav className="app-sidebar">
          <div className="sidebar-group">
            <div className="sidebar-group-label">Overview</div>
            <button className={`sidebar-item ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}>Home</button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Operations</div>
            <button className={`sidebar-item ${view === "operational" ? "active" : ""}`} onClick={() => setView("operational")}>Live Case</button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Intelligence</div>
            <button className={`sidebar-item ${view === "pills" ? "active" : ""}`} onClick={() => setView("pills")}>Intelligence Pills</button>
            <button className={`sidebar-item ${view === "evolution" ? "active" : ""}`} onClick={() => { setEvolutionRecId(null); setView("evolution"); }}>Knowledge Evolution</button>
          </div>
        </nav>
        <main className="app-content">
          {view === "home" && <ReviewedHome role={role} onGoLive={() => setView("operational")} onGoPills={() => setView("pills")} onGoEvolution={() => setView("evolution")} />}
          {view === "operational" && <ReviewedLiveCase key={`live-${role}`} onGoEvolution={(recId) => { setEvolutionRecId(recId); setView("evolution"); }} onGoPill={(pillId, version) => { setSelectedPillKey(`${pillId}@${version}`); setView("pills"); }} />}
          {view === "pills" && <ReviewedPills key={`pills-${role}`} selectedKey={selectedPillKey} onSelectedKeyChange={setSelectedPillKey} />}
          {view === "evolution" && <ReviewedEvolution key={`evo-${role}-${evolutionRecId ?? "none"}`} preselectedRecId={evolutionRecId} onGoLive={() => setView("operational")} onGoPills={() => setView("pills")} />}
        </main>
      </div>
    </div>
  );
}
