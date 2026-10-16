import { useState, useEffect, useCallback } from "react";
import { getHealth, setRole, getPills, getRecommendations, getRecommendation } from "./api";
import type { PillVersion, RecommendationRecord } from "./types";
import { LiveCase } from "./components/FinalLiveCase";
import { IntelligencePills } from "./components/IntelligencePills";
import { KnowledgeEvolution } from "./components/FinalKnowledgeEvolution";
import { Home } from "./components/Home";
import { HowItWorks } from "./components/HowItWorks";

type View = "home" | "how" | "operational" | "pills" | "evolution";

const ROLE_STORAGE_KEY = "ai-harvest-role";

function loadSavedRole(): string {
  try {
    const saved = localStorage.getItem(ROLE_STORAGE_KEY);
    if (saved && ["viewer", "operator", "expert", "reviewer", "approver"].includes(saved)) {
      setRole(saved);
      return saved;
    }
  } catch { /* ignore */ }
  setRole("operator");
  return "operator";
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [role, setRoleState] = useState(loadSavedRole);
  const [health, setHealth] = useState<{
    status: string;
    environment: string;
    provider: string;
    synthetic_demo: boolean;
  } | null>(null);
  const [pills, setPills] = useState<PillVersion[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [evolutionRecId, setEvolutionRecId] = useState<string | null>(null);
  const [pillsSelectedId, setPillsSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    getPills().then(setPills).catch(() => {});
    getRecommendations()
      .then((all) => Promise.all(all.map((r) => getRecommendation(r.id).catch(() => r))))
      .then(setRecommendations)
      .catch(() => setRecommendations([]));
  }, [role]);

  const handleRoleChange = useCallback((r: string) => {
    setRole(r);
    setRoleState(r);
    try { localStorage.setItem(ROLE_STORAGE_KEY, r); } catch { /* ignore */ }
  }, []);

  const computeBadge = (target: View): number | null => {
    if (target === "pills") {
      if (role === "reviewer" || role === "approver") {
        const count = pills.filter((p) => p.status === "IN_REVIEW").length;
        return count > 0 ? count : null;
      }
      if (role === "expert") {
        const count = pills.filter((p) => p.status === "DRAFT").length;
        return count > 0 ? count : null;
      }
      return null;
    }
    if (target === "operational" && role === "operator") {
      const count = recommendations.filter((r) => r.human_decision === null && r.result.decision === "ESCALATE").length;
      return count > 0 ? count : null;
    }
    return null;
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">AI <span className="accent">HARVEST</span></div>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {health && <span className="topbar-env"><span className="topbar-env-dot" />{health.environment} · {health.provider}{health.synthetic_demo ? " · synthetic" : ""}</span>}
          <select className="role-select" value={role} onChange={(e) => handleRoleChange(e.target.value)}>
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
            <button className={`sidebar-item ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}><HomeIcon />Home</button>
            <button className={`sidebar-item ${view === "how" ? "active" : ""}`} onClick={() => setView("how")}><HowIcon />How it works</button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Operations</div>
            <button className={`sidebar-item ${view === "operational" ? "active" : ""}`} onClick={() => setView("operational")}>
              <LiveCaseIcon />Live Case
              {computeBadge("operational") && <span className="sidebar-badge">{computeBadge("operational")}</span>}
            </button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Intelligence</div>
            <button className={`sidebar-item ${view === "pills" ? "active" : ""}`} onClick={() => setView("pills")}>
              <PillIcon />Intelligence Pills
              {computeBadge("pills") && <span className="sidebar-badge">{computeBadge("pills")}</span>}
            </button>
            <button className={`sidebar-item ${view === "evolution" ? "active" : ""}`} onClick={() => { setEvolutionRecId(null); setView("evolution"); }}><EvolutionIcon />Knowledge Evolution</button>
          </div>
        </nav>

        <main className="app-content">
          {view === "how" && <HowItWorks onStart={() => setView("operational")} />}
          {view === "home" && (
            <Home
              key={`home-${role}`}
              onGoToHowItWorks={() => setView("how")}
              onGoToLiveCase={() => setView("operational")}
              onGoToEvolution={(recId?: string) => { setEvolutionRecId(recId ?? null); setView("evolution"); }}
              onGoToPill={(pillId: string) => { setPillsSelectedId(pillId); setView("pills"); }}
            />
          )}
          {view === "operational" && (
            <LiveCase
              key={`live-${role}`}
              onGoToEvolution={(recId: string) => { setEvolutionRecId(recId); setView("evolution"); }}
              onGoToPill={(pillId: string) => { setPillsSelectedId(pillId); setView("pills"); }}
            />
          )}
          {view === "pills" && (
            <IntelligencePills
              key={`pills-${role}`}
              selectedPillId={pillsSelectedId}
              onSelectedPillIdChange={setPillsSelectedId}
            />
          )}
          {view === "evolution" && (
            <KnowledgeEvolution
              key={`evo-${evolutionRecId ?? "none"}-${role}`}
              preselectedRecId={evolutionRecId}
              onGoToPill={(pillId: string) => { setPillsSelectedId(pillId); setView("pills"); }}
              onGoToLiveCase={() => setView("operational")}
              onRefreshPills={() => { getPills().then(setPills).catch(() => {}); }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function LiveCaseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
}
function PillIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 20.5L3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z" /><path d="M8.5 8.5l7 7" /></svg>;
}
function EvolutionIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9-9v18" /></svg>;
}
function HomeIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>;
}
function HowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" /><path d="M12 17h.01" /></svg>;
}
