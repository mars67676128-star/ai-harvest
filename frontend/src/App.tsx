import { useState, useEffect, useCallback } from "react";
import { getHealth, setRole } from "./api";
import { OperationalCase } from "./components/OperationalCase";

type View = "operational" | "pills" | "audit";

export default function App() {
  const [view, setView] = useState<View>("operational");
  const [role, setRoleState] = useState("operator");
  const [health, setHealth] = useState<{
    status: string;
    environment: string;
    provider: string;
    synthetic_demo: boolean;
  } | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const handleRoleChange = useCallback((r: string) => {
    setRole(r);
    setRoleState(r);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          AI <span className="accent">HARVEST</span>
        </div>
        <nav className="topbar-nav">
          <button
            className={view === "operational" ? "active" : ""}
            onClick={() => setView("operational")}
          >
            Operational Case
          </button>
          <button
            className={view === "pills" ? "active" : ""}
            onClick={() => setView("pills")}
          >
            Intelligence Pills
          </button>
          <button
            className={view === "audit" ? "active" : ""}
            onClick={() => setView("audit")}
          >
            Audit
          </button>
        </nav>
        <div className="topbar-right">
          {health && (
            <span className="text-sm text-dim">
              {health.environment} · {health.provider}
              {health.synthetic_demo ? " · synthetic" : ""}
            </span>
          )}
          <select value={role} onChange={(e) => handleRoleChange(e.target.value)}>
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="expert">expert</option>
            <option value="reviewer">reviewer</option>
            <option value="approver">approver</option>
          </select>
        </div>
      </header>

      <main className="content">
        {view === "operational" && <OperationalCase />}
        {view === "pills" && (
          <div className="loading">Intelligence Pills registry — not implemented in this milestone.</div>
        )}
        {view === "audit" && (
          <div className="loading">Audit timeline — not implemented in this milestone.</div>
        )}
      </main>
    </div>
  );
}
