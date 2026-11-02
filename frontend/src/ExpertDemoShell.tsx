import ExpertRequestsView from "./ExpertRequestsView";
import { demoUser } from "./demoIdentity";

export default function ExpertDemoShell() {
  return (
    <div className="sifu-app">
      <aside className="sifu-sidebar">
        <div className="brand-lockup">
          <div className="person-avatar">S</div>
          <div><div className="brand-word">SIFU</div><div className="brand-line">Shared intelligence</div></div>
        </div>

        <a className="new-question" href="/">← Employee workspace</a>

        <div className="sidebar-section-label">Your work</div>
        <nav className="primary-nav" aria-label="Expert workspace">
          <button className="nav-row active">
            <span className="nav-icon">◎</span>
            <span>Expertise requests</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-footer live"><span className="presence-dot" />Expert workspace</div>
      </aside>

      <div className="sifu-stage">
        <header className="sifu-topbar">
          <div className="topbar-context">
            <span className="topbar-kicker">Shared Intelligence From Us</span>
            <span className="topbar-motto">Teach once. Help the next person too.</span>
          </div>
          <div className="topbar-user">
            <div className="user-avatar">{demoUser.initials}</div>
            <div className="user-copy"><strong>{demoUser.name}</strong><span>{demoUser.subtitle}</span></div>
          </div>
        </header>
        <main className="sifu-main"><ExpertRequestsView /></main>
      </div>
    </div>
  );
}
