import KnowledgeOwnerReviewsView from "./KnowledgeOwnerReviewsView";
import { demoUser } from "./demoIdentity";

export default function OwnerDemoShell() {
  return (
    <div className="sifu-app">
      <aside className="sifu-sidebar">
        <div className="brand-lockup">
          <div className="person-avatar">S</div>
          <div><div className="brand-word">SIFU</div><div className="brand-line">Shared intelligence</div></div>
        </div>
        <a className="new-question" href="/">← Employee workspace</a>
        <div className="sidebar-section-label">Your work</div>
        <nav className="primary-nav" aria-label="Knowledge Owner workspace">
          <button className="nav-row active"><span className="nav-icon">✓</span><span>Reviews</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer live"><span className="presence-dot" />Knowledge Owner workspace</div>
      </aside>

      <div className="sifu-stage">
        <header className="sifu-topbar">
          <div className="topbar-context">
            <span className="topbar-kicker">Shared Intelligence From Us</span>
            <span className="topbar-motto">Human validation before organisational teaching.</span>
          </div>
          <div className="topbar-user">
            <div className="user-avatar">{demoUser.initials}</div>
            <div className="user-copy"><strong>{demoUser.name}</strong><span>{demoUser.subtitle}</span></div>
          </div>
        </header>
        <main className="sifu-main"><KnowledgeOwnerReviewsView /></main>
      </div>
    </div>
  );
}
