import { useEffect } from "react";
import { LiveCase } from "./components/FinalLiveCase";
import "./operational-case.css";

function applySifuCaseLanguage() {
  const root = document.querySelector(".operational-case-shell");
  if (!root) return;

  const sectionHeading = root.querySelector<HTMLElement>(".section-heading");
  if (sectionHeading && sectionHeading.textContent !== "Current situation") {
    sectionHeading.textContent = "Current situation";
  }

  const risingOption = root.querySelector<HTMLOptionElement>('select.role-select option[value="rising"]');
  if (risingOption && risingOption.textContent !== "Pump running · water rising") {
    risingOption.textContent = "Pump running · water rising";
  }

  const backflowOption = root.querySelector<HTMLOptionElement>('select.role-select option[value="backflow"]');
  if (backflowOption && backflowOption.textContent !== "Flat water trend · drain backflow") {
    backflowOption.textContent = "Flat water trend · drain backflow";
  }

  root.querySelectorAll<HTMLButtonElement>("button.btn.btn-primary").forEach((button) => {
    const label = button.textContent?.trim();
    if (label === "Run Operational Assessment") button.textContent = "Apply Validated Knowledge";
    if (label === "Running…") button.textContent = "Applying…";
  });

  root.querySelectorAll<HTMLElement>(".callout.callout-info").forEach((callout) => {
    if (callout.textContent?.trim().startsWith("No case open.")) {
      callout.textContent = "Ready to apply validated organisational knowledge to these readings.";
    }
  });
}

export default function OperationalCaseShell() {
  const backToSifu = () => {
    window.location.assign(window.location.pathname);
  };

  useEffect(() => {
    applySifuCaseLanguage();
    const root = document.querySelector(".operational-case-shell");
    if (!root) return;

    const observer = new MutationObserver(() => applySifuCaseLanguage());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
            <LiveCase />
          </main>
        </div>
      </div>
    </div>
  );
}
