import SifuCaseGuidance from "./SifuCaseGuidance";
import "./operational-case.css";

export default function OperationalCaseShell() {
  const backToSifu = () => {
    window.location.assign(window.location.pathname);
  };

  return (
    <div className="operational-case-shell">
      <div className="app-shell">
        <header className="app-topbar">
          <div className="topbar-brand">
            SIFU<span className="brand-sub">AI HARVEST</span>
          </div>
          <div className="topbar-spacer" />
          <button className="back-link" onClick={backToSifu}>← Back to Sifu</button>
        </header>

        <div className="app-body">
          <nav className="app-sidebar">
            <div className="sidebar-group">
              <div className="sidebar-group-label">Operations</div>
              <button className="sidebar-item" onClick={backToSifu}>← Sifu workspace</button>
              <div className="sidebar-item active">Case Guidance</div>
            </div>
          </nav>

          <main className="app-content">
            <SifuCaseGuidance />
          </main>
        </div>
      </div>
    </div>
  );
}
