import { useState, useEffect, useCallback } from "react";
import { getHealth, setRole, getPills, getRecommendations, getRecommendation } from "./api";
import type { PillVersion, RecommendationRecord } from "./types";
import { LiveCase } from "./components/FinalLiveCase";
import { IntelligencePills } from "./components/IntelligencePills";
import { ExactPillView } from "./components/ExactPillView";
import { KnowledgeEvolution } from "./components/FinalKnowledgeEvolution";
import { Home } from "./components/Home";
import { HowItWorks } from "./components/HowItWorks";
import { Capture } from "./components/Capture";
import { PERSONAS } from "./lib/glossary";

type View = "home" | "how" | "operational" | "pills" | "evolution" | "capture";

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
  const [liveRecId, setLiveRecId] = useState<string | null>(null);
  const [pillsSelectedId, setPillsSelectedId] = useState<string | null>(null);
  const [exactPillVersion, setExactPillVersion] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState<boolean>(() => { try { return localStorage.getItem("sifu-banner-dismissed") !== "1"; } catch { return true; } });

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    getPills().then(setPills).catch(() => {});
    // Only roles allowed to read recommendations ask for them (no 403s for other roles).
    if (role !== "operator" && role !== "approver") { setRecommendations([]); return; }
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

  const openRegistryPill = useCallback((pillId: string) => {
    setPillsSelectedId(pillId);
    setExactPillVersion(null);
    setView("pills");
  }, []);

  const openGovernancePill = useCallback((pillId: string) => {
    // Knowledge Evolution knows which governance state the user is looking at even though
    // its legacy callback passes only pill_id. Preserve that exact candidate here instead
    // of silently falling back to the approved release.
    const targetStatus = role === "expert" ? "DRAFT" : role === "reviewer" ? "IN_REVIEW" : null;
    const exact = targetStatus
      ? [...pills]
          .filter((p) => p.pill_id === pillId && p.status === targetStatus)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : undefined;
    setPillsSelectedId(pillId);
    setExactPillVersion(exact?.version ?? null);
    setView("pills");
  }, [pills, role]);

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
        <div className="topbar-brand">Sifu<span className="brand-sub">AI Harvest</span></div>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {health && <span className="topbar-env"><span className="topbar-env-dot" />{health.environment === "demo" ? "Demo" : health.environment} with {health.provider === "mock" ? "offline AI" : `live AI (${health.provider})`}</span>}
          <select className="role-select" value={role} onChange={(e) => handleRoleChange(e.target.value)}>
            <option value="viewer">Viewer · Guest</option>
            <option value="operator">Operator · {PERSONAS.operator.name}</option>
            <option value="expert">Expert · {PERSONAS.expert.name}</option>
            <option value="reviewer">Reviewer · {PERSONAS.reviewer.name}</option>
            <option value="approver">Approver · {PERSONAS.approver.name}</option>
          </select>
        </div>
      </header>

      {showBanner && (
        <div className="demo-banner">
          <span>Demo environment — all sites, people and readings are fictional.</span>
          <button onClick={() => { setShowBanner(false); try { localStorage.setItem("sifu-banner-dismissed", "1"); } catch { /* ignore */ } }} aria-label="Dismiss">×</button>
        </div>
      )}
      <div className="app-body">
        <nav className="app-sidebar">
          <div className="sidebar-group">
            <div className="sidebar-group-label">Overview</div>
            <button className={`sidebar-item ${view === "home" ? "active" : ""}`} title="Home" aria-label="Home" onClick={() => setView("home")}><HomeIcon />Home</button>
            <button className={`sidebar-item ${view === "how" ? "active" : ""}`} title="Guide" aria-label="Guide" onClick={() => setView("how")}><HowIcon />Guide</button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Operations</div>
            <button className={`sidebar-item ${view === "operational" ? "active" : ""}`} title="Live Case" aria-label="Live Case" onClick={() => setView("operational")}>
              <LiveCaseIcon />Live Case
              {computeBadge("operational") && <span className="sidebar-badge">{computeBadge("operational")}</span>}
            </button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Intelligence</div>
            <button className={`sidebar-item ${view === "capture" ? "active" : ""}`} title="Capture know-how" aria-label="Capture know-how" onClick={() => setView("capture")}><CaptureIcon />Capture know-how</button>
            <button className={`sidebar-item ${view === "pills" ? "active" : ""}`} title="Intelligence Pills" aria-label="Intelligence Pills" onClick={() => { setExactPillVersion(null); setView("pills"); }}>
              <PillIcon />Intelligence Pills
              {computeBadge("pills") && <span className="sidebar-badge">{computeBadge("pills")}</span>}
            </button>
            <button className={`sidebar-item ${view === "evolution" ? "active" : ""}`} title="Knowledge Evolution" aria-label="Knowledge Evolution" onClick={() => { setEvolutionRecId(null); setView("evolution"); }}><EvolutionIcon />Knowledge Evolution</button>
          </div>
        </nav>

        <main className="app-content">
          {view === "how" && <HowItWorks onStart={() => setView("operational")} />}
          {view === "capture" && <Capture key={`capture-${role}`} onGoToPill={openRegistryPill} />}
          {view === "home" && (
            <Home
              key={`home-${role}`}
              onGoToHowItWorks={(section?: string) => { setView("how"); if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}
              onGoToLiveCase={(recId?: string) => { setLiveRecId(recId ?? null); setView("operational"); }}
              onGoToEvolution={(recId?: string) => { setEvolutionRecId(recId ?? null); setView("evolution"); }}
              onGoToPill={openRegistryPill}
            />
          )}
          {view === "operational" && (
            <LiveCase
              key={`live-${role}-${liveRecId ?? "none"}`}
              openRecId={liveRecId}
              onGoToEvolution={(recId: string) => { setEvolutionRecId(recId); setView("evolution"); }}
              onGoToPill={openRegistryPill}
            />
          )}
          {view === "pills" && pillsSelectedId && exactPillVersion ? (
            <ExactPillView
              key={`exact-${pillsSelectedId}-${exactPillVersion}-${role}`}
              pillId={pillsSelectedId}
              version={exactPillVersion}
              onBack={() => setExactPillVersion(null)}
            />
          ) : view === "pills" && (
            <IntelligencePills
              key={`pills-${role}`}
              selectedPillId={pillsSelectedId}
              onSelectedPillIdChange={(id) => { setPillsSelectedId(id); setExactPillVersion(null); }}
            />
          )}
          {view === "evolution" && (
            <KnowledgeEvolution
              key={`evo-${evolutionRecId ?? "none"}-${role}`}
              preselectedRecId={evolutionRecId}
              onGoToPill={openGovernancePill}
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

function CaptureIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
