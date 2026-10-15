import { useState, useEffect, useCallback } from "react";
import { getHealth, setRole, getPills, getRecommendations } from "./api";
import type { PillVersion, RecommendationRecord } from "./types";
import { LiveCase } from "./components/LiveCase";
import { IntelligencePills } from "./components/IntelligencePills";
import { KnowledgeEvolution } from "./components/KnowledgeEvolution";

type View = "operational" | "pills" | "evolution";

export default function App() {
  const [view, setView] = useState<View>("operational");
  const [role, setRoleState] = useState("operator");
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

  // Load pills and recommendations for sidebar badges
  useEffect(() => {
    getPills().then(setPills).catch(() => {});
    getRecommendations().then(setRecommendations).catch(() => {});
  }, [role]);

  const handleRoleChange = useCallback((r: string) => {
    setRole(r);
    setRoleState(r);
  }, []);

  // Compute sidebar badge counts based on role
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
    if (target === "operational") {
      if (role === "operator" || role === "viewer") {
        const count = recommendations.filter((r) =>
          r.human_decision === null && r.result.decision === "ESCALATE"
        ).length;
        return count > 0 ? count : null;
      }
      return null;
    }
    return null;
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          AI <span className="accent">HARVEST</span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {health && (
            <span className="topbar-env">
              <span className="topbar-env-dot" />
              {health.environment} · {health.provider}
              {health.synthetic_demo ? " · synthetic" : ""}
            </span>
          )}
          <select
            className="role-select"
            value={role}
            onChange={(e) => handleRoleChange(e.target.value)}
          >
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
            <div className="sidebar-group-label">Operations</div>
            <button
              className={`sidebar-item ${view === "operational" ? "active" : ""}`}
              onClick={() => setView("operational")}
            >
              <LiveCaseIcon />
              Live Case
              {computeBadge("operational") && (
                <span className="sidebar-badge">{computeBadge("operational")}</span>
              )}
            </button>
          </div>
          <div className="sidebar-group">
            <div className="sidebar-group-label">Intelligence</div>
            <button
              className={`sidebar-item ${view === "pills" ? "active" : ""}`}
              onClick={() => setView("pills")}
            >
              <PillIcon />
              Intelligence Pills
              {computeBadge("pills") && (
                <span className="sidebar-badge">{computeBadge("pills")}</span>
              )}
            </button>
            <button
              className={`sidebar-item ${view === "evolution" ? "active" : ""}`}
              onClick={() => setView("evolution")}
            >
              <EvolutionIcon />
              Knowledge Evolution
            </button>
          </div>
        </nav>

        <main className="app-content">
          {view === "operational" && (
            <LiveCase
              key={`live-${role}`}
              onGoToEvolution={(recId: string) => {
                setEvolutionRecId(recId);
                setView("evolution");
              }}
              onGoToPill={(pillId: string) => {
                setPillsSelectedId(pillId);
                setView("pills");
              }}
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
              key={`evo-${evolutionRecId ?? "none"}`}
              preselectedRecId={evolutionRecId}
              onGoToPill={(pillId: string) => {
                setPillsSelectedId(pillId);
                setView("pills");
              }}
              onRefreshPills={() => {
                getPills().then(setPills).catch(() => {});
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function LiveCaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function PillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 20.5L3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z" />
      <path d="M8.5 8.5l7 7" />
    </svg>
  );
}

function EvolutionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9-9v18" />
    </svg>
  );
}
